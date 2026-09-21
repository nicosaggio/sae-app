// Prueba de punta a punta con los Excel REALES. Sólo corre si se definen las rutas:
//   SAE_CATALOGO_XLSX="C:\ruta\CATALOGO SAE.xlsx"  SAE_BASE_PARCHE_XLSX="C:\ruta\26_BASE PARCHE_P (1).xlsx"  npm test
// Tarda ~1 minuto (procesa las 111 imágenes). Usa una base y una carpeta de imágenes temporales.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const RUTA_CATALOGO = process.env.SAE_CATALOGO_XLSX;
const RUTA_BASE = process.env.SAE_BASE_PARCHE_XLSX;
const hayArchivos = Boolean(RUTA_CATALOGO && RUTA_BASE && fs.existsSync(RUTA_CATALOGO) && fs.existsSync(RUTA_BASE));
const skip = hayArchivos ? false : 'definí SAE_CATALOGO_XLSX y SAE_BASE_PARCHE_XLSX para correr esta prueba con los Excel reales';

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-siembra-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');

const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { leerCatalogoExcel } = require('../src/services/catalogoExcelService');
const { leerBaseParche } = require('../src/services/catalogoImportService');
const { sembrarCatalogo } = require('../src/services/catalogoSiembraService');
const fixture = require('./fixtures/catalogo-valores.json');

