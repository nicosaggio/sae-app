/**
 * Presupuestos cargados desde la app ("cotizaciones").
 *
 * Una cotización vive en sus propias tablas hasta que se confirma: mientras está pendiente no la ve
 * ningún otro módulo (calendario, totales, alertas, export de evento, import de Excel). Al confirmarla
 * se copia a lotes / presupuestos / presupuesto_lineas con origen 'app' y desde ahí es un presupuesto
 * más.
 */
const { db, transaction } = require('../db/connection');
const productosService = require('./productosService');
const lotesService = require('./lotesService');
const adjuntosService = require('./cotizacionAdjuntosService');
const clientesService = require('./clientesService');
const croquisService = require('./croquisService');
const { versionGeneral, errorHttp } = require('./catalogoCalculoService');

const TIPOS = ['SAE', 'SAE DE ORG', 'SAE EN PREDIO', 'STAND ARTESANAL', 'STAND SISTEMA', 'ORGANIZACIÓN'];
const IVA_POR_DEFECTO = 0.21;
const DIAS_DE_VALIDEZ = 4; // el Excel calcula "fecha de vencimiento" = fecha del presupuesto + 4

// Textos fijos de la hoja PRESUPUESTO del Excel (celdas B47, B48, E50 y E51).
const TEXTOS = {
  alquiler: 'Todos los elementos son en concepto de alquiler y están sujetos a stock según disponibilidad al momento de la contratación.',
  pago:
    'Para darle curso al armado y/o colocación de lo solicitado, el pago correspondiente deberá ser cancelado (acreditado) con fecha máxima 7 días previos al inicio del armado o a la vigencia del presente presupuesto, lo que suceda primero, al 100%',
  firma: ['Departamento de SAE', 'Anselmi Industria Publicitaria.'],
};

// --------------------------------------------------------------------------------------------
// Funciones puras
// --------------------------------------------------------------------------------------------

const izquierda = (texto, n) => Array.from(texto).slice(0, n).join('');
const derecha = (texto, n) => Array.from(texto).slice(-n).join('');

/**
 * ID de cliente con la misma fórmula de la hoja CARGA del Excel:
 * MAYÚSCULAS( 1ª letra de EXPO + última de TIPO + última de NOMBRE DEL STAND + última de RESPONSABLE
 *             + 2 primeras de NOMBRE DEL STAND + 2 últimas de LOTE ).
 * Devuelve null si falta alguno de los datos (el Excel armaba un código a medias; acá queda vacío).
 */
function generarIdCliente({ evento, tipo, lote, nombre_stand, responsable }) {
  const partes = [evento, tipo, lote, nombre_stand, responsable].map((p) => String(p ?? '').trim());
  if (partes.some((p) => p === '')) return null;
  const [expo, tipoTexto, loteTexto, nombre, resp] = partes;
  return (izquierda(expo, 1) + derecha(tipoTexto, 1) + derecha(nombre, 1) + derecha(resp, 1) + izquierda(nombre, 2) + derecha(loteTexto, 2)).toUpperCase();
}

const redondear2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Subtotal bruto, descuento especial (fracción 0-1, se resta ANTES del IVA), subtotal neto, IVA y
 * total. Las líneas sin precio no suman y se cuentan aparte.
 */
function calcularTotales(lineas, ivaPorcentaje = IVA_POR_DEFECTO, descuentoPorcentaje = 0) {
  let subtotalBruto = 0;
  let sinPrecio = 0;
  for (const l of lineas) {
    if (l.precio_unitario === null || l.precio_unitario === undefined) sinPrecio += 1;
    else subtotalBruto += l.cantidad * l.precio_unitario;
  }
  subtotalBruto = redondear2(subtotalBruto);
  const descuento = redondear2(subtotalBruto * descuentoPorcentaje);
  const subtotal = redondear2(subtotalBruto - descuento);
  const iva = redondear2(subtotal * ivaPorcentaje);
  return {
    subtotal_bruto: subtotalBruto,
    descuento_porcentaje: descuentoPorcentaje,
    descuento,
    subtotal,
    iva_porcentaje: ivaPorcentaje,
    iva,
    total: redondear2(subtotal + iva),
    lineas_sin_precio: sinPrecio,
  };
}

