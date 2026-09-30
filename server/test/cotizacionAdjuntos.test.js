const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-adj-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const PDFDocument = require('pdfkit');
const { Jimp, JimpMime } = require('jimp');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const { sembrarCatalogoDePrueba } = require('./helpers/catalogoDePrueba');

let servidor;
let base;
const cookies = {};

async function iniciarSesion(usuario) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: usuario, password: 'clave' }) });
  cookies[usuario] = res.headers.get('set-cookie').split(';')[0];
}

async function api(usuario, metodo, ruta, cuerpo) {
  const res = await fetch(`${base}/api/cotizaciones${ruta}`, {
    method: metodo,
    headers: { ...(cookies[usuario] ? { cookie: cookies[usuario] } : {}), ...(cuerpo !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: cuerpo !== undefined ? JSON.stringify(cuerpo) : undefined,
  });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, cuerpo: json, res };
}

/** Sube un archivo como el navegador (multipart, campo "archivo"). */
async function subir(usuario, cotizacionId, bytes, nombre, titulo) {
  const datos = new FormData();
  if (bytes !== null) datos.append('archivo', new Blob([bytes]), nombre);
  if (titulo !== undefined) datos.append('titulo', titulo);
  const res = await fetch(`${base}/api/cotizaciones/${cotizacionId}/adjuntos`, { method: 'POST', headers: cookies[usuario] ? { cookie: cookies[usuario] } : {}, body: datos });
  const texto = await res.text();
  let json = null;
  try {
    json = texto ? JSON.parse(texto) : null;
  } catch {
    json = texto;
  }
  return { status: res.status, cuerpo: json };
}

const archivosEnDisco = () => (fs.existsSync(process.env.COTIZACIONES_ADJ_DIR) ? fs.readdirSync(process.env.COTIZACIONES_ADJ_DIR).sort() : []);

const png = async (ancho, alto, color = 0xcc3333ff) => Buffer.from(await new Jimp({ width: ancho, height: alto, color }).getBuffer(JimpMime.png));
const jpg = async (ancho, alto, color = 0x3366ccff) => Buffer.from(await new Jimp({ width: ancho, height: alto, color }).getBuffer(JimpMime.jpeg, { quality: 80 }));

/** Un PDF de `paginas` páginas, cada una con el texto "<etiqueta>-PAGINA-n". */
function pdfDePrueba(etiqueta, paginas, opciones = {}) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ autoFirstPage: false, size: 'A3', ...opciones });
    const partes = [];
    doc.on('data', (d) => partes.push(d));
    doc.on('end', () => resolve(Buffer.concat(partes)));
    for (let i = 1; i <= paginas; i++) {
      doc.addPage();
      doc.fontSize(30).text(`${etiqueta}-PAGINA-${i}`, 60, 60);
    }
    doc.end();
  });
}

/** Le agrega a un JPEG la marca EXIF "Orientation = 6" (foto de celular sacada girada 90°). */
function conOrientacionExif6(bytes) {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0, 0, 0, 1, 0x00, 0x06, 0, 0, 0, 0, 0, 0]);
  const cuerpo = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const cabecera = Buffer.from([0xff, 0xe1, (cuerpo.length + 2) >> 8, (cuerpo.length + 2) & 255]);
  return Buffer.concat([bytes.subarray(0, 2), cabecera, cuerpo, bytes.subarray(2)]);
}

async function paginasDelPdf(buffer) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
  const paginas = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const pagina = await documento.getPage(i);
    const vista = pagina.getViewport({ scale: 1 });
    const contenido = await pagina.getTextContent();
    paginas.push({ texto: contenido.items.map((t) => t.str).join(' '), ancho: Math.round(vista.width), alto: Math.round(vista.height) });
  }
  return paginas;
}

async function pdfDe(usuario, id, consulta = '') {
  const res = await fetch(`${base}/api/cotizaciones/${id}/pdf${consulta}`, { headers: { cookie: cookies[usuario] } });
  return { status: res.status, res, buffer: Buffer.from(await res.arrayBuffer()) };
}

