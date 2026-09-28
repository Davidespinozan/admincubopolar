-- 078_contencion_rutas_chofer.sql — Contención F3-D.
--
-- Hasta 077, la policy chofer_update_own (031) dejaba al Chofer actualizar
-- CUALQUIER columna de su ruta: carga_autorizada, extra_autorizado, folio,
-- carga, totales, cancelación… y llevar el estatus a cualquier valor.
-- Además resolvía identidad con get_my_rol()/get_my_user_id() (por email,
-- sin exigir estatus Activo).
--
-- Flujo real del Chofer (ChoferView → supaStore, auditado en 078):
--   solicitarFirmaCarga  Programada      → Pendiente firma  carga_real, carga_solicitada_at
--   firmarCarga (en el   Pendiente firma → Cargada          carga_confirmada_at/_por, firma_carga,
--     celular del chofer)                                   firma_excepcion(_motivo)
--   compensación cliente Cargada         → Pendiente firma  (limpia la firma si falla el descuento)
--   updateRutaEstatus    Cargada         → En progreso      estatus
--   cerrarRutaCompleta   En progreso     → Cerrada          fecha_fin
-- Nada más. Todo lo demás lo decide Admin (admin_all) o un contrato del
-- servidor (cerrar_ruta_atomic, asignar_ordenes_a_ruta, rename_sku).
--
-- Mecanismo (mínimo, del lado del servidor):
--   1. chofer_update_own pasa a identidad canónica 071 (actor ACTIVO por
--      auth.uid) con WITH CHECK explícito: el Chofer no puede reasignar la
--      ruta ni operar inactivo o sin perfil.
--   2. Trigger BEFORE UPDATE rutas_guard_chofer: si el actor es Chofer,
--      compara OLD/NEW columna por columna y solo acepta las transiciones y
--      columnas del flujo real; carga_real nunca supera carga_autorizada +
--      extra_autorizado. Cualquier otra columna o transición aborta TODA la
--      sentencia (42501). No se usa app.fin_ctx ni ningún bypass por
--      contexto SECURITY DEFINER: un Chofer que entre por una RPC sin guardia
--      (asignar_ordenes_a_ruta) tampoco puede tocar columnas de Admin.
--   Admin, service_role y SQL directo (sin JWT) no cambian.
-- RLS sola no puede expresar la diferencia OLD/NEW por columna; los grants
-- por columna no distinguen roles de la app (todos son `authenticated`).
-- Sin cambios de grants, 076, 077, F4, identidad legacy ni frontend.
-- Idempotente.

DROP POLICY IF EXISTS chofer_update_own ON public.rutas;
CREATE POLICY chofer_update_own ON public.rutas FOR UPDATE TO authenticated
  USING      (erp_rol_activo() = 'Chofer' AND chofer_id = erp_usuario_id())
  WITH CHECK (erp_rol_activo() = 'Chofer' AND chofer_id = erp_usuario_id());

CREATE OR REPLACE FUNCTION rutas_guard_chofer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol        TEXT := erp_rol_activo();
  v_yo         BIGINT := erp_usuario_id();   -- carga_confirmada_por se compara como texto: bigint en prod, text en esquemas locales (041)
  v_cambios    TEXT[];
  v_permitidas TEXT[];
  v_firma      TEXT[] := ARRAY['estatus', 'carga_confirmada_at', 'carga_confirmada_por',
                               'firma_carga', 'firma_excepcion', 'firma_excepcion_motivo'];
  v_sku        TEXT;
  v_qty        TEXT;
  v_max        NUMERIC;
