-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Migration 004: Control Financiero
-- Actualiza tabla pagos, agrega índices para consultas financieras
-- ═══════════════════════════════════════════════════════════════

-- Agregar columnas faltantes a pagos
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS orden_id BIGINT REFERENCES ordenes(id);
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS metodo_pago TEXT DEFAULT 'Efectivo';
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS fecha DATE DEFAULT CURRENT_DATE;
ALTER TABLE pagos ADD COLUMN IF NOT EXISTS cxc_id BIGINT REFERENCES cuentas_por_cobrar(id);

-- Índices para consultas rápidas
CREATE INDEX IF NOT EXISTS idx_pagos_fecha ON pagos(fecha);
CREATE INDEX IF NOT EXISTS idx_pagos_orden ON pagos(orden_id);
CREATE INDEX IF NOT EXISTS idx_pagos_cxc ON pagos(cxc_id);
CREATE INDEX IF NOT EXISTS idx_cxc_vencimiento ON cuentas_por_cobrar(fecha_vencimiento);

-- Agregar columna concepto a cuentas_por_cobrar para mejor descripción
ALTER TABLE cuentas_por_cobrar ADD COLUMN IF NOT EXISTS concepto TEXT DEFAULT '';

-- Agregar columna metodo_pago a ordenes si no existe
ALTER TABLE ordenes ADD COLUMN IF NOT EXISTS metodo_pago TEXT DEFAULT 'Efectivo';

-- RLS para pagos (si no existe)
ALTER TABLE pagos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "pagos_read_all" ON pagos;
DROP POLICY IF EXISTS "pagos_write" ON pagos;
CREATE POLICY "pagos_read_all" ON pagos FOR SELECT TO authenticated USING (true);
CREATE POLICY "pagos_write" ON pagos FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Función para incrementar/decrementar saldo de cliente
CREATE OR REPLACE FUNCTION increment_saldo(p_cli BIGINT, p_delta NUMERIC)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE clientes SET saldo = saldo + p_delta WHERE id = p_cli;
END;
$$;
