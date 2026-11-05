/**
 * Actualización de precios de la BASE PARCHE, en dos pasos:
 *   1. previsualizar(): con una base nueva (leída de un Excel) o previsualizarAumento(): con la base ya
 *      cargada aumentada un porcentaje. Calcula todo con los precios nuevos SIN guardar nada y devuelve
 *      el reporte (qué cambia, qué desaparece, qué queda sin precio).
 *   2. confirmar(): hace backup, guarda una foto de la General de antes en el historial, guarda la base
 *      nueva y recalcula SÓLO la General. Las versiones de evento no se tocan: se armaron con los precios
 *      de su momento y sólo se recalculan si se lo pide a mano ("Recalcular").
 * El .xlsx de origen nunca se modifica: sólo se lee.
 */
const crypto = require('crypto');
const { db, transaction } = require('../db/connection');
const { normalizarCodigo, describirMotivo } = require('./catalogoPreciosService');
const calculo = require('./catalogoCalculoService');
const versionesService = require('./catalogoVersionesService');

const { errorHttp } = calculo;

const VIGENCIA_MS = 30 * 60 * 1000;
const UMBRAL_VARIACION_PCT = 50;
const MAXIMO_NUEVOS_EN_BASE = 1000;

// Previsualizaciones esperando confirmación. Viven en memoria: si se reinicia el servidor hay que volver a subir el archivo.
const pendientes = new Map();

const iguales = (a, b) => (typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b);
const redondear1 = (n) => Math.round(n * 10) / 10;

function variacionPct(antes, despues) {
  if (typeof antes === 'number' && typeof despues === 'number' && antes > 0 && despues > 0) return redondear1(((despues - antes) / antes) * 100);
  return null;
}

