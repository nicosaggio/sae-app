const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const eventosRoutes = require('./routes/eventos');
const lotesRoutes = require('./routes/lotes');
const productosRoutes = require('./routes/productos');
const presupuestosRoutes = require('./routes/presupuestos');
const exportRoutes = require('./routes/export');
const importacionesRoutes = require('./routes/importaciones');
const usuariosRoutes = require('./routes/usuarios');
const catalogoRoutes = require('./routes/catalogo');

const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

function createApp() {
  const app = express();

  app.use(express.json());
  app.use(
    session({
      name: 'saeapp.sid',
      secret: process.env.SESSION_SECRET || 'saeapp-lan-dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        maxAge: 30 * 24 * 60 * 60 * 1000,
      },
    })
  );

  app.get('/api/health', (req, res) => {
    res.json({ ok: true });
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/eventos', eventosRoutes);
  app.use('/api', lotesRoutes);
  app.use('/api/productos', productosRoutes);
  app.use('/api', presupuestosRoutes);
  app.use('/api', exportRoutes);
  app.use('/api/importaciones', importacionesRoutes);
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/catalogo', catalogoRoutes);

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'No encontrado' });
  });

  app.use(express.static(CLIENT_DIST));
  app.get(/^\/(?!api).*/, (req, res) => {
    res.sendFile(path.join(CLIENT_DIST, 'index.html'));
  });

  app.use((err, req, res, next) => {
    console.error(err);
    const esRestriccionDb = err.code === 'ERR_SQLITE_ERROR' && /constraint/i.test(err.message);
    const status = err.status || (esRestriccionDb ? 400 : 500);
    res.status(status).json({ error: err.message || 'Error interno' });
  });

  return app;
}

module.exports = { createApp };
