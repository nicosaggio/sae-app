// Siembra inicial del módulo Catálogos desde CATALOGO SAE.xlsx (+ la base parche para saber
// qué precios salen de la base). Se corre UNA vez: CATALOGO SAE.xlsx pesa más de 100 MB, por
// eso no se sube por HTTP. Antes de escribir hace un backup de la base.
// Uso: npm run seed:catalogo --workspace=server -- "<CATALOGO SAE.xlsx>" "<26_BASE PARCHE_P.xlsx>" [--reemplazar]
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { run: migrar } = require('./migrate');
const { DB_DIR } = require('./connection');
const { ejecutarBackup } = require('../services/backupService');
const { sembrarCatalogo, reporteACsv } = require('../services/catalogoSiembraService');
const { CARPETA_IMAGENES } = require('../services/catalogoImagenService');

const pesos = (n) => (typeof n === 'number' ? `$${Math.round(n).toLocaleString('es-AR')}` : '—');

function imprimirReporte(r, rutaCsv) {
  const t = r.totales;
  const linea = (titulo) => console.log(`\n--- ${titulo} ---`);
  console.log('\n=== Siembra del catálogo terminada ===');
  console.log(`Ítems importados: ${t.itemsImportados} (publicados en el catálogo: ${t.itemsPublicados}) · páginas: ${t.paginas} · enlazados a Productos: ${t.productosEnlazados}`);
  console.log('Reglas de precio: ' + Object.entries(r.clasificacion).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log('Estado de los precios: ' + Object.entries(r.estadosDePrecio).map(([k, v]) => `${k} ${v}`).join(' · '));
  console.log(`Verificación contra el SAE del Excel: ${r.verificacion.coinciden} coinciden, ${r.verificacion.difieren.length} difieren, ${r.verificacion.sinReferencia} sin referencia (ítems nuevos)`);
  for (const d of r.verificacion.difieren) console.log(`   DIFIERE ${d.codigo}: Excel ${pesos(d.sae_excel)} vs app ${pesos(d.sae_app)} (${d.estado}${d.motivo ? ', ' + d.motivo : ''})`);

  linea(`Difieren de la base parche: se dejó la regla actual, sin cambiar precios (${r.difierenDeBaseParche.length})`);
  for (const d of r.difierenDeBaseParche) {
    const enBase = typeof d.valor_en_base_parche === 'number' ? pesos(d.valor_en_base_parche) : `"${d.valor_en_base_parche}"`;
    console.log(`   ${d.codigo.padEnd(10)} ${d.regla.padEnd(44)} catálogo ${pesos(d.valor_en_catalogo).padStart(10)}   base parche ${enBase}`);
  }

  linea(`Filas salteadas (${r.salteadas.length})`);
  for (const s of r.salteadas) console.log(`   fila ${s.fila} ${s.codigo || '(sin código)'} — ${s.descripcion}: ${s.motivo}`);
  for (const n of r.notas) console.log(`   fila ${n.fila}: nota ignorada "${n.texto}"`);

  if (r.avisos.length > 0) {
    linea(`Avisos (${r.avisos.length})`);
    r.avisos.forEach((a) => console.log(`   ${a}`));
  }

  const i = r.imagenes;
  linea('Imágenes');
  console.log(`   ${i.celdasConImagen} celdas con imagen → ${i.archivosDistintos} archivos distintos en el Excel`);
  console.log(`   procesadas ${i.procesadas}, ya existían ${i.reutilizadas}; ${i.pesoOriginalMB} MB → ${i.pesoFinalMB} MB`);
  for (const f of i.fotosSinItem) console.log(`   foto sin ítem asociado (no se guardó): celda ${f.celda}`);
  for (const e of i.errores) console.log(`   ERROR ${e}`);
  console.log(`   Carpeta: ${CARPETA_IMAGENES}`);
  console.log('   OJO: esa carpeta NO entra en el backup automático (sólo copia el .db): respaldala aparte.');

  console.log(`\nReporte completo (una fila por ítem): ${rutaCsv}`);
}

async function main() {
  const argumentos = process.argv.slice(2);
  const reemplazar = argumentos.includes('--reemplazar');
  const [rutaCatalogo, rutaBaseParche] = argumentos.filter((a) => !a.startsWith('--'));
  if (!rutaCatalogo || !rutaBaseParche) {
    console.error('Uso: npm run seed:catalogo --workspace=server -- "<CATALOGO SAE.xlsx>" "<26_BASE PARCHE_P.xlsx>" [--reemplazar]');
    process.exit(1);
  }

  migrar();
  const reporte = await sembrarCatalogo({
    rutaCatalogo,
    rutaBaseParche,
    reemplazar,
    hacerBackup: ejecutarBackup,
    log: (mensaje) => console.log(mensaje),
  });

  const rutaJson = path.join(DB_DIR, 'reporte-siembra-catalogo.json');
  const rutaCsv = path.join(DB_DIR, 'reporte-siembra-catalogo.csv');
  fs.writeFileSync(rutaJson, JSON.stringify(reporte, null, 2));
  fs.writeFileSync(rutaCsv, reporteACsv(reporte));
  imprimirReporte(reporte, rutaCsv);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(`\nError: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { imprimirReporte };
