const { db, transaction } = require('../db/connection');

const ESTADOS = ['pendiente_facturar', 'facturado', 'pendiente_pago', 'cobrado'];

const SELECT_PRESUPUESTO_CONTEXTO = `
  SELECT p.*, l.codigo AS lote_codigo, l.expositor AS lote_expositor,
         e.id AS evento_id, e.nombre AS evento_nombre, e.fecha_inicio, e.fecha_fin
  FROM presupuestos p
  JOIN lotes l ON l.id = p.lote_id
  JOIN eventos e ON e.id = l.evento_id
`;

const SELECT_LINEA = `
  SELECT pl.*, prod.codigo AS producto_codigo, prod.nombre AS producto_nombre, prod.rubro
  FROM presupuesto_lineas pl JOIN productos prod ON prod.id = pl.producto_id
`;

function listarPorLote(loteId) {
  return db.prepare('SELECT * FROM presupuestos WHERE lote_id = ? ORDER BY id DESC').all(loteId);
}

function listar({ confirmado, estado, eventoId, desde, hasta } = {}) {
  let sql = SELECT_PRESUPUESTO_CONTEXTO + ' WHERE 1=1';
  const params = [];
  if (confirmado !== undefined) {
    sql += ' AND p.confirmado = ?';
    params.push(confirmado ? 1 : 0);
  }
  if (estado) {
    sql += ' AND p.estado = ?';
    params.push(estado);
  }
  if (eventoId) {
    sql += ' AND e.id = ?';
    params.push(eventoId);
  }
  if (desde) {
    sql += ' AND e.fecha_inicio >= ?';
    params.push(desde);
  }
  if (hasta) {
    sql += ' AND e.fecha_inicio <= ?';
    params.push(hasta);
  }
  sql += ' ORDER BY e.fecha_inicio ASC, p.id DESC';
  return db.prepare(sql).all(...params);
}

function obtener(id) {
  const presupuesto = db.prepare(SELECT_PRESUPUESTO_CONTEXTO + ' WHERE p.id = ?').get(id);
  if (!presupuesto) return null;
  const lineas = db.prepare(SELECT_LINEA + ' WHERE pl.presupuesto_id = ? ORDER BY prod.rubro, prod.nombre').all(id);
  return { ...presupuesto, lineas };
}

function crear({ loteId, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado }) {
  const info = db
    .prepare(
      `INSERT INTO presupuestos
        (lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      loteId,
      numero || null,
      fecha || null,
      cliente_nombre || null,
      cliente_contacto || null,
      condiciones_pago || null,
      monto_total === undefined || monto_total === null || monto_total === '' ? null : Number(monto_total),
      notas || null,
      confirmado ? 1 : 0
    );
  return db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(info.lastInsertRowid);
}

function actualizar(id, { numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado }) {
  const existente = db.prepare('SELECT id FROM presupuestos WHERE id = ?').get(id);
  if (!existente) {
    const err = new Error('Presupuesto no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare(
    `UPDATE presupuestos SET numero = ?, fecha = ?, cliente_nombre = ?, cliente_contacto = ?, condiciones_pago = ?,
       monto_total = ?, notas = ?, confirmado = ?, actualizado_en = datetime('now') WHERE id = ?`
  ).run(
    numero || null,
    fecha || null,
    cliente_nombre || null,
    cliente_contacto || null,
    condiciones_pago || null,
    monto_total === undefined || monto_total === null || monto_total === '' ? null : Number(monto_total),
    notas || null,
    confirmado ? 1 : 0,
    id
  );
  return db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(id);
}

function cambiarEstado(id, estado) {
  if (!ESTADOS.includes(estado)) {
    const err = new Error('Estado inválido');
    err.status = 400;
    throw err;
  }
  const existente = db.prepare('SELECT id FROM presupuestos WHERE id = ?').get(id);
  if (!existente) {
    const err = new Error('Presupuesto no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE presupuestos SET estado = ?, actualizado_en = datetime('now') WHERE id = ?`).run(estado, id);
  return db.prepare('SELECT * FROM presupuestos WHERE id = ?').get(id);
}

function eliminar(id) {
  const existente = db.prepare('SELECT id FROM presupuestos WHERE id = ?').get(id);
  if (!existente) {
    const err = new Error('Presupuesto no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM presupuestos WHERE id = ?').run(id);
}

/** Igual que lotesService en StockApp: si el producto ya está en el presupuesto, suma la cantidad. */
function guardarLinea({ presupuestoId, productoId, cantidad, comentario }) {
  return transaction(() => {
    const presupuesto = db.prepare('SELECT id FROM presupuestos WHERE id = ?').get(presupuestoId);
    if (!presupuesto) {
      const err = new Error('Presupuesto no encontrado');
      err.status = 404;
      throw err;
    }

    const existente = db
      .prepare('SELECT id, cantidad, comentario FROM presupuesto_lineas WHERE presupuesto_id = ? AND producto_id = ?')
      .get(presupuestoId, productoId);

    let lineaId;
    const cantidadAnterior = existente ? existente.cantidad : 0;
    if (existente) {
      const comentarioFinal = comentario || existente.comentario || null;
      db.prepare(
        `UPDATE presupuesto_lineas SET cantidad = ?, comentario = ?, actualizado_en = datetime('now') WHERE id = ?`
      ).run(existente.cantidad + cantidad, comentarioFinal, existente.id);
      lineaId = existente.id;
    } else {
      const info = db
        .prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, comentario) VALUES (?, ?, ?, ?)')
        .run(presupuestoId, productoId, cantidad, comentario || null);
      lineaId = info.lastInsertRowid;
    }

    const linea = db.prepare(SELECT_LINEA + ' WHERE pl.id = ?').get(lineaId);
    return { linea, cantidad_sumada: cantidad, cantidad_anterior: cantidadAnterior };
  });
}

function actualizarLinea({ lineaId, cantidad }) {
  const linea = db.prepare('SELECT * FROM presupuesto_lineas WHERE id = ?').get(lineaId);
  if (!linea) {
    const err = new Error('Línea no encontrada');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE presupuesto_lineas SET cantidad = ?, actualizado_en = datetime('now') WHERE id = ?`).run(cantidad, lineaId);
  return db.prepare(SELECT_LINEA + ' WHERE pl.id = ?').get(lineaId);
}

function borrarLinea(lineaId) {
  const linea = db.prepare('SELECT id FROM presupuesto_lineas WHERE id = ?').get(lineaId);
  if (!linea) {
    const err = new Error('Línea no encontrada');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM presupuesto_lineas WHERE id = ?').run(lineaId);
}

/** Presupuestos pendientes de pago con evento a <=3 días de empezar, o ya vencidos. */
function alertasPago() {
  return db
    .prepare(
      `SELECT p.*, l.codigo AS lote_codigo, l.expositor AS lote_expositor,
              e.id AS evento_id, e.nombre AS evento_nombre, e.fecha_inicio
       FROM presupuestos p
       JOIN lotes l ON l.id = p.lote_id
       JOIN eventos e ON e.id = l.evento_id
       WHERE p.estado = 'pendiente_pago'
         AND date(e.fecha_inicio) <= date('now', '+3 days')
       ORDER BY e.fecha_inicio ASC`
    )
    .all();
}

module.exports = {
  ESTADOS,
  listarPorLote,
  listar,
  obtener,
  crear,
  actualizar,
  cambiarEstado,
  eliminar,
  guardarLinea,
  actualizarLinea,
  borrarLinea,
  alertasPago,
};
