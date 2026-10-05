-- Croquis (plano de planta) de un lote, dibujado a mano en la app: paredes sueltas (no
-- necesariamente un polígono cerrado — un stand suele tener uno o más lados abiertos al
-- pasillo) + materiales del catálogo colocados con posición y rotación. Es opcional: no todos
-- los lotes tienen uno, y sólo los que SÍ tienen croquis salen impresos en el PDF de totales
-- del evento (ver exportService.js).
CREATE TABLE lote_croquis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lote_id INTEGER NOT NULL UNIQUE REFERENCES lotes(id) ON DELETE CASCADE,
  paredes TEXT NOT NULL DEFAULT '[]',
  materiales TEXT NOT NULL DEFAULT '[]',
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_lote_croquis_lote ON lote_croquis(lote_id);
