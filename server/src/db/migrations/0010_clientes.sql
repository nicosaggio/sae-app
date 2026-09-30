-- Clientes guardados, con el CUIT como clave. Se completan solos al guardar los datos de un presupuesto
-- cargado desde la app, y sirven para autocompletar los presupuestos siguientes del mismo cliente.
-- El CUIT se guarda sólo con los 11 dígitos; los presupuestos lo muestran con guiones.
CREATE TABLE clientes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  cuit TEXT NOT NULL UNIQUE CHECK(length(cuit) = 11),
  razon_social TEXT,
  direccion TEXT,
  contacto TEXT,
  mail TEXT,
  telefono TEXT,
  creado_por INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_clientes_razon_social ON clientes(razon_social COLLATE NOCASE);

-- A qué cliente pertenece un presupuesto (sólo la tabla de presupuestos de la app, no las existentes).
-- Si se borra el cliente, el presupuesto conserva sus datos.
ALTER TABLE cotizaciones ADD COLUMN cliente_id INTEGER REFERENCES clientes(id) ON DELETE SET NULL;

CREATE INDEX idx_cotizaciones_cliente ON cotizaciones(cliente_id);
