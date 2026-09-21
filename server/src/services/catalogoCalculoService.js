/**
 * Capa entre la base de datos y el cálculo puro de precios: lee ajustes, reglas y la última base
 * parche cargada, calcula una versión y guarda el resultado. Todo lo que cambia precios del catálogo
 * (siembra, ABM de ítems, versiones, importación de la base) pasa por acá.
 */
const { db } = require('../db/connection');
const { calcularPrecios, normalizarCodigo } = require('./catalogoPreciosService');

function errorHttp(status, mensaje) {
  const err = new Error(mensaje);
  err.status = status;
  return err;
}

/** El porcentaje viaja como fracción (0,55 = 55 %). Un 55 escrito por error multiplicaría los precios por 56. */
function validarPorcentaje(valor, campo = 'El porcentaje') {
  const n = typeof valor === 'string' && valor.trim() !== '' ? Number(valor.replace(',', '.')) : valor;
  if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 3) {
    throw errorHttp(400, `${campo} tiene que ser una fracción entre 0 y 3 (0,55 = 55 %)`);
  }
  return n;
}

function validarFechaIso(valor, campo = 'La fecha') {
  const m = String(valor || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const fecha = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
  if (!fecha || fecha.getUTCMonth() !== Number(m[2]) - 1 || fecha.getUTCDate() !== Number(m[3])) {
    throw errorHttp(400, `${campo} tiene que tener el formato AAAA-MM-DD`);
  }
  return valor;
}

function leerAjustes() {
  const crudos = Object.fromEntries(db.prepare('SELECT clave, valor FROM catalogo_ajustes').all().map((f) => [f.clave, f.valor]));
  return {
    porcentajeDefecto: Number(crudos.porcentaje_defecto),
    multiplo: Number(crudos.multiplo_redondeo),
    adicionalPie: Number(crudos.adicional_pie_tv),
    fechaVigencia: crudos.fecha_vigencia || null,
    mostrarDecimales: crudos.mostrar_decimales !== '0',
    pieLegal: crudos.pie_legal || '',
    logo: crudos.logo_imagen || null,
  };
}

function versionGeneral() {
  return db.prepare('SELECT * FROM catalogo_versiones WHERE es_general = 1').get();
}

/** Última base parche cargada: código → $ CLIENTE crudo (número, texto o null). */
function leerBasePrecios() {
  const mapa = new Map();
  for (const f of db.prepare('SELECT codigo, cliente_numero, cliente_texto FROM catalogo_base_precios').all()) {
    mapa.set(f.codigo, f.cliente_numero !== null ? f.cliente_numero : f.cliente_texto);
  }
  return mapa;
}

/** Reemplaza la base guardada por la de `baseParche` (resultado de leerBaseParche). Gana la primera aparición de cada código. */
function guardarBasePrecios(baseParche) {
  db.exec('DELETE FROM catalogo_base_precios');
  const insertar = db.prepare(
    'INSERT INTO catalogo_base_precios (codigo, cliente_numero, cliente_texto, descripcion, grupo, unidad) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const vistos = new Set();
  for (const fila of baseParche.filas) {
    const clave = normalizarCodigo(fila.codigo);
    if (vistos.has(clave)) continue;
    vistos.add(clave);
    insertar.run(
      fila.codigo,
      typeof fila.cliente === 'number' ? fila.cliente : null,
      typeof fila.cliente === 'string' ? fila.cliente : null,
      fila.descripcion || null,
      fila.grupo || null,
      fila.unidad || null
    );
  }
  return vistos.size;
}

const leerItems = () => db.prepare('SELECT * FROM catalogo_items ORDER BY id').all();

/** Calcula todos los precios de una versión con las reglas actuales. */
function calcularParaVersion(version, { items = leerItems(), base = leerBasePrecios(), ajustes = leerAjustes() } = {}) {
  return calcularPrecios(items, {
    precioBase: base,
    porcentajeGlobal: version.porcentaje_global,
    aplicarATodos: Boolean(version.aplicar_a_todos),
    multiplo: ajustes.multiplo,
    adicionalPie: ajustes.adicionalPie,
  });
}

/** Los precios de la versión General son también los de la ficha de cada ítem. */
function aplicarAItems(resultados) {
  const actualizar = db.prepare(
    `UPDATE catalogo_items SET pase_parche = ?, sae = ?, estado_precio = ?, motivo_precio = ?, actualizado_en = datetime('now') WHERE id = ?`
  );
  for (const [id, r] of resultados) actualizar.run(r.pase_parche, r.sae, r.estado, r.motivo, id);
}

/** Foto de precios de una versión: con esto se reimprime igual un catálogo viejo. */
function guardarFoto(versionId, resultados) {
  db.prepare('DELETE FROM catalogo_version_precios WHERE version_id = ?').run(versionId);
  const insertar = db.prepare(
    'INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) VALUES (?, ?, ?, ?, ?, ?)'
  );
  for (const [itemId, r] of resultados) insertar.run(versionId, itemId, r.pase_parche, r.porcentaje, r.sae, r.estado);
}

/** Recalcula y guarda una versión (y, si es la General, también los precios de los ítems). */
function recalcularVersion(versionId, contexto = {}) {
  const version = db.prepare('SELECT * FROM catalogo_versiones WHERE id = ?').get(versionId);
  if (!version) throw errorHttp(404, 'Versión de catálogo no encontrada');
  const resultados = calcularParaVersion(version, contexto);
  if (version.es_general) aplicarAItems(resultados);
  guardarFoto(versionId, resultados);
  return resultados;
}

function recalcularGeneral(contexto = {}) {
  return recalcularVersion(versionGeneral().id, contexto);
}

/**
 * Ítems cuyo precio guardado en la versión ya no coincide con lo que darían las reglas actuales
 * (por ejemplo, después de editar una regla). Las versiones de evento no se tocan solas.
 */
function itemsDesactualizados(version, contexto = {}) {
  const resultados = calcularParaVersion(version, contexto);
  const foto = new Map(db.prepare('SELECT item_id, sae, estado_precio FROM catalogo_version_precios WHERE version_id = ?').all(version.id).map((f) => [f.item_id, f]));
  let n = 0;
  for (const [id, r] of resultados) {
    const guardado = foto.get(id);
    if (!guardado || guardado.sae !== r.sae || guardado.estado_precio !== r.estado) n++;
  }
  return n;
}

module.exports = {
  errorHttp,
  validarPorcentaje,
  validarFechaIso,
  leerAjustes,
  versionGeneral,
  leerBasePrecios,
  guardarBasePrecios,
  leerItems,
  calcularParaVersion,
  aplicarAItems,
  guardarFoto,
  recalcularVersion,
  recalcularGeneral,
  itemsDesactualizados,
};
