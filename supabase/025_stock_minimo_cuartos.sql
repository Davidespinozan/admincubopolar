-- 025: Agregar stock_minimo a productos
-- Umbral mínimo de inventario por producto terminado.

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS stock_minimo INTEGER NOT NULL DEFAULT 0;