BEGIN
  -- Solo restringe al actor Chofer activo. Admin (admin_all), service_role y
  -- SQL sin JWT siguen igual; Ventas/Producción no tienen policy de UPDATE.
  IF v_rol IS DISTINCT FROM 'Chofer' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key) INTO v_cambios
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key <> 'updated_at';            -- la pone trg_rutas_upd
  IF v_cambios IS NULL THEN
    RETURN NEW;                            -- sin cambios: inofensivo
  END IF;

  IF OLD.estatus = 'Programada' AND NEW.estatus = 'Pendiente firma' THEN
    v_permitidas := ARRAY['estatus', 'carga_real', 'carga_solicitada_at'];
    IF OLD.carga_confirmada_at IS NOT NULL THEN
      RAISE EXCEPTION 'rutas: la ruta % ya tiene carga confirmada', OLD.id USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Pendiente firma' AND NEW.estatus = 'Cargada' THEN
    v_permitidas := v_firma;
    IF OLD.carga_confirmada_at IS NOT NULL OR NEW.carga_confirmada_at IS NULL
       OR NEW.carga_confirmada_por::TEXT IS DISTINCT FROM v_yo::TEXT THEN
      RAISE EXCEPTION 'rutas: firma de carga inválida para la ruta %', OLD.id USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Cargada' AND NEW.estatus = 'Pendiente firma' THEN
    -- Compensación del cliente (firmarCarga): si falla el descuento de stock
    -- tras el claim de firma, se limpia la firma propia y se vuelve a esperar.
    v_permitidas := v_firma;
    IF OLD.carga_confirmada_por::TEXT IS DISTINCT FROM v_yo::TEXT
       OR NEW.carga_confirmada_at IS NOT NULL OR NEW.carga_confirmada_por IS NOT NULL
       OR NEW.firma_carga IS NOT NULL OR COALESCE(NEW.firma_excepcion, false)
       OR NEW.firma_excepcion_motivo IS NOT NULL THEN
      RAISE EXCEPTION 'rutas: reversión de firma inválida para la ruta %', OLD.id USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Cargada' AND NEW.estatus = 'En progreso' THEN
    v_permitidas := ARRAY['estatus'];
  ELSIF OLD.estatus = 'En progreso' AND NEW.estatus = 'Cerrada' THEN
    v_permitidas := ARRAY['estatus', 'fecha_fin'];
  ELSE
    RAISE EXCEPTION 'rutas: transición % → % no permitida para Chofer', OLD.estatus, NEW.estatus
      USING ERRCODE = '42501';
  END IF;

  IF NOT (v_cambios <@ v_permitidas) THEN
    RAISE EXCEPTION 'rutas: Chofer no puede modificar % (en % → % solo %)',
      array_to_string(v_cambios, ', '), OLD.estatus, NEW.estatus, array_to_string(v_permitidas, ', ')
      USING ERRCODE = '42501';
  END IF;

  -- La carga real nunca supera lo autorizado por Admin (misma regla que el
  -- cliente, ahora en el servidor). Solo cuenta lo autorizado ANTES del UPDATE.
  IF 'carga_real' = ANY (v_cambios) THEN
    IF NEW.carga_real IS NULL OR jsonb_typeof(NEW.carga_real) <> 'object' THEN
      RAISE EXCEPTION 'rutas: carga_real inválida' USING ERRCODE = '42501';
    END IF;
    FOR v_sku, v_qty IN SELECT key, value FROM jsonb_each_text(NEW.carga_real) LOOP
      IF v_qty IS NULL OR v_qty !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'rutas: cantidad inválida para % en carga_real', v_sku USING ERRCODE = '42501';
      END IF;
      v_max := COALESCE((OLD.carga_autorizada ->> v_sku)::NUMERIC, 0)
             + COALESCE((OLD.extra_autorizado ->> v_sku)::NUMERIC, 0);
      IF v_qty::NUMERIC > v_max THEN
        RAISE EXCEPTION 'rutas: carga_real de % (%) supera lo autorizado (%)', v_sku, v_qty, v_max
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

REVOKE ALL ON FUNCTION rutas_guard_chofer() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_rutas_guard_chofer ON public.rutas;
CREATE TRIGGER trg_rutas_guard_chofer
  BEFORE UPDATE ON public.rutas
  FOR EACH ROW EXECUTE FUNCTION rutas_guard_chofer();
