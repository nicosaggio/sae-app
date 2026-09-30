const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-cli-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const clientes = require('../src/services/clientesService');

let servidor;
let base;
const cookies = {};

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
  return { status: res.status, cuerpo: json, res };
}

const presupuesto = (usuario, metodo, ruta, cuerpo) => llamar(usuario, metodo, `/cotizaciones${ruta}`, cuerpo);
const cliente = (usuario, metodo, ruta, cuerpo) => llamar(usuario, metodo, `/clientes${ruta}`, cuerpo);
const nuevoPresupuesto = async (datos) => (await presupuesto('oper1', 'POST', '', datos)).cuerpo;
const cuantosClientes = () => db.prepare('SELECT COUNT(*) n FROM clientes').get().n;

// CUIT reales de prueba, con su dígito verificador correcto
const ATP = '30-52830354-0'; // el del presupuesto de ATP del Excel
const VIDEO = '30-70125272-8';
const PERSONA = '20-12345678-6';

test.before(async () => {
  migrar();
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

test('CUIT: se entiende escrito de cualquier forma y se valida el dígito verificador', () => {
  for (const escrito of [ATP, '30528303540', '30 52830354 0', '30.52830354.0', 'CUIT 30-52830354-0']) {
    const c = clientes.interpretarCuit(escrito);
    assert.deepEqual([c.valido, c.digitos, c.formateado], [true, '30528303540', ATP], escrito);
  }
  for (const valido of [VIDEO, PERSONA]) assert.equal(clientes.interpretarCuit(valido).valido, true, valido);
  assert.equal(clientes.interpretarCuit('30-52830354-1').valido, false, 'dígito verificador equivocado');
  assert.equal(clientes.interpretarCuit('30-5283035').valido, false, 'faltan dígitos');
  assert.equal(clientes.interpretarCuit('305283035400').valido, false, 'sobran dígitos');
  assert.equal(clientes.interpretarCuit('abc').vacio, true, 'sin dígitos = vacío');
  assert.deepEqual(clientes.interpretarCuit(''), { vacio: true, valido: false, digitos: '', formateado: null });
  assert.equal(clientes.interpretarCuit(null).vacio, true);
  assert.equal(clientes.interpretarCuit('30-52830354-1').formateado, null, 'un CUIT inválido no se formatea');
});

test('permisos: hace falta sesión, "solo estado" puede buscar pero no editar ni borrar', async () => {
  assert.equal((await cliente(null, 'GET', '')).status, 401);
  assert.equal((await cliente(null, 'GET', '/buscar?q=a')).status, 401);
  assert.equal((await cliente('estado1', 'GET', '')).status, 200);
  assert.equal((await cliente('estado1', 'GET', '/buscar?q=a')).status, 200);
  assert.equal((await cliente('estado1', 'GET', `/por-cuit/${ATP}`)).status, 200);
  assert.equal((await cliente('estado1', 'PUT', '/1', { razon_social: 'x' })).status, 403);
  assert.equal((await cliente('estado1', 'DELETE', '/1')).status, 403);
});

test('al guardar un presupuesto con CUIT válido se guarda el cliente, y el CUIT queda con guiones', async () => {
  assert.equal(cuantosClientes(), 0);
  const p = await nuevoPresupuesto({ cuit: '30528303540', razon_social: 'ASOCIACION ARGENTINA DE TENIS', direccion: 'Maipu 471', contacto: 'Ana', mail: 'ana@aat.com.ar', telefono: '11 5555-0001' });
  assert.equal(p.cuit, ATP, 'el presupuesto guarda el CUIT normalizado');
  assert.equal(p.cuit_valido, true);
  assert.equal(cuantosClientes(), 1);
  assert.equal(p.cliente.razon_social, 'ASOCIACION ARGENTINA DE TENIS');

  const fila = db.prepare('SELECT * FROM clientes').get();
  assert.equal(fila.cuit, '30528303540', 'en la base el CUIT va sólo con los dígitos');
  assert.deepEqual([fila.direccion, fila.contacto, fila.mail, fila.telefono], ['Maipu 471', 'Ana', 'ana@aat.com.ar', '11 5555-0001']);

  const lista = (await cliente('oper1', 'GET', '')).cuerpo;
  assert.equal(lista.length, 1);
  assert.deepEqual([lista[0].cuit, lista[0].razon_social, lista[0].presupuestos], [ATP, 'ASOCIACION ARGENTINA DE TENIS', 1]);
});

test('el mismo CUIT (escrito distinto) reutiliza al cliente: se actualiza lo que trae y no se borra lo que viene vacío', async () => {
  const antes = cuantosClientes();
  const p = await nuevoPresupuesto({ cuit: 'CUIT 30 52830354 0', razon_social: 'A.A.T.', contacto: 'Luis', mail: '' });
  assert.equal(cuantosClientes(), antes, 'no se duplica');
  assert.equal(p.cuit, ATP);

  const fila = db.prepare('SELECT * FROM clientes WHERE cuit = ?').get('30528303540');
  assert.equal(fila.razon_social, 'A.A.T.', 'lo más reciente gana');
  assert.equal(fila.contacto, 'Luis');
  assert.equal(fila.mail, 'ana@aat.com.ar', 'un dato vacío no borra el que ya había');
  assert.equal(fila.direccion, 'Maipu 471');
  assert.equal((await cliente('oper1', 'GET', '')).cuerpo[0].presupuestos, 2, 'y ya tiene dos presupuestos');

  // Editar los datos de un presupuesto existente también actualiza al cliente
  const editado = (await presupuesto('oper1', 'PUT', `/${p.id}`, { telefono: '11 4444-9999' })).cuerpo;
  assert.equal(editado.cliente.id, fila.id);
  assert.equal(db.prepare('SELECT telefono FROM clientes WHERE id = ?').get(fila.id).telefono, '11 4444-9999');
});

test('un CUIT dudoso no bloquea el presupuesto (todos los datos son opcionales) pero no crea cliente', async () => {
  const antes = cuantosClientes();
  const p = await nuevoPresupuesto({ cuit: '30-52830354-9', razon_social: 'CLIENTE DUDOSO' });
  assert.equal(p.cuit, '30-52830354-9', 'se respeta lo que escribieron');
  assert.equal(p.cuit_valido, false);
  assert.equal(p.cliente, null);
  assert.equal(cuantosClientes(), antes);

  const corregido = (await presupuesto('oper1', 'PUT', `/${p.id}`, { cuit: ATP })).cuerpo;
  assert.equal(corregido.cuit_valido, true);
  assert.ok(corregido.cliente, 'al corregirlo queda vinculado');
  assert.equal(cuantosClientes(), antes, 'al cliente que ya existía');

  const sinCuit = (await presupuesto('oper1', 'PUT', `/${p.id}`, { cuit: '' })).cuerpo;
  assert.equal(sinCuit.cuit, null);
  assert.equal(sinCuit.cuit_valido, null);
  assert.equal(sinCuit.cliente, null, 'sin CUIT deja de estar vinculado');
  assert.equal(cuantosClientes(), antes, 'pero el cliente sigue guardado');

  const vacio = await nuevoPresupuesto({ razon_social: 'SIN CUIT SA' });
  assert.deepEqual([vacio.cuit, vacio.cuit_valido, vacio.cliente], [null, null, null]);
});

test('consultar un CUIT: dice si es válido y, si ya lo tenemos, devuelve al cliente', async () => {
  const conocido = (await cliente('oper1', 'GET', `/por-cuit/${encodeURIComponent('30 52830354 0')}`)).cuerpo;
  assert.deepEqual([conocido.valido, conocido.cuit_formateado, conocido.cliente.cuit], [true, ATP, ATP]);
  assert.equal(conocido.cliente.mail, 'ana@aat.com.ar');

  const nuevo = (await cliente('oper1', 'GET', `/por-cuit/${VIDEO}`)).cuerpo;
  assert.deepEqual([nuevo.valido, nuevo.cuit_formateado, nuevo.cliente], [true, VIDEO, null], 'válido pero todavía no está guardado');

  const invalido = (await cliente('oper1', 'GET', '/por-cuit/30-52830354-9')).cuerpo;
  assert.deepEqual([invalido.valido, invalido.cuit_formateado, invalido.cliente], [false, null, null]);
  assert.equal((await cliente('oper1', 'GET', '/por-cuit/xyz')).cuerpo.vacio, true);
});

test('buscar clientes: por razón social (sin distinguir mayúsculas) o por parte del CUIT', async () => {
  await nuevoPresupuesto({ cuit: VIDEO, razon_social: 'VIDEOSUITCH SRL', contacto: 'Pablo' });
  await nuevoPresupuesto({ cuit: PERSONA, razon_social: 'Fernández, Lucía', contacto: 'Lucía' });

  const porNombre = (await cliente('oper1', 'GET', '/buscar?q=video')).cuerpo;
  assert.deepEqual(porNombre.map((c) => c.cuit), [VIDEO]);
  assert.deepEqual((await cliente('oper1', 'GET', '/buscar?q=fern')).cuerpo.map((c) => c.cuit), [PERSONA]);
  assert.deepEqual((await cliente('oper1', 'GET', '/buscar?q=Pablo')).cuerpo.map((c) => c.cuit), [VIDEO], 'también por contacto');
  assert.deepEqual((await cliente('oper1', 'GET', '/buscar?q=30-7012')).cuerpo.map((c) => c.cuit), [VIDEO], 'por parte del CUIT con guiones');
  assert.deepEqual((await cliente('oper1', 'GET', '/buscar?q=52830')).cuerpo.map((c) => c.cuit), [ATP], 'o sin guiones');
  assert.equal((await cliente('oper1', 'GET', '/buscar?q=nadie-se-llama-asi')).cuerpo.length, 0);
  assert.equal((await cliente('oper1', 'GET', '/buscar?q=%25')).status, 200, 'los comodines no rompen la búsqueda');
  assert.equal((await cliente('oper1', 'GET', '/buscar')).cuerpo.length, 3, 'sin texto trae los primeros');
  assert.equal((await cliente('oper1', 'GET', '/buscar?limite=2')).cuerpo.length, 2);
  assert.deepEqual((await cliente('oper1', 'GET', '/?q=video')).cuerpo.map((c) => c.cuit), [VIDEO]);
});

test('editar un cliente: sus datos y su CUIT (válido y sin repetir con otro cliente)', async () => {
  const id = db.prepare("SELECT id FROM clientes WHERE cuit = '30701252728'").get().id;
  let r = await cliente('oper1', 'PUT', `/${id}`, { razon_social: '  VIDEOSUITCH S.R.L.  ', mail: 'info@videosuitch.com', telefono: '' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.cuerpo.razon_social, r.cuerpo.mail, r.cuerpo.telefono, r.cuerpo.cuit], ['VIDEOSUITCH S.R.L.', 'info@videosuitch.com', null, VIDEO]);
  assert.equal((await cliente('oper1', 'PUT', `/${id}`, { razon_social: 'x'.repeat(201) })).status, 400);

  r = await cliente('oper1', 'PUT', `/${id}`, { cuit: ATP });
  assert.equal(r.status, 409, 'ese CUIT ya es de otro cliente');
  assert.match(r.cuerpo.error, /Ya hay otro cliente con ese CUIT/);
  assert.equal((await cliente('oper1', 'PUT', `/${id}`, { cuit: '30-70125272-1' })).status, 400, 'CUIT inválido');
  assert.equal((await cliente('oper1', 'PUT', `/${id}`, { cuit: VIDEO })).status, 200, 'dejar el mismo CUIT es válido');
  assert.equal((await cliente('oper1', 'PUT', '/99999', { razon_social: 'x' })).status, 404);

  const nuevoCuit = '30-71234567-'; // se prueba con un CUIT libre y válido
  const libre = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => `${nuevoCuit}${d}`).find((c) => clientes.interpretarCuit(c).valido);
  r = await cliente('oper1', 'PUT', `/${id}`, { cuit: libre });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.cuit, libre);
  await cliente('oper1', 'PUT', `/${id}`, { cuit: VIDEO });
});

