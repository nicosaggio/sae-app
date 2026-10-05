const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-croquis-'));
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
let loteId;
let itemCeId; // CE-100, del catálogo de prueba (sin símbolo real en la biblioteca)

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

const croquis = (usuario, metodo, cuerpo) => llamar(usuario, metodo, `/lotes/${loteId}/croquis`, cuerpo);

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol, soloEstado] of [['admin1', 'admin', 0], ['oper1', 'operador', 0], ['estado1', 'operador', 1]]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol, solo_estado, nombre_completo) VALUES (?, ?, ?, ?, ?)').run(nombre, hash, rol, soloEstado, nombre);
  }
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO TEST', '2026-10-10', '2026-10-12', ?)").run(admin).lastInsertRowid);
  loteId = Number(db.prepare("INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, '12', 'STAND TEST')").run(eventoId).lastInsertRowid);
  itemCeId = db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'CE-100'").get().id;

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

test('sin croquis dibujado todavía, devuelve null', async () => {
  const r = await croquis('oper1', 'GET');
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo, null);
});

test('permisos: sin sesión 401; "solo estado" lee pero no escribe', async () => {
  assert.equal((await llamar(null, 'GET', `/lotes/${loteId}/croquis`)).status, 401);
  assert.equal((await croquis('estado1', 'GET')).status, 200);
  assert.equal((await croquis('estado1', 'PUT', { paredes: [], materiales: [] })).status, 403);
  assert.equal((await croquis('estado1', 'DELETE')).status, 403);
});

test('guardar: crea el croquis con paredes y materiales, y lo arma con código/descripción/medidas', async () => {
  const r = await croquis('oper1', 'PUT', {
    paredes: [{ x1: 0, y1: 0, x2: 3, y2: 0 }, { x1: 3, y1: 0, x2: 3, y2: 2 }],
    materiales: [{ catalogo_item_id: itemCeId, x: 0.5, y: 0.2, rotacion: 90 }],
  });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.lote_id, loteId);
  assert.equal(r.cuerpo.paredes.length, 2);
  assert.deepEqual(r.cuerpo.paredes[0], { x1: 0, y1: 0, x2: 3, y2: 0 });
  assert.equal(r.cuerpo.materiales.length, 1);
  assert.deepEqual(
    [r.cuerpo.materiales[0].catalogo_item_id, r.cuerpo.materiales[0].codigo, r.cuerpo.materiales[0].x, r.cuerpo.materiales[0].rotacion],
    [itemCeId, 'CE-100', 0.5, 90]
  );

  const leido = await croquis('oper1', 'GET');
  assert.equal(leido.cuerpo.materiales.length, 1);
});

test('guardar de nuevo: pisa el croquis anterior (no se duplica la fila)', async () => {
  await croquis('oper1', 'PUT', { paredes: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], materiales: [] });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lote_croquis WHERE lote_id = ?').get(loteId).n, 1);
  const r = await croquis('oper1', 'GET');
  assert.equal(r.cuerpo.paredes.length, 1);
  assert.equal(r.cuerpo.materiales.length, 0, 'el guardado nuevo reemplaza los materiales, no los suma');
});

test('validaciones: pared o material mal formado, o ítem de catálogo inexistente, da 400', async () => {
  assert.equal((await croquis('oper1', 'PUT', { paredes: [{ x1: 0, y1: 0, x2: 'a', y2: 0 }], materiales: [] })).status, 400);
  assert.equal((await croquis('oper1', 'PUT', { paredes: [], materiales: [{ catalogo_item_id: 999999, x: 0, y: 0 }] })).status, 400);
  assert.equal((await croquis('oper1', 'PUT', { paredes: [], materiales: [{ catalogo_item_id: itemCeId, x: 'a', y: 0 }] })).status, 400);
  assert.equal((await croquis('oper1', 'PUT', { paredes: 'no es una lista', materiales: [] })).status, 400);
});

