const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const lotesService = require('../services/lotesService');

const router = express.Router();

router.use(requireAuth);

router.post('/eventos/:eventoId/lotes', bloquearSiSoloEstado, (req, res) => {
  const { codigo, expositor, contacto } = req.body || {};
  if (!codigo) {
    return res.status(400).json({ error: 'El código de lote es obligatorio' });
  }
  const lote = lotesService.crear({ eventoId: Number(req.params.eventoId), codigo, expositor, contacto });
  res.status(201).json({ ...lote, presupuestos: [] });
});

router.put('/lotes/:id', bloquearSiSoloEstado, (req, res) => {
  const { codigo, expositor, contacto } = req.body || {};
  if (!codigo) {
    return res.status(400).json({ error: 'El código de lote es obligatorio' });
  }
  res.json(lotesService.editar({ loteId: Number(req.params.id), codigo, expositor, contacto }));
});

router.delete('/lotes/:id', bloquearSiSoloEstado, (req, res) => {
  lotesService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
