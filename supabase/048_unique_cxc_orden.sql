-- 048_unique_cxc_orden.sql
-- Previene 2 cuentas_por_cobrar duplicadas para la misma orden.
-- Ahora updateOrdenEstatus(orden, 'Entregada') hace check existingCxc
-- en JS (TOCTOU): dos invocaciones concurrentes pueden ambas pasar el
-- check y crear 2 CxCs. Con este índice, la segunda inserción falla con
-- 23505 (duplicate key) y el código lo maneja como duplicado.
--
-- Nota: si hay CxCs duplicadas en producción, este CREATE INDEX fallará.
-- En ese caso, limpiar primero con:
--   SELECT orden_id, COUNT(*) FROM cuentas_por_cobrar
--   WHERE orden_id IS NOT NULL GROUP BY orden_id HAVING COUNT(*) > 1;

CREATE UNIQUE INDEX IF NOT EXISTS idx_cxc_orden_unique
  ON cuentas_por_cobrar(orden_id)
  WHERE orden_id IS NOT NULL;
