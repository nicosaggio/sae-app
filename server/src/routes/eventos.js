const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const eventosService = require('../services/eventosService');

const router = express.Router();

router.use(requireAuth);

router.get('/', (req, res) => {
  const { desde, hasta, sin_fecha, con_presupuestos } = req.query;
  res.json(
    eventosService.listar({
      desde,
      hasta,
      sinFecha: sin_fecha === '1',
      conPresupuestos: con_presupuestos === '1',
    })
  );
});

// Va antes de '/:id', que si no lo tomaría como un id.
router.get('/facturacion-anual', (req, res) => {
  const anios = eventosService.aniosConPresupuestos();
  const pedido = req.query.anio;
  if (pedido !== undefined && !/^\d{4}$/.test(String(pedido))) return res.status(400).json({ error: 'El año tiene que ser de 4 cifras (ej. 2026)' });
  // Sin año: el actual si tiene presupuestos, y si no el más reciente que tenga.
  const actual = new Date().getFullYear();
  const anio = pedido !== undefined ? Number(pedido) : anios.includes(actual) ? actual : anios[0] || actual;
  res.json({ ...eventosService.facturacionAnual(anio), anios });
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

router.get('/:id/facturacion', (req, res) => {
  const evento = eventosService.obtener(Number(req.params.id));
  if (!evento) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(eventosService.facturacionPorEvento(Number(req.params.id)));
});

router.post('/', bloquearSiSoloEstado, (req, res) => {
  const { nombre, lugar, fecha_inicio, fecha_fin, notas, fecha_armado, fecha_desarme } = req.body || {};
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Nombre, fecha de inicio y fecha de fin son obligatorios' });
  }
  const evento = eventosService.crear({
    nombre,
    lugar,
    fecha_inicio,
    fecha_fin,
    notas,
    creadoPor: req.usuario.id,
    fecha_armado,
    fecha_desarme,
  });
  res.status(201).json(evento);
});

router.put('/:id', bloquearSiSoloEstado, (req, res) => {
  const { nombre, lugar, fecha_inicio, fecha_fin, notas, fecha_armado, fecha_desarme } = req.body || {};
  if (!nombre || !fecha_inicio || !fecha_fin) {
    return res.status(400).json({ error: 'Nombre, fecha de inicio y fecha de fin son obligatorios' });
  }
  res.json(
    eventosService.actualizar(Number(req.params.id), {
      nombre,
      lugar,
      fecha_inicio,
      fecha_fin,
      notas,
      fecha_armado,
      fecha_desarme,
    })
  );
});

router.delete('/:id', bloquearSiSoloEstado, (req, res) => {
  eventosService.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/:id/fusionar', bloquearSiSoloEstado, (req, res) => {
  const { otroEventoId } = req.body || {};
  if (!otroEventoId) return res.status(400).json({ error: 'Falta otroEventoId' });
  res.json(eventosService.fusionar(Number(req.params.id), Number(otroEventoId)));
});

module.exports = router;
