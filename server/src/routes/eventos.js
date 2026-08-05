const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const eventosService = require('../services/eventosService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const { desde, hasta } = req.query;
  res.json(eventosService.listar({ desde, hasta }));
});

router.get('/:id', (req, res) => {
  const evento = eventosService.obtenerDetalle(Number(req.params.id));
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(evento);
});

router.get('/:id/totales', (req, res) => {
  const evento = eventosService.obtener(Number(req.params.id));
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(eventosService.totalesPorEvento(Number(req.params.id)));
});

router.post('/', (req, res) => {
  const { nombre, lugar, fecha_inicio, fecha_fin, notas } = req.body || {};
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Nombre, fecha de inicio y fecha de fin son obligatorios' });
  }
  const evento = eventosService.crear({ nombre, lugar, fecha_inicio, fecha_fin, notas, creadoPor: req.usuario.id });
  res.status(201).json(evento);
});

router.put('/:id', (req, res) => {
  const { nombre, lugar, fecha_inicio, fecha_fin, notas } = req.body || {};
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Nombre, fecha de inicio y fecha de fin son obligatorios' });
  }
  res.json(eventosService.actualizar(Number(req.params.id), { nombre, lugar, fecha_inicio, fecha_fin, notas }));
});

router.delete('/:id', (req, res) => {
  eventosService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
