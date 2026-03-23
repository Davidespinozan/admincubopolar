-- MIGRACIÓN 019: Agregar columnas faltantes a rutas
-- Ejecutar en Supabase SQL Editor si "Autorizar ruta" falla con error de columna

-- Cambiar carga de TEXT a JSONB
ALTER TABLE rutas ALTER COLUMN carga TYPE JSONB USING CASE WHEN carga IS NULL THEN '{}'::JSONB ELSE carga::JSONB END;
ALTER TABLE rutas ALTER COLUMN carga SET DEFAULT '{}';

-- Columnas de carga por producto (migración 005)
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS carga_autorizada  JSONB NOT NULL DEFAULT '{}';
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS extra_autorizado   JSONB NOT NULL DEFAULT '{}';
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS carga_real         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS devolucion         JSONB NOT NULL DEFAULT '{}';
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS autorizado_at      TIMESTAMPTZ;

-- Clientes asignados a la ruta (migración 008)
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS clientes_asignados JSONB NOT NULL DEFAULT '[]';

-- Secuencia de folios si no existe
CREATE SEQUENCE IF NOT EXISTS folio_r_seq START 1;
