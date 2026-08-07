const { db } = require('../db/connection');

const SELECT_EVENTO = `
  SELECT e.*, u.nombre_completo AS creado_por_nombre, u.nombre_usuario AS creado_por_usuario
  FROM eventos e
  JOIN usuarios u ON u.id = e.creado_por
`;

function listar({ desde, hasta, sinFecha, conPresupuestos } = {}) {
  let sql = SELECT_EVENTO + ' WHERE 1=1';
  const params = [];
  if (desde && hasta) {
    sql += ' AND e.fecha_inicio <= ? AND e.fecha_fin >= ?';
    params.push(hasta, desde);
  }
  if (sinFecha) {
    sql += " AND e.fecha_inicio = ''";
  }
  if (conPresupuestos) {
    sql += ` AND EXISTS (
      SELECT 1 FROM lotes l JOIN presupuestos p ON p.lote_id = l.id WHERE l.evento_id = e.id
    )`;
  }
  sql += ' ORDER BY e.fecha_inicio DESC';
  return db.prepare(sql).all(...params);
}

function obtener(id) {
  return db.prepare(SELECT_EVENTO + ' WHERE e.id = ?').get(id);
}

/** Trae el evento con sus lotes, y cada lote con sus presupuestos (más nuevo primero) y sus líneas. */
function obtenerDetalle(id) {
  const evento = obtener(id);
  if (!evento) return null;

  const lotes = db.prepare('SELECT * FROM lotes WHERE evento_id = ? ORDER BY id DESC').all(id);

  const presupuestosStmt = db.prepare('SELECT * FROM presupuestos WHERE lote_id = ? ORDER BY id DESC');
  const lineasStmt = db.prepare(
    `SELECT pl.*, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre, prod.rubro
     FROM presupuesto_lineas pl JOIN productos prod ON prod.id = pl.producto_id
     WHERE pl.presupuesto_id = ? ORDER BY prod.rubro, prod.nombre`
  );

  const lotesConDatos = lotes.map((lote) => ({
    ...lote,
    presupuestos: presupuestosStmt.all(lote.id).map((p) => ({ ...p, lineas: lineasStmt.all(p.id) })),
  }));

  return { ...evento, lotes: lotesConDatos };
}

function crear({ nombre, lugar, fecha_inicio, fecha_fin, notas, creadoPor, fecha_armado, fecha_desarme }) {
  const info = db
    .prepare(
      `INSERT INTO eventos (nombre, lugar, fecha_inicio, fecha_fin, notas, creado_por, fecha_armado, fecha_desarme)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(nombre, lugar || null, fecha_inicio, fecha_fin, notas || null, creadoPor, fecha_armado || null, fecha_desarme || null);
  return obtener(info.lastInsertRowid);
}

function actualizar(id, { nombre, lugar, fecha_inicio, fecha_fin, notas, fecha_armado, fecha_desarme }) {
  const existente = db.prepare('SELECT id FROM eventos WHERE id = ?').get(id);
  if (!existente) {
    const err = new Error('Evento no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare(
    `UPDATE eventos SET nombre = ?, lugar = ?, fecha_inicio = ?, fecha_fin = ?, notas = ?,
     fecha_armado = ?, fecha_desarme = ?, actualizado_en = datetime('now') WHERE id = ?`
  ).run(nombre, lugar || null, fecha_inicio, fecha_fin, notas || null, fecha_armado || null, fecha_desarme || null, id);
  return obtener(id);
}

function eliminar(id) {
  const existente = db.prepare('SELECT id FROM eventos WHERE id = ?').get(id);
  if (!existente) {
    const err = new Error('Evento no encontrado');
    err.status = 404;
    throw err;
  }
  const tieneLotes = db.prepare('SELECT COUNT(*) AS n FROM lotes WHERE evento_id = ?').get(id).n;
  if (tieneLotes > 0) {
    const err = new Error('No se puede borrar un evento con lotes cargados. Borrá primero sus lotes.');
    err.status = 400;
    throw err;
  }
  db.prepare('DELETE FROM eventos WHERE id = ?').run(id);
}

/** Agrupa filas {rubro, producto_codigo, producto_nombre, cantidad} en [{rubro, productos, subtotal}]. */
function agruparPorRubro(filas) {
  const mapa = new Map();
  for (const fila of filas) {
    const rubro = fila.rubro || 'Sin rubro';
    if (!mapa.has(rubro)) mapa.set(rubro, []);
    mapa.get(rubro).push({ codigo: fila.producto_codigo, nombre: fila.producto_nombre, cantidad: fila.cantidad });
  }
  return Array.from(mapa.entries()).map(([rubro, productos]) => ({
    rubro,
    productos,
    subtotal: productos.reduce((acc, p) => acc + p.cantidad, 0),
  }));
}

/** Suma cantidad por producto (código) a través de TODOS los presupuestos de TODOS los lotes del evento. */
function totalesPorEvento(id) {
  const filas = db
    .prepare(
      `SELECT prod.rubro, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre, SUM(pl.cantidad) AS cantidad
       FROM presupuesto_lineas pl
       JOIN presupuestos p ON p.id = pl.presupuesto_id
       JOIN lotes l ON l.id = p.lote_id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE l.evento_id = ?
       GROUP BY prod.id
       ORDER BY prod.rubro, prod.nombre`
    )
    .all(id);

  return agruparPorRubro(filas);
}

/**
 * Facturación por rubro a través de TODOS los presupuestos del evento, SIN IVA (el
 * precio_unitario que se importa del Excel ya es neto — la columna VALOR UNITARIO de la
 * hoja PRESUPUESTO suma exactamente al SUBTOTAL antes de aplicar el 21% de IVA).
 * Las líneas sin precio_unitario cargado no suman al monto pero se cuentan aparte, para
 * que quede claro cuando un total es parcial.
 */
function facturacionPorEvento(id) {
  const filas = db
    .prepare(
      `SELECT prod.rubro, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre,
              SUM(pl.cantidad) AS cantidad,
              SUM(CASE WHEN pl.precio_unitario IS NOT NULL THEN pl.cantidad * pl.precio_unitario ELSE 0 END) AS subtotal,
              SUM(CASE WHEN pl.precio_unitario IS NULL THEN 1 ELSE 0 END) AS lineas_sin_precio
       FROM presupuesto_lineas pl
       JOIN presupuestos p ON p.id = pl.presupuesto_id
       JOIN lotes l ON l.id = p.lote_id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE l.evento_id = ?
       GROUP BY prod.id
       ORDER BY prod.rubro, prod.nombre`
    )
    .all(id);

  const mapa = new Map();
  for (const fila of filas) {
    const rubro = fila.rubro || 'Sin rubro';
    if (!mapa.has(rubro)) mapa.set(rubro, []);
    mapa.get(rubro).push({
      codigo: fila.producto_codigo,
      nombre: fila.producto_nombre,
      cantidad: fila.cantidad,
      subtotal: fila.subtotal,
      lineasSinPrecio: fila.lineas_sin_precio,
    });
  }

  return Array.from(mapa.entries()).map(([rubro, productos]) => ({
    rubro,
    productos,
    subtotal: productos.reduce((acc, p) => acc + p.subtotal, 0),
    lineasSinPrecio: productos.reduce((acc, p) => acc + p.lineasSinPrecio, 0),
  }));
}

module.exports = {
  listar,
  obtener,
  obtenerDetalle,
  crear,
  actualizar,
  eliminar,
  totalesPorEvento,
  agruparPorRubro,
  facturacionPorEvento,
};
