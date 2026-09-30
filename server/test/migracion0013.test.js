const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const CARPETA = path.join(__dirname, '..', 'src', 'db', 'migrations');
const archivos = fs.readdirSync(CARPETA).filter((f) => f.endsWith('.sql')).sort();

function tablas(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all().map((f) => f.name).sort();
}

function indices(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name NOT LIKE 'sqlite_%'").all().map((f) => f.name).sort();
}

test('la migración 0013 agrega "rechazada" al estado de las cotizaciones sin perder tablas, índices ni datos', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0013')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));

  const tablasAntes = tablas(db);
  const indicesAntes = indices(db);

  // Una cotización real ya cargada, para comprobar que reconstruir la tabla no le borra nada.
  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, nombre_completo, rol) VALUES ('resp', 'x', 'Resp Test', 'operador')").run();
  const usuarioId = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'resp'").get().id;
  db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO TEST', '2026-01-01', '2026-01-03', ?)").run(usuarioId);
  const eventoId = db.prepare("SELECT id FROM eventos WHERE nombre = 'EXPO TEST'").get().id;
  db.prepare(
    `INSERT INTO cotizaciones (evento_id, tipo, lote, nombre_stand, responsable_id, responsable, fecha_carga, creado_por)
     VALUES (?, 'SAE', '12', 'STAND TEST', ?, 'Resp Test', '2026-01-01', ?)`
  ).run(eventoId, usuarioId, usuarioId);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0013'))), 'utf8'));

  assert.deepEqual(tablas(db), tablasAntes, 'no se agregó ni se borró ninguna tabla');
  assert.deepEqual(indices(db), indicesAntes, 'se conservaron los mismos índices');
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);

  const fila = db.prepare("SELECT * FROM cotizaciones WHERE lote = '12'").get();
  assert.equal(fila.nombre_stand, 'STAND TEST', 'la fila que ya existía sigue intacta tras reconstruir la tabla');
  assert.equal(fila.estado, 'pendiente');
  assert.equal(fila.rechazada_por, null);
  assert.equal(fila.rechazada_en, null);

  db.prepare("UPDATE cotizaciones SET estado = 'rechazada', rechazada_por = ?, rechazada_en = datetime('now') WHERE id = ?").run(usuarioId, fila.id);
  assert.equal(db.prepare('SELECT estado FROM cotizaciones WHERE id = ?').get(fila.id).estado, 'rechazada');
  assert.throws(() => db.prepare("UPDATE cotizaciones SET estado = 'otracosa' WHERE id = ?").run(fila.id), /CHECK/);

  db.close();
});
