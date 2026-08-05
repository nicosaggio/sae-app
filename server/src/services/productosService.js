const { db } = require('../db/connection');

function listar({ rubro, activo } = {}) {
  let sql = 'SELECT * FROM productos WHERE 1=1';
  const params = [];
  if (rubro) {
    sql += ' AND rubro = ?';
    params.push(rubro);
  }
  if (activo !== undefined) {
    sql += ' AND activo = ?';
    params.push(activo ? 1 : 0);
  }
  sql += ' ORDER BY rubro, nombre';
  return db.prepare(sql).all(...params);
}

function crear({ codigo, nombre, rubro }) {
  const info = db
    .prepare('INSERT INTO productos (codigo, nombre, rubro) VALUES (?, ?, ?)')
    .run(codigo, nombre, rubro || null);
  return db.prepare('SELECT * FROM productos WHERE id = ?').get(info.lastInsertRowid);
}

function actualizar(id, { codigo, nombre, rubro, activo }) {
  const producto = db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
  if (!producto) {
    const err = new Error('Producto no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare(
    `UPDATE productos SET codigo = ?, nombre = ?, rubro = ?, activo = ?, actualizado_en = datetime('now') WHERE id = ?`
  ).run(codigo, nombre, rubro || null, activo === undefined ? producto.activo : activo ? 1 : 0, id);
  return db.prepare('SELECT * FROM productos WHERE id = ?').get(id);
}

function eliminar(id) {
  const producto = db.prepare('SELECT id FROM productos WHERE id = ?').get(id);
  if (!producto) {
    const err = new Error('Producto no encontrado');
    err.status = 404;
    throw err;
  }
  const enUso = db.prepare('SELECT COUNT(*) AS n FROM presupuesto_lineas WHERE producto_id = ?').get(id).n;
  if (enUso > 0) {
    const err = new Error('No se puede borrar un producto usado en presupuestos. Desactivalo en su lugar.');
    err.status = 400;
    throw err;
  }
  db.prepare('DELETE FROM productos WHERE id = ?').run(id);
}

module.exports = { listar, crear, actualizar, eliminar };
