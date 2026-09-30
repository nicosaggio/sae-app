const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const clientes = require('../services/clientesService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  res.json(clientes.listar({ q: req.query.q }));
});

// Para el autocompletado del formulario de presupuestos
router.get('/buscar', (req, res) => {
  res.json(clientes.buscar(req.query.q, req.query.limite));
});

// Dice si un CUIT es válido y, si ya lo tenemos, devuelve el cliente
router.get('/por-cuit/:cuit', (req, res) => {
  res.json(clientes.porCuit(req.params.cuit));
});

router.put('/:id', bloquearSiSoloEstado, (req, res) => {
  res.json(clientes.actualizar(Number(req.params.id), req.body || {}));
});

router.delete('/:id', bloquearSiSoloEstado, (req, res) => {
  clientes.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
