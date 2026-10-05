require('dotenv').config();
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createApp } = require('./app');
const { run: migrate } = require('./db/migrate');
const { run: seed } = require('./db/seed');
const backupService = require('./services/backupService');
const clientesService = require('./services/clientesService');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

// La clave con la que se firman las sesiones no puede ser la que viene por defecto en el código (es
// pública). Si no se definió SESSION_SECRET en server/.env, se genera una al azar la primera vez y se
// guarda junto a la base de datos (carpeta server/data, que no se sube a git).
function claveDeSesion() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const dir = path.dirname(process.env.DB_PATH || path.join(__dirname, '..', 'data', 'saeapp.db'));
  const archivo = path.join(dir, 'session-secret');
  try {
    const guardada = fs.readFileSync(archivo, 'utf8').trim();
    if (guardada) return guardada;
  } catch {
    // todavía no existe
  }
  const nueva = crypto.randomBytes(48).toString('hex');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(archivo, nueva);
  return nueva;
}
process.env.SESSION_SECRET = claveDeSesion();

migrate();
seed();
// Guarda como clientes a los de los presupuestos que ya estaban cargados (no hace nada si no hay nada que completar)
try {
  const { guardados } = clientesService.completarDesdePresupuestos();
  if (guardados > 0) console.log(`Clientes guardados desde presupuestos existentes: ${guardados}`);
} catch (err) {
  console.error('No se pudieron completar los clientes:', err.message);
}
backupService.iniciarProgramacion();

const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAE-APP escuchando en http://0.0.0.0:${PORT}`);
});
