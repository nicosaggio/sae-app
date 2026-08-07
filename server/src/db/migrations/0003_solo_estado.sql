-- Restricción de permisos independiente del rol (evita reconstruir "usuarios", que tiene
-- filas reales dependientes vía eventos.creado_por). Un operador con solo_estado=1 solo
-- puede cambiar el estado de presupuestos, nada más.
ALTER TABLE usuarios ADD COLUMN solo_estado INTEGER NOT NULL DEFAULT 0;