/** Reporte de lo que pasaría al aplicar `baseParche`. No escribe nada. */
function armarReporte(baseParche, archivo) {
  const items = calculo.leerItems();
  const ajustes = calculo.leerAjustes();
  // Sólo se recalcula la General (ver confirmar()); es la única versión que queda afectada.
  const general = calculo.versionGeneral();
  const versiones = [general];
  const nuevos = calculo.calcularParaVersion(general, { items, base: baseParche.precios, ajustes });

  const porId = new Map(items.map((i) => [i.id, i]));
  const cambios = [];
  const sinPrecio = [];
  const desaparecidos = [];
  for (const item of items) {
    const r = nuevos.get(item.id);
    const cambio = !iguales(item.pase_parche, r.pase_parche) || item.sae !== r.sae || item.estado_precio !== r.estado;
    if (cambio) {
      const variacion = variacionPct(item.sae, r.sae) ?? variacionPct(item.pase_parche, r.pase_parche);
      cambios.push({
        id: item.id,
        codigo: item.codigo,
        descripcion: item.descripcion,
        pase_anterior: item.pase_parche,
        pase_nuevo: r.pase_parche,
        sae_anterior: item.sae,
        sae_nuevo: r.sae,
        estado_anterior: item.estado_precio,
        estado_nuevo: r.estado,
        motivo_nuevo: r.motivo,
        variacion_pct: variacion,
        destacado: variacion !== null && Math.abs(variacion) > UMBRAL_VARIACION_PCT,
      });
    }
    if (r.estado !== 'ok') {
      sinPrecio.push({
        codigo: item.codigo,
        descripcion: item.descripcion,
        estado: r.estado,
        motivo: r.motivo,
        motivo_texto: describirMotivo(r.motivo),
        tenia_precio: item.estado_precio === 'ok',
      });
    }
    if (item.regla_tipo === 'base' && !baseParche.precios.has(normalizarCodigo(item.regla_codigo_base || item.codigo))) {
      desaparecidos.push({ codigo: item.codigo, descripcion: item.descripcion, codigo_base: item.regla_codigo_base || item.codigo });
    }
  }

  const codigosCatalogo = new Set(items.map((i) => normalizarCodigo(i.codigo)));
  for (const i of items) if (i.regla_tipo === 'base') codigosCatalogo.add(normalizarCodigo(i.regla_codigo_base || i.codigo));
  const vistos = new Set();
  const nuevosEnBase = [];
  for (const fila of baseParche.filas) {
    const clave = normalizarCodigo(fila.codigo);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    if (!codigosCatalogo.has(clave)) nuevosEnBase.push({ codigo: fila.codigo, descripcion: fila.descripcion, grupo: fila.grupo, unidad: fila.unidad, cliente: fila.cliente });
  }

  const versionesAfectadas = versiones.map((v) => {
    const resultados = v.es_general ? nuevos : calculo.calcularParaVersion(v, { items, base: baseParche.precios, ajustes });
    const foto = new Map(db.prepare('SELECT item_id, sae, estado_precio FROM catalogo_version_precios WHERE version_id = ?').all(v.id).map((f) => [f.item_id, f]));
    let afectados = 0;
    for (const [itemId, r] of resultados) {
      const guardado = foto.get(itemId);
      if (!guardado || guardado.sae !== r.sae || guardado.estado_precio !== r.estado) afectados++;
    }
    return { id: v.id, nombre: v.nombre, es_general: v.es_general, porcentaje_global: v.porcentaje_global, items_afectados: afectados };
  });

  cambios.sort((a, b) => Math.abs(b.variacion_pct ?? 0) - Math.abs(a.variacion_pct ?? 0) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));

  return {
    archivo,
    resumen: {
      itemsEvaluados: items.length,
      itemsConCambios: cambios.length,
      itemsSinCambios: items.length - cambios.length,
      codigosDesaparecidos: desaparecidos.length,
      codigosNuevosEnBase: nuevosEnBase.length,
      itemsSinPrecio: sinPrecio.length,
      itemsQuePerdieronPrecio: sinPrecio.filter((s) => s.tenia_precio).length,
      variacionesGrandes: cambios.filter((c) => c.destacado).length,
      versionesAfectadas: versionesAfectadas.filter((v) => v.items_afectados > 0).length,
    },
    umbral_variacion_pct: UMBRAL_VARIACION_PCT,
    cambios,
    codigos_desaparecidos: desaparecidos,
    items_sin_precio: sinPrecio,
    codigos_nuevos_en_base: nuevosEnBase.slice(0, MAXIMO_NUEVOS_EN_BASE),
    versiones_afectadas: versionesAfectadas,
    advertencias: {
      codigos_repetidos_en_el_archivo: baseParche.duplicados,
      filas_con_precio_y_sin_codigo: baseParche.sinCodigo.length,
      filas_ocultas_ignoradas: baseParche.ocultas.length,
      valores_de_la_base: baseParche.resumen,
    },
  };
}

function limpiarVencidas() {
  const ahora = Date.now();
  for (const [token, p] of pendientes) if (ahora - p.creadoEn > VIGENCIA_MS) pendientes.delete(token);
}

/**
 * La base parche ya cargada con cada precio aumentado un porcentaje (fracción: 0,1 = 10 %), con la
 * misma forma que devuelve leerBaseParche. Los valores que no son un número (texto, vacío) quedan igual.
 */
function baseAumentada(porcentaje) {
  const filas = db.prepare('SELECT codigo, cliente_numero, cliente_texto, descripcion, grupo, unidad FROM catalogo_base_precios ORDER BY rowid').all();
  if (filas.length === 0) throw errorHttp(400, 'Todavía no hay una base parche cargada para aumentar.');
  const precios = new Map();
  const resumen = { conCodigo: 0, numericos: 0, ceros: 0, textos: 0, vacios: 0 };
  const aumentadas = filas.map((f, i) => {
    const cliente = f.cliente_numero !== null ? Math.round(f.cliente_numero * (1 + porcentaje) * 100) / 100 : f.cliente_texto;
    resumen.conCodigo++;
    if (cliente === null) resumen.vacios++;
    else if (typeof cliente === 'string') resumen.textos++;
    else if (cliente === 0) resumen.ceros++;
    else resumen.numericos++;
    const clave = normalizarCodigo(f.codigo);
    if (!precios.has(clave)) precios.set(clave, cliente);
    return { fila: i + 1, grupo: f.grupo, codigo: f.codigo, descripcion: f.descripcion, unidad: f.unidad, cliente };
  });
  return { precios, filas: aumentadas, duplicados: [], sinCodigo: [], ocultas: [], resumen };
}