test('cotas y comentarios: se guardan, se devuelven, y si no se mandan se conservan los que ya había', async () => {
  const cotas = [{ x1: 0, y1: 0, x2: 3, y2: 0, offset: -0.45 }, { x1: 3, y1: 0, x2: 3, y2: 2, offset: 0.5 }];
  const r = await croquis('oper1', 'PUT', { paredes: [], materiales: [], cotas, comentarios: '  Pared del fondo con gráfica.\r\nVa mostrador.  ' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.cotas, cotas);
  assert.equal(r.cuerpo.comentarios, 'Pared del fondo con gráfica.\nVa mostrador.', 'se recortan los espacios y se unifican los saltos de línea');

  // Guardar de nuevo sin mandar cotas ni comentarios (cliente viejo) no los borra...
  const sinCampos = await croquis('oper1', 'PUT', { paredes: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], materiales: [] });
  assert.equal(sinCampos.cuerpo.cotas.length, 2);
  assert.equal(sinCampos.cuerpo.comentarios, 'Pared del fondo con gráfica.\nVa mostrador.');

  // ...pero mandarlos vacíos sí los borra.
  const vacios = await croquis('oper1', 'PUT', { paredes: [], materiales: [], cotas: [], comentarios: '' });
  assert.deepEqual(vacios.cuerpo.cotas, []);
  assert.equal(vacios.cuerpo.comentarios, '');
});

test('cotas y comentarios: validaciones', async () => {
  const mal = (cuerpo) => croquis('oper1', 'PUT', { paredes: [], materiales: [], ...cuerpo });
  assert.equal((await mal({ cotas: 'no es una lista' })).status, 400);
  assert.equal((await mal({ cotas: [{ x1: 0, y1: 0, x2: 'a', y2: 0, offset: 0.4 }] })).status, 400);
  assert.equal((await mal({ cotas: [{ x1: 0, y1: 0, x2: 1, y2: 0 }] })).status, 400, 'falta el offset');
  assert.equal((await mal({ cotas: Array.from({ length: 301 }, () => ({ x1: 0, y1: 0, x2: 1, y2: 0, offset: 0.4 })) })).status, 400, 'tope de cotas');
  assert.equal((await mal({ comentarios: 123 })).status, 400);
  assert.equal((await mal({ comentarios: 'x'.repeat(1001) })).status, 400, 'tope de caracteres');
  assert.equal((await mal({ comentarios: 'x'.repeat(1000) })).status, 200);
});

test('bloque auxiliar COLUMNA: figura en la biblioteca sin ser un ítem de catálogo, y se guarda y se arma como cualquier material', async () => {
  const lib = await llamar('oper1', 'GET', '/catalogo/croquis-simbolos');
  const columna = lib.cuerpo.COLUMNA;
  assert.ok(columna, 'la columna se ofrece para dibujar');
  assert.equal(columna.catalogo_item_id, null);
  assert.equal(columna.rubro, 'SISTEMA');
  assert.equal(columna.descripcion, 'COLUMNA');
  assert.deepEqual([columna.ancho, columna.profundidad], [0.1, 0.1]);
  assert.equal(columna.paths[0].t, 'circle', 'el mismo círculo que la columna de los paneles');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM catalogo_items WHERE codigo = 'COLUMNA'").get().n, 0, 'no es un ítem de catálogo: no se vende ni tiene precio');

  const r = await croquis('oper1', 'PUT', {
    paredes: [],
    materiales: [{ bloque: 'COLUMNA', x: 1.05, y: 1.05, rotacion: 0 }, { catalogo_item_id: itemCeId, x: 0, y: 0 }],
  });
  assert.equal(r.status, 200);
  const [col, ce] = r.cuerpo.materiales;
  assert.deepEqual([col.bloque, col.codigo, col.catalogo_item_id, col.descripcion, col.ancho, col.x], ['COLUMNA', 'COLUMNA', null, 'COLUMNA', 0.1, 1.05]);
  assert.deepEqual([ce.bloque, ce.codigo], [null, 'CE-100'], 'los materiales de catálogo siguen igual');

  const leido = await croquis('oper1', 'GET');
  assert.equal(leido.cuerpo.materiales[0].bloque, 'COLUMNA', 'persistió');
});

