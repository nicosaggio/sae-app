// Croquis dibujado dentro de un presupuesto de la app: guardado, opción de que salga o no en el PDF, que
// pase al lote al confirmar, y que se copie al duplicar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-cotcroq-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const { sembrarCatalogoDePrueba } = require('./helpers/catalogoDePrueba');

let servidor;
let base;
const cookies = {};
let eventoId;
let itemPanelId;
let stand = 0;

async function iniciarSesion(usuario) {
  const res = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: usuario, password: 'clave' }) });
  cookies[usuario] = res.headers.get('set-cookie').split(';')[0];
}

async function llamar(usuario, metodo, ruta, cuerpo) {
  const res = await fetch(`${base}/api${ruta}`, {
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
  return { status: res.status, cuerpo: json };
}

const idDe = (codigo) => db.prepare('SELECT id FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(codigo).id;

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

async function pdfDe(id) {
  const res = await fetch(`${base}/api/cotizaciones/${id}/pdf`, { headers: { cookie: cookies.oper1 } });
  assert.equal(res.status, 200);
  return textoPorPagina(Buffer.from(await res.arrayBuffer()));
}

/** Presupuesto listo para confirmar (con un ítem con precio). `lote` distinto = stand distinto. */
async function nuevoPresupuesto({ lote = String(++stand), nombre = `STAND ${stand}` } = {}) {
  const { cuerpo } = await llamar('oper1', 'POST', '/cotizaciones', { evento_id: eventoId, tipo: 'SAE', lote, nombre_stand: nombre, razon_social: 'ACME SA' });
  await llamar('oper1', 'POST', `/cotizaciones/${cuerpo.id}/lineas`, { catalogo_item_id: idDe('CE-150'), cantidad: 2 });
  return cuerpo.id;
}

const dibujo = () => ({
  paredes: [{ x1: 0, y1: 0, x2: 3, y2: 0 }],
  materiales: [{ catalogo_item_id: itemPanelId, x: 0.5, y: 0.2, rotacion: 90 }, { bloque: 'COLUMNA', x: 1.05, y: 1.05, rotacion: 0 }],
  cotas: [{ x1: 0, y1: 0, x2: 3, y2: 0, offset: -0.45 }],
  comentarios: 'Pared del fondo con gráfica del cliente.',
});

const croquisDe = (usuario, id, metodo = 'GET', cuerpo) => llamar(usuario, metodo, `/cotizaciones/${id}/croquis`, cuerpo);

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol, soloEstado] of [['admin1', 'admin', 0], ['oper1', 'operador', 0], ['estado1', 'operador', 1]]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol, solo_estado, nombre_completo) VALUES (?, ?, ?, ?, ?)').run(nombre, hash, rol, soloEstado, nombre);
  }
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  eventoId = Number(db.prepare("INSERT INTO eventos (nombre, lugar, fecha_inicio, fecha_fin, creado_por) VALUES ('CAPPER', 'Predio', '2026-10-10', '2026-10-12', ?)").run(admin).lastInsertRowid);
  // Un ítem de catálogo con símbolo real en la biblioteca (ver server/src/data/croquisSimbolos.json).
  itemPanelId = Number(db.prepare("INSERT INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES ('PB-250', 'SISTEMA', 'Panel syma blanco', 'manual', 1)").run().lastInsertRowid);

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

test('un presupuesto nuevo no tiene croquis; se dibuja, se lee y se borra', async () => {
  const id = await nuevoPresupuesto();
  assert.equal((await croquisDe('oper1', id)).cuerpo, null);
  assert.equal((await llamar('oper1', 'GET', `/cotizaciones/${id}`)).cuerpo.croquis, null, 'la ficha dice que no hay croquis');

  const guardado = await croquisDe('oper1', id, 'PUT', dibujo());
  assert.equal(guardado.status, 200);
  assert.equal(guardado.cuerpo.cotizacion_id, id);
  assert.equal(guardado.cuerpo.incluir_en_pdf, true, 'por defecto sale en el PDF');
  assert.equal(guardado.cuerpo.materiales.length, 2);
  assert.equal(guardado.cuerpo.materiales[0].codigo, 'PB-250');
  assert.equal(guardado.cuerpo.materiales[1].codigo, 'COLUMNA', 'el bloque auxiliar también');
  assert.equal(guardado.cuerpo.comentarios, 'Pared del fondo con gráfica del cliente.');

  const ficha = (await llamar('oper1', 'GET', `/cotizaciones/${id}`)).cuerpo;
  assert.deepEqual(ficha.croquis, { paredes: 1, materiales: 2, cotas: 1, con_comentarios: true, incluir_en_pdf: true }, 'la ficha trae un resumen, no todo el dibujo');

  assert.equal((await croquisDe('oper1', id, 'DELETE')).status, 200);
  assert.equal((await croquisDe('oper1', id)).cuerpo, null);
});

