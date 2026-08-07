-- Agrega 'cancelado' al enum de estado. SQLite no permite modificar un CHECK existente
-- con ALTER TABLE, así que se reconstruye la tabla preservando todas las columnas
-- (incluidas las agregadas por 0002) y todos los índices.
CREATE TABLE presupuestos_nueva (
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
    CHECK(estado IN ('pendiente_facturar', 'facturado', 'pendiente_pago', 'cobrado', 'cancelado')),
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  origen TEXT NOT NULL DEFAULT 'manual',
  ruta_archivo TEXT,
  archivo_activo INTEGER NOT NULL DEFAULT 1,
  archivo_mtime TEXT,
  archivo_size INTEGER
);

INSERT INTO presupuestos_nueva
  (id, lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total,
   notas, confirmado, estado, creado_en, actualizado_en, origen, ruta_archivo, archivo_activo,
   archivo_mtime, archivo_size)
  SELECT
   id, lote_id, numero, fecha, cliente_nombre, cliente_contacto, condiciones_pago, monto_total,
   notas, confirmado, estado, creado_en, actualizado_en, origen, ruta_archivo, archivo_activo,
   archivo_mtime, archivo_size
  FROM presupuestos;

DROP TABLE presupuestos;
ALTER TABLE presupuestos_nueva RENAME TO presupuestos;

CREATE INDEX idx_presupuestos_lote ON presupuestos(lote_id);
CREATE INDEX idx_presupuestos_estado ON presupuestos(estado);
CREATE INDEX idx_presupuestos_confirmado ON presupuestos(confirmado);
CREATE UNIQUE INDEX idx_presupuestos_ruta_archivo ON presupuestos(ruta_archivo);
CREATE INDEX idx_presupuestos_archivo_activo ON presupuestos(archivo_activo);