/** Fecha de hoy (hora local del servidor) como "AAAA-MM-DD". */
function hoyIso(ahora = new Date()) {
  const dos = (n) => String(n).padStart(2, '0');
  return `${ahora.getFullYear()}-${dos(ahora.getMonth() + 1)}-${dos(ahora.getDate())}`;
}

function sumarDias(iso, dias) {
  const [a, m, d] = iso.split('-').map(Number);
  const fecha = new Date(Date.UTC(a, m - 1, d + dias));
  return fecha.toISOString().slice(0, 10);
}

// --------------------------------------------------------------------------------------------
// Validación de los datos del formulario
// --------------------------------------------------------------------------------------------

const CAMPOS_TEXTO = { lote: 60, nombre_stand: 160, contacto: 160, mail: 160, telefono: 60, razon_social: 200, cuit: 40, direccion: 240, notas: 2000 };

/** Texto opcional: undefined = no vino; vacío = null; recorta espacios. */
function textoOpcional(valor, campo, maximo) {
  if (valor === undefined) return undefined;
  if (valor === null) return null;
  const limpio = String(valor).trim();
  if (limpio === '') return null;
  if (limpio.length > maximo) throw errorHttp(400, `"${campo}" es demasiado largo (máximo ${maximo} caracteres)`);
  return limpio;
}

/** Devuelve sólo los campos que vinieron, validados. Todos son opcionales. */
function normalizarDatos(datos = {}) {
  const campos = {};
  for (const [campo, maximo] of Object.entries(CAMPOS_TEXTO)) {
    const valor = textoOpcional(datos[campo], campo, maximo);
    if (valor !== undefined) campos[campo] = valor;
  }
  if (datos.tipo !== undefined) {
    const tipo = textoOpcional(datos.tipo, 'tipo', 60);
    if (tipo !== null && !TIPOS.includes(tipo)) throw errorHttp(400, `El tipo tiene que ser uno de: ${TIPOS.join(', ')}`);
    campos.tipo = tipo;
  }
  if (datos.evento_id !== undefined) {
    if (datos.evento_id === null || datos.evento_id === '') campos.evento_id = null;
    else {
      const evento = db.prepare('SELECT id FROM eventos WHERE id = ?').get(Number(datos.evento_id));
      if (!evento) throw errorHttp(400, 'El evento elegido no existe');
      campos.evento_id = evento.id;
    }
  }
  // Un CUIT válido se guarda siempre con guiones; uno dudoso se respeta tal cual lo escribieron
  if (typeof campos.cuit === 'string') {
    const cuit = clientesService.interpretarCuit(campos.cuit);
    if (cuit.valido) campos.cuit = cuit.formateado;
  }
  return campos;
}

function nombreDeUsuario(usuario) {
  return usuario.nombre_completo || usuario.nombre_usuario;
}

// --------------------------------------------------------------------------------------------
// Lectura
// --------------------------------------------------------------------------------------------

function codigoDeFacturacion(c) {
  return c.id_cliente && c.numero ? `${c.id_cliente}-${c.numero}` : null;
}

const SELECT_COTIZACION = `
  SELECT c.*, e.nombre AS evento_nombre, e.fecha_inicio AS evento_fecha_inicio,
         v.nombre AS version_nombre
  FROM cotizaciones c
  LEFT JOIN eventos e ON e.id = c.evento_id
  LEFT JOIN catalogo_versiones v ON v.id = c.catalogo_version_id
`;

function leerFila(id) {
  const fila = db.prepare(SELECT_COTIZACION + ' WHERE c.id = ?').get(id);
  if (!fila) throw errorHttp(404, 'Presupuesto no encontrado');
  return fila;
}