test('permisos y validaciones del croquis del presupuesto', async () => {
  const id = await nuevoPresupuesto();
  assert.equal((await llamar(null, 'GET', `/cotizaciones/${id}/croquis`)).status, 401);
  assert.equal((await croquisDe('estado1', id)).status, 200, '"solo estado" puede verlo');
  assert.equal((await croquisDe('estado1', id, 'PUT', dibujo())).status, 403, 'pero no dibujarlo');
  assert.equal((await croquisDe('estado1', id, 'DELETE')).status, 403);
  assert.equal((await croquisDe('oper1', 999999)).status, 404);
  assert.equal((await croquisDe('oper1', 999999, 'PUT', dibujo())).status, 404);
  assert.equal((await croquisDe('oper1', id, 'PUT', { ...dibujo(), materiales: [{ bloque: 'NO-EXISTE', x: 0, y: 0 }] })).status, 400);
  assert.equal((await croquisDe('oper1', id, 'PUT', { ...dibujo(), paredes: 'no' })).status, 400);
  assert.equal((await croquisDe('oper1', id, 'PUT', { ...dibujo(), comentarios: 'x'.repeat(1001) })).status, 400);
});

test('la opción de incluir el croquis en el PDF: sólo con croquis dibujado, y se puede cambiar siempre', async () => {
  const id = await nuevoPresupuesto();
  const opcion = (incluir) => llamar('oper1', 'PUT', `/cotizaciones/${id}/croquis/pdf`, { incluir_en_pdf: incluir });
  assert.equal((await opcion(false)).status, 404, 'todavía no hay croquis');

  await croquisDe('oper1', id, 'PUT', dibujo());
  const apagado = await opcion(false);
  assert.equal(apagado.status, 200);
  assert.equal(apagado.cuerpo.croquis.incluir_en_pdf, false);
  assert.equal((await croquisDe('oper1', id)).cuerpo.incluir_en_pdf, false);
  assert.equal((await opcion('si')).status, 400, 'tiene que ser verdadero o falso');
  assert.equal((await llamar('estado1', 'PUT', `/cotizaciones/${id}/croquis/pdf`, { incluir_en_pdf: true })).status, 403);

  // Guardar el dibujo de nuevo no cambia la opción elegida.
  await croquisDe('oper1', id, 'PUT', dibujo());
  assert.equal((await croquisDe('oper1', id)).cuerpo.incluir_en_pdf, false);
  assert.equal((await opcion(true)).cuerpo.croquis.incluir_en_pdf, true);

  // Aun confirmado se puede cambiar (el dibujo no, pero la opción del PDF sí).
  assert.equal((await llamar('oper1', 'POST', `/cotizaciones/${id}/confirmar`)).status, 200);
  assert.equal((await opcion(false)).status, 200);
});

test('el PDF del presupuesto trae el croquis (con sus cotas y comentarios) sólo si hay uno y está marcado para incluirlo', async () => {
  const id = await nuevoPresupuesto();
  assert.ok(!(await pdfDe(id)).join(' ').includes('CROQUIS DEL STAND'), 'sin croquis dibujado no hay sección');

  await croquisDe('oper1', id, 'PUT', dibujo());
  const con = (await pdfDe(id)).join(' ');
  assert.match(con, /CROQUIS DEL STAND/);
  assert.match(con, /COMENTARIOS/);
  assert.match(con, /Pared del fondo con gráfica del\s+cliente\./);
  assert.match(con, /3,00 m/, 'la cota');
  assert.match(con, /CONDICIONES[\s\S]*CROQUIS DEL STAND/, 'va después de las condiciones');

  await llamar('oper1', 'PUT', `/cotizaciones/${id}/croquis/pdf`, { incluir_en_pdf: false });
  const sin = (await pdfDe(id)).join(' ');
  assert.ok(!sin.includes('CROQUIS DEL STAND') && !sin.includes('COMENTARIOS'), 'apagado: no sale nada del croquis');
  assert.match(sin, /DETALLE DEL PEDIDO/, 'el resto del presupuesto sale igual');
});

