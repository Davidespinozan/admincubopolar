-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Demo data extra (falso, para pruebas)
-- Idempotente: se puede ejecutar varias veces sin duplicar por claves naturales
-- Ejecutar en Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════

BEGIN;

-- ── USUARIOS DEMO ──────────────────────────────────────────────
INSERT INTO usuarios (nombre, email, rol, estatus)
SELECT * FROM (VALUES
  ('Demo Admin', 'demo.admin@cubopolar.test', 'Admin', 'Activo'),
  ('Demo Chofer 1', 'demo.chofer1@cubopolar.test', 'Chofer', 'Activo'),
  ('Demo Ventas 1', 'demo.ventas1@cubopolar.test', 'Ventas', 'Activo'),
  ('Demo Facturacion 1', 'demo.facturacion1@cubopolar.test', 'Facturación', 'Activo')
) AS v(nombre, email, rol, estatus)
WHERE NOT EXISTS (
  SELECT 1 FROM usuarios u WHERE u.email = v.email
);

-- ── CLIENTES DEMO ──────────────────────────────────────────────
INSERT INTO clientes (nombre, rfc, regimen, uso_cfdi, cp, correo, tipo, contacto, saldo, estatus)
SELECT * FROM (VALUES
  ('DEMO Minisuper La Esquina', 'MES901010AA1', 'Régimen General', 'G03', '34010', 'facturas.esquina@demo.test', 'Tienda', '6181111111', 0, 'Activo'),
  ('DEMO Taquería El Norte', 'TEN920202BB2', 'Régimen General', 'G03', '34020', 'facturas.norte@demo.test', 'Restaurante', '6182222222', 0, 'Activo'),
  ('DEMO Hotel Plaza Centro', 'HPC930303CC3', 'Régimen General', 'G03', '34030', 'facturas.hotel@demo.test', 'Hotel', '6183333333', 0, 'Activo'),
  ('DEMO Público en general', 'XAXX010101000', 'Sin obligaciones', 'S01', '34000', 'publico.general@demo.test', 'General', '6180000000', 0, 'Activo')
) AS v(nombre, rfc, regimen, uso_cfdi, cp, correo, tipo, contacto, saldo, estatus)
WHERE NOT EXISTS (
  SELECT 1 FROM clientes c WHERE c.rfc = v.rfc
);

-- ── PRODUCTOS DEMO (sin tocar SKU productivos existentes) ─────
INSERT INTO productos (sku, nombre, tipo, stock, ubicacion, precio, empaque_sku)
SELECT * FROM (VALUES
  ('DEMO-HC-10K', 'DEMO Hielo Cubo 10 kg', 'Producto Terminado', 180, 'CF-2', 42.00, 'EMP-5'),
  ('DEMO-HT-10K', 'DEMO Hielo Triturado 10 kg', 'Producto Terminado', 120, 'CF-3', 39.00, 'EMP-5')
) AS v(sku, nombre, tipo, stock, ubicacion, precio, empaque_sku)
WHERE NOT EXISTS (
  SELECT 1 FROM productos p WHERE p.sku = v.sku
);

-- ── PRECIOS ESPECIALES DEMO ───────────────────────────────────
INSERT INTO precios_esp (cliente_id, sku, precio)
SELECT c.id, 'DEMO-HC-10K', 38.00
FROM clientes c
WHERE c.rfc = 'MES901010AA1'
  AND NOT EXISTS (
    SELECT 1 FROM precios_esp pe WHERE pe.cliente_id = c.id AND pe.sku = 'DEMO-HC-10K'
  );

-- ── RUTA DEMO ──────────────────────────────────────────────────
INSERT INTO rutas (folio, nombre, chofer_id, estatus, carga)
SELECT 'DEMO-R-001', 'DEMO Ruta Centro', u.id, 'Programada', '80 bolsas'
FROM usuarios u
WHERE u.email = 'demo.chofer1@cubopolar.test'
  AND NOT EXISTS (
    SELECT 1 FROM rutas r WHERE r.folio = 'DEMO-R-001'
  );