/** Motivos por los que todavía no se puede confirmar (lista vacía = se puede). */
function motivosNoConfirmable(fila, lineas) {
  const motivos = [];
  if (!fila.evento_id) motivos.push('Falta elegir el evento (EXPO)');
  if (!fila.lote) motivos.push('Falta el número de stand (LOTE)');
  if (lineas.length === 0) motivos.push('El presupuesto no tiene ítems');
  const sinPrecio = lineas.filter((l) => l.precio_unitario === null).map((l) => l.codigo);
  if (sinPrecio.length > 0) motivos.push(`Faltan precios en: ${sinPrecio.join(', ')}`);
  return motivos;
}

function obtener(id) {
  const fila = leerFila(id);
  const lineas = db
    .prepare('SELECT * FROM cotizacion_lineas WHERE cotizacion_id = ? ORDER BY id')
    .all(id)
    .map((l) => ({
      ...l,
      subtotal: l.precio_unitario === null ? null : redondear2(l.cantidad * l.precio_unitario),
      precio_modificado: l.precio_unitario !== null && l.precio_catalogo !== null && l.precio_unitario !== l.precio_catalogo,
    }));
  const presupuesto = fila.presupuesto_id ? db.prepare('SELECT id, lote_id, estado FROM presupuestos WHERE id = ?').get(fila.presupuesto_id) : null;
  const motivos = fila.estado === 'pendiente' ? motivosNoConfirmable(fila, lineas) : [];
  return {
    ...fila,
    cod_fac: codigoDeFacturacion(fila),
    cuit_valido: fila.cuit ? clientesService.interpretarCuit(fila.cuit).valido : null,
    cliente: fila.cliente_id ? { ...db.prepare('SELECT id, razon_social FROM clientes WHERE id = ?').get(fila.cliente_id) } : null,
    fecha_vencimiento: sumarDias(fila.fecha_carga, DIAS_DE_VALIDEZ),
    lineas,
    adjuntos: adjuntosService.listar(id),
    croquis: croquisService.resumenDeCotizacion(id),
    totales: calcularTotales(lineas, fila.iva_porcentaje, fila.descuento_porcentaje),
    presupuesto: presupuesto ? { ...presupuesto } : null,
    confirmable: { ok: motivos.length === 0, motivos },
  };
}

function listar({ estado, eventoId, presupuestoId, q } = {}) {
  let sql = SELECT_COTIZACION + ' WHERE 1=1';
  const params = [];
  if (estado) {
    sql += ' AND c.estado = ?';
    params.push(estado);
  }
  if (eventoId) {
    sql += ' AND c.evento_id = ?';
    params.push(Number(eventoId));
  }
  if (presupuestoId) {
    sql += ' AND c.presupuesto_id = ?';
    params.push(Number(presupuestoId));
  }
  if (q && String(q).trim()) {
    const patron = `%${String(q).trim()}%`;
    sql += ` AND (c.razon_social LIKE ? OR c.nombre_stand LIKE ? OR c.id_cliente LIKE ? OR c.lote LIKE ? OR e.nombre LIKE ? OR c.responsable LIKE ?)`;
    params.push(patron, patron, patron, patron, patron, patron);
  }
  sql += ' ORDER BY c.id DESC';
  const subtotales = db.prepare('SELECT cotizacion_id, SUM(cantidad * precio_unitario) AS subtotal, COUNT(*) AS lineas FROM cotizacion_lineas GROUP BY cotizacion_id').all();
  const porId = new Map(subtotales.map((s) => [s.cotizacion_id, s]));
  return db
    .prepare(sql)
    .all(...params)
    .map((c) => {
      const s = porId.get(c.id);
      const subtotalBruto = redondear2(s?.subtotal || 0);
      const subtotal = redondear2(subtotalBruto - redondear2(subtotalBruto * c.descuento_porcentaje));
      return { ...c, cod_fac: codigoDeFacturacion(c), cantidad_lineas: s?.lineas || 0, total: redondear2(subtotal + redondear2(subtotal * c.iva_porcentaje)) };
    });
}

