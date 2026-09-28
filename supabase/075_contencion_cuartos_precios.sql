-- 075_contencion_cuartos_precios.sql — Contención F3 (etapa 1 de 3).
--
-- F3-A / F3-F: las policies legacy de 031 dejaban a Chofer y Producción
-- (y al rol inexistente 'Almacén') escribir cuartos_frios directamente:
--   update_roles (UPDATE, todas las columnas) → stock arbitrario o negativo,
--   sin kardex, sin lock y sin atribución, saltándose update_stocks_atomic.
--   write_roles  (INSERT) → Producción podía crear cuartos con stock.
-- Ningún flujo del frontend lo necesita: todas las escrituras directas de
-- cuartos_frios son acciones de Admin, y los movimientos legítimos de Chofer
-- y Producción ya pasan por update_stocks_atomic (071, SECURITY DEFINER, no
-- depende de estas policies).
--
-- F3-G: precios_esp.ventas_write (INSERT para Ventas) no tiene consumidor;
-- la administración de precios especiales es solo Admin (addPrecioEsp).
--
-- Se conservan admin_all y read_all. Sin cambios de grants ni de funciones.
-- Idempotente.

DROP POLICY IF EXISTS update_roles ON public.cuartos_frios;
DROP POLICY IF EXISTS write_roles  ON public.cuartos_frios;
DROP POLICY IF EXISTS ventas_write ON public.precios_esp;