test('borrar un cliente no toca los presupuestos; al volver a guardarlos se vuelve a crear', async () => {
  const p = await nuevoPresupuesto({ cuit: PERSONA, razon_social: 'Fernández, Lucía' });
  const clienteId = p.cliente.id;
  const antes = cuantosClientes();
  assert.equal((await cliente('oper1', 'DELETE', `/${clienteId}`)).status, 200);
  assert.equal(cuantosClientes(), antes - 1);
  assert.equal((await cliente('oper1', 'DELETE', `/${clienteId}`)).status, 404);

  const intacto = (await presupuesto('oper1', 'GET', `/${p.id}`)).cuerpo;
  assert.deepEqual([intacto.cuit, intacto.razon_social, intacto.cliente], [PERSONA, 'Fernández, Lucía', null], 'el presupuesto conserva sus datos');

  const guardado = (await presupuesto('oper1', 'PUT', `/${p.id}`, { contacto: 'Lucía' })).cuerpo;
  assert.ok(guardado.cliente, 'al guardar de nuevo, el cliente vuelve a estar');
  assert.equal(cuantosClientes(), antes);
});

test('duplicar un presupuesto conserva al mismo cliente', async () => {
  const origen = await nuevoPresupuesto({ cuit: ATP, razon_social: 'ASOCIACION ARGENTINA DE TENIS' });
  const antes = cuantosClientes();
  const copia = (await presupuesto('oper1', 'POST', `/${origen.id}/duplicar`)).cuerpo;
  assert.equal(copia.cliente.id, origen.cliente.id);
  assert.equal(copia.cuit, ATP);
  assert.equal(cuantosClientes(), antes);
});

