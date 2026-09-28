-- 081_contencion_ruta_id_ordenes.sql — B3 / R1b: ordenes.ruta_id solo lo
-- asigna Admin (o un contrato del servidor).
--
-- Causa raíz (auditoría 080): la policy ordenes.ventas_update deja a Ventas,
-- Chofer y Facturación actualizar la fila, y ordenes_guard_financiero (069)
-- permite cambiar ruta_id a un actor no Admin cuando la transición es
-- Creada → Asignada. Esa excepción existía para la asignación previa a 080;
-- hoy la única operación legítima de Ventas es asignar_orden con
-- p_ruta_id NULL (080), que no toca ruta_id. Con la excepción, Ventas podía
-- despachar una orden Creada a una ruta concreta por UPDATE directo.
--
-- Mecanismo mínimo, sin modificar el contrato 069: un segundo trigger
-- BEFORE UPDATE (ordenes_guard_ruta) que rechaza cualquier cambio de
-- ordenes.ruta_id cuando el actor autenticado no es Admin activo (071).
-- Mismas exenciones que la guardia 069: sin JWT (SQL/cron), service_role y
-- contexto de contrato (app.fin_ctx, que solo fijan las RPC de 069; ningún
-- rol puede ejecutar fin_marcar_ctx). Así siguen funcionando:
--   asignar_orden / asignar_ordenes_a_ruta / cancelar_orden_asignada (080):
--     Admin cambia ruta_id; Ventas solo Creada → Asignada con ruta NULL.
--   cerrar_ruta_financiero (069): completa ruta_id de entregas escalonadas
--     dentro del contexto de contrato.
--   cancelarRutaConDevolucion / cerrarRuta (Admin directo): intactos.
--   Ventas cobro (estatus, metodo_pago, folio_nota) y Chofer no-entrega
--     (estatus, motivo, fecha, reagendada): no tocan ruta_id.
-- Se conservan tal cual ventas_update, ordenes_guard_financiero y el modelo
-- de transiciones. Idempotente.

CREATE OR REPLACE FUNCTION ordenes_guard_ruta() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo() THEN
    RETURN NEW;
  END IF;
  IF NEW.ruta_id IS DISTINCT FROM OLD.ruta_id
     AND COALESCE(erp_rol_activo(), '') <> 'Admin' THEN
    RAISE EXCEPTION 'ordenes: ruta_id solo lo asigna Admin (usa asignar_orden sin ruta)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION ordenes_guard_ruta() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ordenes_guard_ruta ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_ruta
  BEFORE UPDATE ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION ordenes_guard_ruta();
