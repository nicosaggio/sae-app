-- De qué responsable sale la letra del ID de cliente de un presupuesto de la app, cuando no es el
-- responsable mismo. Pasa con los duplicados: quedan a nombre de quien los duplica, pero siguen la
-- numeración del original (AE15ST1-1 -> AE15ST1-2), así que el ID se sigue armando con el nombre del
-- responsable del original. NULL (todos los que ya existían, y los que se cargan de cero) = el ID se
-- arma con el responsable, como siempre.
ALTER TABLE cotizaciones ADD COLUMN responsable_codigo TEXT;
