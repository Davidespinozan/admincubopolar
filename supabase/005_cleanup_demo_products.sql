-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Limpieza de productos DEMO
-- Borra DEMO-HC-10K y DEMO-HT-10K sin tocar productos reales
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- Quitar referencias en cuartos fríos JSONB (si existen)
UPDATE cuartos_frios
SET stock = stock - 'DEMO-HC-10K' - 'DEMO-HT-10K'
WHERE stock ? 'DEMO-HC-10K' OR stock ? 'DEMO-HT-10K';

-- Borrar movimientos demo relacionados
DELETE FROM inventario_mov
WHERE producto IN ('DEMO-HC-10K', 'DEMO-HT-10K')
   OR sku IN ('DEMO-HC-10K', 'DEMO-HT-10K')
   OR origen LIKE '%DEMO%';

-- Borrar líneas y órdenes demo
DELETE FROM orden_lineas
WHERE sku IN ('DEMO-HC-10K', 'DEMO-HT-10K')
   OR orden_id IN (SELECT id FROM ordenes WHERE folio LIKE 'DEMO-%' OR productos LIKE '%DEMO-%');

DELETE FROM ordenes
WHERE folio LIKE 'DEMO-%'
   OR productos LIKE '%DEMO-%';

-- Borrar producción demo
DELETE FROM produccion
WHERE folio LIKE 'DEMO-%'
   OR sku IN ('DEMO-HC-10K', 'DEMO-HT-10K');

-- Borrar precios especiales demo
DELETE FROM precios_esp
WHERE sku IN ('DEMO-HC-10K', 'DEMO-HT-10K');

-- Finalmente borrar productos demo
DELETE FROM productos
WHERE sku IN ('DEMO-HC-10K', 'DEMO-HT-10K');

COMMIT;