-- ── ORDEN + LÍNEA DEMO ────────────────────────────────────────
INSERT INTO ordenes (folio, cliente_id, fecha, total, estatus, ruta_id)
SELECT 'DEMO-OV-001', c.id, CURRENT_DATE, 760.00, 'Creada', NULL
FROM clientes c
WHERE c.rfc = 'MES901010AA1'
  AND NOT EXISTS (
    SELECT 1 FROM ordenes o WHERE o.folio = 'DEMO-OV-001'
  );

INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
SELECT o.id, 'DEMO-HC-10K', 20, 38.00, 760.00
FROM ordenes o
WHERE o.folio = 'DEMO-OV-001'
  AND NOT EXISTS (
    SELECT 1 FROM orden_lineas ol WHERE ol.orden_id = o.id AND ol.sku = 'DEMO-HC-10K'
  );

-- ── PRODUCCIÓN DEMO ───────────────────────────────────────────
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus)
SELECT 'DEMO-OP-001', now(), 'Matutino', 'Máquina 20', 'DEMO-HC-10K', 60, 'Confirmada'
WHERE NOT EXISTS (
  SELECT 1 FROM produccion p WHERE p.folio = 'DEMO-OP-001'
);

-- ── INVENTARIO MOV DEMO (para visualizar partida doble y kardex)
-- Nota: usa columnas que consume la app actual: producto y usuario (texto).
INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
SELECT 'Entrada', 'EMP-5', 300, 'Compra DEMO', 'Sistema DEMO'
WHERE NOT EXISTS (
  SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Entrada' AND m.producto = 'EMP-5' AND m.origen = 'Compra DEMO'
);

INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
SELECT 'Salida', 'EMP-5', 120, 'Consumo DEMO-OP-001', 'Sistema DEMO'
WHERE NOT EXISTS (
  SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Salida' AND m.producto = 'EMP-5' AND m.origen = 'Consumo DEMO-OP-001'
);

-- ── CUARTOS FRÍOS (JSONB stock) DEMO ──────────────────────────
-- Si existe Cuarto Frío 1/2/3, suma stock demo en JSONB para ver datos en Congeladores.
UPDATE cuartos_frios
SET stock = COALESCE(stock, '{}'::jsonb)
          || jsonb_build_object('DEMO-HC-10K', COALESCE((stock->>'DEMO-HC-10K')::int, 0) + 120)
WHERE nombre IN ('Cuarto Frío 1', 'Cuarto Frio 1')
  AND NOT EXISTS (
    SELECT 1 FROM cuartos_frios cf
    WHERE cf.id = cuartos_frios.id
      AND COALESCE((cf.stock->>'DEMO-HC-10K')::int, 0) >= 120
  );

UPDATE cuartos_frios
SET stock = COALESCE(stock, '{}'::jsonb)
          || jsonb_build_object('DEMO-HT-10K', COALESCE((stock->>'DEMO-HT-10K')::int, 0) + 80)
WHERE nombre IN ('Cuarto Frío 2', 'Cuarto Frio 2', 'Cuarto Frío 3', 'Cuarto Frio 3')
  AND NOT EXISTS (
    SELECT 1 FROM cuartos_frios cf
    WHERE cf.id = cuartos_frios.id
      AND COALESCE((cf.stock->>'DEMO-HT-10K')::int, 0) >= 80
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Limpieza rápida (opcional):
-- DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE folio LIKE 'DEMO-%');
-- DELETE FROM ordenes WHERE folio LIKE 'DEMO-%';
-- DELETE FROM produccion WHERE folio LIKE 'DEMO-%';
-- DELETE FROM rutas WHERE folio LIKE 'DEMO-%';
-- DELETE FROM precios_esp WHERE sku LIKE 'DEMO-%';
-- DELETE FROM productos WHERE sku LIKE 'DEMO-%';
-- DELETE FROM clientes WHERE nombre LIKE 'DEMO %';
-- DELETE FROM usuarios WHERE email LIKE 'demo.%@cubopolar.test';
-- DELETE FROM inventario_mov WHERE origen LIKE '%DEMO%';
-- ═══════════════════════════════════════════════════════════════
