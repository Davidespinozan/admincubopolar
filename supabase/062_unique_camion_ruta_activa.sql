-- 062_unique_camion_ruta_activa.sql
-- Tanda 6 🟢-6: impedir asignar el mismo camión a 2 rutas activas
-- simultáneamente. Replica el patrón de mig 049/059 (chofer + ruta activa).
--
-- Estatus considerados "activos": Programada, Cargada, Pendiente firma,
-- En progreso. Cerrada y Cancelada NO bloquean (libera el camión para
-- la siguiente ruta).
--
-- Pre-verificación obligatoria antes de aplicar:
--   SELECT camion_id, COUNT(*), STRING_AGG(folio, ', ')
--     FROM rutas
--    WHERE estatus IN ('Programada','Cargada','Pendiente firma','En progreso')
--      AND camion_id IS NOT NULL
--    GROUP BY camion_id HAVING COUNT(*) > 1;
--
-- Si devuelve filas, limpiar antes de correr esta migración.

CREATE UNIQUE INDEX IF NOT EXISTS idx_camion_ruta_activa
  ON rutas(camion_id)
  WHERE estatus IN ('Programada','Cargada','Pendiente firma','En progreso')
    AND camion_id IS NOT NULL;

COMMENT ON INDEX idx_camion_ruta_activa IS
  'Tanda 6: impide asignar el mismo camión a 2 rutas activas simultáneamente. Cerrada/Cancelada liberan el camión.';
