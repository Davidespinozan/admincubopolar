-- 011: Add Facturama invoice reference to ordenes
-- This allows syncing payment status between Supabase and Facturama

ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS facturama_id text;
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS facturama_folio text;

COMMENT ON COLUMN ordenes.facturama_id IS 'Facturama CFDI Id for syncing invoice status';
COMMENT ON COLUMN ordenes.facturama_folio IS 'Facturama internal folio number';
