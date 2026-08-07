-- Precio unitario por línea (viene de la hoja PRESUPUESTO del Excel, columna VALOR
-- UNITARIO). Puede variar de un evento a otro para el mismo producto, así que se guarda
-- por línea y no en el catálogo de productos. Columna simple, sin CHECK, así que un
-- ALTER TABLE ADD COLUMN alcanza (no hace falta reconstruir la tabla).
ALTER TABLE presupuesto_lineas ADD COLUMN precio_unitario REAL;
