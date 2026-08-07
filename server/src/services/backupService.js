const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { backup } = require('node:sqlite');
const { db, DB_DIR } = require('../db/connection');

const BACKUPS_DIR = path.join(DB_DIR, 'backups');
const MAXIMO_BACKUPS = 30;

fs.mkdirSync(BACKUPS_DIR, { recursive: true });

async function ejecutarBackup() {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const destino = path.join(BACKUPS_DIR, `saeapp-${timestamp}.db`);

  await backup(db, destino);
  console.log(`Backup creado: ${destino}`);

  const archivos = fs
    .readdirSync(BACKUPS_DIR)
    .filter((f) => f.endsWith('.db'))
    .sort();

  const sobrantes = archivos.length - MAXIMO_BACKUPS;
  for (let i = 0; i < sobrantes; i++) {
    fs.unlinkSync(path.join(BACKUPS_DIR, archivos[i]));
  }
}

function iniciarProgramacion() {
  // Todos los días a las 3:00 AM, hora del servidor.
  cron.schedule('0 3 * * *', () => {
    ejecutarBackup().catch((err) => console.error('Error al hacer backup automático:', err));
  });
  console.log(`Backup automático programado (diario 03:00). Carpeta: ${BACKUPS_DIR}`);
}

module.exports = { ejecutarBackup, iniciarProgramacion, BACKUPS_DIR };
