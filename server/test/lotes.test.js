// Dentro de un evento no puede haber dos lotes con el mismo número: ni al editar uno ni al crearlo.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-lotes-'));
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
let eventoUno;
let eventoDos;

const crearLote = (eventoId, cuerpo) =>
  fetch(`${base}/api/eventos/${eventoId}/lotes`, { method: 'POST', headers: { 'Content-Type': 'application/json', cookie }, body: JSON.stringify(cuerpo) });

test.before(async () => {
  migrar();
  db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', ?, 'admin')").run(bcrypt.hashSync('clave', 4));
  const admin = db.prepare("SELECT id FROM usuarios WHERE nombre_usuario = 'admin1'").get().id;
  const evento = (nombre) => Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, '2026-11-01', '2026-11-03', ?)").run(nombre, admin).lastInsertRowid);
  eventoUno = evento('EXPO UNO');
  eventoDos = evento('EXPO DOS');

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

test('crear un lote con un número que ya existe en el evento da 409 y no crea nada; en otro evento sí se puede', async () => {
  assert.equal((await crearLote(eventoUno, { codigo: 'A-12', expositor: 'ALFA' })).status, 201);

  const repetido = await crearLote(eventoUno, { codigo: 'A-12', expositor: 'BETA' });
  assert.equal(repetido.status, 409);
  assert.match((await repetido.json()).error, /Ya hay otro lote con el número "A-12" en este evento/);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM lotes WHERE evento_id = ?').get(eventoUno).n, 1, 'no se creó el repetido');

  assert.equal((await crearLote(eventoDos, { codigo: 'A-12' })).status, 201, 'el mismo número en otro evento no choca');
  assert.equal((await crearLote(eventoUno, { codigo: 'A-13' })).status, 201, 'otro número en el mismo evento tampoco');
});
