-- 049_unique_chofer_ruta_activa.sql
-- Previene que un chofer tenga 2 rutas activas simultáneamente.
-- La UI usa "miRutaActiva = primera ruta activa" para el chofer; si por
-- error admin asigna 2 rutas en estatus operativo al mismo chofer, la
-- segunda queda en limbo (sin chofer real ejecutándola).
-- Estados activos: 'Cargada', 'En progreso', 'Pendiente firma'.
--
-- Si la migración falla por datos existentes, identificar duplicados:
--   SELECT chofer_id, COUNT(*) FROM rutas
--   WHERE estatus IN ('Cargada','En progreso','Pendiente firma')
--   GROUP BY chofer_id HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_ruta_chofer_activa
  ON rutas(chofer_id)
  WHERE estatus IN ('Cargada', 'En progreso', 'Pendiente firma');
