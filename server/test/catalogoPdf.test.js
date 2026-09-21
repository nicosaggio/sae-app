const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-pdf-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');

const { Jimp, JimpMime } = require('jimp');
const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { guardarImagen } = require('../src/services/catalogoImagenService');
const { createApp } = require('../src/app');
const pdf = require('../src/services/catalogoPdfService');

let servidor;
let base;
let idGeneral;
let cookie;
let fotoRoja;
let logo;

const colorPng = async (ancho, alto, color) => Buffer.from(await new Jimp({ width: ancho, height: alto, color }).getBuffer(JimpMime.png));

test.before(async () => {
  migrar();
  logo = (await guardarImagen(await colorPng(600, 200, 0x3344ccff), { conservarPng: true })).archivo;
  fotoRoja = (await guardarImagen(await colorPng(400, 500, 0xcc2222ff))).archivo;
  const fotoAzul = (await guardarImagen(await colorPng(400, 500, 0x2222ccff))).archivo;
  db.prepare("UPDATE catalogo_ajustes SET valor = ? WHERE clave = 'logo_imagen'").run(logo);
  db.prepare("INSERT OR REPLACE INTO catalogo_ajustes (clave, valor) VALUES ('logo_imagen', ?)").run(logo);

  idGeneral = db.prepare('SELECT id FROM catalogo_versiones WHERE es_general = 1').get().id;
  const corridas = JSON.stringify([{ t: 'MOSTRADOR CIEGO BLANCO\n', b: true, sz: 14 }, { t: 'Ancho: 1 m\nAlto: 1 m', b: false, sz: 11 }]);
  const nuevo = (codigo, sae, extra = {}) => {
    const info = db
      .prepare('INSERT INTO catalogo_items (codigo, descripcion_catalogo, descripcion_formato, imagen, activo, publicado) VALUES (?, ?, ?, ?, ?, 1)')
      .run(codigo, `Ficha ${codigo}`, extra.formato === undefined ? corridas : extra.formato, extra.imagen ?? null, extra.activo ?? 1);
    const id = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) VALUES (?, ?, ?, 0.4, ?, ?)')
      .run(idGeneral, id, sae, sae, sae === null ? 'sin_precio' : 'ok');
    return id;
  };
  const a = nuevo('MC-01', 77700, { imagen: fotoRoja });
  const b = nuevo('TV-43', 355800, { imagen: fotoAzul, formato: null });
  const c = nuevo('SIN-1', null);
  const d = nuevo('BAJA-1', 5000, { activo: 0 });
  const e = nuevo('SINFOTO', 9900, { imagen: `${'e'.repeat(40)}.jpg` });
  const f = nuevo('MILES', 1234500);

  const pagina = (orden, titulo, grande) =>
    Number(db.prepare('INSERT INTO catalogo_paginas (orden, titulo, logo_grande) VALUES (?, ?, ?)').run(orden, titulo, grande).lastInsertRowid);
  const p1 = pagina(1, 'SAE - EQUIPAMIENTO', 1);
  const p2 = pagina(2, 'SAE - PISOS', 0);
  const poner = (p, banda, columna, item) => db.prepare('INSERT INTO catalogo_posiciones (pagina_id, banda, columna, item_id) VALUES (?, ?, ?, ?)').run(p, banda, columna, item);
  poner(p1, 1, 1, a);
  poner(p1, 1, 2, b);
  poner(p1, 1, 3, c);
  poner(p1, 2, 1, d);
  poner(p1, 2, 2, e);
  poner(p2, 1, 1, f);

  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('pdf', ?, 'admin')").run(bcrypt.hashSync('clave', 4));
  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: 'pdf', password: 'clave' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

async function pdfABuffer(versionId) {
  const { doc, faltantes, nombreArchivo } = pdf.construirPdf(versionId);
  const partes = [];
  doc.on('data', (p) => partes.push(p));
  const terminado = new Promise((r) => doc.on('end', r));
  doc.end();
  await terminado;
  return { buffer: Buffer.concat(partes), faltantes, nombreArchivo };
}

async function textoPorPagina(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const paginas = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const contenido = await (await documento.getPage(i)).getTextContent();
    paginas.push(contenido.items.map((t) => t.str).join(' '));
  }
  return paginas;
}

test('portada con el logo + una página por página del catálogo, en A4 vertical', async () => {
  const { buffer } = await pdfABuffer(idGeneral);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  const paginas = await textoPorPagina(buffer);
  assert.equal(paginas.length, 3, 'portada + 2 páginas');
  assert.equal(paginas[0].trim(), '', 'la portada es sólo el logo');
  assert.match(buffer.toString('latin1'), /\/MediaBox \[0 0 595\.28 841\.89\]/);
});