// --------------------------------------------------------------------------------------------
// Alta y edición de los datos
// --------------------------------------------------------------------------------------------

function exigirPendiente(fila) {
  if (fila.estado === 'confirmada') {
    throw errorHttp(409, 'Este presupuesto ya está confirmado. Para cambiarlo, editá el presupuesto dentro del evento.');
  }
  if (fila.estado === 'rechazada') {
    throw errorHttp(409, 'Este presupuesto está rechazado. Reabrilo para poder editarlo.');
  }
}

/** Recalcula el ID de cliente y, si cambió, le da el siguiente número de ese cliente. */
function asignarIdentificacion(id) {
  const fila = leerFila(id);
  const idCliente = generarIdCliente({ evento: fila.evento_nombre, tipo: fila.tipo, lote: fila.lote, nombre_stand: fila.nombre_stand, responsable: fila.responsable });
  if (idCliente === fila.id_cliente && (idCliente === null || fila.numero !== null)) return;
  let numero = null;
  if (idCliente) {
    numero = db.prepare('SELECT COALESCE(MAX(numero), 0) + 1 AS n FROM cotizaciones WHERE id_cliente = ? AND id != ?').get(idCliente, id).n;
  }
  db.prepare("UPDATE cotizaciones SET id_cliente = ?, numero = ?, actualizado_en = datetime('now') WHERE id = ?").run(idCliente, numero, id);
}

/** Inserta la cotización (sin abrir transacción: la usan crear y duplicar, que ya tienen la suya). */
/** Guarda el cliente del presupuesto por su CUIT (si es válido) y deja el vínculo. */
function sincronizarCliente(id, usuario) {
  const fila = leerFila(id);
  const cliente = clientesService.guardarDesdePresupuesto(fila, usuario);
  const clienteId = cliente ? cliente.id : null;
  if (clienteId !== fila.cliente_id) db.prepare('UPDATE cotizaciones SET cliente_id = ? WHERE id = ?').run(clienteId, id);
}

/**
 * `responsableDe` (opcional) es para los duplicados: el ID de cliente incluye la última letra del
 * responsable, así que el duplicado tiene que conservar el del original o cambiaría de ID y su número
 * volvería a empezar en 1. Sigue quedando registrado quién lo creó (`creado_por`).
 */
function insertarCotizacion(datos, usuario, { responsableDe } = {}) {
  const campos = normalizarDatos(datos);
  const columnas = ['fecha_carga', 'responsable_id', 'responsable', 'catalogo_version_id', 'creado_por', ...Object.keys(campos)];
  const responsable = responsableDe ? { id: responsableDe.responsable_id, nombre: responsableDe.responsable } : { id: usuario.id, nombre: nombreDeUsuario(usuario) };
  const valores = [hoyIso(), responsable.id, responsable.nombre, versionGeneral().id, usuario.id, ...Object.values(campos)];
  const info = db.prepare(`INSERT INTO cotizaciones (${columnas.join(', ')}) VALUES (${columnas.map(() => '?').join(', ')})`).run(...valores);
  const id = Number(info.lastInsertRowid);
  asignarIdentificacion(id);
  sincronizarCliente(id, usuario);
  return id;
}

function crear(datos, usuario) {
  normalizarDatos(datos); // valida antes de abrir la transacción
  return transaction(() => obtener(insertarCotizacion(datos, usuario)));
}

function actualizar(id, datos, usuario) {
  const campos = normalizarDatos(datos);
  return transaction(() => {
    exigirPendiente(leerFila(id));
    const claves = Object.keys(campos);
    if (claves.length > 0) {
      db.prepare(`UPDATE cotizaciones SET ${claves.map((k) => `${k} = ?`).join(', ')}, actualizado_en = datetime('now') WHERE id = ?`).run(...Object.values(campos), id);
    }
    asignarIdentificacion(id);
    sincronizarCliente(id, usuario);
    return obtener(id);
  });
}

