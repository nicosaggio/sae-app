const path = require('path');
const express = require('express');
const session = require('express-session');

const authRoutes = require('./routes/auth');
const eventosRoutes = require('./routes/eventos');
const lotesRoutes = require('./routes/lotes');
const productosRoutes = require('./routes/productos');
const presupuestosRoutes = require('./routes/presupuestos');
const exportRoutes = require('./routes/export');
const usuariosRoutes = require('./routes/usuarios');
const catalogoRoutes = require('./routes/catalogo');
const cotizacionesRoutes = require('./routes/cotizaciones');
const clientesRoutes = require('./routes/clientes');

const CLIENT_DIST = path.join(__dirname, '..', '..', 'client', 'dist');

function createApp() {
  const app = express();

  // La app puede estar detrás de un túnel (cloudflared) que corre en esta misma PC: de ahí llegan la IP
  // real del visitante y el "https" en los encabezados X-Forwarded-*. Sólo se les cree si vienen de
  // la propia PC; los de la red local no pueden falsearlos.
  app.set('trust proxy', 'loopback');

  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
    next();
  });

  app.use(express.json());
  app.use(
    session({
      name: 'saeapp.sid',
      secret: process.env.SESSION_SECRET || 'saeapp-lan-dev-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        // Con https (por el túnel) la cookie va marcada Secure; por la red local, con http, sigue andando normal.
        secure: 'auto',
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
  app.use('/api/usuarios', usuariosRoutes);
  app.use('/api/catalogo', catalogoRoutes);
  app.use('/api/cotizaciones', cotizacionesRoutes);
  app.use('/api/clientes', clientesRoutes);

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
    // Los errores 4xx son mensajes pensados para el usuario; los 500 pueden traer rutas del servidor o SQL,
    // que se dejan en el log y no se muestran.
    res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message || 'Error' });
  });

  return app;
}

module.exports = { createApp };
