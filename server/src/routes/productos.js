const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const productosService = require('../services/productosService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const { rubro, activo } = req.query;
  res.json(productosService.listar({ rubro, activo: activo === undefined ? undefined : activo === '1' }));
});

router.post('/', bloquearSiSoloEstado, (req, res) => {
  const { codigo, nombre, rubro } = req.body || {};
  if (!codigo || !nombre) {
    return res.status(400).json({ error: 'Código y nombre son obligatorios' });
  }
  res.status(201).json(productosService.crear({ codigo, nombre, rubro }));
});

router.put('/:id', bloquearSiSoloEstado, (req, res) => {
  const { codigo, nombre, rubro, activo } = req.body || {};
  if (!codigo || !nombre) {
    return res.status(400).json({ error: 'Código y nombre son obligatorios' });
  }
  res.json(productosService.actualizar(Number(req.params.id), { codigo, nombre, rubro, activo }));
});

router.delete('/:id', bloquearSiSoloEstado, (req, res) => {
  productosService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