function eliminar(id) {
  const fila = leerFila(id);
  if (fila.estado === 'confirmada') throw errorHttp(409, 'Un presupuesto confirmado no se borra desde acá: ya es parte del evento.');
  adjuntosService.borrarArchivosDe(id);
  db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(id);
}

/** Lo marca como rechazado (el cliente no lo aceptó) sin borrarlo: queda como registro, de sólo lectura. */
function rechazar(id, usuario) {
  return transaction(() => {
    exigirPendiente(leerFila(id));
    db.prepare(
      `UPDATE cotizaciones SET estado = 'rechazada', rechazada_por = ?, rechazada_en = datetime('now'), actualizado_en = datetime('now') WHERE id = ?`
    ).run(usuario.id, id);
    return obtener(id);
  });
}

/** Vuelve un presupuesto rechazado a pendiente, por si el cliente cambia de opinión. */
function reabrir(id) {
  return transaction(() => {
    const fila = leerFila(id);
    if (fila.estado !== 'rechazada') throw errorHttp(409, 'Sólo se puede reabrir un presupuesto rechazado.');
    db.prepare(
      `UPDATE cotizaciones SET estado = 'pendiente', rechazada_por = NULL, rechazada_en = NULL, actualizado_en = datetime('now') WHERE id = ?`
    ).run(id);
    return obtener(id);
  });
}

/** Copia los datos y los ítems a un presupuesto nuevo (pendiente), a nombre de quien lo duplica. */
function duplicar(id, usuario) {
  return transaction(() => {
    const origen = obtener(id);
    const idNueva = insertarCotizacion(
      {
        evento_id: origen.evento_id,
        tipo: origen.tipo,
        lote: origen.lote,
        nombre_stand: origen.nombre_stand,
        contacto: origen.contacto,
        mail: origen.mail,
        telefono: origen.telefono,
        razon_social: origen.razon_social,
        cuit: origen.cuit,
        direccion: origen.direccion,
        notas: origen.notas,
      },
      usuario,
      { responsableDe: origen }
    );
    db.prepare('UPDATE cotizaciones SET catalogo_version_id = ?, iva_porcentaje = ?, descuento_porcentaje = ? WHERE id = ?').run(
      origen.catalogo_version_id,
      origen.iva_porcentaje,
      origen.descuento_porcentaje,
      idNueva
    );
    const insertar = db.prepare(
      `INSERT INTO cotizacion_lineas (cotizacion_id, catalogo_item_id, codigo, descripcion, rubro, cantidad, precio_catalogo, precio_unitario, comentario)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    adjuntosService.copiar(id, idNueva, usuario);
    croquisService.copiarDeCotizacion(id, idNueva, usuario);
    for (const l of origen.lineas) insertar.run(idNueva, l.catalogo_item_id, l.codigo, l.descripcion, l.rubro, l.cantidad, l.precio_catalogo, l.precio_unitario, l.comentario);
    return obtener(idNueva);
  });
}

// --------------------------------------------------------------------------------------------
// Ítems
// --------------------------------------------------------------------------------------------

/** Precio (neto) de un ítem del catálogo en una lista; null si el ítem no tiene precio en ella. */
function precioEnLista(versionId, itemId) {
  const foto = db.prepare('SELECT sae, estado_precio FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(versionId, itemId);
  return foto && foto.estado_precio === 'ok' && foto.sae !== null ? foto.sae : null;
}

function versionDe(fila) {
  return fila.catalogo_version_id || versionGeneral().id;
}

/** Búsqueda de ítems del catálogo (por código o descripción) con su precio en la lista de la cotización. */
function buscarCatalogo({ q, versionId } = {}) {
  const version = versionId ? Number(versionId) : versionGeneral().id;
  const texto = String(q || '').trim().toLowerCase();
  const patron = `%${texto.replace(/[%_]/g, '')}%`;
  const filas = db
    .prepare(
      `SELECT i.id, i.codigo, i.descripcion, i.rubro, vp.sae, vp.estado_precio
       FROM catalogo_items i
       LEFT JOIN catalogo_version_precios vp ON vp.item_id = i.id AND vp.version_id = ?
       WHERE i.activo = 1 AND (? = '%%' OR LOWER(i.codigo) LIKE ? OR LOWER(i.descripcion) LIKE ?)
       ORDER BY (LOWER(i.codigo) = ?) DESC, (LOWER(i.codigo) LIKE ?) DESC, i.rubro, i.codigo
       LIMIT 25`
    )
    .all(version, patron, patron, patron, texto, `${texto.replace(/[%_]/g, '')}%`);
  return filas.map((f) => ({ id: f.id, codigo: f.codigo, descripcion: f.descripcion, rubro: f.rubro, precio: f.estado_precio === 'ok' ? f.sae : null }));
}

function cantidadValida(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1 || n > 100000) throw errorHttp(400, 'La cantidad tiene que ser un número entero de 1 en adelante');
  return n;
}

function precioValido(valor) {
  if (valor === null || valor === '') return null;
  const n = Number(valor);
  if (!Number.isFinite(n) || n < 0) throw errorHttp(400, 'El precio tiene que ser un número (0 o más)');
  return n;
}

function agregarLinea(id, { catalogo_item_id, cantidad = 1, comentario } = {}) {
  const cantidadFinal = cantidadValida(cantidad);
  const nota = textoOpcional(comentario, 'comentario', 300);
  return transaction(() => {
    const fila = leerFila(id);
    exigirPendiente(fila);
    const item = db.prepare('SELECT * FROM catalogo_items WHERE id = ? AND activo = 1').get(Number(catalogo_item_id));
    if (!item) throw errorHttp(400, 'El ítem no existe en el catálogo (o está dado de baja)');
    const precio = precioEnLista(versionDe(fila), item.id);
    const existente = db.prepare('SELECT * FROM cotizacion_lineas WHERE cotizacion_id = ? AND codigo = ? COLLATE NOCASE').get(id, item.codigo);
    if (existente) {
      db.prepare('UPDATE cotizacion_lineas SET cantidad = ?, comentario = ? WHERE id = ?').run(existente.cantidad + cantidadFinal, nota ?? existente.comentario, existente.id);
    } else {
      db.prepare(
        `INSERT INTO cotizacion_lineas (cotizacion_id, catalogo_item_id, codigo, descripcion, rubro, cantidad, precio_catalogo, precio_unitario, comentario)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, item.id, item.codigo, item.descripcion || item.codigo, item.rubro, cantidadFinal, precio, precio, nota ?? null);
    }
    db.prepare("UPDATE cotizaciones SET actualizado_en = datetime('now') WHERE id = ?").run(id);
    return obtener(id);
  });
}

