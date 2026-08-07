-- Día de armado y día de desarme del evento, ambos opcionales (no siempre coinciden con
-- fecha_inicio/fecha_fin — el armado suele ser antes, el desarme después). Columnas
-- simples sin CHECK, ALTER TABLE ADD COLUMN alcanza.
ALTER TABLE eventos ADD COLUMN fecha_armado TEXT;
ALTER TABLE eventos ADD COLUMN fecha_desarme TEXT;
