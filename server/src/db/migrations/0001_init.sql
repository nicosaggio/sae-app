CREATE TABLE usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre_usuario TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  nombre_completo TEXT,
  rol TEXT NOT NULL DEFAULT 'operador' CHECK(rol IN ('admin', 'operador')),
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE eventos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  lugar TEXT,
  fecha_inicio TEXT NOT NULL,
  fecha_fin TEXT NOT NULL CHECK(fecha_fin >= fecha_inicio),
  notas TEXT,
  creado_por INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_eventos_fechas ON eventos(fecha_inicio, fecha_fin);

CREATE TABLE lotes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  expositor TEXT,
  contacto TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(evento_id, codigo)
);

CREATE INDEX idx_lotes_evento ON lotes(evento_id);

CREATE TABLE productos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL UNIQUE,
  nombre TEXT NOT NULL,
  rubro TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_productos_rubro ON productos(rubro);
CREATE INDEX idx_productos_activo ON productos(activo);

CREATE TABLE presupuestos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id INTEGER NOT NULL REFERENCES lotes(id) ON DELETE CASCADE,
  numero TEXT,
  fecha TEXT,
  cliente_nombre TEXT,
  cliente_contacto TEXT,
  condiciones_pago TEXT,
  monto_total REAL,
  notas TEXT,
  confirmado INTEGER NOT NULL DEFAULT 0,
  estado TEXT NOT NULL DEFAULT 'pendiente_facturar'
    CHECK(estado IN ('pendiente_facturar', 'facturado', 'pendiente_pago', 'cobrado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_presupuestos_lote ON presupuestos(lote_id);
CREATE INDEX idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX idx_presupuestos_confirmado ON presupuestos(confirmado);

CREATE TABLE presupuesto_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  presupuesto_id INTEGER NOT NULL REFERENCES presupuestos(id) ON DELETE CASCADE,
  producto_id INTEGER NOT NULL REFERENCES productos(id) ON DELETE RESTRICT,
  cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  comentario TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(presupuesto_id, producto_id)
);

CREATE INDEX idx_presupuesto_lineas_presupuesto ON presupuesto_lineas(presupuesto_id);
CREATE INDEX idx_presupuesto_lineas_producto ON presupuesto_lineas(producto_id);
