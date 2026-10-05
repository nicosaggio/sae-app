// La lista de presupuestos confirmados sale del más reciente al más antiguo (por la fecha del presupuesto).
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
