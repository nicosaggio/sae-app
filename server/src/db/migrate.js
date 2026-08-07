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
    // foreign_keys se apaga ANTES del BEGIN a propósito: dentro de una transacción SQLite
    // ignora el PRAGMA silenciosamente, y si una migración reconstruye una tabla (DROP +
    // RENAME, necesario para ampliar un CHECK) con foreign_keys=ON, el DROP dispara
    // ON DELETE CASCADE contra las tablas hijas y borra datos reales.
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (nombre) VALUES (?)').run(archivo);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      db.exec('PRAGMA foreign_keys = ON');
      throw err;
    }
    db.exec('PRAGMA foreign_keys = ON');
    const violaciones = db.prepare('PRAGMA foreign_key_check').all();
    if (violaciones.length > 0) {
      throw new Error(
        `La migración ${archivo} dejó referencias de clave foránea huérfanas: ${JSON.stringify(violaciones)}`
      );
    }
  }

  console.log('Migraciones al día.');
}

if (require.main === module) {
  run();
}

module.exports = { run };
