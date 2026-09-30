/**
 * Versiones del catálogo: la "General" (siempre existe, no se borra) y las de evento con otro
 * porcentaje de markup. Cada versión guarda una foto de precios con la que se generó, para poder
 * reimprimir igual un catálogo viejo aunque después cambie la base.
 */
const { db, transaction } = require('../db/connection');
const calculo = require('./catalogoCalculoService');
const { normalizarCodigo } = require('./catalogoPreciosService');

const { errorHttp, validarPorcentaje, validarFechaIso } = calculo;
const tiene = (obj, clave) => obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, clave);

function nombreValido(valor, idPropio = null) {
  const nombre = String(valor === undefined || valor === null ? '' : valor).trim();
  if (nombre === '') throw errorHttp(400, 'El nombre de la versión es obligatorio');
  if (nombre.length > 80) throw errorHttp(400, 'El nombre de la versión no puede pasar de 80 caracteres');
  const repetida = db.prepare('SELECT id FROM catalogo_versiones WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, idPropio === null ? -1 : idPropio);
  if (repetida) throw errorHttp(400, `Ya existe una versión llamada "${nombre}"`);
  return nombre;
}

/** "DD/MM/AAAA" de hoy, para el nombre automático de un historial. */
function hoyCorto() {
  const hoy = new Date();
  const dos = (n) => String(n).padStart(2, '0');
  return `${dos(hoy.getDate())}/${dos(hoy.getMonth() + 1)}/${hoy.getFullYear()}`;
}

/** Si el nombre ya existe, le agrega "(2)", "(3)"... hasta encontrar uno libre. */
function nombreHistorialUnico(base) {
  let nombre = base;
  let n = 2;
  while (db.prepare('SELECT id FROM catalogo_versiones WHERE nombre = ? COLLATE NOCASE').get(nombre)) {
    nombre = `${base} (${n})`;
    n += 1;
  }
  return nombre;
}

function pieValido(valor) {
  if (valor === null || valor === undefined || String(valor).trim() === '') return null;
  const pie = String(valor).trim();
  if (pie.length > 1000) throw errorHttp(400, 'El pie legal no puede pasar de 1000 caracteres');
  return pie;
}

function requerirVersion(id) {
  const version = db.prepare('SELECT * FROM catalogo_versiones WHERE id = ?').get(id);
  if (!version) throw errorHttp(404, 'Versión de catálogo no encontrada');
  return version;
}

function armarVersion(version, contexto) {
  const conteo = db
    .prepare(
      `SELECT SUM(estado_precio = 'ok') AS con_precio, SUM(estado_precio <> 'ok') AS sin_precio, COUNT(*) AS total
         FROM catalogo_version_precios WHERE version_id = ?`
    )
    .get(version.id);
  return {
    id: version.id,
    nombre: version.nombre,
    porcentaje_global: version.porcentaje_global,
    aplicar_a_todos: version.aplicar_a_todos,
    fecha_vigencia: version.fecha_vigencia,
    pie_legal: version.pie_legal,
    es_general: version.es_general,
    es_historial: version.es_historial,
    origen_archivo: version.origen_archivo,
    creado_en: version.creado_en,
    items_con_precio: conteo.con_precio || 0,
    items_sin_precio: conteo.sin_precio || 0,
    // Ítems cuyo precio guardado ya no coincide con lo que darían las reglas de hoy (una versión de evento no se actualiza sola).
    items_desactualizados: calculo.itemsDesactualizados(version, contexto),
  };
}

const contextoDeCalculo = () => ({ items: calculo.leerItems(), base: calculo.leerBasePrecios(), ajustes: calculo.leerAjustes() });

function listarVersiones() {
  const contexto = contextoDeCalculo();
  return db
    .prepare('SELECT * FROM catalogo_versiones ORDER BY es_general DESC, creado_en DESC, id DESC')
    .all()
    .map((v) => armarVersion(v, contexto));
}

function obtenerVersion(id) {
  return armarVersion(requerirVersion(id), contextoDeCalculo());
}

function crearVersion(datos = {}) {
  const nombre = nombreValido(datos.nombre);
  if (!tiene(datos, 'porcentaje_global')) throw errorHttp(400, 'Falta el porcentaje de la versión');
  const porcentaje = validarPorcentaje(datos.porcentaje_global, 'El porcentaje de la versión');
  const fecha = datos.fecha_vigencia ? validarFechaIso(datos.fecha_vigencia, 'La fecha de vigencia') : calculo.leerAjustes().fechaVigencia;
  return transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO catalogo_versiones (nombre, porcentaje_global, aplicar_a_todos, fecha_vigencia, pie_legal) VALUES (?, ?, ?, ?, ?)')
        .run(nombre, porcentaje, datos.aplicar_a_todos ? 1 : 0, fecha, pieValido(datos.pie_legal)).lastInsertRowid
    );
    calculo.recalcularVersion(id);
    return obtenerVersion(id);
  });
}

