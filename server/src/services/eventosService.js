const { db, transaction } = require('../db/connection');
const { SQL_PRESUPUESTO_ACTIVO } = require('./presupuestosService');

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

  const tieneCroquisStmt = db.prepare('SELECT 1 FROM lote_croquis WHERE lote_id = ?');
  const lotesConDatos = lotes.map((lote) => ({
    ...lote,
    tiene_croquis: Boolean(tieneCroquisStmt.get(lote.id)),
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

/**
 * Unifica `origenId` dentro de `destinoId`: mueve todos sus lotes (y presupuestos) al
 * evento destino y borra el evento origen. Si un código de lote ya existe en destino
 * (mismo stand cargado en ambos, típico de una expo duplicada), los presupuestos del
 * lote origen se reasignan al lote existente en vez de duplicarlo.
 * Deja un alias con el nombre del evento absorbido para que un import de Excel que
 * todavía diga ese nombre (archivos viejos, o la carpeta de red antes de renombrarse)
 * siga cayendo en el evento destino en vez de volver a crear el duplicado.
 */
function fusionar(destinoId, origenId) {
  if (destinoId === origenId) {
    const err = new Error('No se puede unificar un evento consigo mismo');
    err.status = 400;
    throw err;
  }
  const destino = db.prepare('SELECT * FROM eventos WHERE id = ?').get(destinoId);
  const origen = db.prepare('SELECT * FROM eventos WHERE id = ?').get(origenId);
  if (!destino || !origen) {
    const err = new Error('Evento no encontrado');
    err.status = 404;
    throw err;
  }

  transaction(() => {
    const lotesOrigen = db.prepare('SELECT * FROM lotes WHERE evento_id = ?').all(origenId);
    for (const lote of lotesOrigen) {
      const colision = db.prepare('SELECT id FROM lotes WHERE evento_id = ? AND codigo = ?').get(destinoId, lote.codigo);
      if (colision) {
        db.prepare('UPDATE presupuestos SET lote_id = ? WHERE lote_id = ?').run(colision.id, lote.id);
        db.prepare('DELETE FROM lotes WHERE id = ?').run(lote.id);
      } else {
        db.prepare('UPDATE lotes SET evento_id = ? WHERE id = ?').run(destinoId, lote.id);
      }
    }

    db.prepare('UPDATE eventos_alias SET evento_id = ? WHERE evento_id = ?').run(destinoId, origenId);
    db.prepare('INSERT OR IGNORE INTO eventos_alias (evento_id, nombre) VALUES (?, ?)').run(destinoId, origen.nombre);
    db.prepare('DELETE FROM eventos WHERE id = ?').run(origenId);
  });

  return obtenerDetalle(destinoId);
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

/** Suma cantidad por producto (código) a través de todos los presupuestos (no cancelados) de TODOS los lotes del evento. */
function totalesPorEvento(id) {
  const filas = db
    .prepare(
      `SELECT prod.rubro, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre, SUM(pl.cantidad) AS cantidad
       FROM presupuesto_lineas pl
       JOIN presupuestos p ON p.id = pl.presupuesto_id
       JOIN lotes l ON l.id = p.lote_id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE l.evento_id = ? AND ${SQL_PRESUPUESTO_ACTIVO}
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
       WHERE l.evento_id = ? AND ${SQL_PRESUPUESTO_ACTIVO}
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

// Mismo criterio que facturacionPorEvento: sin IVA, y las líneas sin precio no suman (se cuentan aparte).
const SUMA_FACTURACION = 'SUM(CASE WHEN pl.precio_unitario IS NOT NULL THEN pl.cantidad * pl.precio_unitario ELSE 0 END)';
const SUMA_SIN_PRECIO = 'SUM(CASE WHEN pl.precio_unitario IS NULL THEN 1 ELSE 0 END)';
const redondear = (n) => Math.round((n || 0) * 100) / 100;

/** Años en los que hay eventos con presupuestos cargados, del más nuevo al más viejo. */
function aniosConPresupuestos() {
  return db
    .prepare(
      `SELECT DISTINCT CAST(substr(e.fecha_inicio, 1, 4) AS INTEGER) AS anio
       FROM eventos e JOIN lotes l ON l.evento_id = e.id JOIN presupuestos p ON p.lote_id = l.id
       WHERE e.fecha_inicio GLOB '[0-9][0-9][0-9][0-9]-*' AND ${SQL_PRESUPUESTO_ACTIVO}
       ORDER BY anio DESC`
    )
    .all()
    .map((r) => r.anio);
}

/**
 * Facturación de todo un año (sin IVA), sumando los presupuestos de los eventos que empiezan ese año:
 * el total, y el desglose por mes, por estado de cobro, por rubro y por evento. Cada evento suma igual
 * que su total en facturacionPorEvento, así que la suma de los eventos es el total del año.
 */
function facturacionAnual(anio) {
  const clave = String(anio);
  const DESDE = `FROM presupuestos p
    JOIN lotes l ON l.id = p.lote_id
    JOIN eventos e ON e.id = l.evento_id
    LEFT JOIN presupuesto_lineas pl ON pl.presupuesto_id = p.id
    WHERE substr(e.fecha_inicio, 1, 4) = ? AND ${SQL_PRESUPUESTO_ACTIVO}`;

  const general = db
    .prepare(`SELECT ${SUMA_FACTURACION} AS total, ${SUMA_SIN_PRECIO} AS sin_precio, COUNT(DISTINCT p.id) AS presupuestos, COUNT(DISTINCT e.id) AS eventos ${DESDE}`)
    .get(clave);

  const porMesFilas = db
    .prepare(`SELECT CAST(substr(e.fecha_inicio, 6, 2) AS INTEGER) AS mes, ${SUMA_FACTURACION} AS total, COUNT(DISTINCT e.id) AS eventos ${DESDE} GROUP BY mes`)
    .all(clave);
  const porMes = Array.from({ length: 12 }, (_, i) => {
    const fila = porMesFilas.find((f) => f.mes === i + 1);
    return { mes: i + 1, total: redondear(fila?.total), eventos: fila?.eventos || 0 };
  });

  const porEstado = db
    .prepare(`SELECT p.estado AS estado, ${SUMA_FACTURACION} AS total, COUNT(DISTINCT p.id) AS presupuestos ${DESDE} GROUP BY p.estado ORDER BY total DESC, p.estado`)
    .all(clave)
    .map((f) => ({ estado: f.estado, total: redondear(f.total), presupuestos: f.presupuestos }));

  const porRubro = db
    .prepare(
      `SELECT COALESCE(prod.rubro, 'Sin rubro') AS rubro, ${SUMA_FACTURACION} AS total, SUM(pl.cantidad) AS cantidad
       FROM presupuestos p
       JOIN lotes l ON l.id = p.lote_id
       JOIN eventos e ON e.id = l.evento_id
       JOIN presupuesto_lineas pl ON pl.presupuesto_id = p.id
       JOIN productos prod ON prod.id = pl.producto_id
       WHERE substr(e.fecha_inicio, 1, 4) = ? AND ${SQL_PRESUPUESTO_ACTIVO}
       GROUP BY COALESCE(prod.rubro, 'Sin rubro') ORDER BY total DESC`
    )
    .all(clave)
    .map((f) => ({ rubro: f.rubro, total: redondear(f.total), cantidad: f.cantidad }));

  const porEvento = db
    .prepare(
      `SELECT e.id AS id, e.nombre AS nombre, e.fecha_inicio AS fecha_inicio, ${SUMA_FACTURACION} AS total,
              ${SUMA_SIN_PRECIO} AS sin_precio, COUNT(DISTINCT p.id) AS presupuestos
       ${DESDE} GROUP BY e.id ORDER BY e.fecha_inicio DESC, e.nombre`
    )
    .all(clave)
    .map((f) => ({ id: f.id, nombre: f.nombre, fecha_inicio: f.fecha_inicio, total: redondear(f.total), lineasSinPrecio: f.sin_precio || 0, presupuestos: f.presupuestos }));

  return {
    anio: Number(anio),
    total: redondear(general.total),
    lineasSinPrecio: general.sin_precio || 0,
    presupuestos: general.presupuestos,
    eventos: general.eventos,
    porMes,
    porEstado,
    porRubro,
    porEvento,
  };
}

module.exports = {
  listar,
  obtener,
  obtenerDetalle,
  crear,
  actualizar,
  eliminar,
  fusionar,
  totalesPorEvento,
  agruparPorRubro,
  facturacionPorEvento,
  aniosConPresupuestos,
  facturacionAnual,
};
