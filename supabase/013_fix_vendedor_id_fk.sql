-- 013: Fix vendedor_id foreign key — should reference usuarios, not empleados
-- Run this in the Supabase SQL Editor

-- Drop the wrong FK constraint
ALTER TABLE ordenes DROP CONSTRAINT IF EXISTS ordenes_vendedor_id_fkey;

-- Re-add with correct reference to usuarios table
ALTER TABLE ordenes ADD CONSTRAINT ordenes_vendedor_id_fkey
  FOREIGN KEY (vendedor_id) REFERENCES usuarios(id);