const nuevaCot = async (datos = {}) => (await api('oper1', 'POST', '', { tipo: 'SAE', lote: '7', nombre_stand: 'STAND ADJ', razon_social: 'ADJUNTOS SA', ...datos })).cuerpo;

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol, soloEstado] of [['admin1', 'admin', 0], ['oper1', 'operador', 0], ['estado1', 'operador', 1]]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol, solo_estado, nombre_completo) VALUES (?, ?, ?, ?, ?)').run(nombre, hash, rol, soloEstado, nombre);
  }
  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  for (const u of ['admin1', 'oper1', 'estado1']) await iniciarSesion(u);
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('permisos: sin sesión 401; "solo estado" puede ver el archivo pero no subir, editar ni quitar', async () => {
  const c = await nuevaCot();
  assert.equal((await subir(null, c.id, await png(50, 50), 'a.png')).status, 401);
  assert.equal((await subir('estado1', c.id, await png(50, 50), 'a.png')).status, 403);

  const subido = (await subir('oper1', c.id, await png(50, 50), 'a.png')).cuerpo.adjuntos[0];
  assert.equal((await api('estado1', 'PUT', `/adjuntos/${subido.id}`, { titulo: 'x' })).status, 403);
  assert.equal((await api('estado1', 'DELETE', `/adjuntos/${subido.id}`)).status, 403);
  assert.equal((await api('estado1', 'GET', `/adjuntos/${subido.id}/archivo`)).status, 200);
  assert.equal((await api(null, 'GET', `/adjuntos/${subido.id}/archivo`)).status, 401);
  assert.equal((await api('estado1', 'GET', `/${c.id}`)).cuerpo.adjuntos.length, 1, 'y lo ve en el detalle');
});

test('subir una imagen: queda guardada con nombre aleatorio, se puede ver y el tipo de contenido es el real', async () => {
  const c = await nuevaCot();
  const antes = archivosEnDisco();
  const bytes = await png(400, 300);
  const r = await subir('oper1', c.id, bytes, 'croquis stand.png', '  Croquis del stand  ');
  assert.equal(r.status, 201);
  const adj = r.cuerpo.adjuntos[0];
  assert.deepEqual([adj.tipo, adj.paginas, adj.titulo, adj.nombre_original, adj.incluir_en_pdf], ['imagen', 1, 'Croquis del stand', 'croquis stand.png', true]);
  assert.ok(adj.tamano > 0);
  const nuevos = archivosEnDisco().filter((f) => !antes.includes(f));
  assert.equal(nuevos.length, 1);
  assert.match(nuevos[0], /^[a-f0-9-]{36}\.png$/, 'nombre aleatorio, sin el que puso el usuario');

  const archivo = await fetch(`${base}/api/cotizaciones/adjuntos/${adj.id}/archivo`, { headers: { cookie: cookies.oper1 } });
  assert.equal(archivo.status, 200);
  assert.equal(archivo.headers.get('content-type'), 'image/png');
  assert.equal(archivo.headers.get('x-content-type-options'), 'nosniff');
  const devuelto = Buffer.from(await archivo.arrayBuffer());
  const imagen = await Jimp.read(devuelto);
  assert.deepEqual([imagen.width, imagen.height], [400, 300]);
});

test('el tipo se decide por el contenido: un PDF con extensión .png se reconoce como PDF y una imagen no se acepta como PDF', async () => {
  const c = await nuevaCot();
  const pdf = await pdfDePrueba('DISFRAZADO', 1);
  const r = await subir('oper1', c.id, pdf, 'foto.png');
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.adjuntos[0].tipo, 'pdf');
  const archivo = await fetch(`${base}/api/cotizaciones/adjuntos/${r.cuerpo.adjuntos[0].id}/archivo`, { headers: { cookie: cookies.oper1 } });
  assert.equal(archivo.headers.get('content-type'), 'application/pdf');
});

