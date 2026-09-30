-- Presupuestos cargados desde la app ("cotizaciones"). Son tablas NUEVAS y separadas a propósito:
-- mientras una cotización está pendiente de confirmación no existe para el calendario, los totales,
-- las alertas, el export de evento ni el import de Excel. Recién al confirmarla se copia a
-- lotes / presupuestos / presupuesto_lineas (origen 'app'), y desde ahí es un presupuesto más.
-- Todos los datos del cliente son opcionales.

-- Ya no se usa (se sacó el piloto: ahora se puede confirmar en cualquier evento). Queda la tabla
-- porque las migraciones acá son siempre aditivas, nunca se borra una que ya se aplicó.
CREATE TABLE cotizaciones_eventos (
  evento_id INTEGER PRIMARY KEY REFERENCES eventos(id) ON DELETE CASCADE,
  habilitado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  habilitado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE cotizaciones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'confirmada')),

  -- Datos de la hoja CARGA del Excel
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

  -- Se calculan solos (misma fórmula que el Excel); NULL mientras falten datos
  id_cliente TEXT,
  numero INTEGER,

  catalogo_version_id INTEGER REFERENCES catalogo_versiones(id) ON DELETE SET NULL,
  iva_porcentaje REAL NOT NULL DEFAULT 0.21 CHECK(iva_porcentaje >= 0 AND iva_porcentaje <= 1),
  notas TEXT,

  -- Al confirmar
  presupuesto_id INTEGER REFERENCES presupuestos(id) ON DELETE SET NULL,
  confirmada_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  confirmada_en TEXT,

  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cotizaciones_estado ON cotizaciones(estado);
CREATE INDEX idx_cotizaciones_evento ON cotizaciones(evento_id);
CREATE INDEX idx_cotizaciones_id_cliente ON cotizaciones(id_cliente, numero);

CREATE TABLE cotizacion_lineas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  -- El código y la descripción se copian: el presupuesto no cambia si después se edita el catálogo.
  catalogo_item_id INTEGER REFERENCES catalogo_items(id) ON DELETE SET NULL,
  codigo TEXT NOT NULL,
  descripcion TEXT NOT NULL,
  rubro TEXT,
  cantidad INTEGER NOT NULL CHECK(cantidad > 0),
  -- Lo que decía la lista de precios al agregar el ítem (NULL = el ítem no tenía precio) y el
  -- precio que efectivamente se cobra (editable; NULL = sin precio todavía). Neto, sin IVA.
  precio_catalogo REAL,
  precio_unitario REAL CHECK(precio_unitario IS NULL OR precio_unitario >= 0),
  comentario TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_cotizacion_lineas_codigo ON cotizacion_lineas(cotizacion_id, codigo COLLATE NOCASE);

-- Croquis, planos y otros archivos (imagen o PDF) que se adjuntan al presupuesto. El archivo vive en
-- una carpeta aparte (fuera de la base y del backup automático); acá queda el registro.
CREATE TABLE cotizacion_adjuntos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL REFERENCES cotizaciones(id) ON DELETE CASCADE,
  titulo TEXT,
  nombre_original TEXT NOT NULL,
  archivo TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK(tipo IN ('imagen', 'pdf')),
  tamano INTEGER NOT NULL,
  paginas INTEGER NOT NULL DEFAULT 1,
  incluir_en_pdf INTEGER NOT NULL DEFAULT 1 CHECK(incluir_en_pdf IN (0, 1)),
  subido_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_cotizacion_adjuntos_cotizacion ON cotizacion_adjuntos(cotizacion_id);