test('el presupuesto en PDF muestra el CUIT con guiones', async () => {
  const p = await nuevoPresupuesto({ cuit: '30528303540', razon_social: 'ATP PDF' });
  const res = await fetch(`${base}/api/cotizaciones/${p.id}/pdf`, { headers: { cookie: cookies.oper1 } });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const documento = await pdfjs.getDocument({ data: new Uint8Array(await res.arrayBuffer()), useSystemFonts: true }).promise;
  const contenido = await (await documento.getPage(1)).getTextContent();
  assert.ok(contenido.items.map((t) => t.str).join(' ').includes(ATP));
});

test('al arrancar se guardan como clientes los presupuestos que ya estaban cargados (y no se repite)', () => {
  // Presupuestos "de antes" de que existiera la tabla de clientes: con CUIT escrito sólo con dígitos y sin vínculo
  const viejo = (cuit, razon) => Number(db.prepare("INSERT INTO cotizaciones (fecha_carga, cuit, razon_social) VALUES ('2026-09-20', ?, ?)").run(cuit, razon).lastInsertRowid);
  const sinVincular = viejo('30701252728', 'VIDEOSUITCH SRL (viejo)');
  const otro = viejo('20222222220', 'CUIT QUE NO ES VÁLIDO'); // dígito verificador inexistente
  const sinCuit = Number(db.prepare("INSERT INTO cotizaciones (fecha_carga, razon_social) VALUES ('2026-09-20', 'SIN CUIT')").run().lastInsertRowid);
  db.prepare('UPDATE cotizaciones SET cliente_id = NULL WHERE id = ?').run(sinVincular);

  const antes = cuantosClientes();
  const r = clientes.completarDesdePresupuestos();
  assert.equal(db.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?').get(sinVincular).cliente_id, db.prepare("SELECT id FROM clientes WHERE cuit = '30701252728'").get().id);
  assert.equal(db.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?').get(otro).cliente_id, null, 'el CUIT dudoso no genera cliente');
  assert.equal(db.prepare('SELECT cliente_id FROM cotizaciones WHERE id = ?').get(sinCuit).cliente_id, null);
  assert.equal(cuantosClientes(), antes, 'el cliente ya existía: sólo se vincula');
  assert.ok(r.guardados >= 1);

  const otraVez = clientes.completarDesdePresupuestos();
  assert.equal(otraVez.guardados, 0, 'correrlo de nuevo no hace nada');
});
