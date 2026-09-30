const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-api-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');

const bcrypt = require('bcryptjs');
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

/** Llama a la API como `usuario` y devuelve { status, cuerpo }. */
async function api(usuario, metodo, ruta, cuerpo) {
  const res = await fetch(`${base}/api/catalogo${ruta}`, {
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

const porCodigo = (codigo) => db.prepare('SELECT * FROM catalogo_items WHERE codigo = ? COLLATE NOCASE').get(codigo);
const idDe = (codigo) => porCodigo(codigo).id;

test.before(async () => {
  migrar();
  sembrarCatalogoDePrueba();
  const hash = bcrypt.hashSync('clave', 4);
  for (const [nombre, rol, soloEstado] of [['admin1', 'admin', 0], ['oper1', 'operador', 0], ['estado1', 'operador', 1]]) {
    db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol, solo_estado) VALUES (?, ?, ?, ?)').run(nombre, hash, rol, soloEstado);
  }
  db.prepare("INSERT INTO productos (codigo, nombre) VALUES ('NUEVO-X', 'Producto nuevo')").run();
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

test('permisos: sin sesión 401; "solo estado" puede leer pero no escribir; ajustes e importación son de admin', async () => {
  assert.equal((await api(null, 'GET', '/items')).status, 401);
  assert.equal((await api('estado1', 'GET', '/items')).status, 200);
  assert.equal((await api('estado1', 'POST', '/items', { codigo: 'X-1' })).status, 403);
  assert.equal((await api('estado1', 'PUT', `/items/${idDe('CE-100')}`, { rubro: 'X' })).status, 403);
  assert.equal((await api('estado1', 'POST', '/versiones', { nombre: 'X', porcentaje_global: 0.5 })).status, 403);
  assert.equal((await api('oper1', 'PUT', '/ajustes', { multiplo_redondeo: 50 })).status, 403);
  assert.equal((await api('oper1', 'POST', '/importar')).status, 403);
  assert.equal((await api('oper1', 'POST', '/importar/confirmar', { token: 'x' })).status, 403);
  assert.equal((await api('admin1', 'GET', '/ajustes')).status, 200);
});

test('listar ítems: filtros por texto, rubro, estado y activos; cada fila trae su regla en texto', async () => {
  const todos = (await api('oper1', 'GET', '/items')).cuerpo;
  assert.equal(todos.length, 8);
  const ce150 = todos.find((i) => i.codigo === 'CE-150');
  assert.equal(ce150.regla_texto, 'derivado de CE-100 ×1.5');
  assert.equal(ce150.sae, 2100);
  assert.equal(todos.find((i) => i.codigo === 'TV-43').regla_texto, 'manual $169.000 + pie');
  assert.equal(todos.find((i) => i.codigo === 'MC-43').regla_texto, 'proporcional al SAE de CE-100 × 68100/38600');

  assert.deepEqual((await api('oper1', 'GET', '/items?q=ce-1')).cuerpo.map((i) => i.codigo), ['CE-100', 'CE-150']);
  assert.deepEqual((await api('oper1', 'GET', '/items?estado=sin_precio')).cuerpo.map((i) => i.codigo), ['SIN']);
  assert.deepEqual((await api('oper1', 'GET', '/items?publicado=0')).cuerpo.map((i) => i.codigo), ['CE-200', 'TV-50P'], 'los que no están en ninguna página');
  assert.equal((await api('oper1', 'GET', '/items?rubro=NO-EXISTE')).cuerpo.length, 0);
  assert.equal((await api('oper1', 'GET', '/items?activo=0')).cuerpo.length, 0);
});

test('ficha de un ítem: de qué depende, qué depende de él, dónde está y su precio en cada versión', async () => {
  const ce100 = (await api('oper1', 'GET', `/items/${idDe('CE-100')}`)).cuerpo;
  assert.deepEqual(ce100.regla, { tipo: 'base', codigo_base: 'CE-100', ref: null, ref2: null, ref3: null, factor: null, num: null, den: null, valor: null, suma_adicional_pie: false });
  assert.deepEqual(ce100.depende_de, []);
  assert.deepEqual(ce100.dependientes.map((d) => d.codigo).sort(), ['CE-150', 'CE-200', 'MC-43']);
  assert.equal(ce100.posicion.titulo, 'SAE - SISTEMA');
  assert.deepEqual([ce100.posicion.banda, ce100.posicion.columna], [1, 1]);
  assert.equal(ce100.precios_por_version[0].nombre, 'General');
  assert.equal(ce100.precios_por_version[0].sae, 1400);
  assert.deepEqual(ce100.ficha, { titulo: 'Ficha CE-100', detalle: 'Ancho: 1 m' });

  const tv50p = (await api('oper1', 'GET', `/items/${idDe('TV-50P')}`)).cuerpo;
  assert.deepEqual(tv50p.depende_de.map((d) => d.codigo), ['TV-43']);
  assert.deepEqual((await api('oper1', 'GET', `/items/${idDe('TV-43')}`)).cuerpo.dependientes.map((d) => d.codigo), ['TV-50P']);
  assert.equal((await api('oper1', 'GET', '/items/999999')).status, 404);
});

test('crear ítem: valida, calcula su precio, lo enlaza con el producto de igual código y recalcula la General', async () => {
  const malos = [
    [{}, /El código es obligatorio/],
    [{ codigo: 'ce-100' }, /Ya existe un ítem con el código "ce-100"/],
    [{ codigo: 'A-1', regla: { tipo: 'inventada' } }, /Tipo de regla inválido/],
    [{ codigo: 'A-1', regla: { tipo: 'derivado' } }, /La regla necesita el ítem de origen/],
    [{ codigo: 'A-1', regla: { tipo: 'derivado', ref: 'NO-EXISTE' } }, /No existe el ítem "NO-EXISTE"/],
    [{ codigo: 'A-1', regla: { tipo: 'manual', valor: 0 } }, /El precio fijo tiene que ser mayor a 0/],
    [{ codigo: 'A-1', regla: { tipo: 'manual', valor: 'abc' } }, /tiene que ser un número/],
    [{ codigo: 'A-1', regla: { tipo: 'proporcional', ref: 'CE-100', num: 1, den: 0 } }, /El denominador tiene que ser mayor a 0/],
    [{ codigo: 'A-1', regla: { tipo: 'derivado', ref: 'CE-100', factor: -2 } }, /El factor tiene que ser mayor a 0/],
    [{ codigo: 'A-1', porcentaje: 55 }, /fracción entre 0 y 3 \(0,55 = 55 %\)/],
    [{ codigo: 'A-1', ficha: { titulo: 'x' }, descripcion_formato: [{ t: 'x' }] }, /Cada tramo de la ficha/],
  ];
  for (const [cuerpo, mensaje] of malos) {
    const r = await api('oper1', 'POST', '/items', cuerpo);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
    assert.match(r.cuerpo.error, mensaje);
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n, 8, 'los rechazos no dejan nada guardado');

  const r = await api('oper1', 'POST', '/items', {
    codigo: 'NUEVO-X', rubro: 'SISTEMA', descripcion: 'Un ítem nuevo', unidad: 'c/u',
    ficha: { titulo: 'PIEZA NUEVA', detalle: 'Ancho: 2 m' },
    regla: { tipo: 'derivado', ref: 'CE-100', factor: 3 },
  });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.sae, 4200, '1000 × 3 × 1,4');
  assert.equal(r.cuerpo.estado_precio, 'ok');
  assert.equal(r.cuerpo.producto.codigo, 'NUEVO-X', 'se enlaza solo con el producto de igual código');
  assert.deepEqual(r.cuerpo.descripcion_formato, [{ t: 'PIEZA NUEVA\n', b: true, sz: 14 }, { t: 'Ancho: 2 m', b: false, sz: 11 }]);
  assert.equal(r.cuerpo.publicado, 0);
  assert.deepEqual(r.cuerpo.depende_de.map((d) => d.codigo), ['CE-100']);
  const general = db.prepare('SELECT id FROM catalogo_versiones WHERE es_general = 1').get().id;
  assert.equal(db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(general, r.cuerpo.id).sae, 4200);
});

test('editar una regla recalcula ese ítem y todo lo que depende de él', async () => {
  const antes = porCodigo('MC-43').sae;
  try {
    const r = await api('oper1', 'PUT', `/items/${idDe('CE-100')}`, { regla: { tipo: 'manual', valor: 2000 } });
    assert.equal(r.status, 200);
    assert.equal(r.cuerpo.sae, 2800);
    assert.equal(porCodigo('CE-150').sae, 4200, 'derivado: 2000 × 1,5 × 1,4');
    assert.equal(porCodigo('CE-200').sae, 5600);
    assert.equal(porCodigo('NUEVO-X').sae, 8400, 'derivado de tercer nivel');
    assert.notEqual(porCodigo('MC-43').sae, antes, 'el proporcional sigue al SAE de CE-100');
    assert.equal(porCodigo('MC-43').sae, 5000, '2.800 × 68.100 / 38.600 = 4.940,1 → 5.000');
  } finally {
    await api('oper1', 'PUT', `/items/${idDe('CE-100')}`, { regla: { tipo: 'base', codigo_base: 'CE-100' } });
  }
  assert.equal(porCodigo('CE-100').sae, 1400);
  assert.equal(porCodigo('MC-43').sae, 2500);
});

test('una regla que crearía una dependencia circular se rechaza y no cambia nada', async () => {
  const antes = db.prepare('SELECT codigo, sae, regla_tipo FROM catalogo_items ORDER BY id').all();
  const r = await api('oper1', 'PUT', `/items/${idDe('CE-100')}`, { regla: { tipo: 'derivado', ref: 'CE-150', factor: 1 } });
  assert.equal(r.status, 400);
  assert.match(r.cuerpo.error, /dependencia circular entre: CE-100, CE-150/);
  assert.deepEqual(db.prepare('SELECT codigo, sae, regla_tipo FROM catalogo_items ORDER BY id').all(), antes);

  const consigoMismo = await api('oper1', 'PUT', `/items/${idDe('CE-150')}`, { regla: { tipo: 'derivado', ref: 'CE-150' } });
  assert.match(consigoMismo.cuerpo.error, /no puede depender de sí mismo/);
});

test('porcentaje propio, ficha, código y producto: se editan y se validan', async () => {
  const id = idDe('PB-1');
  assert.match((await api('oper1', 'PUT', `/items/${id}`, { porcentaje: 55 })).cuerpo.error, /fracción entre 0 y 3/);
  assert.equal((await api('oper1', 'PUT', `/items/${id}`, { porcentaje: 1 })).cuerpo.sae, 4000, '2000 × 2');
  assert.equal((await api('oper1', 'PUT', `/items/${id}`, { porcentaje: null })).cuerpo.sae, 2800, 'NULL = vuelve a seguir al porcentaje general');

  const conFicha = (await api('oper1', 'PUT', `/items/${id}`, { ficha: { titulo: 'PANEL BLANCO', detalle: 'Alto: 2,50 m\nAncho: 1 m' } })).cuerpo;
  assert.equal(conFicha.descripcion_catalogo, 'PANEL BLANCO\nAlto: 2,50 m\nAncho: 1 m');
  assert.deepEqual(conFicha.ficha, { titulo: 'PANEL BLANCO', detalle: 'Alto: 2,50 m\nAncho: 1 m' });
  assert.deepEqual(conFicha.descripcion_formato.map((c) => [c.b, c.sz]), [[true, 14], [false, 11]]);

  assert.match((await api('oper1', 'PUT', `/items/${id}`, { codigo: 'ce-100' })).cuerpo.error, /Ya existe un ítem con el código/);
  assert.equal((await api('oper1', 'PUT', `/items/${id}`, { codigo: 'PB-1', rubro: 'PANELES' })).cuerpo.rubro, 'PANELES');
  assert.match((await api('oper1', 'PUT', `/items/${id}`, { producto_id: 999999 })).cuerpo.error, /El producto indicado no existe/);
  assert.equal((await api('oper1', 'PUT', `/items/${id}`, {})).status, 200, 'sin cambios no falla');
});

test('borrar un ítem: si de él dependen otros se rechaza; si está en el catálogo se da de baja; si no se usa se borra', async () => {
  const conDependientes = await api('oper1', 'DELETE', `/items/${idDe('CE-100')}`);
  assert.equal(conDependientes.status, 400);
  assert.match(conDependientes.cuerpo.error, /de este ítem dependen CE-150, CE-200, MC-43, NUEVO-X/);

  const baja = await api('oper1', 'DELETE', `/items/${idDe('SIN')}`);
  assert.equal(baja.cuerpo.resultado, 'baja_logica');
  assert.equal(porCodigo('SIN').activo, 0);
  assert.equal((await api('oper1', 'GET', '/items')).cuerpo.some((i) => i.codigo === 'SIN'), false, 'las bajas no aparecen por defecto');
  assert.equal((await api('oper1', 'GET', '/items?activo=todos')).cuerpo.some((i) => i.codigo === 'SIN'), true);
  assert.equal((await api('oper1', 'PUT', `/items/${idDe('SIN')}`, { activo: true })).cuerpo.activo, 1, 'se puede reactivar');

  const suelto = (await api('oper1', 'POST', '/items', { codigo: 'SUELTO', regla: { tipo: 'manual', valor: 500 } })).cuerpo;
  assert.equal((await api('oper1', 'DELETE', `/items/${suelto.id}`)).cuerpo.resultado, 'borrado');
  assert.equal(porCodigo('SUELTO'), undefined);
  assert.equal((await api('oper1', 'DELETE', '/items/999999')).status, 404);

  const conDependiente = await api('oper1', 'PUT', `/items/${idDe('TV-43')}`, { activo: false });
  assert.match(conDependiente.cuerpo.error, /No se puede dar de baja: de este ítem dependen TV-50P/);
});

test('páginas: se reordenan conservando su id, se agregan y quitan, y "publicado" sale de dónde está cada ítem', async () => {
  const antes = (await api('oper1', 'GET', '/paginas')).cuerpo;
  assert.deepEqual(antes.map((p) => [p.orden, p.titulo, p.logo_grande]), [[1, 'SAE - SISTEMA', 1], [2, 'SAE - PISOS', 0]]);
  assert.equal(antes[0].posiciones.length, 5);
  assert.equal(antes[0].posiciones[0].item.sae, 1400);

  const [p1, p2] = antes;
  const posiciones = (p) => p.posiciones.map((x) => ({ banda: x.banda, columna: x.columna, item_id: x.item.id }));
  const nueva = { titulo: 'SAE - EXTRA', logo_grande: false, posiciones: [{ banda: 1, columna: 1, item_id: idDe('CE-200') }] };

  const r = await api('oper1', 'PUT', '/paginas', {
    paginas: [{ id: p2.id, titulo: 'SAE - PISOS', posiciones: posiciones(p2) }, { id: p1.id, titulo: 'SAE - SISTEMA', logo_grande: true, posiciones: posiciones(p1) }, nueva],
  });
  assert.equal(r.status, 400, 'la portada tiene que ser la primera página');
  assert.match(r.cuerpo.error, /Sólo la primera página puede llevar el logo grande/);

  const ok = await api('oper1', 'PUT', '/paginas', {
    paginas: [{ id: p1.id, titulo: 'SAE - SISTEMA', logo_grande: true, posiciones: posiciones(p1) }, { id: p2.id, titulo: 'SAE - PISOS', posiciones: posiciones(p2) }, nueva],
  });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.cuerpo.map((p) => [p.orden, p.titulo]), [[1, 'SAE - SISTEMA'], [2, 'SAE - PISOS'], [3, 'SAE - EXTRA']]);
  assert.equal(ok.cuerpo[0].id, p1.id, 'las páginas que ya existían conservan su id');
  assert.equal(porCodigo('CE-200').publicado, 1);

  const sinExtra = await api('oper1', 'PUT', '/paginas', { paginas: ok.cuerpo.slice(0, 2).map((p) => ({ id: p.id, titulo: p.titulo, logo_grande: Boolean(p.logo_grande), posiciones: p.posiciones.map((x) => ({ banda: x.banda, columna: x.columna, item_id: x.item.id })) })) });
  assert.equal(sinExtra.cuerpo.length, 2);
  assert.equal(porCodigo('CE-200').publicado, 0, 'al sacarlo de las páginas deja de estar publicado');
});

test('páginas: rechaza celdas repetidas, ítems repetidos, posiciones inválidas y páginas inexistentes', async () => {
  const p1 = (await api('oper1', 'GET', '/paginas')).cuerpo[0];
  const esperar = async (paginas, patron) => {
    const r = await api('oper1', 'PUT', '/paginas', { paginas });
    assert.equal(r.status, 400);
    assert.match(r.cuerpo.error, patron);
  };
  const a = idDe('CE-100');
  const b = idDe('CE-150');
  await esperar([{ titulo: 'X', posiciones: [{ banda: 1, columna: 1, item_id: a }, { banda: 1, columna: 1, item_id: b }] }], /hay dos ítems en la banda 1, columna 1/);
  await esperar([{ titulo: 'X', posiciones: [{ banda: 1, columna: 1, item_id: a }, { banda: 2, columna: 2, item_id: a }] }], /CE-100 está ubicado más de una vez/);
  await esperar([{ titulo: 'X', posiciones: [{ banda: 3, columna: 1, item_id: a }] }], /la banda es 1 o 2 y la columna 1, 2 o 3/);
  await esperar([{ titulo: 'X', posiciones: [{ banda: 1, columna: 4, item_id: a }] }], /la banda es 1 o 2/);
  await esperar([{ titulo: 'X', posiciones: [{ banda: 1, columna: 1, item_id: 999999 }] }], /El ítem 999999 no existe/);
  await esperar([{ titulo: '', posiciones: [] }], /título de la página 1 es obligatorio/);
  await esperar([{ id: 999999, titulo: 'X', posiciones: [] }], /La página 999999 no existe/);
  await esperar([{ id: p1.id, titulo: 'A', posiciones: [] }, { id: p1.id, titulo: 'B', posiciones: [] }], /está repetida/);
  assert.equal((await api('oper1', 'GET', '/paginas')).cuerpo.length, 2, 'los rechazos no tocaron la estructura');
  assert.equal((await api('oper1', 'PUT', '/paginas', { paginas: 'no es una lista' })).status, 400);
});

test('versiones: la General siempre existe y no se borra ni se renombra; una de evento se crea con otro porcentaje', async () => {
  const lista = (await api('oper1', 'GET', '/versiones')).cuerpo;
  assert.equal(lista[0].nombre, 'General');
  assert.equal(lista[0].es_general, 1);
  assert.equal(lista[0].items_desactualizados, 0);
  const general = lista[0];

  assert.match((await api('oper1', 'DELETE', `/versiones/${general.id}`)).cuerpo.error, /La versión General no se puede borrar/);
  assert.match((await api('oper1', 'PUT', `/versiones/${general.id}`, { nombre: 'Otra' })).cuerpo.error, /no se puede renombrar/);

  assert.match((await api('oper1', 'POST', '/versiones', { nombre: 'Feria', porcentaje_global: 55 })).cuerpo.error, /fracción entre 0 y 3/);
  assert.match((await api('oper1', 'POST', '/versiones', { nombre: 'Feria' })).cuerpo.error, /Falta el porcentaje/);
  assert.match((await api('oper1', 'POST', '/versiones', { nombre: '  ', porcentaje_global: 0.5 })).cuerpo.error, /nombre de la versión es obligatorio/);
  assert.match((await api('oper1', 'POST', '/versiones', { nombre: 'general', porcentaje_global: 0.5 })).cuerpo.error, /Ya existe una versión llamada/);
  assert.match((await api('oper1', 'POST', '/versiones', { nombre: 'X', porcentaje_global: 0.5, fecha_vigencia: '31/12/2026' })).cuerpo.error, /AAAA-MM-DD/);

  const r = await api('oper1', 'POST', '/versiones', { nombre: 'Feria', porcentaje_global: 0.55, fecha_vigencia: '2027-01-31' });
  assert.equal(r.status, 201);
  assert.equal(r.cuerpo.items_desactualizados, 0);
  assert.equal(r.cuerpo.fecha_vigencia, '2027-01-31');

  const precios = (versionId) => Object.fromEntries(db.prepare('SELECT i.codigo, vp.sae FROM catalogo_version_precios vp JOIN catalogo_items i ON i.id = vp.item_id WHERE vp.version_id = ?').all(versionId).map((f) => [f.codigo, f.sae]));
  const feria = precios(r.cuerpo.id);
  assert.equal(feria['CE-100'], 1600, '1000 × 1,55 hacia arriba al múltiplo de 100');
  assert.equal(feria['PB-1'], 3100);
  assert.equal(feria['TV-43'], 355800, 'los TV tienen su propio 100 %: no se pisan');
  assert.equal(feria['MC-43'], 2900, 'el proporcional sigue al SAE de esa versión');
  assert.equal(precios(general.id)['CE-100'], 1400, 'la General no cambió');

  const aTodos = (await api('oper1', 'POST', '/versiones', { nombre: 'Todo 55', porcentaje_global: 0.55, aplicar_a_todos: true })).cuerpo;
  assert.equal(precios(aTodos.id)['TV-43'], 275800, '(169.000 + 8.900) × 1,55, con "aplicar a todos"');
});

test('una versión de evento es una foto: no cambia sola al editar reglas, avisa que quedó desactualizada y se recalcula a pedido', async () => {
  const feria = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.nombre === 'Feria');
  await api('oper1', 'PUT', `/items/${idDe('PB-1')}`, { regla: { tipo: 'manual', valor: 3000 } });
  const foto = db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(feria.id, idDe('PB-1')).sae;
  assert.equal(foto, 3100, 'la versión guardada sigue igual');

  const lista = (await api('oper1', 'GET', '/versiones')).cuerpo;
  assert.equal(lista.find((v) => v.nombre === 'Feria').items_desactualizados, 1);
  assert.equal(lista.find((v) => v.es_general).items_desactualizados, 0, 'la General se recalcula sola');

  const recalculada = (await api('oper1', 'POST', `/versiones/${feria.id}/recalcular`)).cuerpo;
  assert.equal(recalculada.items_desactualizados, 0);
  assert.equal(db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(feria.id, idDe('PB-1')).sae, 4700, '3000 × 1,55');
  await api('oper1', 'PUT', `/items/${idDe('PB-1')}`, { regla: { tipo: 'base', codigo_base: 'PB-1' } });
});

test('versiones: cambiar el porcentaje recalcula, duplicar copia la foto tal cual, renombrar y borrar', async () => {
  const feria = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.nombre === 'Feria');
  const editada = await api('oper1', 'PUT', `/versiones/${feria.id}`, { porcentaje_global: 0.6, nombre: 'Feria 60', pie_legal: 'Vale hasta el {fecha_vigencia}' });
  assert.equal(editada.cuerpo.porcentaje_global, 0.6);
  assert.equal(editada.cuerpo.nombre, 'Feria 60');
  assert.equal(db.prepare('SELECT sae FROM catalogo_version_precios WHERE version_id = ? AND item_id = ?').get(feria.id, idDe('CE-100')).sae, 1600, '1000 × 1,6');

  const copia = (await api('oper1', 'POST', `/versiones/${feria.id}/duplicar`, { nombre: 'Feria copia' })).cuerpo;
  assert.equal(copia.porcentaje_global, 0.6);
  assert.equal(copia.pie_legal, 'Vale hasta el {fecha_vigencia}');
  assert.equal(copia.es_historial, 0, 'duplicar una versión de evento da otra versión de evento, no un historial');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(copia.id).n, db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n);
  assert.match((await api('oper1', 'POST', `/versiones/${feria.id}/duplicar`, { nombre: 'FERIA COPIA' })).cuerpo.error, /Ya existe una versión llamada/);
  assert.equal((await api('oper1', 'POST', `/versiones/${feria.id}/duplicar`)).cuerpo.nombre, 'Feria 60 (copia)');

  assert.equal((await api('oper1', 'DELETE', `/versiones/${copia.id}`)).status, 200);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(copia.id).n, 0, 'borrar la versión borra su foto');
  assert.equal((await api('oper1', 'GET', `/versiones/${copia.id}`)).status, 404);
  assert.equal((await api('oper1', 'DELETE', '/versiones/999999')).status, 404);
});