test('cada ítem lleva su etiqueta, código, ficha y precio en formato argentino; el ítem dado de baja no sale', async () => {
  const { buffer, faltantes } = await pdfABuffer(idGeneral);
  const [, pagina1, pagina2] = await textoPorPagina(buffer);

  assert.match(pagina1, /SAE - EQUIPAMIENTO/);
  assert.equal((pagina1.match(/CODIGO:/g) || []).length, 4, 'MC-01, TV-43, SIN-1 y SINFOTO (BAJA-1 está dado de baja)');
  for (const codigo of ['MC-01', 'TV-43', 'SIN-1', 'SINFOTO']) assert.ok(pagina1.includes(codigo), codigo);
  assert.ok(!pagina1.includes('BAJA-1'));
  assert.ok(pagina1.includes('77.700,00'));
  assert.ok(pagina1.includes('355.800,00'));
  assert.ok(pagina1.includes('9.900,00'));
  assert.ok(pagina1.includes('S / P'), 'un ítem sin precio dice S / P, nunca $ 0,00');
  assert.ok(!/\$\s*0,00/.test(pagina1));

  assert.match(pagina2, /SAE - PISOS/);
  assert.ok(pagina2.includes('1.234.500,00'), 'separador de miles');

  assert.deepEqual(faltantes, [`${'e'.repeat(40)}.jpg`], 'una foto que no está en disco se imprime sin foto y se avisa, no rompe');
});

test('la ficha respeta el formato: título primero y las medidas en líneas separadas', async () => {
  const [, pagina1] = await textoPorPagina((await pdfABuffer(idGeneral)).buffer);
  const titulo = pagina1.indexOf('MOSTRADOR CIEGO BLANCO');
  const ancho = pagina1.indexOf('Ancho: 1 m');
  const alto = pagina1.indexOf('Alto: 1 m');
  assert.ok(titulo >= 0 && titulo < ancho && ancho < alto, 'MOSTRADOR CIEGO BLANCO → Ancho → Alto');
  assert.ok(pagina1.includes('Ficha TV-43'), 'sin formato guardado cae al texto plano de la ficha');
});

test('el pie legal lleva la fecha de vigencia en letras, y cada versión puede tener la suya y su propio texto', async () => {
  const [, pagina1] = await textoPorPagina((await pdfABuffer(idGeneral)).buffer);
  assert.match(pagina1, /TODOS LOS PRECIOS NO INCLUYEN EL IVA \(21 %\) Y ESTÁN EXPRESADOS EN PESOS ARGENTINOS\./);
  assert.match(pagina1, /válidos hasta el 15 de septiembre de 2026\./);
  assert.match(pagina1, /disponibilidad en el momento de la reserva\./);

  const feria = Number(
    db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global, fecha_vigencia, pie_legal) VALUES ('Feria', 0.55, '2027-01-31', 'Precios especiales hasta el {fecha_vigencia}.')").run().lastInsertRowid
  );
  db.prepare('INSERT INTO catalogo_version_precios (version_id, item_id, pase_parche, porcentaje, sae, estado_precio) SELECT ?, item_id, pase_parche, 0.55, sae + 100, estado_precio FROM catalogo_version_precios WHERE version_id = ?').run(feria, idGeneral);
  const paginas = await textoPorPagina((await pdfABuffer(feria)).buffer);
  assert.match(paginas[1], /Precios especiales hasta el 31 de enero de 2027\./);
  assert.ok(paginas[1].includes('77.800,00'), 'usa la foto de precios de esa versión, no la de la General');
  assert.ok(!paginas[1].includes('77.700,00'));
});

test('los decimales se pueden ocultar desde los ajustes', async () => {
  db.prepare("INSERT OR REPLACE INTO catalogo_ajustes (clave, valor) VALUES ('mostrar_decimales', '0')").run();
  try {
    const [, pagina1] = await textoPorPagina((await pdfABuffer(idGeneral)).buffer);
    assert.ok(pagina1.includes('77.700') && !pagina1.includes('77.700,00'));
  } finally {
    db.prepare("INSERT OR REPLACE INTO catalogo_ajustes (clave, valor) VALUES ('mostrar_decimales', '1')").run();
  }
});

test('versión inexistente → 404; versión sin precios calculados → 409 con mensaje claro', () => {
  assert.throws(() => pdf.construirPdf(999999), (err) => err.status === 404);
  const sinPrecios = Number(db.prepare("INSERT INTO catalogo_versiones (nombre, porcentaje_global) VALUES ('Sin calcular', 0.6)").run().lastInsertRowid);
  assert.throws(() => pdf.construirPdf(sinPrecios), (err) => err.status === 409 && /Sin calcular.*todavía no tiene precios calculados/.test(err.message));
});

test('sin páginas cargadas genera igualmente un PDF con un aviso', async () => {
  db.exec('BEGIN');
  try {
    db.exec('DELETE FROM catalogo_posiciones; DELETE FROM catalogo_paginas;');
    const [unica] = await textoPorPagina((await pdfABuffer(idGeneral)).buffer);
    assert.match(unica, /todavía no tiene páginas cargadas/);
  } finally {
    db.exec('ROLLBACK');
  }
});

