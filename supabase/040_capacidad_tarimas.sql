-- ═══════════════════════════════════════════════════════════
-- MIGRACIÓN 040 — Capacidad por tarimas
-- ═══════════════════════════════════════════════════════════
-- Agrega campos para manejar capacidad de cuartos fríos en
-- tarimas físicas (no en bolsas individuales).
--
-- Las tarimas pueden mezclar SKUs. Cada SKU contribuye su
-- fracción de tarima según su tarima_size.
-- ═══════════════════════════════════════════════════════════

-- 1. Productos: cuántas unidades caben en 1 tarima de ese SKU
ALTER TABLE productos ADD COLUMN IF NOT EXISTS tarima_size INT DEFAULT 0;

-- Backfill automático por sufijo del SKU
UPDATE productos SET tarima_size = 180 WHERE sku LIKE '%-5K' AND (tarima_size IS NULL OR tarima_size = 0);
UPDATE productos SET tarima_size = 36 WHERE sku LIKE '%-25K' AND (tarima_size IS NULL OR tarima_size = 0);
UPDATE productos SET tarima_size = 18 WHERE sku LIKE '%-50K' AND (tarima_size IS NULL OR tarima_size = 0);

-- 2. Cuartos fríos: capacidad máxima en tarimas
ALTER TABLE cuartos_frios ADD COLUMN IF NOT EXISTS capacidad_tarimas INT DEFAULT 0;

-- Backfill con datos del cliente
UPDATE cuartos_frios SET capacidad_tarimas = 8 WHERE id = 'CF-1' AND (capacidad_tarimas IS NULL OR capacidad_tarimas = 0);
UPDATE cuartos_frios SET capacidad_tarimas = 15 WHERE id = 'CF-2' AND (capacidad_tarimas IS NULL OR capacidad_tarimas = 0);
UPDATE cuartos_frios SET capacidad_tarimas = 13 WHERE id = 'CF-3' AND (capacidad_tarimas IS NULL OR capacidad_tarimas = 0);

-- NOTA: Si los IDs de cuartos fríos son distintos a CF-1, CF-2, CF-3,
-- los UPDATEs no afectarán nada. David puede ajustar manualmente desde
-- la UI de Configuración de Cuartos Fríos.