test('fotos grandes se reducen a 2.400 px, las de celular giradas por EXIF se enderezan y un PNG se conserva como PNG', async () => {
  const c = await nuevaCot();
  const antes = archivosEnDisco();
  const grande = (await subir('oper1', c.id, await jpg(3200, 2000), 'plano.jpg')).cuerpo.adjuntos[0];
  const archivoNuevo = archivosEnDisco().find((f) => !antes.includes(f));
  const guardada = await Jimp.read(fs.readFileSync(path.join(process.env.COTIZACIONES_ADJ_DIR, archivoNuevo)));
  assert.deepEqual([guardada.width, guardada.height], [2400, 1500], 'el lado mayor queda en 2.400 y se mantiene la proporción');
  assert.ok(grande.tamano < 3200 * 2000, 'y pesa mucho menos');

  const celular = conOrientacionExif6(await jpg(300, 200));
  const r = await subir('oper1', c.id, celular, 'celular.jpg');
  assert.equal(r.status, 201);
  const enderezada = r.cuerpo.adjuntos.find((a) => a.nombre_original === 'celular.jpg');
  const archivo = await fetch(`${base}/api/cotizaciones/adjuntos/${enderezada.id}/archivo`, { headers: { cookie: cookies.oper1 } });
  const finalImg = await Jimp.read(Buffer.from(await archivo.arrayBuffer()));
  assert.deepEqual([finalImg.width, finalImg.height], [200, 300], 'la foto tomada de costado queda vertical');

  const conPng = (await subir('oper1', c.id, await png(100, 100), 'logo.png')).cuerpo.adjuntos.find((a) => a.nombre_original === 'logo.png');
  const respuesta = await fetch(`${base}/api/cotizaciones/adjuntos/${conPng.id}/archivo`, { headers: { cookie: cookies.oper1 } });
  assert.equal(respuesta.headers.get('content-type'), 'image/png');
});

test('subir un PDF: cuenta sus páginas y se sirve tal cual', async () => {
  const c = await nuevaCot();
  const bytes = await pdfDePrueba('PLANO', 3);
  const r = await subir('oper1', c.id, bytes, 'plano electrico.pdf', 'Plano eléctrico');
  assert.equal(r.status, 201);
  const adj = r.cuerpo.adjuntos[0];
  assert.deepEqual([adj.tipo, adj.paginas, adj.titulo], ['pdf', 3, 'Plano eléctrico']);
  const archivo = await fetch(`${base}/api/cotizaciones/adjuntos/${adj.id}/archivo`, { headers: { cookie: cookies.oper1 } });
  assert.equal(archivo.headers.get('content-type'), 'application/pdf');
  assert.ok(Buffer.from(await archivo.arrayBuffer()).equals(bytes), 'el PDF se guarda sin tocar');
});

test('rechazos: lo que no es imagen ni PDF, archivos dañados o con contraseña, vacíos, enormes; y no queda nada guardado', async () => {
  const c = await nuevaCot();
  const antes = archivosEnDisco();
  const error = async (bytes, nombre) => (await subir('oper1', c.id, bytes, nombre));

  let r = await error(Buffer.from('hola, esto es un texto'), 'plano.pdf');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /Solo se pueden adjuntar imágenes JPG o PNG y archivos PDF/);
  assert.equal((await error(Buffer.from('MZ\x90\x00 programa'), 'foto.jpg')).status, 400, 'un ejecutable con extensión .jpg');
  assert.equal((await error(Buffer.from('GIF89a......'), 'animacion.gif')).status, 400, 'GIF no se acepta');

  r = await error(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('basura que no es un jpeg')]), 'rota.jpg');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /dañada/);

  r = await error(await pdfDePrueba('SECRETO', 1, { userPassword: 'clave', ownerPassword: 'otra' }), 'protegido.pdf');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /contraseña/);

  r = await error(Buffer.from('%PDF-1.4\nesto no es un pdf de verdad'), 'roto.pdf');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /PDF está dañado/);

  r = await error(Buffer.alloc(0), 'vacio.png');
  assert.equal(r.status, 400);

  r = await error(Buffer.alloc(26 * 1024 * 1024), 'enorme.png');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /pesa más de 25 MB/);

  r = await subir('oper1', c.id, null);
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /Elegí un archivo/);

  assert.equal((await subir('oper1', 99999, await png(10, 10), 'a.png')).status, 404);
  assert.deepEqual(archivosEnDisco(), antes, 'ningún rechazo dejó archivos sueltos');
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizacion_adjuntos WHERE cotizacion_id = ?').get(c.id).n, 0);
});

