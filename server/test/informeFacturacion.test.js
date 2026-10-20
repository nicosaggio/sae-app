// El informe de facturación: filtrado por mes, y el informe de un evento con sus totales por rubro y sus pedidos
// por lote, en pantalla (datos) y en PDF.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-informe-'));
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
let admin;
const ids = {};
const prod = {};

const api = (ruta) => fetch(`${base}/api${ruta}`, { headers: cookie ? { Cookie: cookie } : {} });

const evento = (nombre, inicio, lugar = null) =>
  Number(db.prepare('INSERT INTO eventos (nombre, lugar, fecha_inicio, fecha_fin, creado_por) VALUES (?, ?, ?, ?, ?)').run(nombre, lugar, inicio, inicio, admin).lastInsertRowid);
const lote = (eventoId, codigo, expositor = null) => Number(db.prepare('INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, ?, ?)').run(eventoId, codigo, expositor).lastInsertRowid);
const presupuesto = (loteId, estado, lineas = []) => {
  const id = Number(db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-01-01', 1, ?, 'manual')").run(loteId, estado).lastInsertRowid);
  for (const [producto, cantidad, precio] of lineas) db.prepare('INSERT INTO presupuesto_lineas (presupuesto_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)').run(id, producto, cantidad, precio);
  return id;
};

async function textoDelPdf(ruta) {
  const res = await api(ruta);
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
  return { paginas, texto: paginas.join(' '), cabecera: res.headers.get('content-disposition') };
}

test.before(async () => {
  migrar();
  admin = Number(db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', ?, 'admin')").run(bcrypt.hashSync('clave-larga-1', 4)).lastInsertRowid);

  prod.sistema = productosService.crear({ codigo: 'PB-1', nombre: 'Panel', rubro: 'SISTEMA' }).id;
  prod.mobiliario = productosService.crear({ codigo: 'MB-1', nombre: 'Mesa', rubro: 'MOBILIARIO' }).id;

  // EXPO A (marzo): tres lotes con presupuestos, uno que solo tiene presupuestos cancelados y uno vacío
  ids.a = evento('EXPO A', '2026-03-10', 'Costa Salguero');
  ids.a10 = lote(ids.a, '10', 'Café Uno');
  presupuesto(ids.a10, 'cobrado', [[prod.sistema, 2, 1000], [prod.mobiliario, 1, 500]]); // 2.500
  ids.a2 = lote(ids.a, '2', 'Zeta SA');
  presupuesto(ids.a2, 'cobrado', [[prod.sistema, 1, 1000]]); // 1.000
  presupuesto(ids.a2, 'pendiente_pago', [[prod.mobiliario, 3, null]]); // sin precio
  presupuesto(ids.a2, 'cancelado', [[prod.sistema, 10, 1000]]); // no cuenta
  ids.aA6 = lote(ids.a, 'A6', 'Sin ítems SRL');
  presupuesto(ids.aA6, 'pendiente_facturar'); // presupuesto sin ítems todavía
  ids.aX9 = lote(ids.a, 'X9', 'Todo cancelado');
  presupuesto(ids.aX9, 'cancelado', [[prod.sistema, 5, 1000]]);

  ids.b = evento('EXPO B', '2026-04-05');
  presupuesto(lote(ids.b, '1'), 'cobrado', [[prod.sistema, 4, 250]]); // 1.000
  ids.c = evento('EXPO C', '2026-03-25');
  presupuesto(lote(ids.c, '1'), 'cobrado', [[prod.mobiliario, 2, 500]]); // 1.000
  ids.vacio = evento('EXPO VACÍA', '2026-03-30');
  ids.seguro = evento('Feria "Q" / Ñandú', '2026-06-01');
  presupuesto(lote(ids.seguro, '1', 'Uno'), 'cobrado', [[prod.sistema, 1, 100]]);

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

// ---------------------------------------------------------------------------------------------
// Filtro por mes
// ---------------------------------------------------------------------------------------------

test('con mes sólo cuenta los eventos que empiezan en ese mes, y los 12 meses suman el año', () => {
  const anio = eventosService.facturacionAnual(2026);
  assert.equal(anio.mes, null);
  assert.equal(anio.total, 3500 + 1000 + 1000 + 100);

  const marzo = eventosService.facturacionAnual(2026, { mes: 3 });
  assert.equal(marzo.mes, 3);
  assert.equal(marzo.total, 4500);
  assert.equal(marzo.eventos, 2);
  assert.deepEqual(marzo.porEvento.map((e) => e.nombre).sort(), ['EXPO A', 'EXPO C']);
  assert.deepEqual(marzo.porMes.filter((m) => m.eventos > 0).map((m) => m.mes), [3], 'sólo el mes pedido tiene datos');
  assert.deepEqual(marzo.porRubro.map((g) => [g.rubro, g.total]), [['SISTEMA', 3000], ['MOBILIARIO', 1500]]);

  let suma = 0;
  for (let mes = 1; mes <= 12; mes++) suma += eventosService.facturacionAnual(2026, { mes }).total;
  assert.equal(suma, anio.total);
  assert.equal(eventosService.facturacionAnual(2026, { mes: 12 }).presupuestos, 0, 'un mes sin eventos da cero');
});

test('la ruta acepta ?mes= (con o sin cero), y lo valida', async () => {
  const marzo = await (await api('/eventos/facturacion-anual?anio=2026&mes=03')).json();
  assert.equal(marzo.total, 4500);
  assert.equal((await (await api('/eventos/facturacion-anual?anio=2026&mes=3')).json()).total, 4500);
  assert.equal((await (await api('/eventos/facturacion-anual?anio=2026&mes=')).json()).mes, null, 'mes vacío es todo el año');
  for (const mal of ['0', '13', 'abc', '3.5', '-1']) {
    assert.equal((await api(`/eventos/facturacion-anual?anio=2026&mes=${mal}`)).status, 400, `mes=${mal}`);
    assert.equal((await api(`/eventos/facturacion-anual/pdf?anio=2026&mes=${mal}`)).status, 400, `pdf mes=${mal}`);
  }
});

test('el PDF de un mes trae sólo ese mes, sin la tabla por mes, y lo dice en el título y el archivo', async () => {
  const { texto, cabecera } = await textoDelPdf('/eventos/facturacion-anual/pdf?anio=2026&mes=3');
  assert.match(texto, /MARZO 2026/);
  assert.match(texto, /FACTURACIÓN DE MARZO 2026/);
  assert.match(texto, /\$ 4\.500/);
  assert.match(texto, /2 eventos/);
  assert.match(texto, /EXPO A/);
  assert.match(texto, /EXPO C/);
  assert.doesNotMatch(texto, /EXPO B/, 'es de abril');
  assert.doesNotMatch(texto, /POR MES/, 'con un solo mes esa tabla no aporta nada');
  assert.match(texto, /% DEL MES/);
  assert.match(texto, /Total Marzo 2026/);
  assert.match(decodeURIComponent(cabecera), /Facturación Marzo 2026\.pdf/);
});

test('el PDF de un mes sin eventos lo dice', async () => {
  const { texto } = await textoDelPdf('/eventos/facturacion-anual/pdf?anio=2026&mes=12');
  assert.match(texto, /No hay presupuestos cargados en eventos de Diciembre de 2026/);
});

// ---------------------------------------------------------------------------------------------
// Informe de un evento (datos)
// ---------------------------------------------------------------------------------------------

test('el informe de un evento trae el total, los rubros con sus productos y los pedidos por lote', () => {
  const r = eventosService.informeFacturacionEvento(ids.a);
  assert.equal(r.evento.nombre, 'EXPO A');
  assert.equal(r.total, 3500);
  assert.equal(r.lineasSinPrecio, 1);
  assert.equal(r.lotes, 3, 'el lote que sólo tiene un presupuesto cancelado no cuenta');
  assert.equal(r.presupuestos, 4, 'los cancelados no cuentan');

  assert.deepEqual(r.porRubro.map((g) => [g.rubro, g.cantidad, g.total, g.lineasSinPrecio]), [['MOBILIARIO', 4, 500, 1], ['SISTEMA', 3, 3000, 0]]);
  const sistema = r.porRubro.find((g) => g.rubro === 'SISTEMA');
  assert.deepEqual(sistema.productos.map((p) => [p.codigo, p.cantidad, p.subtotal]), [['PB-1', 3, 3000]]);

  // Los códigos se ordenan por número donde lo hay: 2, 10, A6
  assert.deepEqual(r.porLote.map((l) => l.codigo), ['2', '10', 'A6']);
  const [dos, diez, a6] = r.porLote;
  assert.equal(dos.expositor, 'Zeta SA');
  assert.equal(dos.presupuestos, 2);
  assert.equal(dos.total, 1000);
  assert.equal(dos.lineasSinPrecio, 1);
  assert.deepEqual(dos.productos.map((p) => [p.codigo, p.cantidad, p.subtotal, p.lineasSinPrecio]), [['MB-1', 3, 0, 1], ['PB-1', 1, 1000, 0]]);
  assert.equal(diez.total, 2500);
  assert.deepEqual(diez.productos.map((p) => p.codigo), ['MB-1', 'PB-1'], 'por rubro y nombre');
  assert.deepEqual([a6.presupuestos, a6.total, a6.productos.length, a6.lineasSinPrecio], [1, 0, 0, 0], 'un lote sin ítems igual se lista');
});

test('el total del informe coincide con la facturación del evento, la del año y la suma de sus lotes', () => {
  for (const id of [ids.a, ids.b, ids.c, ids.seguro]) {
    const r = eventosService.informeFacturacionEvento(id);
    const deLaPantalla = eventosService.facturacionPorEvento(id).reduce((acc, g) => acc + g.subtotal, 0);
    assert.equal(r.total, deLaPantalla, r.evento.nombre);
    assert.equal(r.porLote.reduce((acc, l) => acc + l.total, 0), r.total, `suma de lotes de ${r.evento.nombre}`);
    assert.equal(r.porLote.flatMap((l) => l.productos).reduce((acc, p) => acc + p.subtotal, 0), r.total, `suma de productos de ${r.evento.nombre}`);
    assert.equal(eventosService.facturacionAnual(2026).porEvento.find((e) => e.id === id).total, r.total, `el año de ${r.evento.nombre}`);
  }
});

test('un evento sin presupuestos da un informe vacío y uno que no existe da null', () => {
  const r = eventosService.informeFacturacionEvento(ids.vacio);
  assert.deepEqual([r.total, r.lotes, r.presupuestos, r.porRubro.length, r.porLote.length], [0, 0, 0, 0, 0]);
  assert.equal(eventosService.informeFacturacionEvento(999999), null);
});

test('las rutas del informe de un evento exigen sesión, validan y no se confunden con /:id/facturacion', async () => {
  for (const ruta of [`/eventos/${ids.a}/facturacion/informe`, `/eventos/${ids.a}/facturacion/pdf`]) {
    assert.equal((await fetch(`${base}/api${ruta}`)).status, 401, `sin sesión ${ruta}`);
  }
  const res = await api(`/eventos/${ids.a}/facturacion/informe`);
  assert.equal(res.status, 200);
  const datos = await res.json();
  assert.equal(datos.total, 3500);
  assert.equal(datos.porLote.length, 3);
  assert.equal((await api('/eventos/999999/facturacion/informe')).status, 404);
  assert.equal((await api('/eventos/999999/facturacion/pdf')).status, 404);
  assert.equal((await api(`/eventos/${ids.a}/facturacion/pdf?vista=otra`)).status, 400);
  assert.ok(Array.isArray(await (await api(`/eventos/${ids.a}/facturacion`)).json()), 'la facturación por producto sigue igual');
});

// ---------------------------------------------------------------------------------------------
// Informe de un evento (PDF)
// ---------------------------------------------------------------------------------------------

test('el PDF por rubro trae el total, los totales por rubro y el detalle de cada rubro, sin los lotes', async () => {
  const { texto, cabecera } = await textoDelPdf(`/eventos/${ids.a}/facturacion/pdf`);
  assert.match(texto, /EXPO A/);
  assert.match(texto, /FACTURACIÓN DEL EVENTO/);
  assert.match(texto, /\$ 3\.500/);
  assert.match(texto, /3 lotes/);
  assert.match(texto, /4 presupuestos/);
  assert.match(texto, /Costa Salguero/);
  assert.match(texto, /Del 10\/03\/2026 al 10\/03\/2026/);
  assert.match(texto, /TOTALES POR RUBRO/);
  assert.match(texto, /Total del evento/);
  assert.match(texto, /DETALLE: SISTEMA/);
  assert.match(texto, /DETALLE: MOBILIARIO/);
  assert.match(texto, /Total SISTEMA .*\$ 3\.000/);
  assert.match(texto, /Falta precio en 1 línea\(s\)/, 'avisa que el total es parcial');
  assert.doesNotMatch(texto, /PEDIDOS POR LOTE|RESUMEN POR LOTE/);
  assert.doesNotMatch(texto, /Cobrado|Pendiente de (pago|facturar)/i, 'no se imprime el estado de cobro');
  assert.match(decodeURIComponent(cabecera), /Facturación EXPO A\.pdf/);
});

test('el PDF por lote suma los pedidos de cada lote, en orden, y deja afuera lo cancelado', async () => {
  const { texto, cabecera } = await textoDelPdf(`/eventos/${ids.a}/facturacion/pdf?vista=lote`);
  assert.match(texto, /TOTALES POR RUBRO/, 'los totales por rubro también van en esta vista');
  assert.match(texto, /RESUMEN POR LOTE/);
  assert.match(texto, /PEDIDOS POR LOTE/);
  assert.doesNotMatch(texto, /DETALLE: /);
  const pos = (re) => texto.search(re);
  assert.ok(pos(/Lote 2 — Zeta SA/) > 0 && pos(/Lote 2 — Zeta SA/) < pos(/Lote 10 — Café Uno/) && pos(/Lote 10 — Café Uno/) < pos(/Lote A6 — Sin ítems SRL/), 'lotes en orden 2, 10, A6');
  assert.match(texto, /2 presupuestos/, 'el lote con dos presupuestos lo indica');
  assert.match(texto, /Todavía no tiene ítems cargados/);
  assert.match(texto, /Panel/);
  assert.match(texto, /Mesa/);
  assert.doesNotMatch(texto, /X9|Todo cancelado/, 'un lote con sólo presupuestos cancelados no se lista');
  assert.match(decodeURIComponent(cabecera), /Facturación EXPO A por lote\.pdf/);
});

test('el nombre del archivo no lleva comillas ni barras aunque las tenga el evento', async () => {
  const { cabecera } = await textoDelPdf(`/eventos/${ids.seguro}/facturacion/pdf`);
  assert.match(cabecera, /^inline; filename="[^"]*"; filename\*=UTF-8''[^ ]*$/, 'la comilla del evento no corta el header');
  assert.equal(decodeURIComponent(cabecera.split("filename*=UTF-8''")[1]), 'Facturación Feria Q Ñandú.pdf');
});

test('el PDF de un evento sin presupuestos lo dice', async () => {
  const { texto } = await textoDelPdf(`/eventos/${ids.vacio}/facturacion/pdf?vista=lote`);
  assert.match(texto, /Este evento todavía no tiene presupuestos cargados/);
  assert.doesNotMatch(texto, /TOTALES POR RUBRO/);
});

// Va al final: agrega un evento grande.
test('un evento con muchos lotes sigue en más hojas, repite el título y la cabecera del lote que se corta, y numera las páginas', async () => {
  const grande = evento('EXPO GRANDE', '2026-09-01');
  const producto = (n) => productosService.crear({ codigo: `GR-${String(n).padStart(2, '0')}`, nombre: `Producto grande ${String(n).padStart(2, '0')}`, rubro: 'GRANDE' }).id;
  const productos = Array.from({ length: 40 }, (_, i) => producto(i + 1));
  for (let i = 1; i <= 80; i++) presupuesto(lote(grande, String(i), `Expositor ${String(i).padStart(2, '0')}`), 'cobrado', [[prod.sistema, 1, 100]]);
  presupuesto(lote(grande, 'LARGO', 'Lote con 40 ítems'), 'cobrado', productos.map((id) => [id, 1, 10])); // un lote que no entra en una hoja

  const informe = eventosService.informeFacturacionEvento(grande);
  assert.equal(informe.lotes, 81);
  assert.equal(informe.total, 80 * 100 + 40 * 10);

  const { paginas, texto } = await textoDelPdf(`/eventos/${grande}/facturacion/pdf?vista=lote`);
  assert.ok(paginas.length >= 4, `con 81 lotes son varias hojas (${paginas.length})`);
  for (const n of ['01', '40', '80']) assert.match(texto, new RegExp(`Lote ${Number(n)} — Expositor ${n}`), `sale el lote ${n}`);
  assert.match(texto, /Producto grande 01/);
  assert.match(texto, /Producto grande 40/, 'salen los 40 ítems del lote largo');
  assert.match(texto, /RESUMEN POR LOTE \(continuación\)/, 'al cortarse la tabla se repite su título');
  assert.match(texto, /PEDIDOS POR LOTE \(continuación\)/);
  assert.match(texto, /Lote LARGO — Lote con 40 ítems \(cont\.\)/, 'el lote que se corta repite su cabecera en la hoja siguiente');
  assert.match(texto, /\$ 8\.400/, 'el total del evento');
  assert.match(paginas.at(-1), new RegExp(`Página ${paginas.length} de ${paginas.length}`));
});
