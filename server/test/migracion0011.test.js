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

test('la migración 0011 sólo agrega columnas a catalogo_versiones y catalogo_importaciones: ninguna tabla se recrea', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0011')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0011'))), 'utf8'));
  const despues = esquema(db);

  const cambiadas = Object.keys(antes).filter((n) => despues[n] !== antes[n]).sort();
  assert.deepEqual(cambiadas, ['catalogo_importaciones', 'catalogo_versiones']);
  assert.deepEqual(Object.keys(despues).filter((n) => !(n in antes)), [], 'no se crea ninguna tabla ni índice nuevo');
  assert.match(despues.catalogo_versiones, /es_historial/);
  assert.match(despues.catalogo_importaciones, /historial_version_id/);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('es_historial arranca en 0 para las versiones que ya existían y sólo admite 0 o 1', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  assert.equal(db.prepare("SELECT es_historial FROM catalogo_versiones WHERE es_general = 1").get().es_historial, 0);
  assert.throws(() => db.prepare('UPDATE catalogo_versiones SET es_historial = 2 WHERE es_general = 1').run(), /CHECK/);
  db.close();
});