test.after(() => {
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('el lector cuenta lo mismo que el Excel: 259 ítems, 21 páginas, 113 publicados, 112 imágenes', { skip }, () => {
  const excel = leerCatalogoExcel(RUTA_CATALOGO);
  assert.equal(excel.valores.filas.filter((f) => f.cod).length, 259);
  assert.equal(excel.valores.ocultas.length, 0);
  assert.equal(excel.paginas.length, 21);
  assert.equal(excel.paginas.reduce((a, p) => a + p.bandas.reduce((b, banda) => b + banda.items.length, 0), 0), 113);
  assert.equal(excel.paginas.filter((p) => p.logoGrande).length, 1, 'sólo la primera página lleva el logo grande');
  assert.equal(excel.paginas[0].logoGrande, true);

  // Filas ocultas 212–225: la página borrador que se ignora
  assert.deepEqual(excel.ocultas.catalogo, Array.from({ length: 14 }, (_, i) => 212 + i));

  assert.equal(excel.imagenes.celdasConImagen, 137);
  assert.equal(excel.imagenes.distintas, 112, 'el importador de imágenes cuenta 112');
  assert.equal(excel.logoRuta, 'xl/media/image1.png');
  assert.deepEqual(excel.fotosSinItem.map((f) => f.celda), ['F94']);
  assert.equal(excel.fechaVigencia, '2026-09-15');
  const conImagen = excel.paginas.flatMap((p) => p.bandas.flatMap((b) => b.items)).filter((i) => i.imagenRuta);
  assert.equal(conImagen.length, 113);
});

test('el lector de la base parche encuentra 415 códigos y avisa el duplicado MC-49', { skip }, () => {
  const base = leerBaseParche(RUTA_BASE);
  assert.equal(base.resumen.conCodigo, 415);
  assert.deepEqual(base.duplicados, [{ codigo: 'MC-49', filas: [93, 298] }]);
  assert.equal(base.resumen.textos, 7, 'los "S / P" quedan como texto, no como 0');
});

test('la siembra reproduce el catálogo actual: mismos precios, páginas, imágenes y reglas', { skip }, async () => {
  migrar();
  const mensajes = [];
  const reporte = await sembrarCatalogo({ rutaCatalogo: RUTA_CATALOGO, rutaBaseParche: RUTA_BASE, log: (m) => mensajes.push(m) });

  assert.equal(reporte.totales.itemsImportados, 259);
  assert.equal(reporte.totales.itemsPublicados, 113);
  assert.equal(reporte.totales.paginas, 21);
  assert.equal(reporte.totales.posiciones, 113);
  assert.deepEqual(reporte.clasificacion, { base: 63, derivado: 133, manual: 47, razon: 2, proporcional: 1, sin_precio: 13 });
  assert.deepEqual(reporte.estadosDePrecio, { ok: 246, sin_precio: 13 });

  // Los 257 ítems que ya existían dan el mismo SAE que el Excel; las 2 sillas son ítems nuevos.
  assert.equal(reporte.verificacion.coinciden, 257);
  assert.deepEqual(reporte.verificacion.difieren, []);
  assert.equal(reporte.verificacion.sinReferencia, 2);

  assert.equal(reporte.difierenDeBaseParche.length, 21);
  assert.deepEqual(reporte.salteadas.map((s) => s.fila).sort((a, b) => a - b), [116, 243, 264]);
  assert.match(reporte.avisos.join('\n'), /MS-16 de la base parche/);

  // Cada ítem de la base contra la fixture, que se armó por separado
  const sae = (codigo) => db.prepare('SELECT sae, estado_precio FROM catalogo_items WHERE codigo = ?').get(codigo);
  const fallos = [];
  for (const it of fixture.items) {
    const fila = sae(it.codigo);
    const esperado = it.sae_esperado !== undefined ? it.sae_esperado : it.sae_excel;
    if (esperado === 0 ? fila.estado_precio !== 'sin_precio' : fila.sae !== esperado) fallos.push({ codigo: it.codigo, esperado, fila });
  }
  assert.deepEqual(fallos, []);
  assert.equal(sae('MM-06N').sae, 47300, 'la mesa baja publicada, con su precio y no el de la mesa redonda');
  assert.equal(sae('MS-16').sae, 53500);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalogo_items WHERE codigo IN ('TOMACORRIENTES TRIFASICO')").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM catalogo_items WHERE codigo = 'ES-04'").get().n, 1);

  // Dependencias vivas: las referencias quedaron como ids, no como números congelados
  const ce150 = db.prepare("SELECT * FROM catalogo_items WHERE codigo = 'CE-150'").get();
  const ce100 = db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'CE-100'").get();
  assert.equal(ce150.regla_tipo, 'derivado');
  assert.equal(ce150.regla_item_ref_id, ce100.id);
  assert.equal(ce150.regla_factor, 1.5);
  assert.equal(db.prepare("SELECT suma_adicional_pie, porcentaje FROM catalogo_items WHERE codigo = 'TV-43'").get().porcentaje, 1);

  // Páginas, posiciones y textos de ficha
  const paginas = db.prepare('SELECT orden, titulo, logo_grande FROM catalogo_paginas ORDER BY orden').all();
  assert.equal(paginas.length, 21);
  assert.equal(paginas[0].titulo, 'SAE - EQUIPAMIENTO EN SISTEMA');
  assert.equal(paginas.filter((p) => p.logo_grande).length, 1);
  const ficha = db.prepare("SELECT descripcion_catalogo, publicado FROM catalogo_items WHERE codigo = 'MC-01'").get();
  assert.equal(ficha.publicado, 1);
  assert.match(ficha.descripcion_catalogo, /^MOSTRADOR CIEGO BLANCO\nAncho: 1 m/);
  assert.deepEqual(JSON.parse(db.prepare("SELECT descripcion_formato AS f FROM catalogo_items WHERE codigo = 'MC-01'").get().f), [
    { t: 'MOSTRADOR CIEGO BLANCO\n', b: true, sz: 14 },
    { t: 'Ancho: 1 m\nAlto: 1 m\nProd.: 0,50m', b: false, sz: 11 },
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_items WHERE publicado = 1 AND descripcion_formato IS NULL').get().n, 0, 'todas las fichas publicadas conservan su formato');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_items WHERE publicado = 1').get().n, 113);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios').get().n, 259, 'foto de precios de la versión General');

  // Ajustes, importación registrada y vínculo con productos
  const ajustes = Object.fromEntries(db.prepare('SELECT clave, valor FROM catalogo_ajustes').all().map((a) => [a.clave, a.valor]));
  assert.match(ajustes.logo_imagen, /^[a-f0-9]{40}\.png$/);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_importaciones').get().n, 1);

  // Imágenes: 110 fotos + el logo, JPEG de a lo sumo 800 px, ninguna dentro de la base
  const archivos = fs.readdirSync(process.env.CATALOGO_IMG_DIR);
  assert.equal(archivos.length, 111);
  assert.equal(archivos.filter((a) => a.endsWith('.jpg')).length, 110);
  assert.deepEqual(reporte.imagenes.errores, []);
  assert.equal(reporte.imagenes.archivosDistintos, 112);
  const imagenesDeItems = db.prepare('SELECT imagen FROM catalogo_items WHERE imagen IS NOT NULL').all().map((r) => r.imagen);
  assert.equal(imagenesDeItems.length, 113);
  assert.ok(imagenesDeItems.every((a) => fs.existsSync(path.join(process.env.CATALOGO_IMG_DIR, a))));
  const pesoFinal = archivos.reduce((a, f) => a + fs.statSync(path.join(process.env.CATALOGO_IMG_DIR, f)).size, 0);
  assert.ok(pesoFinal < 15 * 1048576, `las imágenes ocupan ${(pesoFinal / 1048576).toFixed(1)} MB (el Excel original: 104 MB)`);
});

