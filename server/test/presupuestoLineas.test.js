// Agregar un producto a un presupuesto confirmado: el precio es opcional. Sin precio queda "sin precio" (no en 0)
// y, si el producto ya estaba en el presupuesto, se suma la cantidad y se conserva el precio que tenía.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-lineas-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');

let servidor;
let base;
let cookie;
let presupuestoId;
let mesa;
let silla;

const agregar = (cuerpo) =>
  fetch(`${base}/api/presupuestos/${presupuestoId}/lineas`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(cuerpo) });
const lineas = async () => (await (await fetch(`${base}/api/presupuestos/${presupuestoId}`, { headers: { cookie } })).json()).lineas;

test.before(async () => {
  migrar();
  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', ?, 'admin')").run(bcrypt.hashSync('clave', 4));
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO LINEAS', '2026-11-01', '2026-11-03', ?)").run(admin).lastInsertRowid);
  const loteId = Number(db.prepare("INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, '1', 'ALFA')").run(eventoId).lastInsertRowid);
  presupuestoId = Number(db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-10-01', 1, 'pendiente_facturar', 'manual')").run(loteId).lastInsertRowid);
  const producto = (codigo, nombre) => Number(db.prepare('INSERT INTO productos (codigo, nombre, rubro) VALUES (?, ?, ?)').run(codigo, nombre, 'MOBILIARIO').lastInsertRowid);
  mesa = producto('MS', 'Mesa');
  silla = producto('SL', 'Silla');

  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: 'admin1', password: 'clave' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('un producto agregado sin precio queda sin precio, no en 0 (con null, vacío o sin el campo)', async () => {
  assert.equal((await agregar({ producto_id: mesa, cantidad: 2, precio_unitario: null })).status, 201);
  assert.equal((await agregar({ producto_id: silla, cantidad: 1, precio_unitario: '' })).status, 201);
  const hechas = await lineas();
  assert.equal(hechas.find((l) => l.producto_id === mesa).precio_unitario, null);
  assert.equal(hechas.find((l) => l.producto_id === silla).precio_unitario, null);
});

test('agregar de nuevo un producto ya cargado suma la cantidad y no le pisa el precio si no se manda uno', async () => {
  assert.equal((await agregar({ producto_id: mesa, cantidad: 1, precio_unitario: 5000 })).status, 201);
  assert.equal((await lineas()).find((l) => l.producto_id === mesa).precio_unitario, 5000, 'se le puso precio');

  for (const sinPrecio of [{ precio_unitario: null }, { precio_unitario: '' }, {}]) {
    assert.equal((await agregar({ producto_id: mesa, cantidad: 1, ...sinPrecio })).status, 201);
  }
  const mesaFinal = (await lineas()).find((l) => l.producto_id === mesa);
  assert.equal(mesaFinal.cantidad, 2 + 1 + 3, 'se fue sumando');
  assert.equal(mesaFinal.precio_unitario, 5000, 'y el precio sigue siendo el que tenía');

  assert.equal((await agregar({ producto_id: mesa, cantidad: 1, precio_unitario: 0 })).status, 201);
  assert.equal((await lineas()).find((l) => l.producto_id === mesa).precio_unitario, 0, 'un 0 escrito a propósito sí se respeta');
});