function leerLinea(lineaId) {
  const linea = db.prepare('SELECT * FROM cotizacion_lineas WHERE id = ?').get(lineaId);
  if (!linea) throw errorHttp(404, 'Ítem del presupuesto no encontrado');
  exigirPendiente(leerFila(linea.cotizacion_id));
  return linea;
}

function actualizarLinea(lineaId, { cantidad, precio_unitario, comentario } = {}) {
  return transaction(() => {
    const linea = leerLinea(lineaId);
    const nuevaCantidad = cantidad === undefined ? linea.cantidad : cantidadValida(cantidad);
    const nuevoPrecio = precio_unitario === undefined ? linea.precio_unitario : precioValido(precio_unitario);
    const nuevaNota = comentario === undefined ? linea.comentario : textoOpcional(comentario, 'comentario', 300);
    db.prepare('UPDATE cotizacion_lineas SET cantidad = ?, precio_unitario = ?, comentario = ? WHERE id = ?').run(nuevaCantidad, nuevoPrecio, nuevaNota, lineaId);
    db.prepare("UPDATE cotizaciones SET actualizado_en = datetime('now') WHERE id = ?").run(linea.cotizacion_id);
    return obtener(linea.cotizacion_id);
  });
}

function borrarLinea(lineaId) {
  return transaction(() => {
    const linea = leerLinea(lineaId);
    db.prepare('DELETE FROM cotizacion_lineas WHERE id = ?').run(lineaId);
    db.prepare("UPDATE cotizaciones SET actualizado_en = datetime('now') WHERE id = ?").run(linea.cotizacion_id);
    return obtener(linea.cotizacion_id);
  });
}