test('un presupuesto admite hasta 10 adjuntos', async () => {
  const c = await nuevaCot();
  const chico = await png(20, 20);
  for (let i = 0; i < 10; i++) assert.equal((await subir('oper1', c.id, chico, `a${i}.png`)).status, 201);
  const r = await subir('oper1', c.id, chico, 'once.png');
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /hasta 10 adjuntos/);
});

test('editar el título, sacar un adjunto del PDF y quitarlo (borra el archivo del disco)', async () => {
  const c = await nuevaCot();
  const otra = await nuevaCot();
  const a = (await subir('oper1', c.id, await png(30, 30), 'a.png', 'Uno')).cuerpo.adjuntos[0];
  const deOtra = (await subir('oper1', otra.id, await png(31, 31), 'b.png')).cuerpo.adjuntos[0];
  const enDisco = archivosEnDisco().length;

  let r = (await api('oper1', 'PUT', `/adjuntos/${a.id}`, { titulo: '  Nuevo título ', incluir_en_pdf: false })).cuerpo;
  assert.deepEqual([r.adjuntos[0].titulo, r.adjuntos[0].incluir_en_pdf], ['Nuevo título', false]);
  r = (await api('oper1', 'PUT', `/adjuntos/${a.id}`, { titulo: '' })).cuerpo;
  assert.equal(r.adjuntos[0].titulo, null, 'un título vacío lo deja sin título');
  assert.equal(r.adjuntos[0].incluir_en_pdf, false, 'y no toca lo demás');
  assert.equal((await api('oper1', 'PUT', `/adjuntos/${a.id}`, { titulo: 'x'.repeat(121) })).status, 400);
  assert.equal((await api('oper1', 'PUT', '/adjuntos/99999', { titulo: 'x' })).status, 404);

  r = (await api('oper1', 'DELETE', `/adjuntos/${a.id}`)).cuerpo;
  assert.deepEqual(r.adjuntos, []);
  assert.equal(archivosEnDisco().length, enDisco - 1, 'se borró el archivo');
  assert.equal((await api('oper1', 'GET', `/adjuntos/${a.id}/archivo`)).status, 404);
  assert.equal((await api('oper1', 'GET', `/adjuntos/${deOtra.id}/archivo`)).status, 200, 'el de otro presupuesto sigue');
  assert.equal((await api('oper1', 'DELETE', `/adjuntos/${a.id}`)).status, 404);
});

