/**
 * Versiones del catálogo: la "General" (siempre existe, no se borra) y las de evento con otro
 * porcentaje de markup. Cada versión guarda una foto de precios con la que se generó, para poder
 * reimprimir igual un catálogo viejo aunque después cambie la base.
 */
const { db, transaction } = require('../db/connection');
const calculo = require('./catalogoCalculoService');

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

/** Copia parámetros y foto de precios tal cual (no recalcula: el duplicado sale igual que el original). */
function duplicarVersion(id, datos = {}) {
  const origen = requerirVersion(id);
  const nombre = nombreValido(tiene(datos, 'nombre') ? datos.nombre : `${origen.nombre} (copia)`);
  return transaction(() => {
    const nuevoId = Number(
      db
        .prepare('INSERT INTO catalogo_versiones (nombre, porcentaje_global, aplicar_a_todos, fecha_vigencia, pie_legal) VALUES (?, ?, ?, ?, ?)')
        .run(nombre, origen.porcentaje_global, origen.aplicar_a_todos, origen.fecha_vigencia, origen.pie_legal).lastInsertRowid
    );
    db.prepare(
      `INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio)
       SELECT ?, item_id, pase_parche, porcentaje, sae, estado_precio FROM catalogo_version_precios WHERE version_id = ?`
    ).run(nuevoId, id);
    return obtenerVersion(nuevoId);
  });
}

function actualizarVersion(id, datos = {}) {
  const actual = requerirVersion(id);
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
  requerirVersion(id);
  return transaction(() => {
    calculo.recalcularVersion(id);
    return obtenerVersion(id);
  });
}

module.exports = { listarVersiones, obtenerVersion, crearVersion, duplicarVersion, actualizarVersion, eliminarVersion, recalcularVersion };
