const express = require('express');
const multer = require('multer');
const { requireAuth } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const cotizaciones = require('../services/cotizacionesService');
const pdfService = require('../services/cotizacionPdfService');
const adjuntosService = require('../services/cotizacionAdjuntosService');
const { errorHttp } = require('../services/catalogoCalculoService');

const router = express.Router();

router.use(requireAuth);

const subidaAdjunto = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: adjuntosService.TAMANO_MAXIMO, files: 1 },
});

function traducirErrorDeSubida(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') return errorHttp(400, `El archivo pesa más de ${adjuntosService.TAMANO_MAXIMO / 1024 / 1024} MB`);
  if (err && err.name === 'MulterError') return errorHttp(400, 'Subí un solo archivo, en el campo "archivo"');
  return err;
}

// --- Datos auxiliares (antes de las rutas con :id) ---------------------------------------------

router.get('/opciones', (req, res) => {
  res.json(cotizaciones.opciones());
});

router.get('/catalogo/buscar', (req, res) => {
  res.json(cotizaciones.buscarCatalogo({ q: req.query.q, versionId: req.query.version }));
});

// --- Adjuntos (croquis, planos) ---------------------------------------------------------------

router.get('/adjuntos/:adjuntoId/archivo', (req, res) => {
  const { ruta, mime } = adjuntosService.archivoDe(Number(req.params.adjuntoId));
  res.setHeader('Content-Type', mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.sendFile(ruta);
});

router.put('/adjuntos/:adjuntoId', bloquearSiSoloEstado, (req, res) => {
  const { titulo, incluir_en_pdf } = req.body || {};
  res.json(cotizaciones.obtener(adjuntosService.actualizar(Number(req.params.adjuntoId), { titulo, incluir_en_pdf })));
});

router.delete('/adjuntos/:adjuntoId', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.obtener(adjuntosService.quitar(Number(req.params.adjuntoId))));
});

// --- Ítems de un presupuesto -------------------------------------------------------------------

router.put('/lineas/:lineaId', bloquearSiSoloEstado, (req, res) => {
  const { cantidad, precio_unitario, comentario } = req.body || {};
  res.json(cotizaciones.actualizarLinea(Number(req.params.lineaId), { cantidad, precio_unitario, comentario }));
});

router.delete('/lineas/:lineaId', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.borrarLinea(Number(req.params.lineaId)));
});

// --- Presupuestos ------------------------------------------------------------------------------

router.get('/', (req, res) => {
  const { estado, eventoId, presupuestoId, q } = req.query;
  res.json(cotizaciones.listar({ estado: estado || undefined, eventoId: eventoId || undefined, presupuestoId: presupuestoId || undefined, q }));
});

router.post('/', bloquearSiSoloEstado, (req, res) => {
  res.status(201).json(cotizaciones.crear(req.body || {}, req.usuario));
});

router.get('/:id', (req, res) => {
  res.json(cotizaciones.obtener(Number(req.params.id)));
});

router.put('/:id', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.actualizar(Number(req.params.id), req.body || {}, req.usuario));
});

router.delete('/:id', bloquearSiSoloEstado, (req, res) => {
  cotizaciones.eliminar(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/:id/duplicar', bloquearSiSoloEstado, (req, res) => {
  res.status(201).json(cotizaciones.duplicar(Number(req.params.id), req.usuario));
});

router.post('/:id/lineas', bloquearSiSoloEstado, (req, res) => {
  const { catalogo_item_id, cantidad, comentario } = req.body || {};
  res.status(201).json(cotizaciones.agregarLinea(Number(req.params.id), { catalogo_item_id, cantidad, comentario }));
});

router.post('/:id/adjuntos', bloquearSiSoloEstado, (req, res, next) => {
  subidaAdjunto.single('archivo')(req, res, async (err) => {
    if (err) return next(traducirErrorDeSubida(err));
    try {
      if (!req.file) throw errorHttp(400, 'Elegí un archivo para adjuntar');
      const id = Number(req.params.id);
      await adjuntosService.agregar(id, { bytes: req.file.buffer, nombre: req.file.originalname, titulo: req.body && req.body.titulo }, req.usuario);
      return res.status(201).json(cotizaciones.obtener(id));
    } catch (e) {
      return next(e);
    }
  });
});

router.post('/:id/lista', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.aplicarLista(Number(req.params.id), (req.body || {}).version_id));
});

router.post('/:id/descuento', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.aplicarDescuento(Number(req.params.id), (req.body || {}).descuento_porcentaje));
});

router.post('/:id/confirmar', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.confirmar(Number(req.params.id), req.usuario));
});

router.post('/:id/rechazar', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.rechazar(Number(req.params.id), req.usuario));
});

router.post('/:id/reabrir', bloquearSiSoloEstado, (req, res) => {
  res.json(cotizaciones.reabrir(Number(req.params.id)));
});

// ?ver=1 lo abre en el navegador en vez de descargarlo.
router.get('/:id/pdf', async (req, res, next) => {
  try {
    await pdfService.streamPdf(res, Number(req.params.id), { enLinea: req.query.ver === '1' });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
