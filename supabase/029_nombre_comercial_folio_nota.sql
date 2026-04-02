-- 029: Agregar nombre_comercial a clientes y folio_nota a ordenes
-- Solicitado por dueños de CuboPolar

-- Nombre comercial: para identificar clientes de mostrador sin razón social formal
ALTER TABLE clientes ADD COLUMN IF NOT EXISTS nombre_comercial TEXT;

-- Folio de nota física: para registrar el número de nota impresa al momento de la venta/entrega
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS folio_nota TEXT;
