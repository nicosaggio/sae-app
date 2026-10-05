-- Dos agregados al croquis de un lote:
--  * comentarios: aclaraciones libres que salen impresas a la derecha del croquis en el PDF de
--    totales del evento. Vacío = sin comentarios (los croquis que ya existen quedan así).
--  * cotas: medidas acotadas sobre el plano, una lista JSON de {x1, y1, x2, y2, offset} (metros).
--    "[]" = sin cotas.
ALTER TABLE lote_croquis ADD COLUMN comentarios TEXT NOT NULL DEFAULT '';
ALTER TABLE lote_croquis ADD COLUMN cotas TEXT NOT NULL DEFAULT '[]';