test('un croquis sin comentarios sale sin el cuadro de comentarios', async () => {
  const id = await nuevoPresupuesto();
  await croquisDe('oper1', id, 'PUT', { ...dibujo(), comentarios: '' });
  const texto = (await pdfDe(id)).join(' ');
  assert.match(texto, /CROQUIS DEL STAND/);
  assert.ok(!texto.includes('COMENTARIOS'));
});

test('el croquis se dibuja sólo mientras el presupuesto está pendiente', async () => {
  const id = await nuevoPresupuesto();
  await croquisDe('oper1', id, 'PUT', dibujo());
  await llamar('oper1', 'POST', `/cotizaciones/${id}/rechazar`);
  assert.equal((await croquisDe('oper1', id, 'PUT', dibujo())).status, 409, 'rechazado: de sólo lectura');
  assert.equal((await croquisDe('oper1', id, 'DELETE')).status, 409);
  assert.equal((await croquisDe('oper1', id)).status, 200, 'pero se puede ver');
  await llamar('oper1', 'POST', `/cotizaciones/${id}/reabrir`);
  assert.equal((await croquisDe('oper1', id, 'PUT', dibujo())).status, 200, 'reabierto: vuelve a poder editarse');
});

test('al confirmar, el croquis pasa al lote y sale en el PDF de totales del evento; si el lote ya tenía uno no se pisa', async () => {
  const id = await nuevoPresupuesto({ lote: '40', nombre: 'STAND CUARENTA' });
  await croquisDe('oper1', id, 'PUT', dibujo());
  const confirmado = (await llamar('oper1', 'POST', `/cotizaciones/${id}/confirmar`)).cuerpo;
  assert.equal(confirmado.croquis_en_lote, 'copiado');

  const lote = db.prepare("SELECT id FROM lotes WHERE evento_id = ? AND codigo = '40'").get(eventoId);
  const enLote = db.prepare('SELECT * FROM lote_croquis WHERE lote_id = ?').get(lote.id);
  assert.ok(enLote, 'el lote quedó con el croquis');
  assert.equal(JSON.parse(enLote.materiales).length, 2);
  assert.equal(JSON.parse(enLote.cotas).length, 1);
  assert.equal(enLote.comentarios, 'Pared del fondo con gráfica del cliente.');
  assert.ok(db.prepare('SELECT 1 FROM cotizacion_croquis WHERE cotizacion_id = ?').get(id), 'y el del presupuesto también se conserva');

  const totales = await fetch(`${base}/api/eventos/${eventoId}/export/pdf`, { headers: { cookie: cookies.oper1 } });
  assert.match((await textoPorPagina(Buffer.from(await totales.arrayBuffer()))).join(' '), /Expositor: STAND CUARENTA[\s\S]*CROQUIS/);

  // Otro presupuesto del mismo stand, con otro dibujo: el del lote no se pisa.
  const otro = await nuevoPresupuesto({ lote: '40', nombre: 'STAND CUARENTA' });
  await croquisDe('oper1', otro, 'PUT', { paredes: [{ x1: 0, y1: 0, x2: 9, y2: 0 }], materiales: [], comentarios: 'OTRO' });
  assert.equal((await llamar('oper1', 'POST', `/cotizaciones/${otro}/confirmar`)).cuerpo.croquis_en_lote, 'lote_ya_tenia');
  assert.equal(db.prepare('SELECT comentarios FROM lote_croquis WHERE lote_id = ?').get(lote.id).comentarios, 'Pared del fondo con gráfica del cliente.');

  // Sin croquis dibujado no se crea nada en el lote.
  const sinCroquis = await nuevoPresupuesto({ lote: '41', nombre: 'STAND SIN DIBUJO' });
  assert.equal((await llamar('oper1', 'POST', `/cotizaciones/${sinCroquis}/confirmar`)).cuerpo.croquis_en_lote, 'sin_croquis');
  const lote41 = db.prepare("SELECT id FROM lotes WHERE evento_id = ? AND codigo = '41'").get(eventoId);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lote_croquis WHERE lote_id = ?').get(lote41.id).n, 0);
});

