const express = require('express');
const bcrypt = require('bcryptjs');
const { db } = require('../db/connection');
const { requireAuth } = require('../middleware/requireAuth');
const limiteLogin = require('../middleware/limiteLogin');

const router = express.Router();

router.post('/login', (req, res, next) => {
  const espera = limiteLogin.segundosDeEspera(req.ip);
  if (espera > 0) {
    res.set('Retry-After', String(espera));
    return res.status(429).json({ error: `Demasiados intentos fallidos. Probá de nuevo en ${Math.ceil(espera / 60)} minuto(s).` });
  }

  const { nombre_usuario, password } = req.body || {};
  if (!nombre_usuario || !password) {
    return res.status(400).json({ error: 'Usuario y contraseña son obligatorios' });
  }

  const usuario = db
    .prepare('SELECT * FROM usuarios WHERE nombre_usuario = ?')
    .get(nombre_usuario);

  if (!usuario || !usuario.activo || !bcrypt.compareSync(password, usuario.password_hash)) {
    limiteLogin.registrarFallo(req.ip);
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos' });
  }

  limiteLogin.limpiar(req.ip);
  // Sesión nueva en cada login: así un identificador de sesión que alguien haya podido plantar antes de
  // que la persona entrara no sirve después (fijación de sesión).
  req.session.regenerate((err) => {
    if (err) return next(err);
    req.session.userId = usuario.id;
    res.json({
      id: usuario.id,
      nombre_usuario: usuario.nombre_usuario,
      nombre_completo: usuario.nombre_completo,
      rol: usuario.rol,
      solo_estado: !!usuario.solo_estado,
    });
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
