-- 091_b4_contencion_cxc.sql — B4 parte 2: cuentas_por_cobrar sin DML directo.
--
-- Se aplica DESPUÉS de desplegar el frontend que anula / ajusta la CxC con
-- anular_cxc_orden y ajustar_cxc_devolucion (090). Ningún JWT (Admin
-- incluido) crea, modifica ni borra CxC por REST; los contratos
-- SECURITY DEFINER y service_role (webhooks de pago) siguen escribiendo.
-- Idempotente.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON cuentas_por_cobrar FROM authenticated;
