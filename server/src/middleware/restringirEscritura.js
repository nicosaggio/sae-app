/**
 * Middleware de ruta (no de router — varios routers comparten el prefijo "/api", así que
 * un `router.use()` sin path se dispara para pedidos de OTRO router también). Se agrega
 * como segundo argumento en cada ruta de escritura que un usuario `solo_estado=1` NO
 * puede usar (todas, salvo el cambio de estado de un presupuesto).
 */
function bloquearSiSoloEstado(req, res, next) {
  if (req.usuario.solo_estado) {
    return res.status(403).json({ error: 'Tu usuario solo puede cambiar el estado de los presupuestos' });
  }
  next();
}

module.exports = { bloquearSiSoloEstado };
