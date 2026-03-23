-- MIGRACIÓN 021: Agregar columnas faltantes a cuartos_frios

ALTER TABLE cuartos_frios ADD COLUMN IF NOT EXISTS stock      JSONB        NOT NULL DEFAULT '{}';
ALTER TABLE cuartos_frios ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ  NOT NULL DEFAULT now();
