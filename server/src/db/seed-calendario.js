// Sincronización del calendario real de eventos desde un .xlsm (hoja "CALENDARIO 2026").
// Segura para correr más de una vez: matchea eventos existentes por (fecha_inicio,
// fecha_fin, lugar) — que no cambian cuando solo se corrige el nombre en el Excel — y
// ACTUALIZA el nombre/notas en el mismo `evento.id` en vez de duplicarlo. Eso preserva
// los lotes/presupuestos ya importados y vinculados a ese evento. Filas cuyo rango de
// fechas no existe todavía se crean como evento nuevo.
// Uso: node src/db/seed-calendario.js "<ruta al Calendario AIPSA 2026.xlsm>"
const XLSX = require('xlsx');
const { db } = require('./connection');
const eventosService = require('../services/eventosService');

function formatFecha(v) {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  return String(v).slice(0, 10);
}

function run(rutaArchivo) {
  if (!rutaArchivo) {
    console.error('Uso: node src/db/seed-calendario.js "<ruta al xlsm>"');
    process.exit(1);
  }

  const admin = db.prepare("SELECT id FROM usuarios WHERE rol = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) {
    console.error('No hay ningún usuario admin en la base — corré "npm run seed" primero.');
    process.exit(1);
  }

  const wb = XLSX.readFile(rutaArchivo, { cellDates: true });
  const ws = wb.Sheets['CALENDARIO 2026'];
  if (!ws) {
    console.error('No se encontró la hoja "CALENDARIO 2026" en el archivo.');
    process.exit(1);
  }

  const rango = XLSX.utils.decode_range(ws['!ref']);
  let creados = 0;
  let actualizados = 0;
  let sinCambios = 0;
  const salteados = [];
  const renombres = [];

  // Fila 9 (índice 8, 0-based) en adelante.
  for (let r = 8; r <= rango.e.r; r++) {
    const cell = (c) => {
      const celda = ws[XLSX.utils.encode_cell({ r, c })];
      return celda ? celda.v : null;
    };

    const nombreRaw = cell(0); // A
    const estado = cell(6); // G
    const comienzo = cell(9); // J
    const fin = cell(10); // K
    const predioRaw = cell(12); // M

    if (nombreRaw === null || nombreRaw === undefined || String(nombreRaw).trim() === '') continue;
    const nombre = String(nombreRaw).trim();

    if (!comienzo || !fin) {
      salteados.push(`${nombre} (fila ${r + 1}): sin fecha de inicio/fin`);
      continue;
    }

    const fecha_inicio = formatFecha(comienzo);
    const fecha_fin = formatFecha(fin);
    if (fecha_fin < fecha_inicio) {
      salteados.push(`${nombre} (fila ${r + 1}): fin (${fecha_fin}) antes que inicio (${fecha_inicio})`);
      continue;
    }

    const lugar = predioRaw ? String(predioRaw).trim() : null;
    const notas = estado ? `Estado calendario: ${String(estado).trim()}` : null;

    const existente = db
      .prepare('SELECT * FROM eventos WHERE fecha_inicio = ? AND fecha_fin = ? AND lugar IS ?')
      .get(fecha_inicio, fecha_fin, lugar);

    if (existente) {
      if (existente.nombre !== nombre || existente.notas !== notas) {
        if (existente.nombre !== nombre) renombres.push(`"${existente.nombre}" → "${nombre}"`);
        eventosService.actualizar(existente.id, { nombre, lugar, fecha_inicio, fecha_fin, notas });
        actualizados++;
      } else {
        sinCambios++;
      }
      continue;
    }

    eventosService.crear({ nombre, lugar, fecha_inicio, fecha_fin, notas, creadoPor: admin.id });
    creados++;
  }

  console.log(`Eventos creados: ${creados}`);
  console.log(`Eventos actualizados (mismo rango de fechas, cambió nombre/notas): ${actualizados}`);
  console.log(`Sin cambios: ${sinCambios}`);
  console.log(`Filas salteadas: ${salteados.length}`);
  if (salteados.length) {
    salteados.forEach((s) => console.log(`  - ${s}`));
  }
  if (renombres.length) {
    console.log('Renombres aplicados:');
    renombres.forEach((s) => console.log(`  - ${s}`));
  }
}

if (require.main === module) {
  run(process.argv[2]);
}

module.exports = { run };
