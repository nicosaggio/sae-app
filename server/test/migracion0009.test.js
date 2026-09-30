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

test('la migración 0009 sólo agrega tablas nuevas: no toca ninguna tabla ni índice que ya existía', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0009')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0009'))), 'utf8'));
  const despues = esquema(db);

  for (const [nombre, sql] of Object.entries(antes)) assert.equal(despues[nombre], sql, `"${nombre}" quedó igual`);
  const nuevos = Object.keys(despues).filter((n) => !(n in antes)).sort();
  assert.deepEqual(nuevos, ['cotizacion_adjuntos', 'cotizacion_lineas', 'cotizaciones', 'cotizaciones_eventos', 'idx_cotizacion_adjuntos_cotizacion', 'idx_cotizacion_lineas_codigo', 'idx_cotizaciones_estado', 'idx_cotizaciones_evento', 'idx_cotizaciones_id_cliente']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('la migración 0009 no deja filas en las tablas existentes y las nuevas arrancan vacías', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  for (const tabla of ['cotizaciones', 'cotizacion_lineas', 'cotizacion_adjuntos', 'cotizaciones_eventos']) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get().n, 0, tabla);
  db.close();
});