/** "10 %", "12,5 %" */
const textoPorcentaje = (fraccion) => `${(Math.round(fraccion * 10000) / 100).toLocaleString('es-AR')} %`;

/** Paso 1: sólo lee y calcula. Devuelve el reporte y un token para confirmar. */
function previsualizar(baseParche, { archivo, usuarioId }) {
  limpiarVencidas();
  for (const [token, p] of pendientes) if (p.usuarioId === usuarioId) pendientes.delete(token);
  const reporte = armarReporte(baseParche, archivo);
  const token = crypto.randomUUID();
  const creadoEn = Date.now();
  pendientes.set(token, { baseParche, archivo, usuarioId, creadoEn });
  return { token, vence_en: new Date(creadoEn + VIGENCIA_MS).toISOString(), ...reporte };
}

/** Paso 1 de un aumento: la base cargada hoy, con todos sus precios aumentados `porcentaje` (fracción). */
function previsualizarAumento(porcentaje, { usuarioId }) {
  const n = typeof porcentaje === 'string' && porcentaje.trim() !== '' ? Number(porcentaje.replace(',', '.')) : porcentaje;
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0 || n > 3) {
    throw errorHttp(400, 'El aumento tiene que ser una fracción mayor a 0 y hasta 3 (0,1 = 10 %)');
  }
  return previsualizar(baseAumentada(n), { archivo: `Aumento del ${textoPorcentaje(n)} sobre la base cargada`, usuarioId });
}

/** Paso 2: backup, guardar la base nueva y recalcular la General (sólo ella), todo en una transacción. */
async function confirmar(token, { usuarioId, hacerBackup = null }) {
  limpiarVencidas();
  const pendiente = pendientes.get(token);
  if (!pendiente) throw errorHttp(410, 'La previsualización venció o no existe. Volvé a subir el archivo.');
  if (pendiente.usuarioId !== usuarioId) throw errorHttp(403, 'Esa previsualización la hizo otro usuario');

  if (hacerBackup) await hacerBackup();

  const reporte = transaction(() => {
    const armado = armarReporte(pendiente.baseParche, pendiente.archivo);
    // Antes de pisar la General con los precios nuevos, se guarda sola una foto con nombre de cómo
    // estaba (con esto no hace falta acordarse de guardarla a mano antes de actualizar la base). Si
    // esta base no cambia nada, no tiene sentido guardar una foto igual a la que ya había.
    const historial = armado.resumen.itemsConCambios > 0 ? versionesService.guardarHistorialGeneral() : null;
    calculo.guardarBasePrecios(pendiente.baseParche);
    const contexto = { items: calculo.leerItems(), base: calculo.leerBasePrecios(), ajustes: calculo.leerAjustes() };
    calculo.recalcularGeneral(contexto);
    db.prepare('INSERT INTO catalogo_importaciones (archivo, usuario_id, items_afectados, resumen_json, historial_version_id) VALUES (?, ?, ?, ?, ?)').run(
      pendiente.archivo,
      usuarioId,
      armado.resumen.itemsConCambios,
      JSON.stringify(armado),
      historial ? historial.id : null
    );
    return { ...armado, historial_version: historial ? { id: historial.id, nombre: historial.nombre } : null };
  });
  pendientes.delete(token);
  return reporte;
}

module.exports = { previsualizar, previsualizarAumento, baseAumentada, confirmar, armarReporte, VIGENCIA_MS, _pendientes: pendientes };
