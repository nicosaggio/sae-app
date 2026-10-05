// Endurecimiento para usar la app desde Internet (detrás de un túnel https en la misma PC): encabezados,
// cookie segura, límite de intentos de login, sesión nueva en cada login, errores sin detalles técnicos,
// política de claves y nombres de archivo seguros.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-seguridad-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const bcrypt = require('bcryptjs');
const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const { createApp } = require('../src/app');
const limiteLogin = require('../src/middleware/limiteLogin');

let servidor;
let base;

const login = (usuario, password, extra = {}) =>
  fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extra },
    body: JSON.stringify({ nombre_usuario: usuario, password }),
  });
const cookieDe = (res) => res.headers.get('set-cookie').split(';')[0];

test.before(async () => {
  migrar();
  const hash = bcrypt.hashSync('clave-larga-1', 4);
  db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES (?, ?, ?)').run('admin1', hash, 'admin');
  db.prepare('INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES (?, ?, ?)').run('oper1', hash, 'operador');
  servidor = createApp().listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

test.beforeEach(() => limiteLogin.reiniciarTodo());

test.after(() => {
  servidor.close();
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('encabezados de seguridad; HSTS sólo cuando la conexión llegó por https', async () => {
  const plano = await fetch(`${base}/api/health`);
  assert.equal(plano.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(plano.headers.get('x-frame-options'), 'SAMEORIGIN');
  assert.equal(plano.headers.get('referrer-policy'), 'same-origin');
  assert.equal(plano.headers.get('strict-transport-security'), null, 'por la red local (http) no se manda HSTS');

  const seguro = await fetch(`${base}/api/health`, { headers: { 'X-Forwarded-Proto': 'https' } });
  assert.match(seguro.headers.get('strict-transport-security'), /max-age=\d+/);
});

test('la cookie de sesión es Secure cuando entran por https (túnel) y funciona normal por http (red local)', async () => {
  const porLan = await login('oper1', 'clave-larga-1');
  assert.equal(porLan.status, 200);
  const cookieLan = porLan.headers.get('set-cookie');
  assert.match(cookieLan, /HttpOnly/i);
  assert.match(cookieLan, /SameSite=Lax/i);
  assert.ok(!/;\s*Secure/i.test(cookieLan), 'con http la cookie no puede ser Secure o el navegador la descartaría');

  const porTunel = await login('oper1', 'clave-larga-1', { 'X-Forwarded-Proto': 'https' });
  assert.equal(porTunel.status, 200);
  assert.match(porTunel.headers.get('set-cookie'), /;\s*Secure/i);
});

test('límite de intentos de login: bloquea a esa IP tras varios fallos, aun con la clave correcta, y no afecta a otras IP', async () => {
  const atacante = { 'X-Forwarded-For': '203.0.113.7' };
  for (let i = 0; i < limiteLogin.MAX_FALLOS; i++) {
    assert.equal((await login('admin1', `mala-${i}`, atacante)).status, 401);
  }
  const bloqueado = await login('admin1', 'clave-larga-1', atacante);
  assert.equal(bloqueado.status, 429);
  assert.ok(Number(bloqueado.headers.get('retry-after')) > 0);
  assert.match((await bloqueado.json()).error, /Demasiados intentos/);

  // Otra IP real (el túnel local manda la del visitante en X-Forwarded-For) entra sin problema.
  assert.equal((await login('admin1', 'clave-larga-1', { 'X-Forwarded-For': '198.51.100.9' })).status, 200);
});

test('un login correcto borra los fallos anteriores de esa IP', async () => {
  const ip = { 'X-Forwarded-For': '203.0.113.50' };
  for (let i = 0; i < limiteLogin.MAX_FALLOS - 1; i++) await login('admin1', 'mala', ip);
  assert.equal((await login('admin1', 'clave-larga-1', ip)).status, 200);
  for (let i = 0; i < limiteLogin.MAX_FALLOS - 1; i++) assert.equal((await login('admin1', 'mala', ip)).status, 401, 'el contador arrancó de cero');
});

test('los fallos se olvidan pasada la ventana de tiempo', () => {
  const t0 = 1_000_000;
  for (let i = 0; i < limiteLogin.MAX_FALLOS; i++) limiteLogin.registrarFallo('9.9.9.9', t0);
  assert.ok(limiteLogin.segundosDeEspera('9.9.9.9', t0 + 1000) > 0);
  assert.equal(limiteLogin.segundosDeEspera('9.9.9.9', t0 + limiteLogin.VENTANA_MS + 1), 0);
});

test('cada login crea una sesión nueva: la anterior deja de servir (no hay fijación de sesión)', async () => {
  const a = cookieDe(await login('oper1', 'clave-larga-1'));
  const resB = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: a },
    body: JSON.stringify({ nombre_usuario: 'oper1', password: 'clave-larga-1' }),
  });
  const b = cookieDe(resB);
  assert.notEqual(a, b, 'el identificador de sesión cambia al loguearse');
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: a } })).status, 401, 'la sesión vieja quedó destruida');
  assert.equal((await fetch(`${base}/api/auth/me`, { headers: { cookie: b } })).status, 200);
});

