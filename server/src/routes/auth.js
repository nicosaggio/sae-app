const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();

router.post('/login', (req, res) => {
  const { nombre_usuario, password } = req.body || {};
  if (!nombre_usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }

  const usuario = db
    .prepare('SELECT * FROM usuarios WHERE nombre_usuario = ?')
    .get(nombre_usuario);

  if (!usuario || !usuario.activo || !bcrypt.compareSync(password, usuario.password_hash)) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  req.session.userId = usuario.id;
  res.json({
    id: usuario.id,
    nombre_usuario: usuario.nombre_usuario,
    nombre_completo: usuario.nombre_completo,
    rol: usuario.rol,
  });
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ ok: true });
  });
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.usuario);
});

module.exports = router;
