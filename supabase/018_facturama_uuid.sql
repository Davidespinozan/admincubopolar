-- Add UUID column to store the CFDI UUID returned by Facturama.
-- Required for generating Complemento de Pago (CfdiType 'P') on credit sales.
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS facturama_uuid TEXT;
COMMENT ON COLUMN ordenes.facturama_uuid IS 'UUID del CFDI timbrado en Facturama, requerido para Complemento de Pago';
