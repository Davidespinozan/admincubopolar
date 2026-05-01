-- 041_archivo_columnas_huerfanas_rutas.sql
-- Archiva 3 columnas que existen en BD de producción de Cubo Polar
-- pero no estaban versionadas en migraciones. Detectadas en auditoría
-- de mayo 2026.
--
-- Esta migración es NO-OP en producción (IF NOT EXISTS).
-- Su valor es permitir replicar el schema en ambientes nuevos
-- (staging, otro cliente con fork del repo, etc).

ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS carga_confirmada_at TIMESTAMP;

ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS carga_confirmada_por TEXT;

ALTER TABLE rutas
  ADD COLUMN IF NOT EXISTS fecha_fin TIMESTAMP;

COMMENT ON COLUMN rutas.carga_confirmada_at IS
  'Timestamp de confirmacion de carga (chofer o produccion)';

COMMENT ON COLUMN rutas.carga_confirmada_por IS
  'Usuario que confirmo o firmo la carga';

COMMENT ON COLUMN rutas.fecha_fin IS
  'Fecha de cierre de ruta via cerrarRutaCompleta';
