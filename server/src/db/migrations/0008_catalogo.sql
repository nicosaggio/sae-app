CREATE TABLE catalogo_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo TEXT NOT NULL,
  rubro TEXT,
  descripcion TEXT,
  descripcion_catalogo TEXT,
  descripcion_formato TEXT,
  unidad TEXT,
  regla_tipo TEXT NOT NULL DEFAULT 'sin_precio'
    CHECK(regla_tipo IN ('base', 'derivado', 'manual', 'proporcional', 'razon', 'sin_precio')),
  regla_codigo_base TEXT,
  regla_item_ref_id INTEGER REFERENCES catalogo_items(id) ON DELETE RESTRICT,
  regla_item_ref2_id INTEGER REFERENCES catalogo_items(id) ON DELETE RESTRICT,
  regla_item_ref3_id INTEGER REFERENCES catalogo_items(id) ON DELETE RESTRICT,
  regla_factor REAL,
  regla_num REAL,
  regla_den REAL,
  valor_manual REAL,
  suma_adicional_pie INTEGER NOT NULL DEFAULT 0 CHECK(suma_adicional_pie IN (0, 1)),
  porcentaje REAL CHECK(porcentaje IS NULL OR porcentaje >= 0),
  pase_parche REAL,
  sae INTEGER,
  estado_precio TEXT NOT NULL DEFAULT 'sin_calcular'
    CHECK(estado_precio IN ('sin_calcular', 'ok', 'sin_precio', 'error')),
  motivo_precio TEXT,
  publicado INTEGER NOT NULL DEFAULT 0 CHECK(publicado IN (0, 1)),
  imagen TEXT,
  producto_id INTEGER REFERENCES productos(id) ON DELETE SET NULL,
  activo INTEGER NOT NULL DEFAULT 1 CHECK(activo IN (0, 1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_catalogo_items_codigo ON catalogo_items(codigo COLLATE NOCASE);
CREATE INDEX idx_catalogo_items_rubro ON catalogo_items(rubro);
CREATE INDEX idx_catalogo_items_publicado ON catalogo_items(publicado);
CREATE INDEX idx_catalogo_items_producto ON catalogo_items(producto_id);

CREATE TABLE catalogo_paginas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  orden INTEGER NOT NULL,
  titulo TEXT NOT NULL,
  logo_grande INTEGER NOT NULL DEFAULT 0 CHECK(logo_grande IN (0, 1))
);

CREATE INDEX idx_catalogo_paginas_orden ON catalogo_paginas(orden);

CREATE TABLE catalogo_posiciones (
  pagina_id INTEGER NOT NULL REFERENCES catalogo_paginas(id) ON DELETE CASCADE,
  banda INTEGER NOT NULL CHECK(banda IN (1, 2)),
  columna INTEGER NOT NULL CHECK(columna IN (1, 2, 3)),
  item_id INTEGER NOT NULL REFERENCES catalogo_items(id) ON DELETE RESTRICT,
  PRIMARY KEY (pagina_id, banda, columna)
);

CREATE INDEX idx_catalogo_posiciones_item ON catalogo_posiciones(item_id);

CREATE TABLE catalogo_versiones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  porcentaje_global REAL NOT NULL CHECK(porcentaje_global >= 0),
  aplicar_a_todos INTEGER NOT NULL DEFAULT 0 CHECK(aplicar_a_todos IN (0, 1)),
  fecha_vigencia TEXT,
  pie_legal TEXT,
  es_general INTEGER NOT NULL DEFAULT 0 CHECK(es_general IN (0, 1)),
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_catalogo_versiones_nombre ON catalogo_versiones(nombre COLLATE NOCASE);
CREATE UNIQUE INDEX idx_catalogo_versiones_general ON catalogo_versiones(es_general) WHERE es_general = 1;

CREATE TABLE catalogo_version_precios (
  version_id INTEGER NOT NULL REFERENCES catalogo_versiones(id) ON DELETE CASCADE,
  item_id INTEGER NOT NULL REFERENCES catalogo_items(id) ON DELETE RESTRICT,
  pase_parche REAL,
  porcentaje REAL,
  sae INTEGER,
  estado_precio TEXT NOT NULL CHECK(estado_precio IN ('ok', 'sin_precio', 'error')),
  PRIMARY KEY (version_id, item_id)
);

CREATE INDEX idx_catalogo_version_precios_item ON catalogo_version_precios(item_id);

CREATE TABLE catalogo_base_precios (
  codigo TEXT NOT NULL,
  cliente_numero REAL,
  cliente_texto TEXT,
  descripcion TEXT,
  grupo TEXT,
  unidad TEXT
);

CREATE UNIQUE INDEX idx_catalogo_base_precios_codigo ON catalogo_base_precios(codigo COLLATE NOCASE);

CREATE TABLE catalogo_importaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo TEXT NOT NULL,
  fecha TEXT NOT NULL DEFAULT (datetime('now')),
  usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  items_afectados INTEGER NOT NULL DEFAULT 0,
  resumen_json TEXT
);

CREATE TABLE catalogo_ajustes (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL,
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO catalogo_ajustes (clave, valor) VALUES
  ('porcentaje_defecto', '0.4'),
  ('multiplo_redondeo', '100'),
  ('adicional_pie_tv', '8900'),
  ('fecha_vigencia', '2026-09-15'),
  ('mostrar_decimales', '1'),
  ('pie_legal',
   'TODOS LOS PRECIOS NO INCLUYEN EL IVA (21 %) Y ESTÁN EXPRESADOS EN PESOS ARGENTINOS.' || char(10) ||
   'Los precios aquí indicados son válidos hasta el {fecha_vigencia}.' || char(10) ||
   'Todos los artículos son para alquiler y están sujetos a disponibilidad en el momento de la reserva.');

INSERT INTO catalogo_versiones (nombre, porcentaje_global, aplicar_a_todos, fecha_vigencia, es_general)
VALUES ('General', 0.4, 0, '2026-09-15', 1);