test('duplicar un presupuesto copia su croquis (y si sale o no en el PDF)', async () => {
  const id = await nuevoPresupuesto();
  await croquisDe('oper1', id, 'PUT', dibujo());
  await llamar('oper1', 'PUT', `/cotizaciones/${id}/croquis/pdf`, { incluir_en_pdf: false });

  const copia = (await llamar('oper1', 'POST', `/cotizaciones/${id}/duplicar`)).cuerpo;
  assert.notEqual(copia.id, id);
  const croquis = (await croquisDe('oper1', copia.id)).cuerpo;
  assert.equal(croquis.materiales.length, 2);
  assert.equal(croquis.incluir_en_pdf, false);

  // Son independientes: dibujar en la copia no toca el original.
  await croquisDe('oper1', copia.id, 'PUT', { ...dibujo(), materiales: [] });
  assert.equal((await croquisDe('oper1', id)).cuerpo.materiales.length, 2);
});

test('borrar el presupuesto borra su croquis', async () => {
  const id = await nuevoPresupuesto();
  await croquisDe('oper1', id, 'PUT', dibujo());
  assert.ok(db.prepare('SELECT 1 FROM cotizacion_croquis WHERE cotizacion_id = ?').get(id));
  assert.equal((await llamar('oper1', 'DELETE', `/cotizaciones/${id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM cotizacion_croquis WHERE cotizacion_id = ?').get(id).n, 0);
});

test('si el croquis no entra debajo de las condiciones, pasa a una hoja nueva con su encabezado, sin partirse', async () => {
  // Según cuántos ítems tenga el presupuesto, el final de las condiciones cae en distintos lugares de la
  // hoja; hay cantidades para las que no queda lugar para el croquis. Se prueba con varias hasta dar con una.
  for (let n = 1; n <= 40; n++) {
    db.prepare("INSERT OR IGNORE INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES (?, 'SISTEMA', ?, 'manual', 1)").run(`Z-${n}`, `ÍTEM DE RELLENO ${n}`);
  }
  let conSalto = null;
  for (let n = 4; n <= 40 && !conSalto; n++) {
    const id = await nuevoPresupuesto();
    for (let i = 1; i <= n; i++) await llamar('oper1', 'POST', `/cotizaciones/${id}/lineas`, { catalogo_item_id: idDe(`Z-${i}`), cantidad: 1 });
    await croquisDe('oper1', id, 'PUT', dibujo());
    const paginas = await pdfDe(id);
    const hoja = paginas.findIndex((p) => p.includes('CROQUIS DEL STAND'));
    assert.ok(hoja >= 0, `con ${n} ítems el croquis tiene que salir`);
    if (hoja > 0 && !paginas[hoja].includes('CONDICIONES')) conSalto = { n, hoja, paginas };
  }
  assert.ok(conSalto, 'alguna cantidad de ítems tiene que forzar el salto de hoja');
  const pagina = conSalto.paginas[conSalto.hoja];
  assert.match(pagina, /PRESUPUESTO/, 'la hoja nueva repite el encabezado');
  assert.match(pagina, /COMENTARIOS/, 'y trae el croquis completo, con su cuadro de comentarios');
  assert.match(pagina, /3,00 m/);
  assert.ok(conSalto.paginas.slice(0, conSalto.hoja).some((p) => p.includes('CONDICIONES')), 'las condiciones quedaron en la hoja anterior');
});

test('un croquis hecho sólo de columnas (sin ítems de catálogo) también sale en el PDF', async () => {
  const id = await nuevoPresupuesto();
  await croquisDe('oper1', id, 'PUT', { paredes: [], materiales: [{ bloque: 'COLUMNA', x: 0, y: 0 }, { bloque: 'COLUMNA', x: 1, y: 0 }], comentarios: '' });
  assert.match((await pdfDe(id)).join(' '), /CROQUIS DEL STAND/);
});
