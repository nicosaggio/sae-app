-- Cada versión del catálogo tiene sus propias páginas: organizar las de una versión de evento (sacar
-- un ítem, mover una página) no toca las de la General ni las de otra versión. Hasta ahora había una
-- sola estructura compartida por todas.
--
-- Las páginas que ya existían pasan a ser de la General, y cada una de las demás versiones recibe una
-- copia (con sus posiciones), así que todas arrancan viéndose igual que hasta hoy. Borrar una versión
-- borra sus páginas (y éstas sus posiciones).
ALTER TABLE catalogo_paginas ADD COLUMN version_id INTEGER REFERENCES catalogo_versiones(id) ON DELETE CASCADE;

UPDATE catalogo_paginas SET version_id = (SELECT id FROM catalogo_versiones WHERE es_general = 1);

INSERT INTO catalogo_paginas (orden, titulo, logo_grande, version_id)
SELECT p.orden, p.titulo, p.logo_grande, v.id
  FROM catalogo_versiones v
  JOIN catalogo_paginas p ON p.version_id = (SELECT id FROM catalogo_versiones WHERE es_general = 1)
 WHERE v.es_general = 0
 ORDER BY v.id, p.orden, p.id;

-- Cada copia se empareja con su original por su lugar en el orden (las copias se insertaron en ese
-- mismo orden, así que sus id crecen igual).
WITH general AS (SELECT id FROM catalogo_versiones WHERE es_general = 1),
     originales AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY orden, id) AS n FROM catalogo_paginas WHERE version_id = (SELECT id FROM general)
     ),
     copias AS (
       SELECT id, ROW_NUMBER() OVER (PARTITION BY version_id ORDER BY orden, id) AS n FROM catalogo_paginas WHERE version_id <> (SELECT id FROM general)
     )
INSERT INTO catalogo_posiciones (pagina_id, banda, columna, item_id)
SELECT c.id, po.banda, po.columna, po.item_id
  FROM copias c
  JOIN originales o ON o.n = c.n
  JOIN catalogo_posiciones po ON po.pagina_id = o.id;

CREATE INDEX idx_catalogo_paginas_version ON catalogo_paginas(version_id, orden);
