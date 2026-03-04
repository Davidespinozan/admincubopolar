-- ════════════════════════════════════════════════════════════
-- MIGRACIÓN 009: Dirección y geolocalización de clientes
-- ════════════════════════════════════════════════════════════
-- Agrega campos de dirección completa, coordenadas lat/lng para
-- integración con Google Maps, y zona para agrupación de rutas
-- ════════════════════════════════════════════════════════════

-- Agregar campos de dirección
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS calle TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS colonia TEXT;
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS ciudad TEXT DEFAULT 'Hermosillo';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS estado TEXT DEFAULT 'Sonora';
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS codigo_postal VARCHAR(10);

-- Coordenadas para Google Maps (se obtienen por geocoding)
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS latitud NUMERIC(10, 7);
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS longitud NUMERIC(10, 7);

-- Zona/sector para agrupación inteligente de rutas
-- Ej: "Norte", "Centro", "Sur", "Industrial", "Periférico"
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS zona TEXT;

-- Índice para búsquedas por zona
CREATE INDEX IF NOT EXISTS idx_clientes_zona ON clientes(zona);

-- Índice espacial básico (para clusters por proximidad)
CREATE INDEX IF NOT EXISTS idx_clientes_coords ON clientes(latitud, longitud) WHERE latitud IS NOT NULL;

-- Comentarios
COMMENT ON COLUMN clientes.latitud IS 'Latitud GPS (geocoding de Google Maps)';
COMMENT ON COLUMN clientes.longitud IS 'Longitud GPS (geocoding de Google Maps)';
COMMENT ON COLUMN clientes.zona IS 'Zona/sector para agrupación de rutas (Norte, Centro, Sur, etc.)';
