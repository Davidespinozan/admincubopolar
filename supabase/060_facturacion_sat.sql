-- 060_facturacion_sat.sql
-- Cierre de pendientes Facturación SAT (auditoría facturación Tanda 4):
--   1. productos.clave_prod_serv + clave_unidad (CFDI 4.0): backend
--      lee del catálogo del producto en lugar de PRODUCT_CATALOG
--      hardcoded.
--   2. Backfill de SKUs reales de Cubo Polar:
--        HIB-* (Hielo Industrial Barra)
--        HIP-* (Hielo Industrial Pieza)
--        HIT-* (Hielo Industrial Triturado)
--        HPC-* (Hielo Premium Cubo)
--        HPT-* (Hielo Premium Triturado)
--        HC-/HT-/BH-* (legacy por si quedan)
--      Todos esos: 50202302 (clave SAT genérica para hielo).
--      EMP-*: 24121800 (clave SAT empaques).
--   3. Normalización de clientes.regimen y configuracion_empresa.regimen_fiscal:
--      mapear strings legacy ("Régimen General", etc.) a códigos SAT
--      ('601', '626', '616'). UI cambia a select con catálogo SAT.
--
-- David ejecutó manualmente el backfill correcto sobre la BD; este
-- archivo refleja el estado final para que un clone del repo pueda
-- reproducirlo.

-- ─────────────────────────────────────────────────────────────────
-- PASO 1: columnas SAT en productos
-- ─────────────────────────────────────────────────────────────────

ALTER TABLE productos
  ADD COLUMN IF NOT EXISTS clave_prod_serv VARCHAR(8),
  ADD COLUMN IF NOT EXISTS clave_unidad    VARCHAR(5) DEFAULT 'H87';

COMMENT ON COLUMN productos.clave_prod_serv IS
  'Clave de producto/servicio del catálogo SAT c_ClaveProdServ (8 dígitos). Default null → fallback en backend a 50202302.';
COMMENT ON COLUMN productos.clave_unidad IS
  'Clave de unidad SAT c_ClaveUnidad (default H87 = pieza).';

-- ─────────────────────────────────────────────────────────────────
-- PASO 2: backfill clave_prod_serv para SKUs existentes
-- ─────────────────────────────────────────────────────────────────
-- SKUs reales de Cubo Polar (verificado con David 2026-05-05).

-- Hielo en cualquier presentación: clave SAT 50202302
UPDATE productos
   SET clave_prod_serv = '50202302'
 WHERE clave_prod_serv IS NULL
   AND (
        sku LIKE 'HIB-%'   -- Hielo Industrial Barra
     OR sku LIKE 'HIP-%'   -- Hielo Industrial Pieza
     OR sku LIKE 'HIT-%'   -- Hielo Industrial Triturado
     OR sku LIKE 'HPC-%'   -- Hielo Premium Cubo
     OR sku LIKE 'HPT-%'   -- Hielo Premium Triturado
     OR sku LIKE 'HC-%'    -- legacy (por si queda)
     OR sku LIKE 'HT-%'    -- legacy (por si queda)
     OR sku LIKE 'BH-%'    -- legacy barra (por si queda)
   );

-- Empaques: clave SAT 24121800
UPDATE productos
   SET clave_prod_serv = '24121800'
 WHERE clave_prod_serv IS NULL
   AND sku LIKE 'EMP-%';

-- ─────────────────────────────────────────────────────────────────
-- PASO 3: normalizar clientes.regimen a códigos SAT
-- ─────────────────────────────────────────────────────────────────
-- Antes la UI guardaba strings ("Régimen General"). Ahora guarda
-- códigos SAT directos ('601', '626', etc.). Mapeo legacy:

UPDATE clientes SET regimen = '601'
 WHERE regimen IN ('Régimen General', 'General de Ley Personas Morales');

UPDATE clientes SET regimen = '626'
 WHERE regimen ILIKE '%Simplificado%' AND regimen NOT SIMILAR TO '\d{3}';

UPDATE clientes SET regimen = '612'
 WHERE regimen ILIKE '%Personas Físicas%' AND regimen NOT SIMILAR TO '\d{3}';

UPDATE clientes SET regimen = '605'
 WHERE regimen ILIKE '%Sueldos%' AND regimen NOT SIMILAR TO '\d{3}';

UPDATE clientes SET regimen = '621'
 WHERE regimen ILIKE '%Incorporación Fiscal%' AND regimen NOT SIMILAR TO '\d{3}';

-- Sin obligaciones / vacío / cualquier otro string que NO sea un código
-- de 3 dígitos válido → 616 (sin obligaciones, default seguro).
UPDATE clientes SET regimen = '616'
 WHERE regimen IS NULL
    OR TRIM(regimen) = ''
    OR (regimen NOT SIMILAR TO '\d{3}'
        AND regimen NOT IN ('601', '603', '605', '606', '607', '608', '610',
                            '611', '612', '614', '615', '616', '620', '621',
                            '622', '623', '624', '625', '626'));

-- ─────────────────────────────────────────────────────────────────
-- PASO 4: normalizar configuracion_empresa.regimen_fiscal
-- ─────────────────────────────────────────────────────────────────
-- El placeholder de la UI sugería formato "601 General de Ley...".
-- Si quedó capturado así, extraer los primeros 3 dígitos.

UPDATE configuracion_empresa
   SET regimen_fiscal = SUBSTRING(regimen_fiscal FROM '^\d{3}')
 WHERE regimen_fiscal SIMILAR TO '\d{3}\s.*';

-- Si quedaron strings sin código, dejar como '601' (Persona Moral
-- es la forma legal típica de empresa con CFDI activo). Admin
-- corrige si su régimen real es otro.
UPDATE configuracion_empresa
   SET regimen_fiscal = '601'
 WHERE regimen_fiscal IS NULL
    OR TRIM(regimen_fiscal) = ''
    OR regimen_fiscal NOT SIMILAR TO '\d{3}';
