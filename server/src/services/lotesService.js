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

function leer(loteId) {
  const lote = db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
  if (!lote) {
    const err = new Error('Lote no encontrado');
    err.status = 404;
    throw err;
  }
  return lote;
}

/** Dentro de un evento no puede haber dos lotes con el mismo número. */
function exigirCodigoLibre(lote, codigo) {
  const otro = db.prepare('SELECT id FROM lotes WHERE evento_id = ? AND codigo = ? AND id != ?').get(lote.evento_id, codigo, lote.id);
  if (otro) {
    const err = new Error(`Ya hay otro lote con el número "${codigo}" en este evento.`);
    err.status = 409;
    throw err;
  }
}

function editar({ loteId, codigo, expositor, contacto }) {
  const lote = leer(loteId);
  exigirCodigoLibre(lote, codigo);
  db.prepare(`UPDATE lotes SET codigo = ?, expositor = ?, contacto = ?, actualizado_en = datetime('now') WHERE id = ?`).run(
    codigo,
    expositor || null,
    contacto || null,
    loteId
  );
  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
}

/** Cambia sólo el número del lote; el expositor y el contacto quedan como estaban. */
function cambiarCodigo({ loteId, codigo }) {
  const lote = leer(loteId);
  exigirCodigoLibre(lote, codigo);
  db.prepare(`UPDATE lotes SET codigo = ?, actualizado_en = datetime('now') WHERE id = ?`).run(codigo, loteId);
  return db.prepare('SELECT * FROM lotes WHERE id = ?').get(loteId);
}

function eliminar(loteId) {
  leer(loteId);
  db.prepare('DELETE FROM lotes WHERE id = ?').run(loteId);
}

module.exports = { crear, listarPorEvento, editar, cambiarCodigo, eliminar };