test('historial de la General: duplicarla guarda una foto fija, con nombre, que no se puede editar ni recalcular pero sí renombrar y borrar', async () => {
  const general = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.es_general === 1);
  assert.equal(general.es_historial, 0);

  const guardada = (await api('oper1', 'POST', `/versiones/${general.id}/duplicar`, { nombre: 'General antes de septiembre' })).cuerpo;
  assert.equal(guardada.es_historial, 1);
  assert.equal(guardada.es_general, 0);
  assert.equal(guardada.porcentaje_global, general.porcentaje_global);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM catalogo_version_precios WHERE version_id = ?').get(guardada.id).n, db.prepare('SELECT COUNT(*) AS n FROM catalogo_items').get().n, 'misma foto de precios que la General en ese momento');

  // Es de sólo lectura para el precio: ni el porcentaje ni "aplicar a todos" se pueden tocar, ni se recalcula
  for (const cuerpo of [{ porcentaje_global: 0.6 }, { aplicar_a_todos: true }]) {
    const r = await api('oper1', 'PUT', `/versiones/${guardada.id}`, cuerpo);
    assert.equal(r.status, 400);
    assert.match(r.cuerpo.error, /versión guardada del historial.*foto fija/);
  }
  const recalc = await api('oper1', 'POST', `/versiones/${guardada.id}/recalcular`);
  assert.equal(recalc.status, 400);
  assert.match(recalc.cuerpo.error, /foto fija/);

  // La vigencia y el pie legal sí se pueden corregir: son sólo texto del PDF, no cambian ningún precio
  const conVigencia = await api('oper1', 'PUT', `/versiones/${guardada.id}`, { fecha_vigencia: '2027-01-01', pie_legal: 'Vale para este evento.' });
  assert.equal(conVigencia.status, 200);
  assert.equal(conVigencia.cuerpo.fecha_vigencia, '2027-01-01');
  assert.equal(conVigencia.cuerpo.pie_legal, 'Vale para este evento.');
  assert.equal(conVigencia.cuerpo.es_historial, 1, 'sigue siendo del historial');

  // Pero sí se puede renombrar (eso es "ponerle un nombre") y cambiarle el pie legal
  const renombrada = await api('oper1', 'PUT', `/versiones/${guardada.id}`, { nombre: 'Lista de agosto 2026' });
  assert.equal(renombrada.status, 200);
  assert.equal(renombrada.cuerpo.nombre, 'Lista de agosto 2026');
  assert.equal(renombrada.cuerpo.es_historial, 1, 'sigue siendo del historial');

  // Se ve en el listado general de versiones (es una fila más de la misma tabla) y se puede exportar a PDF
  assert.ok((await api('oper1', 'GET', '/versiones')).cuerpo.some((v) => v.id === guardada.id && v.es_historial === 1));
  const pdf = await fetch(`${base}/api/catalogo/versiones/${guardada.id}/pdf`, { headers: { cookie: cookies.oper1 } });
  assert.equal(pdf.status, 200);

  // Se puede borrar como cualquier versión de evento
  assert.equal((await api('oper1', 'DELETE', `/versiones/${guardada.id}`)).status, 200);
  assert.equal((await api('oper1', 'GET', `/versiones/${guardada.id}`)).status, 404);
});

