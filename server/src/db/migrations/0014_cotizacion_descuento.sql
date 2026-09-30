-- Descuento especial de un presupuesto cargado desde la app: un porcentaje (fracción 0-1) que se
-- resta del subtotal ANTES de calcular el IVA. Por defecto 0 (sin descuento), igual que hoy.
ALTER TABLE cotizaciones ADD COLUMN descuento_porcentaje REAL NOT NULL DEFAULT 0 CHECK(descuento_porcentaje >= 0 AND descuento_porcentaje <= 1);
