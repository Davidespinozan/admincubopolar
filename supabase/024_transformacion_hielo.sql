-- MIGRACIÓN 024: Soporte para transformación de hielo (barras → triturado)
-- Agrega columnas a produccion para distinguir producción normal de transformaciones

ALTER TABLE produccion ADD COLUMN IF NOT EXISTS tipo          TEXT NOT NULL DEFAULT 'Produccion';
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS input_sku     TEXT;
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS input_kg      NUMERIC(10,2);
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS output_kg     NUMERIC(10,2);
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS merma_kg      NUMERIC(10,2);
ALTER TABLE produccion ADD COLUMN IF NOT EXISTS rendimiento   NUMERIC(5,2); -- porcentaje 0-100

-- Índice para consultas por tipo
CREATE INDEX IF NOT EXISTS idx_produccion_tipo ON produccion(tipo);
