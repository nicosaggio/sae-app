require('dotenv').config();
const { createApp } = require('./app');
const { run: migrate } = require('./db/migrate');
const { run: seed } = require('./db/seed');
const excelImportService = require('./services/excelImportService');
const backupService = require('./services/backupService');
const clientesService = require('./services/clientesService');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

migrate();
seed();
// Guarda como clientes a los de los presupuestos que ya estaban cargados (no hace nada si no hay nada que completar)
try {
  const { guardados } = clientesService.completarDesdePresupuestos();
  if (guardados > 0) console.log(`Clientes guardados desde presupuestos existentes: ${guardados}`);
} catch (err) {
  console.error('No se pudieron completar los clientes:', err.message);
}
excelImportService.iniciarProgramacion();
backupService.iniciarProgramacion();

const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAE-APP escuchando en http://0.0.0.0:${PORT}`);
});
