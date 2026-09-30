-- 089_b3_contencion_ordenes.sql — B3 parte 2: sin INSERT directo de órdenes.
--
-- Se aplica DESPUÉS de desplegar el frontend que crea órdenes con
-- crear_orden (088). Ventas y Chofer dejan de insertar ordenes/orden_lineas
-- por REST: la venta normal usa crear_orden (precio, total, estado, folio y
-- actor del servidor) y la exprés, cerrar_ruta_financiero. Admin conserva
-- admin_all (frontera de confianza). Idempotente.
DROP POLICY IF EXISTS ventas_insert ON ordenes;
DROP POLICY IF EXISTS write_roles ON orden_lineas;
