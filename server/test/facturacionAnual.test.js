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

async function pdfDelInforme(anio) {
  const res = await api(`/eventos/facturacion-anual/pdf?anio=${anio}`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/pdf');
  assert.match(res.headers.get('content-disposition'), /^inline;/, 'se abre en el navegador para imprimirlo');
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), useSystemFonts: true }).promise;
  const paginas = [];
  for (let i = 1; i <= documento.numPages; i++) {
    const contenido = await (await documento.getPage(i)).getTextContent();
    paginas.push(contenido.items.map((t) => t.str).join(' ').replace(/\s+/g, ' '));
  }
  return paginas;
}

test('el informe en PDF trae el total, por mes, por rubro y por evento, y no el desglose por estado de cobro', async () => {
  const paginas = await pdfDelInforme(2026);
  const texto = paginas.join(' ');
  assert.match(texto, /FACTURACIÓN 2026/);
  assert.match(texto, /\$ 5\.500/, 'el total del año');
  assert.match(texto, /3 eventos/);
  assert.match(texto, /4 presupuestos/);
  assert.match(texto, /1 línea\(s\) sin precio/, 'avisa que el total es parcial');
  for (const mes of ['Marzo', 'Julio']) assert.match(texto, new RegExp(mes));
  assert.match(texto, /Total 2026/);
  assert.match(texto, /SISTEMA/);
  assert.match(texto, /MOBILIARIO/);
  for (const evento of ['EXPO A', 'EXPO B', 'EXPO C']) assert.match(texto, new RegExp(evento));
  assert.doesNotMatch(texto, /EXPO D|EXPO E/, 'sólo los eventos del año con presupuestos');
  // Los estados de los presupuestos viejos no están al día: ese desglose no se imprime.
  assert.doesNotMatch(texto, /estado de cobro|Cobrado|Pendiente de (pago|facturar)|Facturado/i);
  const paginaDeEventos = paginas.find((p) => /POR EVENTO/.test(p));
  for (const evento of ['EXPO A', 'EXPO B', 'EXPO C']) assert.match(paginaDeEventos, new RegExp(evento), 'una tabla corta no se parte entre dos hojas');
  assert.match(paginas.at(-1), new RegExp(`Página ${paginas.length} de ${paginas.length}`));
});

test('el informe de un año sin presupuestos lo dice', async () => {
  assert.match((await pdfDelInforme(2024)).join(' '), /No hay presupuestos cargados en eventos de 2024/);
});

test('la ruta exige sesión, valida el año y no se confunde con /:id', async () => {
  const sinSesion = await fetch(`${base}/api/eventos/facturacion-anual?anio=2026`);
  assert.equal(sinSesion.status, 401);

  const mala = await api('/eventos/facturacion-anual?anio=abc');
  assert.equal(mala.status, 400);
  assert.equal((await api('/eventos/facturacion-anual/pdf?anio=abc')).status, 400);
  assert.equal((await fetch(`${base}/api/eventos/facturacion-anual/pdf?anio=2026`)).status, 401);

  const r = await api('/eventos/facturacion-anual?anio=2026');
  assert.equal(r.status, 200);
  const datos = await r.json();
  assert.equal(datos.total, 5500);
  assert.deepEqual(datos.anios, [2026, 2025]);

  const sinAnio = await (await api('/eventos/facturacion-anual')).json();
  assert.ok(datos.anios.includes(sinAnio.anio), 'sin año pide uno que tenga presupuestos');
});

// Va al final: agrega eventos de 2027 que cambian los años disponibles de los tests de arriba.
test('un año con muchos eventos sigue en más hojas, repite el título de la tabla y numera las páginas', async () => {
  const admin = db.prepare('SELECT id FROM usuarios LIMIT 1').get().id;
  const producto = db.prepare("SELECT id FROM productos WHERE codigo = 'PB-1'").get().id;
  for (let i = 1; i <= 90; i++) {
    const evento = Number(db.prepare('INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, ?, ?, ?)').run(`EXPO MASIVA ${String(i).padStart(2, '0')}`, '2027-04-10', '2027-04-12', admin).lastInsertRowid);
    const lote = Number(db.prepare('INSERT INTO lotes (evento_id, codigo) VALUES (?, ?)').run(evento, `M${i}`).lastInsertRowid);
    const presupuesto = Number(db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2027-01-01', 1, 'cobrado', 'manual')").run(lote).lastInsertRowid);
    db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, 1, 100)').run(presupuesto, producto);
  }
  const paginas = await pdfDelInforme(2027);
  assert.ok(paginas.length >= 3, `con 90 eventos son varias hojas (${paginas.length})`);
  const texto = paginas.join(' ');
  for (const n of [1, 45, 90]) assert.match(texto, new RegExp(`EXPO MASIVA ${String(n).padStart(2, '0')}`), `sale el evento ${n}`);
  assert.match(texto, /POR EVENTO \(continuación\)/, 'al cortarse la tabla se repite su título');
  assert.match(paginas.at(-1), new RegExp(`Página ${paginas.length} de ${paginas.length}`));
  assert.match(paginas.at(-1), /\$ 9\.000/, 'el total (90 × $ 100) cierra la última hoja');
});
