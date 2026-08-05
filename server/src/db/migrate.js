const fs = require('fs');
const path = require('path');
const { db } = require('./connection');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

function run() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      nombre TEXT PRIMARY KEY,
      aplicada_en TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const aplicadas = new Set(
    db.prepare('SELECT nombre FROM schema_migrations').all().map((r) => r.nombre)
  );

  const archivos = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  for (const archivo of archivos) {
    if (aplicadas.has(archivo)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, archivo), 'utf8');
    console.log(`Aplicando migración: ${archivo}`);
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (nombre) VALUES (?)').run(archivo);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }

  console.log('Migraciones al día.');
}

if (require.main === module) {
  run();
}

module.exports = { run };