/**
 * Copia parámetros y foto de precios tal cual (no recalcula: el duplicado sale igual que el original).
 * Duplicar la General (o un historial) da como resultado otra versión "del historial" — fija, no se
 * recalcula sola con una base parche nueva: es justamente cómo se guarda una versión vieja con nombre.
 * Duplicar una versión de evento da otra versión de evento normal.
 */
function duplicarVersion(id, datos = {}) {
  const origen = requerirVersion(id);
  const nombre = nombreValido(tiene(datos, 'nombre') ? datos.nombre : `${origen.nombre} (copia)`);
  const esHistorial = origen.es_general || origen.es_historial ? 1 : 0;
  return transaction(() => {
    const nuevoId = Number(
      db
        .prepare('INSERT INTO catalogo_versiones (nombre, porcentaje_global, aplicar_a_todos, fecha_vigencia, pie_legal, es_historial) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nombre, origen.porcentaje_global, origen.aplicar_a_todos, origen.fecha_vigencia, origen.pie_legal, esHistorial).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio)
       SELECT ?, item_id, pase_parche, porcentaje, sae, estado_precio FROM catalogo_version_precios WHERE version_id = ?`
    ).run(nuevoId, id);
    return obtenerVersion(nuevoId);
  });
}

/**
 * Guarda la lista General de HOY como una versión del historial, con nombre. Es la misma operación que
 * "duplicar la General" (queda fija: no se toca con una base parche nueva ni se puede editar el
 * porcentaje), pensada para llamarse a mano desde la pantalla de Versiones o sola al confirmar una base
 * parche nueva. Si la General todavía no tiene ningún precio calculado (recién instalada, sin sembrar)
 * no guarda nada y devuelve null: no tiene sentido una foto vacía.
 */
function guardarHistorialGeneral(datos = {}) {
  const general = db.prepare('SELECT id FROM catalogo_versiones WHERE es_general = 1').get();
  const tieneFotos = db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(general.id).n > 0;
  if (!tieneFotos) return null;
  const nombre = tiene(datos, 'nombre') ? datos.nombre : nombreHistorialUnico(`General ${hoyCorto()}`);
  return duplicarVersion(general.id, { nombre });
}

/**
 * Crea una versión con precios importados de un archivo (una planilla de presupuesto de un evento
 * puntual, ver catalogoListaPreciosService): el precio de cada ítem es el que trae el archivo, TAL
 * CUAL — no se recalcula con la base ni con un porcentaje. Un código del catálogo que no está en el
 * archivo (o vino en 0) queda "sin precio". Queda fija, igual que el historial de la General.
 */
function crearVersionImportada({ nombre, lista, aplicarATodos = false, fechaVigencia, pieLegal, porcentajeReferencia, origenArchivo }) {
  const nombreOk = nombreValido(nombre);
  const fecha = fechaVigencia ? validarFechaIso(fechaVigencia, 'La fecha de vigencia') : calculo.leerAjustes().fechaVigencia;
  const porcentaje = validarPorcentaje(porcentajeReferencia ?? 0, 'El porcentaje de referencia');
  return transaction(() => {
    const id = Number(
      db
        .prepare('INSERT INTO catalogo_versiones (nombre, porcentaje_global, aplicar_a_todos, fecha_vigencia, pie_legal, es_historial, origen_archivo) VALUES (?, ?, ?, ?, ?, 1, ?)')
        .run(nombreOk, porcentaje, aplicarATodos ? 1 : 0, fecha, pieValido(pieLegal), origenArchivo || null).lastInsertRowid
    );
    const insertar = db.prepare('INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) VALUES (?, ?, NULL, NULL, ?, ?)');
    for (const item of calculo.leerItems()) {
      const crudo = lista.precios.get(normalizarCodigo(item.codigo));
      const conPrecio = typeof crudo === 'number' && crudo > 0;
      insertar.run(id, item.id, conPrecio ? Math.round(crudo) : null, conPrecio ? 'ok' : 'sin_precio');
    }
    return obtenerVersion(id);
  });
}

function actualizarVersion(id, datos = {}) {
  const actual = requerirVersion(id);
  // El porcentaje y "aplicar a todos" recalcularían los precios (ver más abajo): eso es lo que no se
  // puede tocar en una foto fija. La vigencia y el pie legal son sólo texto del PDF, no afectan el
  // precio de nada: se pueden corregir aunque la versión sea del historial o esté importada.
  if (actual.es_historial && ['porcentaje_global', 'aplicar_a_todos'].some((campo) => tiene(datos, campo))) {
    const motivo = actual.origen_archivo ? `importada de "${actual.origen_archivo}"` : 'guardada del historial de la General';
    throw errorHttp(400, `Esta es una versión ${motivo}: es una foto fija y no se le puede cambiar el porcentaje. Se le puede cambiar el nombre, la vigencia y el pie legal.`);
  }
  const sets = {};
  if (tiene(datos, 'nombre')) {
    if (actual.es_general && String(datos.nombre).trim() !== actual.nombre) throw errorHttp(400, 'La versión General no se puede renombrar');
    if (!actual.es_general) sets.nombre = nombreValido(datos.nombre, id);
  }
  if (tiene(datos, 'porcentaje_global')) sets.porcentaje_global = validarPorcentaje(datos.porcentaje_global, 'El porcentaje de la versión');
  if (tiene(datos, 'aplicar_a_todos')) sets.aplicar_a_todos = datos.aplicar_a_todos ? 1 : 0;
  if (tiene(datos, 'fecha_vigencia')) sets.fecha_vigencia = validarFechaIso(datos.fecha_vigencia, 'La fecha de vigencia');
  if (tiene(datos, 'pie_legal')) sets.pie_legal = pieValido(datos.pie_legal);
  if (Object.keys(sets).length === 0) return obtenerVersion(id);

  const recalcula = tiene(sets, 'porcentaje_global') || tiene(sets, 'aplicar_a_todos');
  return transaction(() => {
    const columnas = Object.keys(sets);
    db.prepare(`UPDATE catalogo_versiones SET ${columnas.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`).run(...columnas.map((c) => sets[c]), id);
    if (actual.es_general) {
      // La General es el catálogo "vivo": su porcentaje y su fecha son también los ajustes por defecto.
      const guardar = db.prepare(`INSERT INTO catalogo_ajustes (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor, actualizado_en = datetime('now')`);
      if (tiene(sets, 'porcentaje_global')) guardar.run('porcentaje_defecto', String(sets.porcentaje_global));
      if (tiene(sets, 'fecha_vigencia')) guardar.run('fecha_vigencia', sets.fecha_vigencia);
    }
    if (recalcula) calculo.recalcularVersion(id);
    return obtenerVersion(id);
  });
}

function eliminarVersion(id) {
  const version = requerirVersion(id);
  if (version.es_general) throw errorHttp(400, 'La versión General no se puede borrar');
  db.prepare('DELETE FROM catalogo_versiones WHERE id = ?').run(id);
}

/** Vuelve a calcular la versión con las reglas y la base de hoy (para una versión de evento, después de editar reglas). */
function recalcularVersion(id) {
  const version = requerirVersion(id);
  if (version.es_historial) {
    const motivo = version.origen_archivo ? `importada de "${version.origen_archivo}"` : 'guardada del historial de la General';
    throw errorHttp(400, `Esta es una versión ${motivo}: es una foto fija y no se recalcula.`);
  }
  return transaction(() => {
    calculo.recalcularVersion(id);
    return obtenerVersion(id);
  });
}

/** Valida un nombre de versión (obligatorio, largo, no repetido) sin crear nada. Para validar antes de un paso previo (por ejemplo, antes de leer un archivo grande). */
function validarNombreNuevo(nombre) {
  nombreValido(nombre);
}

module.exports = {
  listarVersiones,
  obtenerVersion,
  crearVersion,
  duplicarVersion,
  guardarHistorialGeneral,
  crearVersionImportada,
  validarNombreNuevo,
  actualizarVersion,
  eliminarVersion,
  recalcularVersion,
};
