-- Marca los presupuestos (cotizaciones) que alguien reabrió a mano después de haber sido rechazados.
-- Los pendientes de un evento que ya terminó se rechazan solos; si uno se reabre a propósito (por ejemplo
-- el cliente aceptó tarde), esta marca evita que el rechazo automático lo vuelva a rechazar.
ALTER TABLE cotizaciones ADD COLUMN reabierta_en TEXT;
