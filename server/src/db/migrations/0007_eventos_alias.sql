CREATE TABLE eventos_alias (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  evento_id INTEGER NOT NULL REFERENCES eventos(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX idx_eventos_alias_nombre ON eventos_alias(nombre COLLATE NOCASE);
CREATE INDEX idx_eventos_alias_evento ON eventos_alias(evento_id);
