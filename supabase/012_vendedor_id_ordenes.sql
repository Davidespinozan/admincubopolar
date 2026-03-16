-- 012: Add vendedor_id to ordenes so sales staff can see their own orders
-- Run this in the Supabase SQL Editor

ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS vendedor_id integer REFERENCES empleados(id);
CREATE INDEX IF NOT EXISTS idx_ordenes_vendedor ON ordenes(vendedor_id);
