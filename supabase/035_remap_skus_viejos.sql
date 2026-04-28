-- 035: Remapear SKUs viejos → nuevos en TODAS las tablas que los referencian como string
-- Mapeo:
--   HC-25K → HPC-25K
--   HC-5K  → HPC-5K
--   HT-25K → HPT-25K
--   HT-5K  → HPT-5K
--   BH-50K → HIB-50K
--
-- IMPORTANTE: ejecutar esto UNA SOLA VEZ. Es idempotente (si los viejos ya no existen, no hace nada).
-- Si tienes dudas, primero corre solo los SELECTs comentados al final para ver qué se afectará.

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- 1. Tablas con columna SKU como TEXT (referencias directas)
-- ═══════════════════════════════════════════════════════════

UPDATE inventario_mov SET producto = 'HPC-25K' WHERE producto = 'HC-25K';
UPDATE inventario_mov SET producto = 'HPC-5K'  WHERE producto = 'HC-5K';
UPDATE inventario_mov SET producto = 'HPT-25K' WHERE producto = 'HT-25K';
UPDATE inventario_mov SET producto = 'HPT-5K'  WHERE producto = 'HT-5K';
UPDATE inventario_mov SET producto = 'HIB-50K' WHERE producto = 'BH-50K';

UPDATE mermas SET sku = 'HPC-25K' WHERE sku = 'HC-25K';
UPDATE mermas SET sku = 'HPC-5K'  WHERE sku = 'HC-5K';
UPDATE mermas SET sku = 'HPT-25K' WHERE sku = 'HT-25K';
UPDATE mermas SET sku = 'HPT-5K'  WHERE sku = 'HT-5K';
UPDATE mermas SET sku = 'HIB-50K' WHERE sku = 'BH-50K';

UPDATE produccion SET sku = 'HPC-25K' WHERE sku = 'HC-25K';
UPDATE produccion SET sku = 'HPC-5K'  WHERE sku = 'HC-5K';
UPDATE produccion SET sku = 'HPT-25K' WHERE sku = 'HT-25K';
UPDATE produccion SET sku = 'HPT-5K'  WHERE sku = 'HT-5K';
UPDATE produccion SET sku = 'HIB-50K' WHERE sku = 'BH-50K';

-- input_sku en transformaciones
UPDATE produccion SET input_sku = 'HPC-25K' WHERE input_sku = 'HC-25K';
UPDATE produccion SET input_sku = 'HPC-5K'  WHERE input_sku = 'HC-5K';
UPDATE produccion SET input_sku = 'HPT-25K' WHERE input_sku = 'HT-25K';
UPDATE produccion SET input_sku = 'HPT-5K'  WHERE input_sku = 'HT-5K';
UPDATE produccion SET input_sku = 'HIB-50K' WHERE input_sku = 'BH-50K';

UPDATE precios_esp SET sku = 'HPC-25K' WHERE sku = 'HC-25K';
UPDATE precios_esp SET sku = 'HPC-5K'  WHERE sku = 'HC-5K';
UPDATE precios_esp SET sku = 'HPT-25K' WHERE sku = 'HT-25K';
UPDATE precios_esp SET sku = 'HPT-5K'  WHERE sku = 'HT-5K';
UPDATE precios_esp SET sku = 'HIB-50K' WHERE sku = 'BH-50K';

UPDATE orden_lineas SET sku = 'HPC-25K' WHERE sku = 'HC-25K';
UPDATE orden_lineas SET sku = 'HPC-5K'  WHERE sku = 'HC-5K';
UPDATE orden_lineas SET sku = 'HPT-25K' WHERE sku = 'HT-25K';
UPDATE orden_lineas SET sku = 'HPT-5K'  WHERE sku = 'HT-5K';
UPDATE orden_lineas SET sku = 'HIB-50K' WHERE sku = 'BH-50K';

-- ═══════════════════════════════════════════════════════════
-- 2. ordenes.productos — string con formato "25×HC-25K, 10×HC-5K"
--    Usamos REPLACE en cadena. Es seguro porque ningún SKU viejo es
--    substring de otro SKU (viejo o nuevo).
-- ═══════════════════════════════════════════════════════════

UPDATE ordenes SET productos = REPLACE(productos, 'HC-25K', 'HPC-25K') WHERE productos LIKE '%HC-25K%';
UPDATE ordenes SET productos = REPLACE(productos, 'HC-5K',  'HPC-5K')  WHERE productos LIKE '%HC-5K%';
UPDATE ordenes SET productos = REPLACE(productos, 'HT-25K', 'HPT-25K') WHERE productos LIKE '%HT-25K%';
UPDATE ordenes SET productos = REPLACE(productos, 'HT-5K',  'HPT-5K')  WHERE productos LIKE '%HT-5K%';
UPDATE ordenes SET productos = REPLACE(productos, 'BH-50K', 'HIB-50K') WHERE productos LIKE '%BH-50K%';

