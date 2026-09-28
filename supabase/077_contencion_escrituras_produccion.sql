-- 077_contencion_escrituras_produccion.sql — Contención F3 (F3-B, F3-C, F3-E).
--
-- Con 076 en producción (registrar_produccion / registrar_transformacion) y
-- el frontend migrado (commit 9473a14), ningún flujo legítimo de Producción,
-- Chofer ni Ventas escribe directo en estas tablas (auditoría estática de
-- callers en src/__tests__/produccionAtomica.test.js). Estas policies legacy
-- de 031 ya solo abren escrituras directas que saltan los contratos:
--
--   F3-B  productos.produccion_update  (UPDATE, Producción/'Almacén'):
--         cualquier columna, incluido sku → bypass hermano de 074.
--   F3-C  inventario_mov.insert_roles  (INSERT, Producción/'Almacén'/Chofer/
--         Ventas): kardex arbitrario (actor, producto, cantidad).
--   F3-E  produccion.produccion_update (UPDATE, Producción) y
--         produccion.produccion_write  (INSERT, Producción): historia y
--         estado de producción sin contrato.
--
-- Se conservan admin_all y read_all en las tres tablas. Los contratos
-- SECURITY DEFINER (071 stock, 072 mermas, 074 rename_sku, 076 producción)
-- no dependen de estas policies. Sin políticas de reemplazo, sin cambios de
-- grants, funciones, triggers ni frontend. Idempotente.

DROP POLICY IF EXISTS produccion_update ON public.productos;
DROP POLICY IF EXISTS insert_roles      ON public.inventario_mov;
DROP POLICY IF EXISTS produccion_update ON public.produccion;
DROP POLICY IF EXISTS produccion_write  ON public.produccion;
