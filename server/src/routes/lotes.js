const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const { transaction } = require('../db/connection');
const lotesService = require('../services/lotesService');
const cotizacionesService = require('../services/cotizacionesService');
const croquisService = require('../services/croquisService');

const router = express.Router();

router.use(requireAuth);

// El número nuevo de un lote también llega a los presupuestos de la app ya confirmados en él
function conPresupuestosAlDia(lote) {
  cotizacionesService.actualizarLoteDeConfirmadas(lote.id, lote.codigo);
  return lote;
}

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
  res.json(transaction(() => conPresupuestosAlDia(lotesService.editar({ loteId: Number(req.params.id), codigo, expositor, contacto }))));
});

// Cambia sólo el número (desde el presupuesto confirmado, en la lista de Presupuestos): el expositor y el
// contacto del lote no se tocan.
router.put('/lotes/:id/codigo', bloquearSiSoloEstado, (req, res) => {
  const codigo = String(req.body?.codigo ?? '').trim();
  if (!codigo) {
    return res.status(400).json({ error: 'El número de lote es obligatorio' });
  }
  res.json(transaction(() => conPresupuestosAlDia(lotesService.cambiarCodigo({ loteId: Number(req.params.id), codigo }))));
});

router.delete('/lotes/:id', bloquearSiSoloEstado, (req, res) => {
  lotesService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

router.get('/lotes/:id/croquis', (req, res) => {
  res.json(croquisService.obtener(Number(req.params.id)));
});

router.put('/lotes/:id/croquis', bloquearSiSoloEstado, (req, res) => {
  res.json(croquisService.guardar(Number(req.params.id), req.body || {}, req.usuario));
});

router.delete('/lotes/:id/croquis', bloquearSiSoloEstado, (req, res) => {
  croquisService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
