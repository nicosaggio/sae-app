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

test('la migración 0010 agrega la tabla de clientes y una columna a los presupuestos de la app; nada más cambia', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0010')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0010'))), 'utf8'));
  const despues = esquema(db);

  const cambiadas = Object.keys(antes).filter((n) => despues[n] !== antes[n]);
  assert.deepEqual(cambiadas, ['cotizaciones'], 'sólo cambió la tabla de presupuestos de la app (una columna nueva)');
  assert.match(despues.cotizaciones, /cliente_id/);
  assert.deepEqual(Object.keys(despues).filter((n) => !(n in antes)).sort(), ['clientes', 'idx_clientes_razon_social', 'idx_cotizaciones_cliente']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('la tabla de clientes exige un CUIT de 11 dígitos y no admite repetidos', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  db.prepare("INSERT INTO clientes (cuit, razon_social) VALUES ('30528303540', 'A')").run();
  assert.throws(() => db.prepare("INSERT INTO clientes (cuit) VALUES ('30528303540')").run(), /UNIQUE/);
  assert.throws(() => db.prepare("INSERT INTO clientes (cuit) VALUES ('123')").run(), /CHECK/);
  db.close();
});
