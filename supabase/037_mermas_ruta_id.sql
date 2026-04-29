-- ════════════════════════════════════════════════════════════
-- MIGRACIÓN 037: Vincular mermas a ruta cuando vienen del cierre de ruta
-- ════════════════════════════════════════════════════════════
-- Antes la única forma de saber "esta merma pertenece a la ruta X"
-- era buscar en el campo origen el texto "Ruta {nombreChofer}". Eso
-- mezclaba mermas de rutas distintas del mismo chofer y obligaba a
-- match por nombre, frágil ante cambios o nombres repetidos.
--
-- Ahora cada merma puede referenciar directamente la ruta a la que
-- pertenece. Mermas de producción/transformación quedan con ruta_id
-- NULL (no son de ruta).
-- ════════════════════════════════════════════════════════════

ALTER TABLE mermas
  ADD COLUMN IF NOT EXISTS ruta_id BIGINT REFERENCES rutas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mermas_ruta_id ON mermas(ruta_id);

COMMENT ON COLUMN mermas.ruta_id IS
  'Ruta a la que pertenece la merma. NULL = merma de producción/transformación, no de ruta.';
