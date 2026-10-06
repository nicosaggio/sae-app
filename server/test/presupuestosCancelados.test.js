// Un presupuesto cancelado queda como registro pero no cuenta: no sale en el PDF del evento (ni su detalle,
// ni los totales), ni suma en las cantidades ni en la facturación por evento y del año. Al reabrirlo vuelve a contar.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-cancelados-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const eventosService = require('../src/services/eventosService');

let servidor;
let base;
let cookie;
let eventoId;
const ids = {};

async function textoDelPdf() {
  const res = await fetch(`${base}/api/eventos/${eventoId}/export/pdf`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), useSystemFonts: true }).promise;
  const paginas = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const contenido = await (await documento.getPage(i)).getTextContent();
    paginas.push(contenido.items.map((t) => t.str).join(' '));
  }
  return paginas.join(' ');
}

const cambiarEstado = (presupuestoId, estado) =>
  fetch(`${base}/api/presupuestos/${presupuestoId}/estado`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ estado }) });
const guardarCroquis = (loteId) =>
  fetch(`${base}/api/lotes/${loteId}/croquis`, { method: 'PUT', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ paredes: [{ x1: 0, y1: 0, x2: 3, y2: 0 }], materiales: [] }) });

test.before(async () => {
  migrar();
  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', ?, 'admin')").run(bcrypt.hashSync('clave', 4));
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO CANCELACIONES', '2026-11-01', '2026-11-03', ?)").run(admin).lastInsertRowid);

  const producto = (codigo, nombre, rubro) => Number(db.prepare('INSERT INTO productos (codigo, nombre, rubro) VALUES (?, ?, ?)').run(codigo, nombre, rubro).lastInsertRowid);
  const activo = producto('PA', 'Producto Activo', 'SISTEMA');
  const cancelable = producto('PC', 'Producto Cancelable', 'MOBILIARIO');
  const lote = (codigo, expositor) => Number(db.prepare('INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, ?, ?)').run(eventoId, codigo, expositor).lastInsertRowid);
  const presupuesto = (loteId, estado, lineas) => {
    const id = Number(db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-10-01', 1, ?, 'manual')").run(loteId, estado).lastInsertRowid);
    for (const [productoId, cantidad, precio] of lineas) db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)').run(id, productoId, cantidad, precio);
    return id;
  };

  ids.alfa = lote('1', 'ALFA'); // un presupuesto activo y otro que se va a cancelar
  presupuesto(ids.alfa, 'cobrado', [[activo, 2, 1000]]);
  ids.aCancelar = presupuesto(ids.alfa, 'pendiente_facturar', [[cancelable, 5, 1000]]);
  ids.beta = lote('2', 'BETA'); // su único presupuesto se va a cancelar; tiene croquis
  ids.betaPresupuesto = presupuesto(ids.beta, 'pendiente_facturar', [[cancelable, 7, 1000]]);
  ids.gamma = lote('3', 'GAMMA'); // sin presupuestos, con croquis: todavía en preparación
  ids.delta = lote('4', 'DELTA'); // activo, con croquis
  presupuesto(ids.delta, 'pendiente_pago', [[activo, 1, 1000]]);

  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: 'admin1', password: 'clave' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
  for (const lote of [ids.beta, ids.gamma, ids.delta]) assert.equal((await guardarCroquis(lote)).status, 200);
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('antes de cancelar, todo suma (punto de comparación)', async () => {
  const pdf = await textoDelPdf();
  assert.match(pdf, /Producto Cancelable/);
  assert.match(pdf, /Expositor: BETA/);
  assert.equal(eventosService.totalesPorEvento(eventoId).flatMap((g) => g.productos).find((p) => p.nombre === 'Producto Cancelable').cantidad, 12);
  assert.equal(eventosService.facturacionAnual(2026).total, 2000 + 5000 + 7000 + 1000);
});

test('un presupuesto cancelado no sale en el PDF del evento, ni en las cantidades, ni en la facturación', async () => {
  assert.equal((await cambiarEstado(ids.aCancelar, 'cancelado')).status, 200);
  assert.equal((await cambiarEstado(ids.betaPresupuesto, 'cancelado')).status, 200);

  const pdf = await textoDelPdf();
  assert.match(pdf, /Producto Activo/, 'lo que sigue activo sí sale');
  assert.doesNotMatch(pdf, /Producto Cancelable/, 'ni en el detalle del lote ni en los totales del evento');

  const productos = eventosService.totalesPorEvento(eventoId).flatMap((g) => g.productos);
  assert.deepEqual(productos.map((p) => [p.nombre, p.cantidad]), [['Producto Activo', 3]]);

  const facturacion = eventosService.facturacionPorEvento(eventoId);
  assert.equal(facturacion.reduce((acc, g) => acc + g.subtotal, 0), 3000);

  const anual = eventosService.facturacionAnual(2026);
  assert.equal(anual.total, 3000);
  assert.equal(anual.presupuestos, 2);
  assert.ok(!anual.porEstado.some((e) => e.estado === 'cancelado'));
  assert.ok(!anual.porRubro.some((g) => g.rubro === 'MOBILIARIO'));
});

test('un stand con todos sus presupuestos cancelados no imprime su croquis; los que siguen en pie o sin presupuesto cargado sí', async () => {
  const pdf = await textoDelPdf();
  assert.doesNotMatch(pdf, /Expositor: BETA/, 'BETA se cayó: ni su detalle ni su croquis');
  assert.match(pdf, /Expositor: GAMMA/, 'sin presupuestos todavía: se imprime igual');
  assert.match(pdf, /Expositor: DELTA/);
  assert.equal((pdf.match(/CROQUIS/g) || []).length, 2, 'sólo GAMMA y DELTA');
});

test('un presupuesto cancelado sigue visible en las listas y en el evento, y al reabrirlo vuelve a contar', async () => {
  const lista = await (await fetch(`${base}/api/presupuestos?eventoId=${eventoId}`, { headers: { cookie } })).json();
  assert.ok(lista.some((p) => p.id === ids.aCancelar && p.estado === 'cancelado'), 'el cancelado sigue en la lista');
  const detalle = eventosService.obtenerDetalle(eventoId);
  assert.ok(detalle.lotes.find((l) => l.id === ids.alfa).presupuestos.some((p) => p.id === ids.aCancelar), 'y en el detalle del evento');

  assert.equal((await cambiarEstado(ids.betaPresupuesto, 'pendiente_facturar')).status, 200);
  const pdf = await textoDelPdf();
  assert.match(pdf, /Expositor: BETA/, 'reabierto, BETA vuelve al PDF');
  assert.equal(eventosService.facturacionAnual(2026).total, 3000 + 7000);
});
