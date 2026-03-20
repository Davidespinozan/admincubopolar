-- Harden public access and enforce stronger payment idempotency where possible.

-- 1) Remove anonymous full-access policies from core operational tables.
DROP POLICY IF EXISTS "anon_all" ON usuarios;
DROP POLICY IF EXISTS "anon_all" ON clientes;
DROP POLICY IF EXISTS "anon_all" ON productos;
DROP POLICY IF EXISTS "anon_all" ON precios_esp;
DROP POLICY IF EXISTS "anon_all" ON ordenes;
DROP POLICY IF EXISTS "anon_all" ON rutas;
DROP POLICY IF EXISTS "anon_all" ON produccion;
DROP POLICY IF EXISTS "anon_all" ON inventario_mov;
DROP POLICY IF EXISTS "anon_all" ON cuartos_frios;
DROP POLICY IF EXISTS "anon_all" ON comodatos;
DROP POLICY IF EXISTS "anon_all" ON leads;
DROP POLICY IF EXISTS "anon_all" ON empleados;
DROP POLICY IF EXISTS "anon_all" ON nomina_periodos;
DROP POLICY IF EXISTS "anon_all" ON nomina_recibos;
DROP POLICY IF EXISTS "anon_all" ON movimientos_contables;
DROP POLICY IF EXISTS "anon_all" ON mermas;
DROP POLICY IF EXISTS "anon_all" ON auditoria;

-- 2) Add a unique payment reference index only when current data is clean.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'idx_pagos_ref'
  ) AND NOT EXISTS (
    SELECT referencia
    FROM pagos
    WHERE referencia IS NOT NULL AND referencia <> ''
    GROUP BY referencia
    HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX idx_pagos_ref ON pagos(referencia) WHERE referencia <> '';
  END IF;
END $$;