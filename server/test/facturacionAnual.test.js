// Facturación de todo un año (sin IVA): total, por mes, por estado de cobro, por rubro y por evento.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-anual-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const eventosService = require('../src/services/eventosService');
const productosService = require('../src/services/productosService');

let servidor;
let base;
let cookie;
const ids = {};

const api = (ruta, opciones = {}) => fetch(`${base}/api${ruta}`, { ...opciones, headers: { ...(opciones.headers || {}), ...(cookie ? { Cookie: cookie } : {}) } });

test.before(async () => {
  migrar();
  const admin = Number(db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', ?, 'admin')").run(bcrypt.hashSync('clave-larga-1', 4)).lastInsertRowid);

  const sistema = productosService.crear({ codigo: 'PB-1', nombre: 'Panel', rubro: 'SISTEMA' }).id;
  const mobiliario = productosService.crear({ codigo: 'MB-1', nombre: 'Mesa', rubro: 'MOBILIARIO' }).id;

  const evento = (nombre, inicio) =>
    Number(db.prepare('INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, ?, ?, ?)').run(nombre, inicio, inicio, admin).lastInsertRowid);
  let n = 0;
  const presupuesto = (eventoId, estado, lineas) => {
    const lote = Number(db.prepare('INSERT INTO lotes (evento_id, codigo) VALUES (?, ?)').run(eventoId, `L${++n}`).lastInsertRowid);
    const id = Number(
      db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-01-01', 1, ?, 'manual')").run(lote, estado).lastInsertRowid
    );
    for (const [producto, cantidad, precio] of lineas) {
      db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)').run(id, producto, cantidad, precio);
    }
    return id;
  };

  ids.a = evento('EXPO A', '2026-03-10');
  ids.b = evento('EXPO B', '2026-03-20');
  ids.c = evento('EXPO C', '2026-07-01');
  ids.d = evento('EXPO D (2025)', '2025-12-30');
  ids.e = evento('EXPO E (sin presupuestos)', '2026-05-01');
  presupuesto(ids.a, 'cobrado', [[sistema, 2, 1000], [mobiliario, 1, 500]]); // 2.500
  presupuesto(ids.a, 'pendiente_pago', [[sistema, 1, 1000], [mobiliario, 3, null]]); // 1.000 y una línea sin precio
  presupuesto(ids.b, 'pendiente_facturar', [[mobiliario, 4, 250]]); // 1.000
  presupuesto(ids.c, 'cobrado', [[sistema, 1, 1000]]); // 1.000
  presupuesto(ids.d, 'cobrado', [[sistema, 10, 1000]]); // 10.000, pero de 2025

  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nombre_usuario: 'admin1', password: 'clave-larga-1' }) });
  cookie = login.headers.get('set-cookie').split(';')[0];
});

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('suma sólo los eventos del año pedido, sin IVA, y cuenta aparte las líneas sin precio', () => {
  const r = eventosService.facturacionAnual(2026);
  assert.equal(r.anio, 2026);
  assert.equal(r.total, 5500);
  assert.equal(r.lineasSinPrecio, 1);
  assert.equal(r.presupuestos, 4);
  assert.equal(r.eventos, 3, 'el evento sin presupuestos y el de 2025 no cuentan');
  assert.equal(eventosService.facturacionAnual(2025).total, 10000);
  assert.equal(eventosService.facturacionAnual(2024).total, 0);
});

test('desglose por mes (siempre 12), por estado de cobro, por rubro y por evento', () => {
  const r = eventosService.facturacionAnual(2026);

  assert.equal(r.porMes.length, 12);
  assert.deepEqual(r.porMes[2], { mes: 3, total: 4500, eventos: 2 });
  assert.deepEqual(r.porMes[6], { mes: 7, total: 1000, eventos: 1 });
  assert.equal(r.porMes[0].total, 0);
  assert.equal(r.porMes.reduce((acc, m) => acc + m.total, 0), r.total);

  assert.deepEqual(r.porEstado.map((e) => [e.estado, e.total, e.presupuestos]), [['cobrado', 3500, 2], ['pendiente_facturar', 1000, 1], ['pendiente_pago', 1000, 1]]);

  assert.deepEqual(r.porRubro.map((g) => [g.rubro, g.total]), [['SISTEMA', 4000], ['MOBILIARIO', 1500]]);

  assert.deepEqual(r.porEvento.map((e) => e.id), [ids.c, ids.b, ids.a], 'del más reciente al más antiguo');
  assert.equal(r.porEvento.find((e) => e.id === ids.a).presupuestos, 2);
  assert.equal(r.porEvento.find((e) => e.id === ids.a).lineasSinPrecio, 1);
});

test('el total de cada evento coincide con el de su pantalla de facturación', () => {
  const r = eventosService.facturacionAnual(2026);
  for (const evento of r.porEvento) {
    const totalDelEvento = eventosService.facturacionPorEvento(evento.id).reduce((acc, g) => acc + g.subtotal, 0);
    assert.equal(evento.total, totalDelEvento, evento.nombre);
  }
  assert.equal(r.porEvento.reduce((acc, e) => acc + e.total, 0), r.total);
});

test('los años disponibles son los que tienen presupuestos, del más nuevo al más viejo', () => {
  assert.deepEqual(eventosService.aniosConPresupuestos(), [2026, 2025]);
});

test('la ruta exige sesión, valida el año y no se confunde con /:id', async () => {
  const sinSesion = await fetch(`${base}/api/eventos/facturacion-anual?anio=2026`);
  assert.equal(sinSesion.status, 401);

  const mala = await api('/eventos/facturacion-anual?anio=abc');
  assert.equal(mala.status, 400);

  const r = await api('/eventos/facturacion-anual?anio=2026');
  assert.equal(r.status, 200);
  const datos = await r.json();
  assert.equal(datos.total, 5500);
  assert.deepEqual(datos.anios, [2026, 2025]);

  const sinAnio = await (await api('/eventos/facturacion-anual')).json();
  assert.ok(datos.anios.includes(sinAnio.anio), 'sin año pide uno que tenga presupuestos');
});
