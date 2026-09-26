-- 068_pagos_cliente_id_nullable.sql
-- P0 (seguridad financiera / integridad): pagos.cliente_id deja de usar
-- el centinela 0.
--
-- ANTES (variante 002_safe_migration aplicada en producción):
--   pagos.cliente_id BIGINT NOT NULL DEFAULT 0, sin FK a clientes.
--   El código insertaba `cliente_id: orden.cliente_id || 0` para órdenes
--   anónimas ("Público en general"), inventando una identidad que no
--   existe en clientes.
--
-- DESPUÉS:
--   pagos.cliente_id BIGINT NULL, sin DEFAULT. NULL = pago de una orden
--   sin cliente registrado. El código (persistence.js, cerrarRutaCompleta)
--   escribe NULL en ese caso y nunca 0.
--
-- Datos existentes: las filas con cliente_id = 0 (si las hubiera) se
-- normalizan a NULL. clientes.id es BIGSERIAL (empieza en 1), así que 0
-- nunca fue un cliente real. Ninguna otra fila cambia.
--
-- Idempotente: se puede correr más de una vez.

ALTER TABLE pagos ALTER COLUMN cliente_id DROP NOT NULL;
ALTER TABLE pagos ALTER COLUMN cliente_id DROP DEFAULT;

UPDATE pagos SET cliente_id = NULL WHERE cliente_id = 0;

COMMENT ON COLUMN pagos.cliente_id IS
  'clientes.id del pagador. NULL = orden sin cliente registrado (Público en general). Nunca 0 (P0, mig 068).';
