const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, '..', '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DB_DIR, 'saeapp.db');

fs.mkdirSync(DB_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec('PRAGMA busy_timeout = 5000');

// node:sqlite no tiene transacciones anidadas (un BEGIN dentro de otro BEGIN tira error). Un `transaction()`
// llamado desde adentro de otro (por ejemplo, un servicio que guarda una versión del historial como parte
// de confirmar una base parche, que ya está dentro de su propia transacción) se suma a la de afuera: sólo
// la llamada más externa hace BEGIN/COMMIT/ROLLBACK de verdad. Un error en cualquier nivel deshace todo.
let profundidad = 0;

function transaction(fn) {
  const esRaiz = profundidad === 0;
  if (esRaiz) db.exec('BEGIN IMMEDIATE');
  profundidad += 1;
  try {
    const result = fn();
    profundidad -= 1;
    if (esRaiz) db.exec('COMMIT');
    return result;
  } catch (err) {
    profundidad -= 1;
    if (esRaiz) db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, transaction, DB_PATH, DB_DIR };