/** Cambia la lista de precios y vuelve a poner el precio de la lista en todos los ítems (pisa los editados a mano). */
function aplicarLista(id, versionId) {
  return transaction(() => {
    exigirPendiente(leerFila(id));
    const version = db.prepare('SELECT id FROM catalogo_versiones WHERE id = ?').get(Number(versionId));
    if (!version) throw errorHttp(400, 'La lista de precios elegida no existe');
    db.prepare("UPDATE cotizaciones SET catalogo_version_id = ?, actualizado_en = datetime('now') WHERE id = ?").run(version.id, id);
    const actualizar = db.prepare('UPDATE cotizacion_lineas SET precio_catalogo = ?, precio_unitario = ? WHERE id = ?');
    for (const l of db.prepare('SELECT id, catalogo_item_id FROM cotizacion_lineas WHERE cotizacion_id = ? AND catalogo_item_id IS NOT NULL').all(id)) {
      const precio = precioEnLista(version.id, l.catalogo_item_id);
      actualizar.run(precio, precio, l.id);
    }
    return obtener(id);
  });
}

/** Descuento especial (fracción 0-1) que se resta del subtotal antes del IVA. 0 = sin descuento. */
function aplicarDescuento(id, descuentoPorcentaje) {
  const n = Number(descuentoPorcentaje);
  if (!Number.isFinite(n) || n < 0 || n > 1) throw errorHttp(400, 'El descuento tiene que ser un número entre 0 y 1 (por ejemplo 0.1 para 10 %)');
  return transaction(() => {
    exigirPendiente(leerFila(id));
    db.prepare("UPDATE cotizaciones SET descuento_porcentaje = ?, actualizado_en = datetime('now') WHERE id = ?").run(n, id);
    return obtener(id);
  });
}

// --------------------------------------------------------------------------------------------
// Confirmación: pasa a ser un presupuesto del evento
// --------------------------------------------------------------------------------------------

function productoParaLinea(linea) {
  if (linea.catalogo_item_id) {
    const vinculado = db.prepare('SELECT producto_id FROM catalogo_items WHERE id = ?').get(linea.catalogo_item_id);
    if (vinculado && vinculado.producto_id) return vinculado.producto_id;
  }
  const existente =
    db.prepare('SELECT id FROM productos WHERE codigo = ?').get(linea.codigo) || db.prepare('SELECT id FROM productos WHERE LOWER(codigo) = LOWER(?)').get(linea.codigo);
  if (existente) return existente.id;
  return productosService.crear({ codigo: linea.codigo, nombre: linea.descripcion, rubro: linea.rubro }).id;
}

function encontrarOCrearLote(eventoId, codigo, expositor) {
  const existente = db.prepare('SELECT * FROM lotes WHERE evento_id = ? AND codigo = ? AND expositor IS ?').get(eventoId, codigo, expositor);
  return existente || lotesService.crear({ eventoId, codigo, expositor, contacto: null });
}

