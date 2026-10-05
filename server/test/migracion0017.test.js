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

test('la migración 0017 sólo agrega la tabla cotizacion_croquis: ninguna tabla existente se toca', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos.filter((f) => f < '0017')) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));
  const antes = esquema(db);

  db.exec(fs.readFileSync(path.join(CARPETA, archivos.find((f) => f.startsWith('0017'))), 'utf8'));
  const despues = esquema(db);

  assert.deepEqual(Object.keys(antes).filter((n) => despues[n] !== antes[n]), [], 'ninguna tabla ni índice existente cambió');
  assert.deepEqual(Object.keys(despues).filter((n) => !(n in antes)), ['cotizacion_croquis']);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
});

test('cotizacion_croquis: un solo croquis por presupuesto, arranca vacío y saliendo en el PDF, y se borra con el presupuesto', () => {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON');
  for (const archivo of archivos) db.exec(fs.readFileSync(path.join(CARPETA, archivo), 'utf8'));

  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('resp', 'x', 'operador')").run();
  const usuarioId = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'resp'").get().id;
  db.prepare("INSERT INTO cotizaciones (fecha_carga, responsable_id, responsable, creado_por) VALUES ('2026-10-01', ?, 'resp', ?)").run(usuarioId, usuarioId);
  const cotizacionId = db.prepare('SELECT id FROM cotizaciones').get().id;

  db.prepare('INSERT INTO cotizacion_croquis (cotizacion_id, creado_por) VALUES (?, ?)').run(cotizacionId, usuarioId);
  const fila = db.prepare('SELECT * FROM cotizacion_croquis WHERE cotizacion_id = ?').get(cotizacionId);
  assert.deepEqual([fila.paredes, fila.materiales, fila.cotas, fila.comentarios, fila.incluir_en_pdf], ['[]', '[]', '[]', '', 1]);

  assert.throws(() => db.prepare('INSERT INTO cotizacion_croquis (cotizacion_id) VALUES (?)').run(cotizacionId), /UNIQUE/);
  assert.throws(() => db.prepare('UPDATE cotizacion_croquis SET incluir_en_pdf = 2 WHERE cotizacion_id = ?').run(cotizacionId), /CHECK|constraint/i);

  db.prepare('DELETE FROM cotizaciones WHERE id = ?').run(cotizacionId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizacion_croquis').get().n, 0, 'borrar el presupuesto borra su croquis');
  db.close();
});
