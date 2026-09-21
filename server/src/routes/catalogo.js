const fs = require('fs');
const express = require('express');
const multer = require('multer');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const { bloquearSiSoloEstado } = require('../middleware/restringirEscritura');
const catalogoService = require('../services/catalogoService');
const versionesService = require('../services/catalogoVersionesService');
const baseService = require('../services/catalogoBaseService');
const catalogoPdfService = require('../services/catalogoPdfService');
const { leerBaseParche } = require('../services/catalogoImportService');
const { ejecutarBackup } = require('../services/backupService');
const { rutaDeImagen, guardarImagen } = require('../services/catalogoImagenService');

const router = express.Router();

router.use(requireAuth);

const TAMANO_MAXIMO = 20 * 1024 * 1024;
const subida = multer({
  storage: multer.memoryStorage(),
  defParamCharset: 'utf8',
  limits: { fileSize: TAMANO_MAXIMO, files: 1 },
  fileFilter: (req, archivo, cb) => {
    if (!/\.(xlsx|xlsm)$/i.test(archivo.originalname)) {
      const err = new Error('El archivo tiene que ser una planilla de Excel (.xlsx o .xlsm)');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

const subidaImagen = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024, files: 1 },
  fileFilter: (req, archivo, cb) => {
    if (!/^image\/(jpeg|png|gif)$/.test(archivo.mimetype)) {
      const err = new Error('La foto tiene que ser una imagen JPG, PNG o GIF');
      err.status = 400;
      return cb(err);
    }
    return cb(null, true);
  },
});

function traducirErrorDeSubida(err) {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    const e = new Error(err.field === 'imagen' ? 'La foto pesa más de 15 MB' : 'El archivo pesa más de 20 MB');
    e.status = 400;
    return e;
  }
  if (err && err.name === 'MulterError') {
    const e = new Error('Subí un solo archivo, en el campo correcto');
    e.status = 400;
    return e;
  }
  return err;
}

const id = (req) => Number(req.params.id);

// --- Ítems
router.get('/items', (req, res) => {
  const { rubro, publicado, q, estado, activo } = req.query;
  res.json(catalogoService.listarItems({ rubro, publicado, q, estado, activo }));
});
router.get('/items/:id', (req, res) => res.json(catalogoService.obtenerItem(id(req))));
router.post('/items', bloquearSiSoloEstado, (req, res) => res.status(201).json(catalogoService.crearItem(req.body || {})));
router.put('/items/:id', bloquearSiSoloEstado, (req, res) => res.json(catalogoService.actualizarItem(id(req), req.body || {})));
router.put('/items/:id/imagen', bloquearSiSoloEstado, (req, res, next) => {
  subidaImagen.single('imagen')(req, res, async (errorDeSubida) => {
    if (errorDeSubida) return next(traducirErrorDeSubida(errorDeSubida));
    if (!req.file) return next(Object.assign(new Error('Falta la foto (campo "imagen")'), { status: 400 }));
    try {
      const itemId = id(req);
      catalogoService.obtenerItem(itemId);
      let guardada;
      try {
        guardada = await guardarImagen(req.file.buffer);
      } catch {
        throw Object.assign(new Error('No se pudo leer la foto. ¿Es una imagen JPG, PNG o GIF válida?'), { status: 400 });
      }
      return res.json(catalogoService.asignarImagen(itemId, guardada.archivo));
    } catch (err) {
      return next(err);
    }
  });
});
router.delete('/items/:id', bloquearSiSoloEstado, (req, res) => res.json(catalogoService.eliminarItem(id(req))));

// --- Páginas (estructura del catálogo)
router.get('/paginas', (req, res) => res.json(catalogoService.obtenerPaginas(req.query.version === undefined ? undefined : Number(req.query.version))));
router.put('/paginas', bloquearSiSoloEstado, (req, res) => {
  const cuerpo = req.body || {};
  res.json(catalogoService.guardarPaginas(Array.isArray(cuerpo) ? cuerpo : cuerpo.paginas));
});

// --- Versiones
router.get('/versiones', (req, res) => res.json(versionesService.listarVersiones()));
router.get('/versiones/:id', (req, res) => res.json(versionesService.obtenerVersion(id(req))));
router.post('/versiones', bloquearSiSoloEstado, (req, res) => res.status(201).json(versionesService.crearVersion(req.body || {})));
router.post('/versiones/:id/duplicar', bloquearSiSoloEstado, (req, res) => res.status(201).json(versionesService.duplicarVersion(id(req), req.body || {})));
router.post('/versiones/:id/recalcular', bloquearSiSoloEstado, (req, res) => res.json(versionesService.recalcularVersion(id(req))));
router.put('/versiones/:id', bloquearSiSoloEstado, (req, res) => res.json(versionesService.actualizarVersion(id(req), req.body || {})));
router.delete('/versiones/:id', bloquearSiSoloEstado, (req, res) => {
  versionesService.eliminarVersion(id(req));
  res.json({ ok: true });
});
router.get('/versiones/:id/pdf', (req, res) => catalogoPdfService.streamPdf(res, id(req)));

// --- Ajustes y televisores
router.get('/ajustes', (req, res) => res.json(catalogoService.obtenerAjustes()));
router.put('/ajustes', requireAdmin, bloquearSiSoloEstado, (req, res) => res.json(catalogoService.actualizarAjustes(req.body || {})));
router.get('/televisores', (req, res) => res.json(catalogoService.obtenerTelevisores()));
router.put('/televisores', bloquearSiSoloEstado, (req, res) => res.json(catalogoService.actualizarTelevisores(req.body || {})));

// --- Actualización de precios desde la base parche (sólo admin): previsualizar y después confirmar
router.post('/importar', requireAdmin, bloquearSiSoloEstado, (req, res, next) => {
  subida.single('archivo')(req, res, (errorDeSubida) => {
    if (errorDeSubida) return next(traducirErrorDeSubida(errorDeSubida));
    if (!req.file) return next(Object.assign(new Error('Falta el archivo de la base parche (campo "archivo")'), { status: 400 }));
    try {
      const baseParche = leerBaseParche(req.file.buffer);
      return res.json(baseService.previsualizar(baseParche, { archivo: req.file.originalname, usuarioId: req.usuario.id }));
    } catch (err) {
      return next(err);
    }
  });
});

router.post('/importar/confirmar', requireAdmin, bloquearSiSoloEstado, async (req, res, next) => {
  try {
    const token = req.body && req.body.token;
    if (!token) return res.status(400).json({ error: 'Falta el token de la previsualización' });
    res.json(await baseService.confirmar(token, { usuarioId: req.usuario.id, hacerBackup: ejecutarBackup }));
  } catch (err) {
    next(err);
  }
});

router.get('/importaciones', (req, res) => res.json(catalogoService.listarImportaciones()));
router.get('/importaciones/:id', (req, res) => res.json(catalogoService.obtenerImportacion(id(req))));

// --- Imágenes
router.get('/imagenes/:archivo', (req, res) => {
  const ruta = rutaDeImagen(req.params.archivo);
  if (!ruta || !fs.existsSync(ruta)) {
    return res.status(404).json({ error: 'Imagen no encontrada' });
  }
  // El nombre es el hash del contenido: nunca cambia, así que el navegador puede guardarla.
  res.set('Cache-Control', 'private, max-age=86400, immutable');
  res.sendFile(ruta);
});

module.exports = router;