function confirmar(id, usuario) {
  return transaction(() => {
    const cotizacion = obtener(id);
    exigirPendiente(cotizacion);
    if (!cotizacion.confirmable.ok) throw errorHttp(400, `Todavía no se puede confirmar: ${cotizacion.confirmable.motivos.join('; ')}.`);

    const lote = encontrarOCrearLote(cotizacion.evento_id, cotizacion.lote, cotizacion.nombre_stand);
    // Mismo mapeo que el import de Excel: contacto = contacto + mail, cliente = razón social,
    // notas = texto de alquiler, condiciones = texto de pago, monto = TOTAL con IVA.
    const info = db
      .prepare(
        `INSERT INTO presupuestos
           (lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado, estado, origen)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'pendiente_facturar', 'app')`
      )
      .run(
        lote.id,
        cotizacion.numero === null ? null : String(cotizacion.numero),
        cotizacion.fecha_carga,
        cotizacion.razon_social || cotizacion.nombre_stand,
        [cotizacion.contacto, cotizacion.mail].filter(Boolean).join(' - ') || null,
        TEXTOS.pago,
        cotizacion.totales.total,
        [TEXTOS.alquiler, cotizacion.notas].filter(Boolean).join('\n'),
      );
    const presupuestoId = Number(info.lastInsertRowid);

    // presupuesto_lineas tiene una sola línea por producto: si dos ítems llegaran al mismo producto, se suman.
    const porProducto = new Map();
    for (const l of cotizacion.lineas) {
      const productoId = productoParaLinea(l);
      const previa = porProducto.get(productoId);
      if (previa) previa.cantidad += l.cantidad;
      else porProducto.set(productoId, { cantidad: l.cantidad, precio: l.precio_unitario, comentario: l.comentario });
    }
    const insertar = db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, comentario, precio_unitario) VALUES (?, ?, ?, ?, ?)');
    for (const [productoId, l] of porProducto) insertar.run(presupuestoId, productoId, l.cantidad, l.comentario, l.precio);

    db.prepare(
      `UPDATE cotizaciones SET estado = 'confirmada', presupuesto_id = ?, confirmada_por = ?, confirmada_en = datetime('now'), actualizado_en = datetime('now') WHERE id = ?`
    ).run(presupuestoId, usuario.id, id);

    // El croquis dibujado en el presupuesto pasa al lote, para que salga en el PDF de totales del evento.
    const croquisEnLote = croquisService.copiarALote(id, lote.id, usuario);
    return { ...obtener(id), croquis_en_lote: croquisEnLote };
  });
}

// --------------------------------------------------------------------------------------------
// Croquis dibujado en el presupuesto
// --------------------------------------------------------------------------------------------

function obtenerCroquis(id) {
  leerFila(id);
  return croquisService.obtenerDeCotizacion(id);
}

/** Se dibuja mientras el presupuesto está pendiente; al confirmarlo pasa al lote y ahí se sigue editando. */
function guardarCroquis(id, datos, usuario) {
  exigirPendiente(leerFila(id));
  return croquisService.guardarDeCotizacion(id, datos, usuario);
}

function eliminarCroquis(id) {
  exigirPendiente(leerFila(id));
  croquisService.eliminarDeCotizacion(id);
}

/** Que el croquis salga o no en el PDF se puede cambiar siempre, como en los adjuntos. */
function definirCroquisEnPdf(id, incluir) {
  leerFila(id);
  croquisService.definirIncluirEnPdf(id, incluir);
  return obtener(id);
}

function opciones() {
  return {
    tipos: TIPOS,
    iva_porcentaje: IVA_POR_DEFECTO,
    dias_de_validez: DIAS_DE_VALIDEZ,
    versiones: db.prepare('SELECT id, nombre, porcentaje_global, es_general, es_historial FROM catalogo_versiones ORDER BY es_general DESC, es_historial ASC, nombre').all().map((v) => ({ ...v })),
    catalogo_cargado: db.prepare('SELECT COUNT(*) AS n FROM catalogo_items WHERE activo = 1').get().n > 0,
  };
}

module.exports = {
  TIPOS,
  TEXTOS,
  IVA_POR_DEFECTO,
  DIAS_DE_VALIDEZ,
  generarIdCliente,
  calcularTotales,
  hoyIso,
  sumarDias,
  codigoDeFacturacion,
  listar,
  obtener,
  crear,
  actualizar,
  eliminar,
  rechazar,
  reabrir,
  duplicar,
  buscarCatalogo,
  agregarLinea,
  actualizarLinea,
  borrarLinea,
  aplicarLista,
  aplicarDescuento,
  confirmar,
  obtenerCroquis,
  guardarCroquis,
  eliminarCroquis,
  definirCroquisEnPdf,
  opciones,
};
