const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const eventosService = require('../services/eventosService');
const informeAnualPdfService = require('../services/informeAnualPdfService');
const informeEventoPdfService = require('../services/informeEventoPdfService');

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

/** El año pedido en ?anio=; sin año, el actual si tiene presupuestos y si no el más reciente que tenga. Null si no es válido. */
function anioPedido(req, anios) {
  const pedido = req.query.anio;
  if (pedido === undefined) {
    const actual = new Date().getFullYear();
    return anios.includes(actual) ? actual : anios[0] || actual;
  }
  return /^\d{4}$/.test(String(pedido)) ? Number(pedido) : null;
}

const ERROR_ANIO = { error: 'El año tiene que ser de 4 cifras (ej. 2026)' };

/** El mes pedido en ?mes= (1 a 12). Sin mes, undefined (todo el año). Null si no es válido. */
function mesPedido(req) {
  const pedido = req.query.mes;
  if (pedido === undefined || pedido === '') return undefined;
  return /^(0?[1-9]|1[0-2])$/.test(String(pedido)) ? Number(pedido) : null;
}

const ERROR_MES = { error: 'El mes tiene que ser un número de 1 a 12' };

// Estas van antes de '/:id', que si no las tomaría como un id.
router.get('/facturacion-anual', (req, res) => {
  const anios = eventosService.aniosConPresupuestos();
  const anio = anioPedido(req, anios);
  if (anio === null) return res.status(400).json(ERROR_ANIO);
  const mes = mesPedido(req);
  if (mes === null) return res.status(400).json(ERROR_MES);
  res.json({ ...eventosService.facturacionAnual(anio, { mes }), anios });
});

// El informe del año (o de un mes) para imprimir: se abre en el visor de PDF del navegador.
router.get('/facturacion-anual/pdf', async (req, res, next) => {
  try {
    const anio = anioPedido(req, eventosService.aniosConPresupuestos());
    if (anio === null) return res.status(400).json(ERROR_ANIO);
    const mes = mesPedido(req);
    if (mes === null) return res.status(400).json(ERROR_MES);
    await informeAnualPdfService.streamPdf(res, anio, { mes });
  } catch (err) {
    next(err);
  }
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

// El informe de un evento: total, totales por rubro (con sus productos) y pedidos por lote.
router.get('/:id/facturacion/informe', (req, res) => {
  const informe = eventosService.informeFacturacionEvento(Number(req.params.id));
  if (!informe) return res.status(404).json({ error: 'Evento no encontrado' });
  res.json(informe);
});

// El mismo informe para imprimir. ?vista=rubro (por defecto) trae el detalle de cada rubro; ?vista=lote, los pedidos por lote.
router.get('/:id/facturacion/pdf', async (req, res, next) => {
  try {
    const vista = req.query.vista === undefined ? 'rubro' : String(req.query.vista);
    if (!informeEventoPdfService.VISTAS.includes(vista)) return res.status(400).json({ error: "La vista tiene que ser 'rubro' o 'lote'" });
    const informe = eventosService.informeFacturacionEvento(Number(req.params.id));
    if (!informe) return res.status(404).json({ error: 'Evento no encontrado' });
    await informeEventoPdfService.streamPdf(res, informe, vista);
  } catch (err) {
    next(err);
  }
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
