-- 099_contencion_pagos_proveedores.sql — parte 2 de 2. Se aplica DESPUÉS de
-- desplegar el frontend que paga cuentas por pagar con pagar_cuenta_por_pagar
-- (098). Idempotente.
-- La API ya no inserta en pagos_proveedores por REST: el pago a proveedor
-- (con su fecha de negocio del servidor) solo lo registra el contrato. Un
-- cliente anterior que lo intente revierte su abono y su egreso.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON pagos_proveedores FROM authenticated;
DO $$
DECLARE v_seq TEXT := pg_get_serial_sequence('public.pagos_proveedores', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM authenticated', v_seq);
  END IF;
END $$;
