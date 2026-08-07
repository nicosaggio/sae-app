const { db } = require('../db/connection');

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  const usuario = db
    .prepare('SELECT id, nombre_usuario, nombre_completo, rol, activo, solo_estado FROM usuarios WHERE id = ?')
    .get(req.session.userId);
  if (!usuario || !usuario.activo) {
    return res.status(401).json({ error: 'No autenticado' });
  }
  req.usuario = usuario;
  next();
}

function requireAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') {
    return res.status(403).json({ error: 'Requiere permisos de administrador' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
