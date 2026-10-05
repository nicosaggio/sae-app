const express = require('express');
const { requireAuth, requireAdmin } = require('../middleware/requireAuth');
const usuariosService = require('../services/usuariosService');

const router = express.Router();

// Con la app accesible desde Internet una clave de 4 caracteres es demasiado débil.
const CLAVE_MINIMA = 8;

router.use(requireAuth);
router.use(requireAdmin);

router.get('/', (req, res) => {
  res.json(usuariosService.listar());
});

router.post('/', (req, res) => {
  const { nombre_usuario, password, nombre_completo, rol, solo_estado } = req.body || {};
  if (!nombre_usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }
  if (typeof password !== 'string' || password.length < CLAVE_MINIMA) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres` });
  }
  res.status(201).json(usuariosService.crear({ nombre_usuario, password, nombre_completo, rol, solo_estado }));
});

router.put('/:id', (req, res) => {
  const { nombre_completo, rol, activo, solo_estado } = req.body || {};
  if (Number(req.params.id) === req.usuario.id && activo === false) {
    return res.status(400).json({ error: 'No podés desactivar tu propio usuario' });
  }
  res.json(usuariosService.actualizar(Number(req.params.id), { nombre_completo, rol, activo, solo_estado }));
});

router.post('/:id/password', (req, res) => {
  const { password } = req.body || {};
  if (typeof password !== 'string' || password.length < CLAVE_MINIMA) {
    return res.status(400).json({ error: `La contraseña debe tener al menos ${CLAVE_MINIMA} caracteres` });
  }
  usuariosService.cambiarPassword(Number(req.params.id), password);
  res.json({ ok: true });
});

module.exports = router;
