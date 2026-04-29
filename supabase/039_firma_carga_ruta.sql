-- ═══════════════════════════════════════════════════════════
-- MIGRACIÓN 039 — Firma de carga
-- ═══════════════════════════════════════════════════════════
-- Permite que el responsable de Producción firme con el dedo
-- la carga real del chofer antes de que salga a ruta.
--
-- Defensiva: extiende el ENUM estatus_ruta si existe (caso schema
-- inicializado desde 001_schema.sql). Si la columna estatus es TEXT
-- (caso 001_schema_completo.sql), el bloque DO no hace nada.
-- ═══════════════════════════════════════════════════════════

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'estatus_ruta') THEN
    ALTER TYPE estatus_ruta ADD VALUE IF NOT EXISTS 'Pendiente firma';
    ALTER TYPE estatus_ruta ADD VALUE IF NOT EXISTS 'Cargada';
  END IF;
END $$;

ALTER TABLE rutas ADD COLUMN IF NOT EXISTS firma_carga TEXT;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS firma_excepcion BOOLEAN DEFAULT FALSE;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS firma_excepcion_motivo TEXT;
ALTER TABLE rutas ADD COLUMN IF NOT EXISTS carga_solicitada_at TIMESTAMPTZ;

-- firma_carga: base64 PNG de la firma dibujada con el dedo
-- firma_excepcion: true si se cargó sin firma (modo emergencia)
-- firma_excepcion_motivo: razón obligatoria si firma_excepcion = true
-- carga_solicitada_at: timestamp de cuando el chofer pidió firma (para timers de fallback)
