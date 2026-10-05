-- Croquis dibujado dentro de un presupuesto de la app (cotización), mientras todavía no existe el lote:
-- el presupuesto recién crea su lote al confirmarse. Mismo formato que lote_croquis. Al confirmar, el
-- croquis se copia al lote (si el lote no tenía uno) para que salga en el PDF de totales del evento.
-- incluir_en_pdf: si el croquis sale (1) o no (0) en el PDF del presupuesto.
CREATE TABLE cotizacion_croquis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cotizacion_id INTEGER NOT NULL UNIQUE REFERENCES cotizaciones(id) ON DELETE CASCADE,
  paredes TEXT NOT NULL DEFAULT '[]',
  materiales TEXT NOT NULL DEFAULT '[]',
  cotas TEXT NOT NULL DEFAULT '[]',
  comentarios TEXT NOT NULL DEFAULT '',
  incluir_en_pdf INTEGER NOT NULL DEFAULT 1 CHECK (incluir_en_pdf IN (0, 1)),
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
