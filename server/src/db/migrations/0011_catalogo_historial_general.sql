-- Historial de la versión General del catálogo (la del 40 %, "el presupuesto general de SAE"): permite
-- guardar una foto con nombre de cómo estaba la lista en un momento dado, y volver a verla o usarla más
-- adelante. Una fila "histórico" es una fila más de catalogo_versiones (misma tabla que las versiones de
-- evento: reutiliza toda su foto de precios en catalogo_version_precios), sólo que marcada para que:
--   - NO se recalcule sola cuando se confirma una base parche nueva (queda fija, "foto" real).
--   - NO se pueda editar el porcentaje/vigencia ni recalcular a mano (es de sólo lectura; sí se puede
--     renombrar y borrar, como cualquier versión de evento).
-- Se crea sola (con un nombre automático) cada vez que se confirma una base parche con cambios reales,
-- justo antes de recalcular, para no perder la lista anterior; también se puede guardar a mano con un
-- nombre elegido, desde la pantalla de Versiones.
ALTER TABLE catalogo_versiones ADD COLUMN es_historial INTEGER NOT NULL DEFAULT 0 CHECK(es_historial IN (0, 1));

-- Además de quedar en el reporte guardado (resumen_json), queda el vínculo directo a la versión que se
-- guardó justo antes de esa importación, para poder ir directo a "ver los precios de antes de esto".
ALTER TABLE catalogo_importaciones ADD COLUMN historial_version_id INTEGER REFERENCES catalogo_versiones(id) ON DELETE SET NULL;
