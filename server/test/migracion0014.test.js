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

test('la migración 0014 sólo agrega una columna a cotizaciones (descuento_porcentaje): ninguna tabla se recrea', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0014')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0014'))), 'utf8'));
  const despues = esquema(db);

  const cambiadas = Object.keys(antes).filter((n) => despues[n] !== antes[n]);
  assert.deepEqual(cambiadas, ['cotizaciones']);
  assert.deepEqual(Object.keys(despues).filter((n) => !(n in antes)), [], 'no se crea ninguna tabla ni índice nuevo');
  assert.match(despues.cotizaciones, /descuento_porcentaje/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('descuento_porcentaje arranca en 0 para las cotizaciones que ya existían y sólo admite fracciones entre 0 y 1', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0014')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('resp', 'x', 'operador')").run();
  const usuarioId = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'resp'").get().id;
  db.prepare("INSERT INTO cotizaciones (responsable_id, responsable, fecha_carga, creado_por) VALUES (?, 'Resp Test', '2026-01-01', ?)").run(usuarioId, usuarioId);
  const cotId = db.prepare('SELECT id FROM cotizaciones').get().id;

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0014'))), 'utf8'));

  assert.equal(db.prepare('SELECT descuento_porcentaje FROM cotizaciones WHERE id = ?').get(cotId).descuento_porcentaje, 0);
  db.prepare('UPDATE cotizaciones SET descuento_porcentaje = 0.1 WHERE id = ?').run(cotId);
  assert.equal(db.prepare('SELECT descuento_porcentaje FROM cotizaciones WHERE id = ?').get(cotId).descuento_porcentaje, 0.1);
  assert.throws(() => db.prepare('UPDATE cotizaciones SET descuento_porcentaje = 1.5 WHERE id = ?').run(cotId), /CHECK/);
  assert.throws(() => db.prepare('UPDATE cotizaciones SET descuento_porcentaje = -0.1 WHERE id = ?').run(cotId), /CHECK/);
  db.close();
});