test('bloque auxiliar: un bloque que no existe, o que es un ítem de catálogo común, da 400', async () => {
  const con = (m) => croquis('oper1', 'PUT', { paredes: [], materiales: [m] });
  assert.equal((await con({ bloque: 'NO-EXISTE', x: 0, y: 0 })).status, 400);
  assert.equal((await con({ bloque: 'CE-100', x: 0, y: 0 })).status, 400, 'CE-100 tiene símbolo pero no es un bloque auxiliar');
  assert.equal((await con({ bloque: 7, x: 0, y: 0 })).status, 400);
  assert.equal((await con({ x: 0, y: 0 })).status, 400, 'sin ítem de catálogo ni bloque');
  assert.equal((await con({ bloque: 'COLUMNA', x: 'a', y: 0 })).status, 400);
});

test('los spots traen su "ancla": el punto del brazo que se apoya en la línea de un dintel', async () => {
  for (const [codigo, profundidad] of [['IS-03', 0.15], ['IS-04', 0.3], ['IS-06', 0.3]]) {
    db.prepare("INSERT INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES (?, 'ELECTRICIDAD', 'SPOT', 'manual', 1)").run(codigo);
    const r = await llamar('oper1', 'GET', '/catalogo/croquis-simbolos');
    assert.deepEqual(r.cuerpo[codigo].ancla, [0.05, profundidad], `${codigo}: el medio de la barrita al final del brazo`);
    assert.equal(r.cuerpo[codigo].profundidad, profundidad);
  }
  const r = await llamar('oper1', 'GET', '/catalogo/croquis-simbolos');
  assert.equal(r.cuerpo.COLUMNA.ancla, undefined, 'los demás símbolos no tienen ancla');
});

test('lote inexistente da 404', async () => {
  assert.equal((await llamar('oper1', 'GET', '/lotes/999999/croquis')).status, 404);
  assert.equal((await llamar('oper1', 'PUT', '/lotes/999999/croquis', { paredes: [], materiales: [] })).status, 404);
});

test('eliminar: borra el croquis, vuelve a estar en null', async () => {
  await croquis('oper1', 'PUT', { paredes: [{ x1: 0, y1: 0, x2: 1, y2: 0 }], materiales: [] });
  assert.equal((await croquis('oper1', 'DELETE')).status, 200);
  assert.equal((await croquis('oper1', 'GET')).cuerpo, null);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lote_croquis WHERE lote_id = ?').get(loteId).n, 0);
});

test('biblioteca de símbolos: sólo devuelve ítems activos con símbolo real (no inventa uno para los que no tienen)', async () => {
  // "PB-1" (código inventado del catálogo de prueba, no existe en la biblioteca real) no tiene símbolo.
  const vacio = await llamar('oper1', 'GET', '/catalogo/croquis-simbolos');
  assert.equal(vacio.status, 200);
  assert.deepEqual(vacio.cuerpo['PB-1'], undefined);

  // Un código real de la biblioteca (PB-250) sí tiene que aparecer si está activo...
  db.prepare("INSERT INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES ('PB-250', 'SISTEMA', 'Panel syma blanco', 'manual', 1)").run();
  // ...pero no si está dado de baja.
  db.prepare("INSERT INTO catalogo_items (codigo, rubro, descripcion, regla_tipo, activo) VALUES ('PC-250', 'SISTEMA', 'Panel syma cerezo', 'manual', 0)").run();

  const r = await llamar('oper1', 'GET', '/catalogo/croquis-simbolos');
  assert.equal(r.status, 200);
  assert.ok(r.cuerpo['PB-250'], 'ítem activo con símbolo real: aparece');
  assert.ok(r.cuerpo['PB-250'].paths.length > 0);
  assert.equal(typeof r.cuerpo['PB-250'].ancho, 'number');
  assert.equal(r.cuerpo['PB-250'].rubro, 'SISTEMA');
  assert.equal(r.cuerpo['PB-250'].descripcion, 'Panel syma blanco');
  assert.equal(r.cuerpo['PB-250'].catalogo_item_id, db.prepare("SELECT id FROM catalogo_items WHERE codigo = 'PB-250'").get().id);
  assert.equal(r.cuerpo['PC-250'], undefined, 'ítem dado de baja: no aparece aunque tenga símbolo');
});
