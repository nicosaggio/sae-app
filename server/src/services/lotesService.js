const { db } = require('../db/connection');

function crear({ eventoId, codigo, expositor, contacto }) {
  const info = db
    .prepare('INSERT INTO lotes (evento_id, codigo, expositor, contacto) VALUES (?, ?, ?, ?)')
    .run(eventoId, codigo, expositor || null, contacto || null);
  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(info.lastInsertRowid);
}

function listarPorEvento(eventoId) {
  return db.prepare('SELECT * FROM lotes WHERE evento_id = ? ORDER BY id DESC').all(eventoId);
}

function editar({ loteId, codigo, expositor, contacto }) {
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) {
    const err = new Error('Lote no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare(`UPDATE lotes SET codigo = ?, expositor = ?, contacto = ?, actualizado_en = datetime('now') WHERE id = ?`).run(
    codigo,
    expositor || null,
    contacto || null,
    loteId
  );
  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
}

function eliminar(loteId) {
  const lote = db.prepare('SELECT id FROM lotes WHERE id = ?').get(loteId);
  if (!lote) {
    const err = new Error('Lote no encontrado');
    err.status = 404;
    throw err;
  }
  db.prepare('DELETE FROM lotes WHERE id = ?').run(loteId);
}

module.exports = { crear, listarPorEvento, editar, eliminar };
