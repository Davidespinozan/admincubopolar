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

-- ── PRODUCTOS DEMO ─────────────────────────────────────────────
-- No se crean productos nuevos. Este seed usa SKUs ya existentes:
-- HC-25K, HC-5K, EMP-25 y EMP-5.

-- ── PRECIOS ESPECIALES DEMO ───────────────────────────────────
INSERT INTO precios_esp (cliente_id, sku, precio)
SELECT c.id, 'HC-25K', 82.00
FROM clientes c
WHERE c.rfc = 'MES901010AA1'
  AND NOT EXISTS (
    SELECT 1 FROM precios_esp pe WHERE pe.cliente_id = c.id AND pe.sku = 'HC-25K'
  );

-- ── RUTA DEMO ──────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='rutas' AND column_name='carga' AND data_type='jsonb'
  ) THEN
    INSERT INTO rutas (folio, nombre, chofer_id, chofer_nombre, estatus, carga)
    SELECT 'DEMO-R-001', 'DEMO Ruta Centro', u.id, u.nombre, 'Programada', '{"bolsas":80}'::jsonb
    FROM usuarios u
    WHERE u.email = 'demo.chofer1@cubopolar.test'
      AND NOT EXISTS (SELECT 1 FROM rutas r WHERE r.folio = 'DEMO-R-001');
  ELSE
    INSERT INTO rutas (folio, nombre, chofer_id, estatus, carga)
    SELECT 'DEMO-R-001', 'DEMO Ruta Centro', u.id, 'Programada', '80 bolsas'
    FROM usuarios u
    WHERE u.email = 'demo.chofer1@cubopolar.test'
      AND NOT EXISTS (SELECT 1 FROM rutas r WHERE r.folio = 'DEMO-R-001');
  END IF;
END $$;

-- ── ORDEN + LÍNEA DEMO ────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='ordenes' AND column_name='cliente_nombre'
  ) THEN
    INSERT INTO ordenes (folio, cliente_id, cliente_nombre, fecha, productos, total, estatus, ruta_id)
    SELECT 'DEMO-OV-001', c.id, c.nombre, CURRENT_DATE, '10×HC-25K', 820.00, 'Creada', NULL
    FROM clientes c
    WHERE c.rfc = 'MES901010AA1'
      AND NOT EXISTS (SELECT 1 FROM ordenes o WHERE o.folio = 'DEMO-OV-001');
  ELSE
    INSERT INTO ordenes (folio, cliente_id, fecha, total, estatus, ruta_id)
    SELECT 'DEMO-OV-001', c.id, CURRENT_DATE, 820.00, 'Creada', NULL
    FROM clientes c
    WHERE c.rfc = 'MES901010AA1'
      AND NOT EXISTS (SELECT 1 FROM ordenes o WHERE o.folio = 'DEMO-OV-001');
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='public' AND table_name='orden_lineas'
  ) THEN
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
    SELECT o.id, 'HC-25K', 10, 82.00, 820.00
    FROM ordenes o
    WHERE o.folio = 'DEMO-OV-001'
      AND NOT EXISTS (
        SELECT 1 FROM orden_lineas ol WHERE ol.orden_id = o.id AND ol.sku = 'HC-25K'
      );
  END IF;
END $$;

-- ── PRODUCCIÓN DEMO ───────────────────────────────────────────
INSERT INTO produccion (folio, fecha, turno, maquina, sku, cantidad, estatus)
SELECT 'DEMO-OP-001', now(), 'Matutino', 'Máquina 20', 'HC-25K', 60, 'Confirmada'
WHERE NOT EXISTS (
  SELECT 1 FROM produccion p WHERE p.folio = 'DEMO-OP-001'
);

-- ── INVENTARIO MOV DEMO (para visualizar partida doble y kardex)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='inventario_mov' AND column_name='producto'
  ) THEN
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    SELECT 'Entrada', 'EMP-25', 300, 'Compra DEMO', 'Sistema DEMO'
    WHERE NOT EXISTS (
      SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Entrada' AND m.producto = 'EMP-25' AND m.origen = 'Compra DEMO'
    );

    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    SELECT 'Salida', 'EMP-25', 120, 'Consumo DEMO-OP-001', 'Sistema DEMO'
    WHERE NOT EXISTS (
      SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Salida' AND m.producto = 'EMP-25' AND m.origen = 'Consumo DEMO-OP-001'
    );
  ELSE
    INSERT INTO inventario_mov (tipo, sku, cantidad, origen, usuario_id)
    SELECT 'Entrada', 'EMP-25', 300, 'Compra DEMO', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Entrada' AND m.sku = 'EMP-25' AND m.origen = 'Compra DEMO'
    );

    INSERT INTO inventario_mov (tipo, sku, cantidad, origen, usuario_id)
    SELECT 'Salida', 'EMP-25', 120, 'Consumo DEMO-OP-001', NULL
    WHERE NOT EXISTS (
      SELECT 1 FROM inventario_mov m WHERE m.tipo = 'Salida' AND m.sku = 'EMP-25' AND m.origen = 'Consumo DEMO-OP-001'
    );
  END IF;
END $$;

-- ── CUARTOS FRÍOS (JSONB stock) DEMO ──────────────────────────
-- Si existe Cuarto Frío 1/2/3, suma stock demo en JSONB para ver datos en Congeladores.
UPDATE cuartos_frios
SET stock = COALESCE(stock, '{}'::jsonb)
          || jsonb_build_object('HC-25K', COALESCE((stock->>'HC-25K')::int, 0) + 120)
WHERE nombre IN ('Cuarto Frío 1', 'Cuarto Frio 1')
  AND NOT EXISTS (
    SELECT 1 FROM cuartos_frios cf
    WHERE cf.id = cuartos_frios.id
      AND COALESCE((cf.stock->>'HC-25K')::int, 0) >= 120
  );

UPDATE cuartos_frios
SET stock = COALESCE(stock, '{}'::jsonb)
          || jsonb_build_object('HC-5K', COALESCE((stock->>'HC-5K')::int, 0) + 80)
WHERE nombre IN ('Cuarto Frío 2', 'Cuarto Frio 2', 'Cuarto Frío 3', 'Cuarto Frio 3')
  AND NOT EXISTS (
    SELECT 1 FROM cuartos_frios cf
    WHERE cf.id = cuartos_frios.id
      AND COALESCE((cf.stock->>'HC-5K')::int, 0) >= 80
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════
-- Limpieza rápida (opcional):
-- DELETE FROM orden_lineas WHERE orden_id IN (SELECT id FROM ordenes WHERE folio LIKE 'DEMO-%');
-- DELETE FROM ordenes WHERE folio LIKE 'DEMO-%';
-- DELETE FROM produccion WHERE folio LIKE 'DEMO-%';
-- DELETE FROM rutas WHERE folio LIKE 'DEMO-%';
-- DELETE FROM precios_esp WHERE sku = 'HC-25K' AND cliente_id IN (SELECT id FROM clientes WHERE nombre LIKE 'DEMO %');
-- DELETE FROM clientes WHERE nombre LIKE 'DEMO %';
-- DELETE FROM usuarios WHERE email LIKE 'demo.%@cubopolar.test';
-- DELETE FROM inventario_mov WHERE origen LIKE '%DEMO%';
-- ═══════════════════════════════════════════════════════════════
