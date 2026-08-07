require('dotenv').config();
const { createApp } = require('./app');
const { run: migrate } = require('./db/migrate');
const { run: seed } = require('./db/seed');
const excelImportService = require('./services/excelImportService');
const backupService = require('./services/backupService');

const PORT = process.env.PORT ? Number(process.env.PORT) : 4001;

migrate();
seed();
excelImportService.iniciarProgramacion();
backupService.iniciarProgramacion();

const app = createApp();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`SAE-APP escuchando en http://0.0.0.0:${PORT}`);
});
