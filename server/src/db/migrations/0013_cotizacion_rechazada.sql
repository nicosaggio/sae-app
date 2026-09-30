-- Agrega 'rechazada' al enum de estado de las cotizaciones (presupuestos cargados desde la app que
-- todavía no se confirmaron) y columnas de auditoría (quién y cuándo), simétricas a confirmada_por /
-- confirmada_en. SQLite no permite modificar un CHECK existente con ALTER TABLE, así que se reconstruye
-- la tabla preservando todas las columnas y todos los índices (mismo patrón que 0004).
CREATE TABLE cotizaciones_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'confirmada', 'rechazada')),
  evento_id INTEGER REFERENCES eventos(id) ON DELETE SET NULL,
  tipo TEXT,
  lote TEXT,
  nombre_stand TEXT,
  contacto TEXT,
  mail TEXT,
  telefono TEXT,
  razon_social TEXT,
  cuit TEXT,
  direccion TEXT,
  responsable_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  responsable TEXT,
  fecha_carga TEXT NOT NULL,
  id_cliente TEXT,
  numero INTEGER,
  catalogo_version_id INTEGER REFERENCES catalogo_versiones(id) ON DELETE SET NULL,
  iva_porcentaje REAL NOT NULL DEFAULT 0.21 CHECK(iva_porcentaje >= 0 AND iva_porcentaje <= 1),
  notas TEXT,
  presupuesto_id INTEGER REFERENCES presupuestos(id) ON DELETE SET NULL,
  confirmada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  confirmada_en TEXT,
  rechazada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  rechazada_en TEXT,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL
);

INSERT INTO cotizaciones_nueva
  (id, estado, evento_id, tipo, lote, nombre_stand, contacto, mail, telefono, razon_social, cuit,
   direccion, responsable_id, responsable, fecha_carga, id_cliente, numero, catalogo_version_id,
   iva_porcentaje, notas, presupuesto_id, confirmada_por, confirmada_en, creado_por, creado_en,
   actualizado_en, cliente_id)
  SELECT
   id, estado, evento_id, tipo, lote, nombre_stand, contacto, mail, telefono, razon_social, cuit,
   direccion, responsable_id, responsable, fecha_carga, id_cliente, numero, catalogo_version_id,
   iva_porcentaje, notas, presupuesto_id, confirmada_por, confirmada_en, creado_por, creado_en,
   actualizado_en, cliente_id
  FROM cotizaciones;

DROP TABLE cotizaciones;
ALTER TABLE cotizaciones_nueva RENAME TO cotizaciones;

CREATE INDEX idx_cotizaciones_estado ON cotizaciones(estado);
CREATE INDEX idx_cotizaciones_evento ON cotizaciones(evento_id);
CREATE INDEX idx_cotizaciones_id_cliente ON cotizaciones(id_cliente, numero);
CREATE INDEX idx_cotizaciones_cliente ON cotizaciones(cliente_id);
