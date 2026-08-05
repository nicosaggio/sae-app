CREATE TABLE lotes_nueva (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL,
  expositor TEXT,
  contacto TEXT,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(evento_id, codigo, expositor)
);

INSERT INTO lotes_nueva (id, evento_id, codigo, expositor, contacto, creado_en, actualizado_en)
  SELECT id, evento_id, codigo, expositor, contacto, creado_en, actualizado_en FROM lotes;

DROP TABLE lotes;
ALTER TABLE lotes_nueva RENAME TO lotes;
CREATE INDEX idx_lotes_evento ON lotes(evento_id);

ALTER TABLE presupuestos ADD COLUMN origen TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE presupuestos ADD COLUMN ruta_archivo TEXT;
ALTER TABLE presupuestos ADD COLUMN archivo_activo INTEGER NOT NULL DEFAULT 1;
ALTER TABLE presupuestos ADD COLUMN archivo_mtime TEXT;
ALTER TABLE presupuestos ADD COLUMN archivo_size INTEGER;

CREATE UNIQUE INDEX idx_presupuestos_ruta_archivo ON presupuestos(ruta_archivo);
CREATE INDEX idx_presupuestos_archivo_activo ON presupuestos(archivo_activo);

CREATE TABLE import_pendientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  ruta_archivo TEXT NOT NULL,
  datos_json TEXT,
  lote_id INTEGER REFERENCES lotes(id) ON DELETE CASCADE,
  presupuesto_huerfano_id INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
  presupuesto_nuevo_id INTEGER REFERENCES presupuestos(id) ON DELETE CASCADE,
  detectado_en TEXT NOT NULL DEFAULT (datetime('now')),
  resuelto INTEGER NOT NULL DEFAULT 0,
  resuelto_en TEXT
);

CREATE INDEX idx_import_pendientes_resuelto ON import_pendientes(resuelto);