-- ═══════════════════════════════════════════════════════════
-- 3. cuartos_frios.stock — JSONB con keys SKU
--    Si la key vieja existe, la suma a la key nueva (por si ya existía).
-- ═══════════════════════════════════════════════════════════

UPDATE cuartos_frios
SET stock = (
  SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
  FROM (
    SELECT
      CASE key
        WHEN 'HC-25K' THEN 'HPC-25K'
        WHEN 'HC-5K'  THEN 'HPC-5K'
        WHEN 'HT-25K' THEN 'HPT-25K'
        WHEN 'HT-5K'  THEN 'HPT-5K'
        WHEN 'BH-50K' THEN 'HIB-50K'
        ELSE key
      END AS new_key,
      SUM((value)::numeric) AS total_value
    FROM jsonb_each(stock)
    GROUP BY new_key
  ) sub
)
WHERE stock ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'];

-- ═══════════════════════════════════════════════════════════
-- 4. rutas — JSONB en carga, carga_autorizada, extra_autorizado
-- ═══════════════════════════════════════════════════════════

UPDATE rutas
SET carga = (
  SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
  FROM (
    SELECT
      CASE key
        WHEN 'HC-25K' THEN 'HPC-25K'
        WHEN 'HC-5K'  THEN 'HPC-5K'
        WHEN 'HT-25K' THEN 'HPT-25K'
        WHEN 'HT-5K'  THEN 'HPT-5K'
        WHEN 'BH-50K' THEN 'HIB-50K'
        ELSE key
      END AS new_key,
      SUM((value)::numeric) AS total_value
    FROM jsonb_each(carga)
    GROUP BY new_key
  ) sub
)
WHERE carga IS NOT NULL AND carga ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'];

UPDATE rutas
SET carga_autorizada = (
  SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
  FROM (
    SELECT
      CASE key
        WHEN 'HC-25K' THEN 'HPC-25K'
        WHEN 'HC-5K'  THEN 'HPC-5K'
        WHEN 'HT-25K' THEN 'HPT-25K'
        WHEN 'HT-5K'  THEN 'HPT-5K'
        WHEN 'BH-50K' THEN 'HIB-50K'
        ELSE key
      END AS new_key,
      SUM((value)::numeric) AS total_value
    FROM jsonb_each(carga_autorizada)
    GROUP BY new_key
  ) sub
)
WHERE carga_autorizada IS NOT NULL AND carga_autorizada ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'];

UPDATE rutas
SET extra_autorizado = (
  SELECT COALESCE(jsonb_object_agg(new_key, total_value), '{}'::jsonb)
  FROM (
    SELECT
      CASE key
        WHEN 'HC-25K' THEN 'HPC-25K'
        WHEN 'HC-5K'  THEN 'HPC-5K'
        WHEN 'HT-25K' THEN 'HPT-25K'
        WHEN 'HT-5K'  THEN 'HPT-5K'
        WHEN 'BH-50K' THEN 'HIB-50K'
        ELSE key
      END AS new_key,
      SUM((value)::numeric) AS total_value
    FROM jsonb_each(extra_autorizado)
    GROUP BY new_key
  ) sub
)
WHERE extra_autorizado IS NOT NULL AND extra_autorizado ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'];

COMMIT;

-- ═══════════════════════════════════════════════════════════
-- VERIFICACIÓN POST-MIGRACIÓN — corre estas queries para confirmar 0 referencias viejas:
-- ═══════════════════════════════════════════════════════════
-- SELECT COUNT(*) AS inv_mov_viejos FROM inventario_mov WHERE producto IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K');
-- SELECT COUNT(*) AS mermas_viejas FROM mermas WHERE sku IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K');
-- SELECT COUNT(*) AS prod_viejas FROM produccion WHERE sku IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K') OR input_sku IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K');
-- SELECT COUNT(*) AS precios_viejos FROM precios_esp WHERE sku IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K');
-- SELECT COUNT(*) AS lineas_viejas FROM orden_lineas WHERE sku IN ('HC-25K','HC-5K','HT-25K','HT-5K','BH-50K');
-- SELECT COUNT(*) AS ord_viejas FROM ordenes WHERE productos LIKE '%HC-25K%' OR productos LIKE '%HC-5K%' OR productos LIKE '%HT-25K%' OR productos LIKE '%HT-5K%' OR productos LIKE '%BH-50K%';
-- SELECT COUNT(*) AS cf_viejos FROM cuartos_frios WHERE stock ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'];
-- SELECT COUNT(*) AS rutas_viejas FROM rutas WHERE (carga IS NOT NULL AND carga ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'])
--   OR (carga_autorizada IS NOT NULL AND carga_autorizada ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K'])
--   OR (extra_autorizado IS NOT NULL AND extra_autorizado ?| ARRAY['HC-25K','HC-5K','HT-25K','HT-5K','BH-50K']);
