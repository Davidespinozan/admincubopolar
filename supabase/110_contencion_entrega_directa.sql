-- 110_contencion_entrega_directa.sql — OL-02D2: contención del camino
-- heredado de venta directa (dos pasos). Aditiva: una guarda nueva; no cambia
-- la guarda 105, ni políticas, ni grants, ni el contrato 109. Sin datos.
--
-- Invariante: fuera del contexto de contrato (app.fin_ctx = 'rpc'), ninguna
-- escritura puede llevar a 'Entregada' una orden que NO tenía ruta antes del
-- UPDATE y que estaba en un estado de entrega física pendiente ('Creada',
-- 'Asignada', 'En ruta'). La venta sin ruta se entrega con
-- completar_venta_directa (109): cobro/CxC + salida de inventario + Entregada
-- en una transacción. Aplica a cualquier actor (Ventas, Admin y service role):
-- la regla es CÓMO ocurre la entrega física, no QUIÉN la pide.
--
-- Se usa la ruta ANTERIOR (OLD.ruta_id): un UPDATE que pone ruta y Entregada a
-- la vez sobre una orden sin ruta también se rechaza.
--
-- Sigue permitido:
--   * entrega con ruta (chofer, en línea o desde la cola offline; Admin):
--     OLD.ruta_id no es NULL;
--   * completar_venta_directa y el cierre de ruta (cerrar_ruta_financiero):
--     marcan el contexto de contrato antes del UPDATE;
--   * cancelación de CFDI (Facturada → Entregada, service role): 'Facturada'
--     no está en los estados vigilados;
--   * el webhook del link (OL-02D1) ya no escribe estatus.
-- Las demás transiciones siguen gobernadas por ordenes_guard_financiero (105);
-- esta guarda solo agrega una barrera, no abre ninguna transición.
--
-- Reversión (vuelve a permitir el camino heredado de dos pasos):
--   DROP TRIGGER IF EXISTS trg_ordenes_guard_entrega_directa ON public.ordenes;
--   DROP FUNCTION IF EXISTS public.ordenes_guard_entrega_directa();

CREATE OR REPLACE FUNCTION public.ordenes_guard_entrega_directa() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF fin_ctx_activo() THEN
    RETURN NEW;
  END IF;
  IF NEW.estatus = 'Entregada'
     AND OLD.estatus IN ('Creada', 'Asignada', 'En ruta')
     AND OLD.ruta_id IS NULL THEN
    RAISE EXCEPTION 'ordenes: una venta sin ruta se entrega con completar_venta_directa (cobro y salida de inventario en un solo paso)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_entrega_directa() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_ordenes_guard_entrega_directa ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_entrega_directa
  BEFORE UPDATE OF estatus ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_entrega_directa();