test('el PDF del presupuesto lleva los anexos al final, en orden, con "Anexo n" y la numeración de todo el documento', async () => {
  const c = await nuevaCot();
  await api('oper1', 'POST', `/${c.id}/lineas`, { catalogo_item_id: db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'CE-100'").get().id, cantidad: 2 });
  await subir('oper1', c.id, await png(400, 300), 'croquis.png', 'Croquis del stand');
  await subir('oper1', c.id, await pdfDePrueba('PLANO', 2), 'plano.pdf', 'Plano eléctrico');
  const oculto = (await subir('oper1', c.id, await png(80, 80), 'interno.png', 'Nota interna')).cuerpo.adjuntos[2];
  await api('oper1', 'PUT', `/adjuntos/${oculto.id}`, { incluir_en_pdf: false });

  const { status, res, buffer } = await pdfDe('oper1', c.id);
  assert.equal(status, 200);
  assert.equal(buffer.subarray(0, 4).toString(), '%PDF');
  assert.match(res.headers.get('content-disposition'), /^attachment/);
  assert.equal(Number(res.headers.get('content-length')), buffer.length);

  const paginas = await paginasDelPdf(buffer);
  assert.equal(paginas.length, 4, '1 del presupuesto + 1 imagen + 2 del PDF; el que no se incluye no cuenta');
  assert.ok(paginas[0].texto.includes('Se adjuntan al final de este documento: 1) Croquis del stand; 2) Plano eléctrico.'));
  assert.equal(paginas[0].texto.includes('Nota interna'), false, 'el que se sacó del PDF no aparece');
  assert.ok(paginas[0].texto.includes('Página 1 de 4'), 'la numeración cuenta también los anexos');
  assert.deepEqual([paginas[0].ancho, paginas[0].alto], [595, 842], 'el presupuesto es A4 vertical');

  assert.ok(paginas[1].texto.includes('ANEXO 1') && paginas[1].texto.includes('Croquis del stand'));
  assert.ok(paginas[1].texto.includes('Página 2 de 4'));
  assert.ok(paginas[1].ancho > paginas[1].alto, 'una imagen apaisada va en una página apaisada');
  assert.ok(paginas[2].texto.includes('PLANO-PAGINA-1'));
  assert.ok(paginas[3].texto.includes('PLANO-PAGINA-2'));
  assert.ok(paginas[2].ancho > 595, 'las páginas del PDF adjunto conservan su tamaño (A3)');

  const enLinea = await pdfDe('oper1', c.id, '?ver=1');
  assert.match(enLinea.res.headers.get('content-disposition'), /^inline/);
  assert.equal((await paginasDelPdf(enLinea.buffer)).length, 4);
});

test('una imagen vertical va en página vertical y sin adjuntos el PDF queda como antes', async () => {
  const c = await nuevaCot();
  assert.equal((await paginasDelPdf((await pdfDe('oper1', c.id)).buffer)).length, 1, 'sin adjuntos: una sola página');
  await subir('oper1', c.id, await png(300, 500), 'vertical.png');
  const paginas = await paginasDelPdf((await pdfDe('oper1', c.id)).buffer);
  assert.equal(paginas.length, 2);
  assert.ok(paginas[1].alto > paginas[1].ancho);
  assert.ok(paginas[1].texto.includes('ANEXO 1') && paginas[1].texto.includes('vertical'), 'sin título usa el nombre del archivo sin extensión');
  assert.equal(paginas[1].texto.includes('.png'), false);
});

test('duplicar copia los adjuntos con sus propios archivos; eliminar el presupuesto borra los suyos', async () => {
  const c = await nuevaCot();
  await subir('oper1', c.id, await png(60, 60), 'uno.png', 'Uno');
  await subir('oper1', c.id, await pdfDePrueba('P', 1), 'dos.pdf', 'Dos');
  const enDisco = archivosEnDisco().length;

  const copia = (await api('oper1', 'POST', `/${c.id}/duplicar`)).cuerpo;
  assert.deepEqual(copia.adjuntos.map((a) => [a.titulo, a.tipo]), [['Uno', 'imagen'], ['Dos', 'pdf']]);
  assert.equal(archivosEnDisco().length, enDisco + 2, 'los archivos se copian');

  assert.equal((await api('oper1', 'DELETE', `/${copia.id}`)).status, 200);
  assert.equal(archivosEnDisco().length, enDisco, 'al eliminar la copia se borran sus archivos y no los del original');
  assert.equal((await api('oper1', 'GET', `/${c.id}`)).cuerpo.adjuntos.length, 2);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizacion_adjuntos WHERE cotizacion_id = ?').get(copia.id).n, 0);
});

test('un presupuesto ya confirmado admite agregar y quitar adjuntos (no cambian lo que ya es del evento)', async () => {
  const c = await nuevaCot();
  db.prepare("UPDATE cotizaciones SET estado = 'confirmada' WHERE id = ?").run(c.id);
  const r = await subir('oper1', c.id, await png(40, 40), 'plano.png', 'Plano');
  assert.equal(r.status, 201);
  assert.equal((await api('oper1', 'DELETE', `/adjuntos/${r.cuerpo.adjuntos[0].id}`)).status, 200);
});
