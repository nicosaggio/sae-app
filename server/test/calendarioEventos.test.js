// El calendario (y "Próximos eventos") muestra los eventos que ya tienen algún presupuesto: confirmado, o
// pendiente de confirmación. Un presupuesto rechazado no cuenta, y un evento sin ninguno tampoco.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-calendario-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');

const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const eventosService = require('../src/services/eventosService');

const ids = {};

const evento = (nombre, creadoPor) =>
  Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, '2026-11-10', '2026-11-12', ?)").run(nombre, creadoPor).lastInsertRowid);
const cotizacion = (eventoId, estado) =>
  db.prepare("INSERT INTO cotizaciones (estado, evento_id, fecha_carga) VALUES (?, ?, '2026-10-01')").run(estado, eventoId);

test.before(() => {
  migrar();
  const admin = Number(db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('admin1', 'x', 'admin')").run().lastInsertRowid);

  ids.sinNada = evento('SIN PRESUPUESTOS', admin);
  ids.confirmado = evento('CON CONFIRMADO', admin);
  ids.pendiente = evento('CON PENDIENTE', admin);
  ids.rechazado = evento('SOLO RECHAZADO', admin);
  ids.rechazadoYPendiente = evento('RECHAZADO Y PENDIENTE', admin);

  const lote = Number(db.prepare("INSERT INTO lotes (evento_id, codigo, expositor) VALUES (?, '1', 'ALFA')").run(ids.confirmado).lastInsertRowid);
  db.prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', '2026-10-01', 1, 'pendiente_pago', 'manual')").run(lote);

  cotizacion(ids.pendiente, 'pendiente');
  cotizacion(ids.rechazado, 'rechazada');
  cotizacion(ids.rechazadoYPendiente, 'rechazada');
  cotizacion(ids.rechazadoYPendiente, 'pendiente');
});

const enElCalendario = () =>
  eventosService
    .listar({ desde: '2026-11-01', hasta: '2026-11-30', conPresupuestos: true })
    .map((e) => e.id)
    .sort((a, b) => a - b);

test('el calendario incluye los eventos con presupuesto confirmado o pendiente de confirmación', () => {
  assert.deepEqual(enElCalendario(), [ids.confirmado, ids.pendiente, ids.rechazadoYPendiente]);
});

test('un evento con presupuestos solo rechazados, o sin ninguno, no aparece', () => {
  const visibles = enElCalendario();
  assert.ok(!visibles.includes(ids.rechazado));
  assert.ok(!visibles.includes(ids.sinNada));
});

test('al rechazar el único presupuesto pendiente el evento sale del calendario, y al reabrirlo vuelve', () => {
  db.prepare("UPDATE cotizaciones SET estado = 'rechazada' WHERE evento_id = ? AND estado = 'pendiente'").run(ids.pendiente);
  assert.ok(!enElCalendario().includes(ids.pendiente));
  db.prepare("UPDATE cotizaciones SET estado = 'pendiente' WHERE evento_id = ?").run(ids.pendiente);
  assert.ok(enElCalendario().includes(ids.pendiente));
});

test('sin el filtro de presupuestos se listan todos los eventos del rango', () => {
  const todos = eventosService.listar({ desde: '2026-11-01', hasta: '2026-11-30' });
  assert.equal(todos.length, 5);
});
