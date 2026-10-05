const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CARPETA = path.join(__dirname, '..', 'src', 'db', 'migrations');
const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort();

function esquema(db) {
  return Object.fromEntries(db.prepare("SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map((f) => [f.name, f.sql]));
}

test('la migración 0015 sólo agrega la tabla lote_croquis (y su índice): ninguna tabla existente se toca', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0015')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0015'))), 'utf8'));
  const despues = esquema(db);

  const cambiadas = Object.keys(antes).filter((n) => despues[n] !== antes[n]);
  assert.deepEqual(cambiadas, [], 'ninguna tabla existente cambió');
  assert.deepEqual(Object.keys(despues).filter((n) => !(n in antes)).sort(), ['idx_lote_croquis_lote', 'lote_croquis']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('lote_croquis: un solo croquis por lote (UNIQUE), paredes/materiales arrancan en "[]", y se borra en cascada con el lote', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));

  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('resp', 'x', 'operador')").run();
  const usuarioId = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'resp'").get().id;
  db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO TEST', '2026-01-01', '2026-01-03', ?)").run(usuarioId);
  const eventoId = db.prepare("SELECT id FROM eventos WHERE nombre = 'EXPO TEST'").get().id;
  db.prepare("INSERT INTO lotes (evento_id, codigo) VALUES (?, '12')").run(eventoId);
  const loteId = db.prepare('SELECT id FROM lotes').get().id;

  db.prepare('INSERT INTO lote_croquis (lote_id, creado_por) VALUES (?, ?)').run(loteId, usuarioId);
  const fila = db.prepare('SELECT * FROM lote_croquis WHERE lote_id = ?').get(loteId);
  assert.equal(fila.paredes, '[]');
  assert.equal(fila.materiales, '[]');

  assert.throws(() => db.prepare('INSERT INTO lote_croquis (lote_id) VALUES (?)').run(loteId), /UNIQUE/, 'no se puede duplicar el croquis de un lote');

  db.prepare('DELETE FROM lotes WHERE id = ?').run(loteId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lote_croquis').get().n, 0, 'borrar el lote borra su croquis');
  db.close();
});
