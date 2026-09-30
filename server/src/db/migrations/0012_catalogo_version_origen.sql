-- De dónde salió una versión importada (por ejemplo "CIDEL - SEPTIEMBRE.xlsm"), para que quede
-- registrado de dónde vinieron sus precios. NULL para la General y las versiones armadas en la app
-- (con un porcentaje) o guardadas del historial de la General.
ALTER TABLE catalogo_versiones ADD COLUMN origen_archivo TEXT;