test('el PDF de la versión General: portada + 21 páginas, los 113 ítems con su código y su precio, y pesa pocos MB', { skip }, async () => {
  const { construirPdf, formatearPesos } = require('../src/services/catalogoPdfService');
  const general = db.prepare('SELECT id FROM catalogo_versiones WHERE es_general = 1').get().id;
  const { doc, faltantes } = construirPdf(general);
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const terminado = new Promise((r) => doc.on('end', r));
  doc.end();
  await terminado;
  const buffer = Buffer.concat(partes);

  assert.deepEqual(faltantes, []);
  assert.ok(buffer.length < 8 * 1048576, `el PDF pesa ${(buffer.length / 1048576).toFixed(1)} MB (el Excel original: 109 MB)`);

  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  assert.equal(documento.numPages, 22);
  const textoDe = async (n) => (await (await documento.getPage(n)).getTextContent()).items.map((t) => t.str).join(' ');
  assert.equal((await textoDe(1)).trim(), '', 'la portada es sólo el logo');

  const paginas = db.prepare('SELECT * FROM catalogo_paginas ORDER BY orden').all();
  let verificados = 0;
  for (const [i, pagina] of paginas.entries()) {
    const texto = await textoDe(i + 2);
    assert.ok(texto.includes(pagina.titulo), `título de la página ${pagina.orden}`);
    assert.ok(texto.includes('15 de septiembre de 2026'), `pie de la página ${pagina.orden}`);
    const items = db
      .prepare(
        `SELECT i.codigo, vp.sae FROM catalogo_posiciones po JOIN catalogo_items i ON i.id = po.item_id
           JOIN catalogo_version_precios vp ON vp.item_id = i.id AND vp.version_id = ? WHERE po.pagina_id = ?`
      )
      .all(general, pagina.id);
    assert.equal((texto.match(/CODIGO:/g) || []).length, items.length, `etiquetas de la página ${pagina.orden}`);
    for (const it of items) {
      assert.ok(texto.includes(it.codigo), `código ${it.codigo}`);
      assert.ok(texto.includes(formatearPesos(it.sae)), `precio de ${it.codigo}: ${formatearPesos(it.sae)}`);
      verificados++;
    }
  }
  assert.equal(verificados, 113);
});

test('actualizar precios con la base real: la misma base no cambia nada; si PB-250 cuesta el doble se arrastra toda su cadena', { skip }, () => {
  const baseService = require('../src/services/catalogoBaseService');
  const baseParche = leerBaseParche(RUTA_BASE);

  const igual = baseService.armarReporte(baseParche, 'misma.xlsx');
  assert.equal(igual.resumen.itemsEvaluados, 259);
  assert.equal(igual.resumen.itemsConCambios, 0, 'subir de nuevo la misma base no cambia ningún precio');
  assert.equal(igual.resumen.codigosDesaparecidos, 0);
  assert.equal(igual.resumen.itemsSinPrecio, 13);
  assert.equal(igual.resumen.versionesAfectadas, 0);

  const precioActual = baseParche.precios.get('PB-250');
  baseParche.precios.set('PB-250', precioActual * 2);
  const conCambio = baseService.armarReporte(baseParche, 'pb250-doble.xlsx');
  const codigos = conCambio.cambios.map((c) => c.codigo);
  for (const c of ['PB-250', 'PB-250 x', 'PB-250 xx', 'PB-250 xxx', 'PB-150x']) assert.ok(codigos.includes(c), `${c} depende de PB-250`);
  const pb250 = conCambio.cambios.find((c) => c.codigo === 'PB-250');
  assert.ok(Math.abs(pb250.variacion_pct - 100) < 1, `la variación se mide sobre el SAE redondeado al múltiplo de 100: ${pb250.variacion_pct} %`);
  assert.equal(pb250.destacado, true);
  assert.equal(conCambio.cambios.find((c) => c.codigo === 'PB-250 xxx').sae_nuevo, pb250.sae_nuevo, 'la cadena de 3 niveles termina en el mismo precio');
  assert.equal(conCambio.resumen.versionesAfectadas, 1);
});

test('volver a sembrar sin --reemplazar se rechaza; con --reemplazar no duplica y reutiliza las imágenes', { skip }, async () => {
  await assert.rejects(
    () => sembrarCatalogo({ rutaCatalogo: RUTA_CATALOGO, rutaBaseParche: RUTA_BASE }),
    (err) => err.status === 400 && /ya tiene 259 ítems/.test(err.message)
  );
  const reporte = await sembrarCatalogo({ rutaCatalogo: RUTA_CATALOGO, rutaBaseParche: RUTA_BASE, reemplazar: true });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n, 259);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_paginas').get().n, 21);
  assert.equal(reporte.imagenes.procesadas, 0);
  assert.equal(reporte.imagenes.reutilizadas, 111);
  assert.equal(reporte.verificacion.difieren.length, 0);
});
