-- 070_enable_financial_rls.sql — P1 Fase A, forward-fix de P0-3.
--
-- Causa raíz: en producción `pagos`, `cuentas_por_cobrar` y
-- `movimientos_contables` tenían RLS DESHABILITADO (pg_class.relrowsecurity
-- = false). Con RLS apagado las policies no se evalúan y rige el grant de
-- tabla (authenticated: SELECT/INSERT/UPDATE/DELETE). 069 endureció las
-- policies pero no podía surtir efecto. Detectado en el smoke de seguridad
-- de producción del 2026-09-27.
--
-- ENABLE (no FORCE) es suficiente para el modelo actual:
--   - Los callers de la API (anon, authenticated) no son owners de las
--     tablas y no tienen BYPASSRLS → quedan sujetos a las policies de 069.
--   - Los contratos SECURITY DEFINER (crear_cxc_orden, abonar_cxc,
--     registrar_pago_orden, registrar_ingreso_orden, cerrar_ruta_financiero,
--     increment_saldo, ...) son owned by `postgres`, que es owner de las
--     tablas y tiene BYPASSRLS → operan igual que antes; su autorización la
--     hace fin_actor_permitido.
--   - El backend usa service_role (BYPASSRLS) → sin cambio.
--   FORCE solo afectaría al owner; activarlo no añade protección frente a
--   la API y podría romper contratos si el owner perdiera BYPASSRLS.
--
-- Sin nuevas policies, sin cambios de grants ni de funciones. Idempotente.
-- `mermas` queda FUERA (documentada como deuda del siguiente bloque).

ALTER TABLE public.pagos                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cuentas_por_cobrar    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.movimientos_contables ENABLE ROW LEVEL SECURITY;
