// La lista de presupuestos confirmados: orden del más reciente al más antiguo (por la fecha del presupuesto)
// y datos de la cotización original (código de facturación y responsable) cuando se cargó desde la app.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), 'saeapp-orden-'));
process.env.DB_PATH = path.join(carpeta, 'test.db');
process.env.CATALOGO_IMG_DIR = path.join(carpeta, 'img');
process.env.BACKUPS_DIR = path.join(carpeta, 'backups');
process.env.COTIZACIONES_ADJ_DIR = path.join(carpeta, 'adjuntos');

const { db } = require('../src/db/connection');
const { run: migrar } = require('../src/db/migrate');
const presupuestosService = require('../src/services/presupuestosService');

test.before(() => {
  migrar();
});

test.after(() => {
  db.close();
  fs.rmSync(carpeta, { recursive: true, force: true });
});

test('los presupuestos salen del más reciente al más antiguo, aunque el evento sea más viejo o más nuevo', () => {
  const admin = Number(db.prepare("INSERT INTO usuarios (nombre_usuario, password_hash, rol) VALUES ('a', 'x', 'admin')").run().lastInsertRowid);
  const evento = (nombre, inicio) =>
    Number(db.prepare('INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES (?, ?, ?, ?)').run(nombre, inicio, inicio, admin).lastInsertRowid);
  const lote = (eventoId, codigo) => Number(db.prepare('INSERT INTO lotes (evento_id, codigo) VALUES (?, ?)').run(eventoId, codigo).lastInsertRowid);
  const presupuesto = (loteId, fecha, confirmado = 1) =>
    Number(
      db
        .prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '1', ?, ?, 'pendiente_facturar', 'manual')")
        .run(loteId, fecha, confirmado).lastInsertRowid
    );

  const eventoViejo = evento('EXPO VIEJA', '2026-02-09');
  const eventoNuevo = evento('EXPO NUEVA', '2026-12-01');
  // Cargados en desorden: el presupuesto de fecha más reciente es el del evento viejo.
  const a = presupuesto(lote(eventoNuevo, '1'), '2026-09-01');
  const b = presupuesto(lote(eventoViejo, '2'), '2026-10-05');
  const c = presupuesto(lote(eventoNuevo, '3'), '2026-03-15');
  const d = presupuesto(lote(eventoViejo, '4'), '2026-09-01'); // misma fecha que `a`: gana el cargado después
  presupuesto(lote(eventoViejo, '5'), '2026-12-31', 0); // sin confirmar: no entra en la lista de confirmados

  const confirmados = presupuestosService.listar({ confirmado: true }).map((p) => p.id);
  assert.deepEqual(confirmados, [b, d, a, c]);
});

test('la lista trae el código de facturación y el responsable de los presupuestos cargados desde la app; los de Excel, vacío', () => {
  const admin = Number(db.prepare('SELECT id FROM usuarios LIMIT 1').get().id);
  const eventoId = Number(db.prepare("INSERT INTO eventos (nombre, fecha_inicio, fecha_fin, creado_por) VALUES ('EXPO COD', '2026-11-01', '2026-11-03', ?)").run(admin).lastInsertRowid);
  const loteId = (codigo) => Number(db.prepare('INSERT INTO lotes (evento_id, codigo) VALUES (?, ?)').run(eventoId, codigo).lastInsertRowid);
  const presupuesto = (lote, origen, fecha) =>
    Number(
      db
        .prepare("INSERT INTO presupuestos (lote_id, numero, fecha, confirmado, estado, origen) VALUES (?, '2', ?, 1, 'pendiente_facturar', ?)")
        .run(lote, fecha, origen).lastInsertRowid
    );
  const deApp = presupuesto(loteId('A1'), 'app', '2027-01-02');
  const deExcel = presupuesto(loteId('A2'), 'excel', '2027-01-01');
  const sinCodigo = presupuesto(loteId('A3'), 'app', '2027-01-03'); // su cotización todavía no tenía ID de cliente
  const cotizacion = (presupuestoId, idCliente, numero) =>
    db
      .prepare("INSERT INTO cotizaciones (estado, fecha_carga, responsable, id_cliente, numero, presupuesto_id) VALUES ('confirmada', '2027-01-01', 'Ana Gómez', ?, ?, ?)")
      .run(idCliente, numero, presupuestoId);
  cotizacion(deApp, 'CEXYZ01', 2);
  cotizacion(sinCodigo, null, null);

  const lista = presupuestosService.listar({ eventoId });
  const fila = (id) => lista.find((p) => p.id === id);
  assert.equal(fila(deApp).cod_fac, 'CEXYZ01-2');
  assert.equal(fila(deApp).responsable, 'Ana Gómez');
  assert.equal(fila(deExcel).cod_fac, null);
  assert.equal(fila(deExcel).responsable, null);
  assert.equal(fila(sinCodigo).cod_fac, null, 'sin ID de cliente no hay código');
  assert.equal(lista.length, 3, 'el unir con la cotización no repite ni pierde presupuestos');
});
