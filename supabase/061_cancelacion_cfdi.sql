-- 061_cancelacion_cfdi.sql
-- Tanda 5: cancelación de CFDI con motivos SAT (01-04).
--
-- Al cancelar, la orden vuelve a estatus 'Entregada' (revierte facturación)
-- y queda anotada con cuándo/por qué/quién. facturama_id/uuid/folio se
-- conservan como histórico; cuando se re-timbre se sobrescriben y
-- cfdi_cancelado_at se limpia para liberar el lock idempotente.
--
-- Motivos SAT (Anexo 20 v4.0):
--   01 — Comprobante emitido con errores con relación (requiere uuid_sustituto)
--   02 — Comprobante emitido con errores sin relación
--   03 — No se llevó a cabo la operación
--   04 — Operación nominativa relacionada en factura global

ALTER TABLE ordenes
  ADD COLUMN IF NOT EXISTS cfdi_cancelado_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cfdi_cancelado_motivo          VARCHAR(2),
  ADD COLUMN IF NOT EXISTS cfdi_cancelado_motivo_detalle  TEXT,
  ADD COLUMN IF NOT EXISTS cfdi_cancelado_uuid_sustituto  TEXT,
  ADD COLUMN IF NOT EXISTS cfdi_cancelado_por             TEXT;

COMMENT ON COLUMN ordenes.cfdi_cancelado_at IS
  'Timestamp de cancelación del CFDI ante el SAT (vía Facturama DELETE).';
COMMENT ON COLUMN ordenes.cfdi_cancelado_motivo IS
  'Motivo SAT de cancelación: 01 (con relación, requiere sustituto), 02 (sin relación), 03 (no se llevó a cabo), 04 (operación nominativa en factura global).';
COMMENT ON COLUMN ordenes.cfdi_cancelado_motivo_detalle IS
  'Notas libres del usuario que canceló (auditoría interna).';
COMMENT ON COLUMN ordenes.cfdi_cancelado_uuid_sustituto IS
  'UUID del CFDI que sustituye al cancelado (solo aplica para motivo=01).';
COMMENT ON COLUMN ordenes.cfdi_cancelado_por IS
  'Usuario que disparó la cancelación (texto plano, mismo patrón que cancelada_por).';

-- Index parcial para queries de "facturas vigentes" (excluir canceladas).
-- Útil en filtros de FacturacionView y reportes contables.
CREATE INDEX IF NOT EXISTS idx_ordenes_cfdi_vigente
  ON ordenes (id)
  WHERE facturama_uuid IS NOT NULL AND cfdi_cancelado_at IS NULL;

-- Validar valores de motivo cuando estén poblados.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ordenes_cfdi_motivo_chk'
  ) THEN
    ALTER TABLE ordenes
      ADD CONSTRAINT ordenes_cfdi_motivo_chk
      CHECK (cfdi_cancelado_motivo IS NULL OR cfdi_cancelado_motivo IN ('01','02','03','04'));
  END IF;
END $$;