test('un error interno no muestra detalles técnicos (rutas, SQL) a quien lo recibe', async () => {
  const cookie = cookieDe(await login('oper1', 'clave-larga-1'));
  const original = db.prepare.bind(db);
  const silencio = console.error;
  console.error = () => {};
  db.prepare = () => {
    throw new Error('SQLITE_ERROR: no such table en C:\\Users\\secreto\\saeapp.db');
  };
  let res;
  try {
    res = await fetch(`${base}/api/eventos`, { headers: { cookie } });
  } finally {
    delete db.prepare;
    console.error = silencio;
  }
  assert.equal(typeof original, 'function');
  assert.equal(res.status, 500);
  const cuerpo = await res.json();
  assert.equal(cuerpo.error, 'Error interno del servidor');
  assert.ok(!/secreto|SQLITE/.test(JSON.stringify(cuerpo)));
});

test('los errores de validación (4xx) siguen mostrando su mensaje claro', async () => {
  const res = await login('', '');
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /obligatorios/);
});

test('claves: mínimo 8 caracteres y tienen que ser texto', async () => {
  const cookie = cookieDe(await login('admin1', 'clave-larga-1'));
  const crear = (password) =>
    fetch(`${base}/api/usuarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ nombre_usuario: `u${Math.random()}`, password }) });
  assert.equal((await crear('1234567')).status, 400);
  assert.equal((await crear(12345678)).status, 400, 'un número no es una clave válida');
  assert.equal((await crear(['abcdefgh'])).status, 400);
  assert.equal((await crear('12345678')).status, 201);

  const lista = await (await fetch(`${base}/api/usuarios`, { headers: { cookie } })).json();
  const id = lista[0].id;
  const cambiar = (password) =>
    fetch(`${base}/api/usuarios/${id}/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ password }) });
  assert.equal((await cambiar('corta')).status, 400);
  assert.equal((await cambiar('suficientemente-larga')).status, 200);
});

test('un operador no puede usar la administración de usuarios', async () => {
  const cookie = cookieDe(await login('oper1', 'clave-larga-1'));
  assert.equal((await fetch(`${base}/api/usuarios`, { headers: { cookie } })).status, 403);
  assert.equal((await fetch(`${base}/api/usuarios`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify({ nombre_usuario: 'x', password: '12345678', rol: 'admin' }) })).status, 403);
});

test('sin sesión no se puede leer ni escribir nada de la app (sólo login y health están abiertos)', async () => {
  for (const ruta of ['/api/eventos', '/api/productos', '/api/clientes', '/api/catalogo/items', '/api/cotizaciones', '/api/usuarios']) {
    assert.equal((await fetch(`${base}${ruta}`)).status, 401, ruta);
  }
  assert.equal((await fetch(`${base}/api/eventos`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401);
  assert.equal((await fetch(`${base}/api/health`)).status, 200);
});

test('el nombre del PDF de totales sólo lleva caracteres seguros aunque el filtro de rubros traiga comillas', async () => {
  const cookie = cookieDe(await login('admin1', 'clave-larga-1'));
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO', '2026-11-01', '2026-11-03', ?)").run(admin).lastInsertRowid);
  const res = await fetch(`${base}/api/eventos/${eventoId}/export/pdf?rubros=${encodeURIComponent('SISTEMA","x=y')}`, { headers: { cookie } });
  assert.equal(res.status, 200);
  const cabecera = res.headers.get('content-disposition');
  assert.match(cabecera, /^attachment; filename="evento-\d+-[A-Za-z0-9_-]+\.pdf"$/);
  await res.arrayBuffer();
});
