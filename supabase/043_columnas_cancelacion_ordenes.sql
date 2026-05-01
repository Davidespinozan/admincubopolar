-- 043_columnas_cancelacion_ordenes.sql
-- Agrega 3 columnas a ordenes para registrar el contexto de cancelacion.
-- El estatus 'Cancelada' ya existe en el enum estatus_orden (001_schema.sql).
-- Estas columnas se llenan cuando un Admin cancela una orden via UI.

ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS motivo_cancelacion TEXT;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cancelada_at TIMESTAMPTZ;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS cancelada_por TEXT;

COMMENT ON COLUMN ordenes.motivo_cancelacion IS 'Motivo capturado al cancelar la orden';
COMMENT ON COLUMN ordenes.cancelada_at IS 'Timestamp de cancelacion';
COMMENT ON COLUMN ordenes.cancelada_por IS 'Usuario que cancelo (texto plano, mismo patron que auditoria.usuario)';