test('HTTP: el PDF se descarga con nombre y tipo correctos, y hace falta sesión', async () => {
  const sinSesion = await fetch(`${base}/api/catalogo/versiones/${idGeneral}/pdf`);
  assert.equal(sinSesion.status, 401);

  const res = await fetch(`${base}/api/catalogo/versiones/${idGeneral}/pdf`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  const disposicion = res.headers.get('content-disposition');
  assert.match(disposicion, /^attachment; filename="CATALOGO SAE - General - \d{4}-\d{2}-\d{2}\.pdf"; filename\*=UTF-8''CATALOGO%20SAE%20-%20General%20-%20/);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF');

  const noExiste = await fetch(`${base}/api/catalogo/versiones/999999/pdf`, { headers: { cookie } });
  assert.equal(noExiste.status, 404);
  assert.match((await noExiste.json()).error, /no encontrada/);
});

test('HTTP: las imágenes se sirven con caché, y un nombre inválido o inexistente da 404', async () => {
  const res = await fetch(`${base}/api/catalogo/imagenes/${fotoRoja}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/jpeg');
  assert.match(res.headers.get('cache-control'), /immutable/);
  await res.arrayBuffer();

  assert.equal((await fetch(`${base}/api/catalogo/imagenes/${fotoRoja}`)).status, 401);
  for (const malo of ['..%2F..%2Fsaeapp.db', 'logo.jpg', `${'f'.repeat(40)}.jpg`]) {
    assert.equal((await fetch(`${base}/api/catalogo/imagenes/${malo}`, { headers: { cookie } })).status, 404, malo);
  }
});

test('formatearPesos, fechaLarga y nombreDeArchivo', () => {
  assert.equal(pdf.formatearPesos(0), '0,00');
  assert.equal(pdf.formatearPesos(999), '999,00');
  assert.equal(pdf.formatearPesos(1000), '1.000,00');
  assert.equal(pdf.formatearPesos(40200), '40.200,00');
  assert.equal(pdf.formatearPesos(1234567), '1.234.567,00');
  assert.equal(pdf.formatearPesos(40200, false), '40.200');
  assert.equal(pdf.formatearPesos(40200.5), '40.200,50');

  assert.equal(pdf.fechaLarga('2026-09-15'), '15 de septiembre de 2026');
  assert.equal(pdf.fechaLarga('2027-01-05'), '5 de enero de 2027');
  assert.equal(pdf.fechaLarga(null), null);
  assert.equal(pdf.fechaLarga('mañana'), null);

  assert.equal(pdf.nombreDeArchivo('General', new Date('2026-09-21T15:00:00Z')), 'CATALOGO SAE - General - 2026-09-21.pdf');
  assert.equal(pdf.nombreDeArchivo('Expo: "Muebles" / 2026?', new Date('2026-09-21T15:00:00Z')), 'CATALOGO SAE - Expo Muebles 2026 - 2026-09-21.pdf');
});

// Ancho ficticio: medio cuerpo por letra
const medir = (t, b, sz) => t.length * sz * 0.5;
const textos = (lineas) => lineas.map((l) => l.fragmentos.map((f) => f.t).join(''));

test('armarLineas: respeta los saltos de línea y no agrega una línea vacía por el salto final del título', () => {
  const lineas = pdf.armarLineas([{ t: 'TITULO\n', b: true, sz: 14 }, { t: 'Ancho: 1 m\nAlto: 1 m', b: false, sz: 11 }], 500, medir);
  assert.deepEqual(textos(lineas), ['TITULO', 'Ancho: 1 m', 'Alto: 1 m']);
  assert.deepEqual(lineas.map((l) => l.tamano), [14, 11, 11]);
});

test('armarLineas: corta por palabras cuando no entra, sin espacios al principio ni al final de cada línea', () => {
  const lineas = pdf.armarLineas([{ t: 'MOSTRADOR CIEGO BLANCO CON GUARDADO', b: true, sz: 10 }], 105, medir);
  assert.deepEqual(textos(lineas), ['MOSTRADOR CIEGO', 'BLANCO CON GUARDADO']);
  assert.ok(lineas.every((l) => medir(l.fragmentos.map((f) => f.t).join(''), true, 10) <= 105));
});

test('armarLineas: tamaños y negritas mezclados en la misma línea; línea vacía si hay dos saltos seguidos', () => {
  const mezcla = pdf.armarLineas([{ t: 'PESO ', b: false, sz: 11 }, { t: 'MAX.', b: true, sz: 14 }], 500, medir);
  assert.equal(mezcla.length, 1);
  assert.equal(mezcla[0].tamano, 14);
  assert.deepEqual(mezcla[0].fragmentos.map((f) => [f.t, f.b, f.sz]), [['PESO ', false, 11], ['MAX.', true, 14]]);

  assert.deepEqual(textos(pdf.armarLineas([{ t: 'a\n\nb', b: true, sz: 12 }], 500, medir)), ['a', '', 'b']);
});

test('armarLineas: una palabra más ancha que la celda queda sola en su línea (sin loop infinito)', () => {
  const lineas = pdf.armarLineas([{ t: 'PALABRAINTERMINABLEMENTELARGA fin', b: true, sz: 10 }], 30, medir);
  assert.deepEqual(textos(lineas), ['PALABRAINTERMINABLEMENTELARGA', 'fin']);
  assert.deepEqual(pdf.armarLineas([], 100, medir), []);
});