test('historial de la General: duplicar un historial da otro historial, y duplicar sin nombre respeta el patrón "(copia)"', async () => {
  const general = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.es_general === 1);
  const original = (await api('oper1', 'POST', `/versiones/${general.id}/duplicar`, { nombre: 'Foto base' })).cuerpo;
  const copiaDeCopia = (await api('oper1', 'POST', `/versiones/${original.id}/duplicar`)).cuerpo;
  assert.equal(copiaDeCopia.nombre, 'Foto base (copia)');
  assert.equal(copiaDeCopia.es_historial, 1, 'duplicar un historial da otro historial');
});

test('el PDF de una versión de evento sale con sus precios', async () => {
  const feria = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.nombre === 'Feria 60');
  const res = await fetch(`${base}/api/catalogo/versiones/${feria.id}/pdf`, { headers: { cookie: cookies.oper1 } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-disposition'), /CATALOGO SAE - Feria 60 - /);
  assert.equal(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString(), '%PDF');
});

test('ajustes: se leen con el aviso de las imágenes, se validan y al cambiarlos se recalcula la General', async () => {
  const ajustes = (await api('oper1', 'GET', '/ajustes')).cuerpo;
  assert.equal(ajustes.adicional_pie_tv, 8900);
  assert.equal(ajustes.multiplo_redondeo, 100);
  assert.equal(ajustes.carpeta_imagenes, process.env.CATALOGO_IMG_DIR);
  assert.match(ajustes.aviso_imagenes, /NO entran en el backup automático/);

  const mal = async (cuerpo, patron) => assert.match((await api('admin1', 'PUT', '/ajustes', cuerpo)).cuerpo.error, patron);
  await mal({ porcentaje_defecto: 40 }, /fracción entre 0 y 3/);
  await mal({ multiplo_redondeo: 0 }, /como mínimo 1/);
  await mal({ multiplo_redondeo: 2.5 }, /entero entre 1 y 100000/);
  await mal({ adicional_pie_tv: -5 }, /como mínimo 0/);
  await mal({ fecha_vigencia: '15/09/2026' }, /AAAA-MM-DD/);
  await mal({ fecha_vigencia: '2026-02-31' }, /AAAA-MM-DD/);
  await mal({ pie_legal: '   ' }, /obligatorio/);

  const cambiado = (await api('admin1', 'PUT', '/ajustes', { adicional_pie_tv: 10000 })).cuerpo;
  assert.equal(cambiado.adicional_pie_tv, 10000);
  assert.equal(porCodigo('TV-43').sae, 358000, '(169.000 + 10.000) × 2');
  assert.equal(porCodigo('TV-50P').sae, 358000, 'el derivado sigue al TV-43');
  await api('admin1', 'PUT', '/ajustes', { adicional_pie_tv: 8900 });
  assert.equal(porCodigo('TV-43').sae, 355800);

  await api('admin1', 'PUT', '/ajustes', { multiplo_redondeo: 500 });
  assert.equal(porCodigo('CE-100').sae, 1500, '1400 redondeado hacia arriba a múltiplos de 500');
  await api('admin1', 'PUT', '/ajustes', { multiplo_redondeo: 100 });

  const fecha = (await api('admin1', 'PUT', '/ajustes', { fecha_vigencia: '2027-03-01', pie_legal: 'Válido hasta el {fecha_vigencia}.' })).cuerpo;
  assert.equal(fecha.fecha_vigencia, '2027-03-01');
  assert.equal(db.prepare('SELECT fecha_vigencia FROM catalogo_versiones WHERE es_general = 1').get().fecha_vigencia, '2027-03-01', 'la fecha de la General sigue al ajuste');

  await api('admin1', 'PUT', '/ajustes', { porcentaje_defecto: 0.5 });
  assert.equal(db.prepare('SELECT porcentaje_global FROM catalogo_versiones WHERE es_general = 1').get().porcentaje_global, 0.5, 'el porcentaje por defecto es el de la General');
  assert.equal(porCodigo('CE-100').sae, 1500);
  await api('oper1', 'PUT', `/versiones/${db.prepare('SELECT id FROM catalogo_versiones WHERE es_general = 1').get().id}`, { porcentaje_global: 0.4 });
  assert.equal(db.prepare("SELECT valor FROM catalogo_ajustes WHERE clave = 'porcentaje_defecto'").get().valor, '0.4', 'y al revés');
  assert.equal(porCodigo('CE-100').sae, 1400);
});

test('televisores: lista los ítems que suman el pie con sus derivados; se cargan a mano el precio de lista y el adicional', async () => {
  const antes = (await api('oper1', 'GET', '/televisores')).cuerpo;
  assert.equal(antes.adicional_pie, 8900);
  assert.deepEqual(antes.items.map((t) => [t.codigo, t.precio_lista, t.sae]), [['TV-43', 169000, 355800]]);
  assert.deepEqual(antes.items[0].derivados.map((d) => d.codigo), ['TV-50P']);

  const tv43 = antes.items[0].id;
  assert.match((await api('oper1', 'PUT', '/televisores', { precios: [{ id: idDe('PB-1'), precio_lista: 100 }] })).cuerpo.error, /no es un televisor/);
  assert.match((await api('oper1', 'PUT', '/televisores', { precios: [{ id: tv43, precio_lista: 0 }] })).cuerpo.error, /mayor a 0/);

  const despues = (await api('oper1', 'PUT', '/televisores', { adicional_pie: 9000, precios: [{ id: tv43, precio_lista: 179000 }] })).cuerpo;
  assert.equal(despues.adicional_pie, 9000);
  assert.equal(despues.items[0].precio_lista, 179000);
  assert.equal(despues.items[0].sae, 376000, '(179.000 + 9.000) × 2');
  assert.equal(porCodigo('TV-50P').sae, 376000);
  await api('oper1', 'PUT', '/televisores', { adicional_pie: 8900, precios: [{ id: tv43, precio_lista: 169000 }] });
  assert.equal(porCodigo('TV-43').sae, 355800);
});

test('páginas por versión: trae los precios de esa versión y el formato de cada ficha', async () => {
  const feria = (await api('oper1', 'GET', '/versiones')).cuerpo.find((v) => v.nombre === 'Feria 60');
  const general = (await api('oper1', 'GET', '/paginas')).cuerpo;
  const deFeria = (await api('oper1', 'GET', `/paginas?version=${feria.id}`)).cuerpo;

  const ce100 = (paginas) => paginas[0].posiciones.find((p) => p.item.codigo === 'CE-100').item;
  assert.equal(ce100(general).sae, 1400);
  assert.equal(ce100(deFeria).sae, 1600, 'los precios son los de la versión pedida');
  assert.deepEqual(ce100(general).descripcion_formato, [{ t: 'Ficha CE-100\n', b: true, sz: 14 }, { t: 'Ancho: 1 m', b: false, sz: 11 }]);
  assert.equal((await api('oper1', 'GET', '/paginas?version=999999')).status, 404);
});

/** Foto de prueba: un PNG de color sólido. */
async function fotoDePrueba(ancho = 1000, alto = 500) {
  const { Jimp, JimpMime } = require('jimp');
  return Buffer.from(await new Jimp({ width: ancho, height: alto, color: 0x2244aaff }).getBuffer(JimpMime.png));
}

async function subirFoto(usuario, itemId, buffer, { nombre = 'foto.png', tipo = 'image/png', campo = 'imagen' } = {}) {
  const formulario = new FormData();
  if (buffer) formulario.append(campo, new Blob([buffer], { type: tipo }), nombre);
  const res = await fetch(`${base}/api/catalogo/items/${itemId}/imagen`, { method: 'PUT', headers: { cookie: cookies[usuario] }, body: formulario });
  const t = await res.text();
  return { status: res.status, cuerpo: t ? JSON.parse(t) : null };
}

test('foto de un ítem: se sube, se recomprime a JPEG, se sirve y reemplaza a la anterior', async () => {
  const id = idDe('CE-150');
  const r = await subirFoto('oper1', id, await fotoDePrueba());
  assert.equal(r.status, 200);
  assert.match(r.cuerpo.imagen, /^[a-f0-9]{40}\.jpg$/);
  const { Jimp } = require('jimp');
  const guardada = await Jimp.read(path.join(process.env.CATALOGO_IMG_DIR, r.cuerpo.imagen));
  assert.equal(guardada.width, 800, 'se achica al ancho máximo del catálogo');

  const servida = await fetch(`${base}/api/catalogo/imagenes/${r.cuerpo.imagen}`, { headers: { cookie: cookies.oper1 } });
  assert.equal(servida.status, 200);
  assert.equal(servida.headers.get('content-type'), 'image/jpeg');
  await servida.arrayBuffer();

  const otra = await subirFoto('oper1', id, await fotoDePrueba(600, 900), { nombre: 'otra.png' });
  assert.notEqual(otra.cuerpo.imagen, r.cuerpo.imagen);
  assert.equal(porCodigo('CE-150').imagen, otra.cuerpo.imagen);
});

test('foto de un ítem: rechaza lo que no es una imagen, sin archivo, ítem inexistente y usuarios de "solo estado"', async () => {
  const id = idDe('CE-150');
  const antes = porCodigo('CE-150').imagen;
  const mal = async (respuesta, patron) => {
    assert.equal(respuesta.status, 400);
    assert.match(respuesta.cuerpo.error, patron);
  };
  await mal(await subirFoto('oper1', id, Buffer.from('%PDF-1.4'), { nombre: 'x.pdf', tipo: 'application/pdf' }), /JPG, PNG o GIF/);
  await mal(await subirFoto('oper1', id, Buffer.from('no soy una imagen'), { tipo: 'image/png' }), /No se pudo leer la foto/);
  await mal(await subirFoto('oper1', id, null), /Falta la foto/);
  await mal(await subirFoto('oper1', id, await fotoDePrueba(), { campo: 'otro' }), /Subí un solo archivo/);
  assert.equal((await subirFoto('oper1', 999999, await fotoDePrueba())).status, 404);
  assert.equal((await subirFoto('estado1', id, await fotoDePrueba())).status, 403);
  assert.equal((await subirFoto(null, id, await fotoDePrueba())).status, 401);
  assert.equal(porCodigo('CE-150').imagen, antes, 'los rechazos no tocaron la foto');
});

test('historial de importaciones: la siembra queda registrada con su reporte', async () => {
  const lista = (await api('oper1', 'GET', '/importaciones')).cuerpo;
  assert.equal(lista.length, 1);
  assert.equal(lista[0].archivo, 'Siembra inicial: CATALOGO SAE.xlsx');
  const detalle = (await api('oper1', 'GET', `/importaciones/${lista[0].id}`)).cuerpo;
  assert.equal(detalle.resumen.totales.itemsImportados, 8);
  assert.equal((await api('oper1', 'GET', '/importaciones/999999')).status, 404);
});
