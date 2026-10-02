-- 105_contencion_devoluciones.sql — parte 2 de 2. Se aplica DESPUÉS de
-- desplegar el frontend que registra devoluciones con registrar_devolucion
-- (104). Idempotente.
--   1. devoluciones: inmutable por API (sin INSERT/UPDATE/DELETE REST; guarda
--      como segunda capa). La devolución canónica es la del contrato.
--   2. ordenes.tiene_devolucion: solo la pone el contrato (ni Admin ni Chofer
--      la cambian por REST).
--   3. update_stocks_atomic y ajustar_cxc_devolucion: sin EXECUTE de la API
--      (su último llamador era la devolución del cliente; 095 queda superado
--      en la frontera de la API, no relajado). service_role/SQL los conservan.
--   4. Egreso de reembolso de una orden (categoría Devoluciones con orden):
--      solo el contrato lo escribe; los asientos manuales sin orden siguen.

-- ═══ 1. devoluciones inmutable por API ═══
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON devoluciones FROM authenticated;
DO $$
DECLARE v_seq TEXT := pg_get_serial_sequence('public.devoluciones', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM authenticated', v_seq);
  END IF;
END $$;
CREATE OR REPLACE FUNCTION public.devoluciones_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'devoluciones: la devolución la registra registrar_devolucion; es inmutable' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.devoluciones_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_devoluciones_guard ON devoluciones;
CREATE TRIGGER trg_devoluciones_guard BEFORE INSERT OR UPDATE OR DELETE ON devoluciones
  FOR EACH ROW EXECUTE FUNCTION public.devoluciones_guard();

-- ═══ 2. ordenes.tiene_devolucion: solo por contrato ═══
CREATE OR REPLACE FUNCTION public.ordenes_guard_financiero()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_rol TEXT;
  v_ok  BOOLEAN;
BEGIN
  -- Backend (service_role), sesión directa (postgres) y contratos rpc:
  -- sin restricción aquí (ya autorizados).
  IF v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo() THEN
    RETURN NEW;
  END IF;

  v_rol := COALESCE(fin_mi_rol_activo(), '');

  -- Campos financieros/fiscales: inmutables por REST para cualquier rol.
  IF NEW.total            IS DISTINCT FROM OLD.total
     OR NEW.cliente_id    IS DISTINCT FROM OLD.cliente_id
     OR NEW.tipo_cobro    IS DISTINCT FROM OLD.tipo_cobro
     OR NEW.requiere_factura IS DISTINCT FROM OLD.requiere_factura
     OR NEW.facturama_id  IS DISTINCT FROM OLD.facturama_id
     OR NEW.facturama_folio IS DISTINCT FROM OLD.facturama_folio
     OR NEW.facturama_uuid IS DISTINCT FROM OLD.facturama_uuid
     OR NEW.cfdi_cancelado_at IS DISTINCT FROM OLD.cfdi_cancelado_at
     OR NEW.cfdi_cancelado_motivo IS DISTINCT FROM OLD.cfdi_cancelado_motivo
     OR NEW.cfdi_cancelado_motivo_detalle IS DISTINCT FROM OLD.cfdi_cancelado_motivo_detalle
     OR NEW.cfdi_cancelado_uuid_sustituto IS DISTINCT FROM OLD.cfdi_cancelado_uuid_sustituto
     OR NEW.cfdi_cancelado_por IS DISTINCT FROM OLD.cfdi_cancelado_por
     -- 105: la marca de devolución la pone solo registrar_devolucion.
     OR NEW.tiene_devolucion IS DISTINCT FROM OLD.tiene_devolucion
  THEN
    RAISE EXCEPTION 'ordenes: campo financiero/fiscal inmutable por REST (usa el flujo autorizado)'
      USING ERRCODE = '42501';
  END IF;

  -- ruta_id: Admin, o asignación Creada→Asignada (RPC asignar_ordenes_a_ruta).
  IF NEW.ruta_id IS DISTINCT FROM OLD.ruta_id AND v_rol <> 'Admin'
     AND NOT (OLD.estatus = 'Creada' AND NEW.estatus = 'Asignada') THEN
    RAISE EXCEPTION 'ordenes: ruta_id solo lo cambia Admin o la asignación de ruta' USING ERRCODE = '42501';
  END IF;

  -- metodo_pago: solo al registrar la entrega/cobro, o Admin.
  IF NEW.metodo_pago IS DISTINCT FROM OLD.metodo_pago AND v_rol <> 'Admin'
     AND NOT (NEW.estatus = 'Entregada' AND OLD.estatus IS DISTINCT FROM 'Entregada') THEN
    RAISE EXCEPTION 'ordenes: metodo_pago solo cambia al cobrar' USING ERRCODE = '42501';
  END IF;

  -- estatus: transiciones de la FSM del ERP. Facturada/Entregada←Facturada
  -- son exclusivas del backend.
  IF NEW.estatus IS DISTINCT FROM OLD.estatus THEN
    v_ok := CASE OLD.estatus
      WHEN 'Creada'   THEN NEW.estatus IN ('Asignada', 'Cancelada')
      WHEN 'Asignada' THEN NEW.estatus IN ('En ruta', 'Entregada', 'No entregada', 'Cancelada')
                           OR (NEW.estatus = 'Creada' AND v_rol = 'Admin')
      WHEN 'En ruta'  THEN NEW.estatus IN ('Entregada', 'No entregada', 'Cancelada')
      ELSE FALSE
    END;
    IF NOT COALESCE(v_ok, false) THEN
      RAISE EXCEPTION 'ordenes: transición % → % no permitida por REST', OLD.estatus, NEW.estatus
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END $function$;

-- ═══ 3. Primitivas genéricas fuera de la API ═══
REVOKE EXECUTE ON FUNCTION public.update_stocks_atomic(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ajustar_cxc_devolucion(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ═══ 4. Egreso de reembolso: reservado al contrato ═══
CREATE OR REPLACE FUNCTION public.movimientos_contables_devolucion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND (COALESCE(NEW.referencia, '') LIKE 'DEVOL-%'
       OR (NEW.tipo = 'Egreso' AND NEW.categoria = 'Devoluciones' AND NEW.orden_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'movimientos_contables: el reembolso de una devolución lo registra registrar_devolucion' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND (COALESCE(OLD.referencia, '') LIKE 'DEVOL-%' OR EXISTS (SELECT 1 FROM devoluciones WHERE egreso_id = OLD.id)) THEN
    RAISE EXCEPTION 'movimientos_contables: el egreso % es el reembolso de una devolución; no se edita ni se borra', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.movimientos_contables_devolucion_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_movimientos_contables_devolucion_guard ON movimientos_contables;
CREATE TRIGGER trg_movimientos_contables_devolucion_guard BEFORE INSERT OR UPDATE OR DELETE ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_contables_devolucion_guard();
