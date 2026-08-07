const express = require('express');
const { db } = require('../db/connection');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const excelImportService = require('../services/excelImportService');
const eventosService = require('../services/eventosService');

const router = express.Router();

router.use(requireAuth);

function contextoPresupuesto(presupuestoId) {
  if (!presupuestoId) return null;
  return db
    .prepare(
      `SELECT pr.*, l.codigo AS lote_codigo, l.expositor AS lote_expositor, e.nombre AS evento_nombre
       FROM presupuestos pr JOIN lotes l ON l.id = pr.lote_id JOIN eventos e ON e.id = l.evento_id
       WHERE pr.id = ?`
    )
    .get(presupuestoId);
}

router.get('/pendientes', (req, res) => {
  const filas = db.prepare('SELECT * FROM import_pendientes WHERE resuelto = 0 ORDER BY id DESC').all();
  const resultado = filas.map((p) => {
    if (p.tipo === 'evento_ambiguo') {
      return { ...p, datos: JSON.parse(p.datos_json) };
    }
    return {
      ...p,
      huerfano: contextoPresupuesto(p.presupuesto_huerfano_id),
      nuevo: contextoPresupuesto(p.presupuesto_nuevo_id),
    };
  });
  res.json(resultado);
});

router.get('/estado', (req, res) => {
  const pendientes = db.prepare('SELECT COUNT(*) AS n FROM import_pendientes WHERE resuelto = 0').get().n;
  const eventosSinFecha = db.prepare("SELECT COUNT(*) AS n FROM eventos WHERE fecha_inicio = ''").get().n;
  res.json({ carpeta: excelImportService.CARPETA, pendientes, eventosSinFecha, total: pendientes + eventosSinFecha });
});

router.post('/pendientes/:id/resolver-reemplazo', bloquearSiSoloEstado, (req, res) => {
  const pendiente = db.prepare('SELECT * FROM import_pendientes WHERE id = ?').get(req.params.id);
  if (!pendiente) return res.status(404).json({ error: 'Pendiente no encontrado' });
  if (pendiente.tipo !== 'posible_reemplazo') return res.status(400).json({ error: 'Tipo de pendiente inválido' });

  db.prepare('DELETE FROM presupuestos WHERE id = ?').run(pendiente.presupuesto_huerfano_id);
  db.prepare("UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE id = ?").run(pendiente.id);
  res.json({ ok: true });
});

router.post('/pendientes/:id/resolver-independiente', bloquearSiSoloEstado, (req, res) => {
  const pendiente = db.prepare('SELECT * FROM import_pendientes WHERE id = ?').get(req.params.id);
  if (!pendiente) return res.status(404).json({ error: 'Pendiente no encontrado' });

  db.prepare("UPDATE import_pendientes SET resuelto = 1, resuelto_en = datetime('now') WHERE id = ?").run(pendiente.id);
  res.json({ ok: true });
});

router.post('/pendientes/:id/vincular-evento', bloquearSiSoloEstado, (req, res) => {
  const { evento_id } = req.body || {};
  if (!evento_id) return res.status(400).json({ error: 'evento_id es obligatorio' });

  const presupuestoId = excelImportService.materializarPendiente(Number(req.params.id), Number(evento_id));
  res.json({ ok: true, presupuesto_id: presupuestoId });
});

router.post('/pendientes/:id/crear-evento', bloquearSiSoloEstado, (req, res) => {
  const { nombre, lugar, fecha_inicio, fecha_fin } = req.body || {};
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Nombre, fecha de inicio y fecha de fin son obligatorios' });
  }

  const evento = eventosService.crear({ nombre, lugar, fecha_inicio, fecha_fin, notas: null, creadoPor: req.usuario.id });
  const presupuestoId = excelImportService.materializarPendiente(Number(req.params.id), evento.id);
  res.json({ ok: true, evento, presupuesto_id: presupuestoId });
});

router.post('/escanear-ahora', bloquearSiSoloEstado, (req, res) => {
  const resultado = excelImportService.escanear();
  res.json(resultado);
});

module.exports = router;
