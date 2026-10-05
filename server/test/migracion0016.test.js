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

test('la migración 0016 sólo agrega dos columnas a lote_croquis: ninguna otra tabla ni índice cambia', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0016')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0016'))), 'utf8'));
  const despues = esquema(db);

  assert.deepEqual(Object.keys(despues).sort(), Object.keys(antes).sort(), 'no aparece ni desaparece ninguna tabla ni índice');
  assert.deepEqual(Object.keys(antes).filter((n) => despues[n] !== antes[n]), ['lote_croquis'], 'sólo cambia lote_croquis');
  assert.deepEqual(
    db.prepare('PRAGMA table_info(lote_croquis)').all().map((c) => c.name).slice(-2),
    ['comentarios', 'cotas']
  );
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('los croquis que ya existían quedan sin comentarios y sin cotas', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0016')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));

  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('resp', 'x', 'operador')").run();
  const usuarioId = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'resp'").get().id;
  db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO TEST', '2026-01-01', '2026-01-03', ?)").run(usuarioId);
  const eventoId = db.prepare("SELECT id FROM eventos WHERE nombre = 'EXPO TEST'").get().id;
  db.prepare("INSERT INTO lotes (evento_id, codigo) VALUES (?, '12')").run(eventoId);
  const loteId = db.prepare('SELECT id FROM lotes').get().id;
  db.prepare('INSERT INTO lote_croquis (lote_id, paredes, creado_por) VALUES (?, ?, ?)').run(loteId, '[{"x1":0,"y1":0,"x2":1,"y2":0}]', usuarioId);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0016'))), 'utf8'));

  const fila = db.prepare('SELECT * FROM lote_croquis WHERE lote_id = ?').get(loteId);
  assert.equal(fila.comentarios, '');
  assert.equal(fila.cotas, '[]');
  assert.equal(fila.paredes, '[{"x1":0,"y1":0,"x2":1,"y2":0}]', 'lo que ya estaba dibujado no se toca');
  db.close();
});
