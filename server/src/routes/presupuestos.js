const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const presupuestosService = require('../services/presupuestosService');

const router = express.Router();

router.use(requireAuth);

router.get('/presupuestos', (req, res) => {
  const { confirmado, estado, eventoId, desde, hasta } = req.query;
  res.json(
    presupuestosService.listar({
      confirmado: confirmado === undefined ? true : confirmado === '1',
      estado: estado || undefined,
      eventoId: eventoId ? Number(eventoId) : undefined,
      desde,
      hasta,
    })
  );
});

router.get('/presupuestos/alertas', (req, res) => {
  res.json(presupuestosService.alertasPago());
});

router.get('/presupuestos/:id', (req, res) => {
  const presupuesto = presupuestosService.obtener(Number(req.params.id));
  if (!presupuesto) return res.status(404).json({ error: 'Presupuesto no encontrado' });
  res.json(presupuesto);
});

router.get('/lotes/:loteId/presupuestos', (req, res) => {
  res.json(presupuestosService.listarPorLote(Number(req.params.loteId)));
});

router.post('/lotes/:loteId/presupuestos', (req, res) => {
  const { numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado } = req.body || {};
  const presupuesto = presupuestosService.crear({
    loteId: Number(req.params.loteId),
    numero,
    fecha,
    cliente_nombre,
    cliente_contacto,
    condiciones_pago,
    monto_total,
    notas,
    confirmado,
  });
  res.status(201).json({ ...presupuesto, lineas: [] });
});

router.put('/presupuestos/:id', (req, res) => {
  const { numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total, notas, confirmado } = req.body || {};
  res.json(
    presupuestosService.actualizar(Number(req.params.id), {
      numero,
      fecha,
      cliente_nombre,
      cliente_contacto,
      condiciones_pago,
      monto_total,
      notas,
      confirmado,
    })
  );
});

router.patch('/presupuestos/:id/estado', (req, res) => {
  const { estado } = req.body || {};
  res.json(presupuestosService.cambiarEstado(Number(req.params.id), estado));
});

router.delete('/presupuestos/:id', (req, res) => {
  presupuestosService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/presupuestos/:id/lineas', (req, res) => {
  const { producto_id, cantidad, comentario } = req.body || {};
  if (!producto_id || !cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'producto_id y cantidad (mayor a 0) son obligatorios' });
  }
  const resultado = presupuestosService.guardarLinea({
    presupuestoId: Number(req.params.id),
    productoId: Number(producto_id),
    cantidad: Number(cantidad),
    comentario: comentario || null,
  });
  res.status(201).json(resultado);
});

router.put('/presupuesto-lineas/:id', (req, res) => {
  const { cantidad } = req.body || {};
  if (!cantidad || cantidad <= 0) {
    return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
  }
  res.json(presupuestosService.actualizarLinea({ lineaId: Number(req.params.id), cantidad: Number(cantidad) }));
});

router.delete('/presupuesto-lineas/:id', (req, res) => {
  presupuestosService.borrarLinea(Number(req.params.id));
  res.json({ ok: true });
});

module.exports = router;
