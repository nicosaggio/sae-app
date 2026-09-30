/**
 * Crear una versión del catálogo con los precios finales de un evento puntual, leídos de un archivo
 * (la misma planilla de presupuesto de siempre — ver catalogoListaPreciosService). En dos pasos, igual
 * que la actualización de la base parche:
 *   1. previsualizar(): lee el archivo y arma el reporte (qué ítems tienen precio, cuáles no, cómo
 *      quedarían comparados con la General de hoy) SIN guardar nada.
 *   2. confirmar(): recién ahí crea la versión, fija (no se recalcula nunca sola).
 */
const crypto = require('crypto');
const calculo = require('./catalogoCalculoService');
const versionesService = require('./catalogoVersionesService');
const { normalizarCodigo } = require('./catalogoPreciosService');
const { leerListaDePrecios } = require('./catalogoListaPreciosService');

const { errorHttp } = calculo;

const VIGENCIA_MS = 30 * 60 * 1000;

// Previsualizaciones esperando confirmación. Viven en memoria: si se reinicia el servidor hay que volver a subir el archivo.
const pendientes = new Map();

function limpiarVencidas() {
  const ahora = Date.now();
  for (const [token, p] of pendientes) if (ahora - p.creadoEn > VIGENCIA_MS) pendientes.delete(token);
}

function redondear1(n) {
  return Math.round(n * 10) / 10;
}

/** Arma el reporte de previsualización a partir de la lista ya leída. No escribe nada. */
function armarReporte(lista, { archivo }) {
  const items = calculo.leerItems();
  const codigosCatalogo = new Set(items.map((i) => normalizarCodigo(i.codigo)));

  const conPrecio = [];
  const sinPrecio = [];
  for (const item of items) {
    const crudo = lista.precios.get(normalizarCodigo(item.codigo));
    const nuevoSae = typeof crudo === 'number' && crudo > 0 ? Math.round(crudo) : null;
    const fila = {
      codigo: item.codigo,
      descripcion: item.descripcion,
      sae_nuevo: nuevoSae,
      sae_general_actual: item.estado_precio === 'ok' ? item.sae : null,
      variacion_pct:
        nuevoSae !== null && item.estado_precio === 'ok' && item.sae > 0 ? redondear1(((nuevoSae - item.sae) / item.sae) * 100) : null,
      en_el_archivo: lista.precios.has(normalizarCodigo(item.codigo)),
    };
    if (nuevoSae !== null) conPrecio.push(fila);
    else sinPrecio.push(fila);
  }
  conPrecio.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  sinPrecio.sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  const codigosDesconocidos = [];
  for (const fila of lista.filas) {
    const clave = normalizarCodigo(fila.codigo);
    if (!codigosCatalogo.has(clave)) codigosDesconocidos.push({ fila: fila.fila, codigo: fila.codigo, descripcion: fila.descripcion });
  }

  return {
    archivo,
    columna_precio: lista.columnaPrecio,
    resumen: {
      itemsEvaluados: items.length,
      itemsConPrecio: conPrecio.length,
      itemsSinPrecio: sinPrecio.length,
      codigosDesconocidos: codigosDesconocidos.length,
    },
    items_con_precio: conPrecio,
    items_sin_precio: sinPrecio,
    codigos_desconocidos: codigosDesconocidos,
    advertencias: {
      codigos_repetidos_en_el_archivo: lista.duplicados,
      filas_con_precio_y_sin_codigo: lista.sinCodigo.length,
      filas_ocultas_ignoradas: lista.ocultas.length,
      valores_del_archivo: lista.resumen,
    },
  };
}

/** Paso 1: lee el archivo, valida los datos de la versión y arma el reporte. Devuelve el reporte y un token para confirmar. */
function previsualizar(origen, { archivo, usuarioId, nombre, aplicarATodos, fechaVigencia, pieLegal, porcentajeReferencia }) {
  limpiarVencidas();
  const lista = leerListaDePrecios(origen);
  // Se valida el nombre ahora para no hacer subir el archivo dos veces si ya está usado.
  versionesService.validarNombreNuevo(nombre);
  const reporte = armarReporte(lista, { archivo });

  for (const [token, p] of pendientes) if (p.usuarioId === usuarioId) pendientes.delete(token);
  const token = crypto.randomUUID();
  const creadoEn = Date.now();
  pendientes.set(token, { lista, archivo, usuarioId, creadoEn, datosVersion: { nombre, aplicarATodos, fechaVigencia, pieLegal, porcentajeReferencia } });
  return { token, vence_en: new Date(creadoEn + VIGENCIA_MS).toISOString(), ...reporte };
}

/** Paso 2: crea la versión, fija, con los precios del archivo. */
function confirmar(token, { usuarioId }) {
  limpiarVencidas();
  const pendiente = pendientes.get(token);
  if (!pendiente) throw errorHttp(410, 'La previsualización venció o no existe. Volvé a subir el archivo.');
  if (pendiente.usuarioId !== usuarioId) throw errorHttp(403, 'Esa previsualización la hizo otro usuario');

  const version = versionesService.crearVersionImportada({
    ...pendiente.datosVersion,
    lista: pendiente.lista,
    origenArchivo: pendiente.archivo,
  });
  pendientes.delete(token);
  return version;
}

module.exports = { previsualizar, confirmar, armarReporte, VIGENCIA_MS, _pendientes: pendientes };
