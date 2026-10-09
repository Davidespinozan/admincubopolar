-- 120_ger1_dueno_accesos.sql — GER-1 (2026-10-09): Dueño, accesos adicionales por
-- persona, cuentas con contraseña temporal y bitácora de cambios sensibles.
-- Aditiva y compatible con el frontend desplegado (la contención de la
-- escritura REST de `usuarios` es 121, después del frontend nuevo).
--
-- Hallazgos de GER-0 (producción, solo lectura, 2026-10-09): Admin cambia
-- cualquier usuario por REST (policy usuarios admin_all), incluido el rol;
-- ningún cambio directo por API en precios, salarios, cuentas por pagar o
-- usuarios deja rastro del lado del servidor.
--
--   1. Dueño = Admin + `es_dueno` (un solo dueño; CHECK: el dueño es Admin).
--      No es un rol nuevo: facturación (111–113) y las Netlify Functions leen
--      `usuarios.rol` directo y un rol distinto dejaría al dueño sin ellas.
--   2. Accesos adicionales (`accesos_extra`): un usuario suma Ventas y/o
--      Almacén Bolsas a su rol principal. Solo esos dos (sus ramas por rol se
--      revisaron una por una). fin_actor_permitido decide con TODOS los roles
--      del actor; las reglas "Ventas solo sobre lo suyo" valen también para el
--      acceso adicional (completar_venta_directa, fin_orden_operable y las 4
--      policies de Ventas). La facturación (111–113) lee el rol principal y
--      rechaza el acceso adicional (falla cerrado; la factura la hace Admin).
--   3. Contraseña temporal: `debe_cambiar_password` deja al usuario SIN
--      autoridad de negocio (erp_actor lo excluye) hasta que la cambia. El
--      servidor guarda la huella (hash de Auth) de la temporal y solo acepta
--      el cambio si la huella actual es otra.
--   4. Usuarios por contrato: guardar_usuario (Admin; solo el dueño asigna
--      Admin, toca a otro Admin, al dueño o los accesos; nadie se cambia su
--      propio rol, estatus ni accesos). Policy de lectura de Admin separada de
--      admin_all (121 quita admin_all y el DML REST).
--   5. Bitácora (`bitacora_cambios`): toda escritura REST directa en tablas
--      sensibles queda con antes/después y actor fijado por el servidor; los
--      contratos de usuarios escriben la suya. Inmutable por API; solo el
--      dueño la lee. Los contratos de negocio ya dejan `auditoria`.
--
-- Reversión: fin_actor_permitido, erp_actor y fin_orden_operable de 069/071/088,
-- completar_venta_directa de 109, policies de Ventas con erp_rol_activo()/
-- get_my_rol(); DROP de las funciones, tablas, policy admin_read e índice
-- nuevos; DROP COLUMN es_dueno, accesos_extra, debe_cambiar_password.

BEGIN;

-- ═══ 1. Columnas y restricciones ═══
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS es_dueno BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS accesos_extra TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE public.usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_dueno_admin_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_dueno_admin_check CHECK (NOT es_dueno OR rol = 'Admin');
ALTER TABLE public.usuarios DROP CONSTRAINT IF EXISTS usuarios_accesos_extra_check;
ALTER TABLE public.usuarios ADD CONSTRAINT usuarios_accesos_extra_check
  CHECK (accesos_extra <@ ARRAY['Ventas', 'Almacén Bolsas']::TEXT[] AND NOT (rol = ANY (accesos_extra)));
CREATE UNIQUE INDEX IF NOT EXISTS usuarios_un_dueno ON public.usuarios ((true)) WHERE es_dueno;

-- Huella de la contraseña temporal (hash de Auth). Sin acceso por API.
CREATE TABLE IF NOT EXISTS public.usuarios_password_temporal (
  usuario_id BIGINT PRIMARY KEY REFERENCES public.usuarios(id) ON DELETE CASCADE,
  hash       TEXT NOT NULL,
  fijada_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  fijada_por TEXT
);
ALTER TABLE public.usuarios_password_temporal ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuarios_password_temporal FROM PUBLIC, anon, authenticated;

-- ═══ 2. Identidad: actor sin autoridad mientras debe cambiar su contraseña ═══
CREATE OR REPLACE FUNCTION public.erp_actor()
RETURNS TABLE (id BIGINT, rol TEXT, nombre TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.rol::TEXT, u.nombre
    FROM usuarios u
   WHERE u.auth_id IS NOT NULL
     AND u.auth_id = auth.uid()
     AND u.estatus = 'Activo'
     AND NOT u.debe_cambiar_password
   LIMIT 1
$$;

-- Todos los roles del actor: el principal más sus accesos adicionales.
CREATE OR REPLACE FUNCTION public.erp_roles_activos() RETURNS TEXT[]
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ARRAY[u.rol::TEXT] || u.accesos_extra
    FROM usuarios u
   WHERE u.auth_id IS NOT NULL
     AND u.auth_id = auth.uid()
     AND u.estatus = 'Activo'
     AND NOT u.debe_cambiar_password
   LIMIT 1
$$;
REVOKE ALL ON FUNCTION public.erp_roles_activos() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_roles_activos() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.erp_tiene_rol(p_rol TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(p_rol = ANY (erp_roles_activos()), false)
$$;
REVOKE ALL ON FUNCTION public.erp_tiene_rol(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_tiene_rol(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.erp_es_dueno() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM usuarios u
     WHERE u.auth_id IS NOT NULL AND u.auth_id = auth.uid()
       AND u.estatus = 'Activo' AND u.es_dueno AND NOT u.debe_cambiar_password)
$$;
REVOKE ALL ON FUNCTION public.erp_es_dueno() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_es_dueno() TO authenticated, service_role;

-- Contratos: autoriza con TODOS los roles del actor (antes, solo el principal).
CREATE OR REPLACE FUNCTION public.fin_actor_permitido(p_roles TEXT[]) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN RETURN TRUE; END IF;
  IF fin_ctx_activo() THEN RETURN TRUE; END IF;
  IF v_jwt <> 'authenticated' THEN RETURN FALSE; END IF;
  RETURN COALESCE(erp_roles_activos(), '{}'::TEXT[]) && p_roles;
END $$;

-- Órdenes operables: el acceso adicional de Ventas vale como Ventas (sin ruta).
CREATE OR REPLACE FUNCTION public.fin_orden_operable(p_ruta_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_rol TEXT;
BEGIN
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR fin_ctx_activo() THEN RETURN TRUE; END IF;
  v_rol := COALESCE(erp_rol_activo(), '');
  IF v_rol = 'Admin' THEN RETURN TRUE; END IF;
  IF v_rol = 'Chofer' THEN
    RETURN p_ruta_id IS NOT NULL AND EXISTS (SELECT 1 FROM rutas WHERE id = p_ruta_id AND chofer_id = erp_usuario_id());
  END IF;
  IF v_rol IN ('Ventas', 'Facturación') OR erp_tiene_rol('Ventas') THEN RETURN p_ruta_id IS NULL; END IF;
  RETURN FALSE;
END $$;

-- ═══ 3. Venta directa: la regla "solo sus órdenes" alcanza al acceso adicional ═══
CREATE OR REPLACE FUNCTION public.completar_venta_directa(
  p_operacion_id UUID,
  p_orden_id     BIGINT,
  p_modo         TEXT,
  p_metodo       TEXT,
  p_asignacion   JSONB,
  p_referencia   TEXT DEFAULT NULL,
  p_folio_nota   TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt        TEXT := fin_jwt_role();
  v_rol        TEXT;
  v_actor_id   BIGINT := erp_usuario_id();
  v_etiqueta   TEXT := erp_actor_etiqueta();
  v_modo       TEXT := btrim(COALESCE(p_modo, ''));
  v_metodo     TEXT := btrim(COALESCE(p_metodo, ''));
  v_ref        TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
  v_nota       TEXT := NULLIF(btrim(COALESCE(p_folio_nota, '')), '');
  v_el         JSONB;
  v_sku        TEXT;
  v_cuarto     TEXT;
  v_cant       NUMERIC;
  v_asig       JSONB;
  v_clave      TEXT;
  v_prev       JSONB;
  v_ord        ordenes%ROWTYPE;
  v_faltan     TEXT;
  v_sobran     TEXT;
  v_desc       TEXT;
  v_rooms      TEXT[];
  v_n_rooms    INTEGER;
  v_a          RECORD;
  v_disp       INTEGER;
  v_pagado     NUMERIC;
  v_pend       NUMERIC;
  v_fin        JSONB;
  v_pago       JSONB := NULL;
  v_cxc        JSONB := NULL;
  v_ord_fin    ordenes%ROWTYPE;
  v_res        JSONB;
BEGIN
  -- 1. Autorización ANTES de marcar el contexto (dentro de fin_ctx los
  --    contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'completar_venta_directa: no autorizado' USING ERRCODE = '42501';
  END IF;
  v_rol := CASE WHEN v_jwt = 'authenticated' THEN COALESCE(fin_mi_rol_activo(), '') ELSE 'Sistema' END;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: operación y orden requeridas' USING ERRCODE = '22023';
  END IF;

  -- 2. Modo y método (las cadenas que ya usan Ventas y Admin).
  IF v_modo NOT IN ('contado', 'credito', 'pagado_link') THEN
    RAISE EXCEPTION 'completar_venta_directa: modo inválido (contado, credito, pagado_link)' USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_modo = 'contado' AND v_metodo IN ('Efectivo', 'Transferencia SPEI', 'Tarjeta (terminal)'))
       OR (v_modo = 'credito' AND v_metodo = 'Crédito (fiado)')
       OR (v_modo = 'pagado_link' AND v_metodo = 'QR / Link de pago')) THEN
    RAISE EXCEPTION 'completar_venta_directa: el método % no corresponde al modo %', v_metodo, v_modo USING ERRCODE = '22023';
  END IF;

  -- 3. Asignación: arreglo de {sku, cuarto_id, cantidad}; cantidades enteras
  --    > 0; sin pares (sku, cuarto) repetidos. Otras llaves se ignoran.
  IF p_asignacion IS NULL OR jsonb_typeof(p_asignacion) <> 'array' OR jsonb_array_length(p_asignacion) = 0 THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación debe ser una lista de {sku, cuarto_id, cantidad}' USING ERRCODE = '22023';
  END IF;
  v_asig := '[]'::jsonb;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_asignacion) LOOP
    IF jsonb_typeof(v_el) <> 'object'
       OR jsonb_typeof(v_el -> 'sku') IS DISTINCT FROM 'string' OR jsonb_typeof(v_el -> 'cuarto_id') IS DISTINCT FROM 'string'
       OR jsonb_typeof(v_el -> 'cantidad') IS DISTINCT FROM 'number' THEN
      RAISE EXCEPTION 'completar_venta_directa: cada partida requiere sku, cuarto_id y cantidad' USING ERRCODE = '22023';
    END IF;
    v_sku := btrim(v_el ->> 'sku'); v_cuarto := btrim(v_el ->> 'cuarto_id'); v_cant := (v_el ->> 'cantidad')::NUMERIC;
    IF v_sku = '' OR v_cuarto = '' THEN
      RAISE EXCEPTION 'completar_venta_directa: sku y cuarto_id no pueden estar vacíos' USING ERRCODE = '22023';
    END IF;
    IF v_cant <= 0 OR v_cant <> trunc(v_cant) OR v_cant > 2147483647 THEN
      RAISE EXCEPTION 'completar_venta_directa: cantidad inválida para % en % (entero mayor a 0)', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = v_sku AND e.value ->> 'cuarto_id' = v_cuarto) THEN
      RAISE EXCEPTION 'completar_venta_directa: % en % aparece más de una vez', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    v_asig := v_asig || jsonb_build_array(jsonb_build_object('sku', v_sku, 'cuarto_id', v_cuarto, 'cantidad', v_cant::INTEGER));
  END LOOP;
  -- Forma canónica (ordenada por SKU y cuarto): base de la huella y del recorrido.
  SELECT jsonb_agg(e.value ORDER BY e.value ->> 'sku', e.value ->> 'cuarto_id') INTO v_asig FROM jsonb_array_elements(v_asig) e;
  v_clave := jsonb_build_object('orden', p_orden_id, 'modo', v_modo, 'metodo', v_metodo, 'referencia', v_ref, 'folio_nota', v_nota, 'asignacion', v_asig)::text;

  -- 4. Orden bloqueada; propiedad (Ventas: solo sus órdenes).
  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'completar_venta_directa: orden % no existe', p_orden_id USING ERRCODE = '22023';
  END IF;
  -- 120: también quien actúa por un acceso adicional de Ventas (rol principal
  -- distinto) queda limitado a sus órdenes. Admin y Ventas: sin cambio.
  IF (v_rol = 'Ventas' OR (v_rol NOT IN ('Admin', 'Sistema') AND erp_tiene_rol('Ventas')))
     AND v_ord.vendedor_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no es de este vendedor', v_ord.folio USING ERRCODE = '42501';
  END IF;

  -- 5. Idempotencia (mismo UUID + misma huella → resultado original).
  v_prev := stock_op_replay(p_operacion_id, 'venta_directa', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- 6. Elegibilidad con la orden ya bloqueada.
  IF v_ord.ruta_id IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % tiene ruta; la entrega y el cobro son del chofer', v_ord.folio USING ERRCODE = '22023';
  END IF;
  IF v_ord.estatus NOT IN ('Creada', 'Asignada') THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % está % (se requiere Creada o Asignada sin ruta)', v_ord.folio, v_ord.estatus USING ERRCODE = '22023';
  END IF;

  -- 7. La asignación cubre EXACTAMENTE las líneas de la orden.
  IF NOT EXISTS (SELECT 1 FROM orden_lineas WHERE orden_id = p_orden_id AND cantidad > 0) THEN
    RAISE EXCEPTION 'completar_venta_directa: la orden % no tiene líneas', v_ord.folio USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(l.sku || ' (' || l.q || ')', ', ' ORDER BY l.sku) INTO v_faltan
    FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku HAVING SUM(cantidad) > 0) l
   WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku);
  IF v_faltan IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: falta asignar %', v_faltan USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(DISTINCT e.value ->> 'sku', ', ') INTO v_sobran FROM jsonb_array_elements(v_asig) e
   WHERE NOT EXISTS (SELECT 1 FROM orden_lineas l WHERE l.orden_id = p_orden_id AND l.sku = e.value ->> 'sku' AND l.cantidad > 0);
  IF v_sobran IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: % no está en la orden', v_sobran USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(x.sku || ': asignado ' || x.asig || ', orden ' || x.q, '; ' ORDER BY x.sku) INTO v_desc
    FROM (SELECT l.sku, l.q, (SELECT SUM((e.value ->> 'cantidad')::INTEGER) FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' = l.sku) AS asig
            FROM (SELECT sku, SUM(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku) l) x
   WHERE x.asig IS DISTINCT FROM x.q;
  IF v_desc IS NOT NULL THEN
    RAISE EXCEPTION 'completar_venta_directa: la asignación no coincide con la orden (%)', v_desc USING ERRCODE = '22023';
  END IF;

  -- 8. Cuartos de la asignación, bloqueados en orden de id; existencia.
  SELECT array_agg(DISTINCT e.value ->> 'cuarto_id' ORDER BY e.value ->> 'cuarto_id') INTO v_rooms FROM jsonb_array_elements(v_asig) e;
  SELECT count(*) INTO v_n_rooms FROM (SELECT 1 FROM cuartos_frios WHERE id = ANY (v_rooms) ORDER BY id FOR UPDATE) k;
  IF v_n_rooms <> array_length(v_rooms, 1) THEN
    RAISE EXCEPTION 'completar_venta_directa: cuarto inexistente en la asignación (%)',
      (SELECT string_agg(r, ', ') FROM unnest(v_rooms) r WHERE NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = r)) USING ERRCODE = '22023';
  END IF;
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    SELECT COALESCE((stock ->> v_a.sku)::INTEGER, 0) INTO v_disp FROM cuartos_frios WHERE id = v_a.cuarto_id;
    IF v_disp < v_a.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%', v_a.sku, v_a.cuarto_id, v_disp, v_a.cantidad USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- 9. pagado_link: el pago del proveedor ya cubre el total (sin pago nuevo).
  IF v_modo = 'pagado_link' THEN
    SELECT COALESCE(SUM(monto), 0) INTO v_pagado FROM pagos WHERE orden_id = p_orden_id;
    v_pend := round(COALESCE(v_ord.total, 0) - v_pagado, 2);
    IF COALESCE(v_ord.total, 0) <= 0 OR v_pend > 0 THEN
      RAISE EXCEPTION 'completar_venta_directa: el link de pago de % no cubre el total (pendiente %)', v_ord.folio, greatest(v_pend, 0) USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 10. Registro de la operación (la FK del kardex lo exige antes del movimiento).
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, orden_id, resultado)
  VALUES (p_operacion_id, 'venta_directa', v_clave, v_actor_id, v_etiqueta, p_orden_id, '{}'::jsonb);

  PERFORM fin_marcar_ctx();

  -- 11. Salida física: SOLO de los cuartos asignados, con kardex ligado a la orden.
  FOR v_a IN SELECT e.value ->> 'sku' AS sku, e.value ->> 'cuarto_id' AS cuarto_id, (e.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) e ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku' LOOP
    PERFORM stock_mov_cuarto(v_a.cuarto_id, v_a.sku, -v_a.cantidad, 'Salida', 'Venta directa ' || COALESCE(v_ord.folio, 'Orden ' || p_orden_id),
                             COALESCE(NULLIF(v_ord.cliente_nombre, ''), 'Cliente'), 'venta_directa/' || p_orden_id, v_etiqueta, NULL, p_operacion_id);
  END LOOP;

  -- 12. Entregada (fecha de entrega e ingreso devengado por el trigger 093).
  UPDATE ordenes
     SET estatus = 'Entregada', metodo_pago = v_metodo, folio_nota = COALESCE(v_nota, folio_nota)
   WHERE id = p_orden_id;

  -- 13. Dinero: pago o CxC por los contratos existentes; un resultado no
  --     aplicado revierte TODO (nunca Entregada sin pago ni CxC).
  IF v_modo = 'contado' THEN
    v_fin := registrar_pago_orden(p_orden_id, v_metodo, v_ref, v_actor_id);
    IF COALESCE((v_fin ->> 'aplicado')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: el pago no se aplicó (%)', COALESCE(v_fin ->> 'motivo', 'sin motivo') USING ERRCODE = '22023';
    END IF;
    v_pago := v_fin;
  ELSIF v_modo = 'credito' THEN
    v_fin := crear_cxc_orden(p_orden_id, 30);
    IF COALESCE((v_fin ->> 'creada')::BOOLEAN, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'completar_venta_directa: la CxC no se creó (%)', COALESCE(v_fin ->> 'motivo', 'ya existía') USING ERRCODE = '22023';
    END IF;
    v_cxc := v_fin;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Venta directa', 'Órdenes', COALESCE(v_ord.folio, 'Orden ' || p_orden_id) || ' — ' || v_modo || ' (' || v_metodo || '). Salida: '
          || (SELECT string_agg((e.value ->> 'cantidad') || '×' || (e.value ->> 'sku') || ' de ' || (e.value ->> 'cuarto_id'), ', ' ORDER BY e.value ->> 'cuarto_id', e.value ->> 'sku') FROM jsonb_array_elements(v_asig) e));

  SELECT * INTO v_ord_fin FROM ordenes WHERE id = p_orden_id;
  v_res := jsonb_build_object('orden_id', p_orden_id, 'folio', v_ord.folio, 'estatus', v_ord_fin.estatus, 'estatus_anterior', v_ord.estatus,
                              'modo', v_modo, 'metodo', v_metodo, 'total', v_ord.total, 'pago', v_pago, 'cxc', v_cxc, 'asignacion', v_asig,
                              'delivered_at', v_ord_fin.delivered_at, 'actor', v_etiqueta, 'actor_id', v_actor_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.completar_venta_directa(UUID, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT) TO authenticated, service_role;

-- ═══ 4. Policies de Ventas: por rol principal O acceso adicional ═══
ALTER POLICY ventas_update ON public.ordenes
  USING (erp_tiene_rol('Ventas') AND ruta_id IS NULL)
  WITH CHECK (erp_tiene_rol('Ventas') AND ruta_id IS NULL);
ALTER POLICY ventas_update ON public.clientes
  USING (erp_tiene_rol('Ventas') OR get_my_rol() = 'Facturación');
ALTER POLICY ventas_write ON public.clientes
  WITH CHECK (erp_tiene_rol('Ventas') OR get_my_rol() = 'Facturación');
ALTER POLICY ventas_all ON public.leads
  USING (erp_tiene_rol('Ventas'))
  WITH CHECK (erp_tiene_rol('Ventas'));

-- Lectura de usuarios para Admin, separada de admin_all (121 quita admin_all).
DROP POLICY IF EXISTS admin_read ON public.usuarios;
CREATE POLICY admin_read ON public.usuarios FOR SELECT TO authenticated USING (get_my_rol() = 'Admin');

-- ═══ 5. Bitácora de cambios sensibles ═══
CREATE TABLE IF NOT EXISTS public.bitacora_cambios (
  id          BIGSERIAL PRIMARY KEY,
  at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  tabla       TEXT NOT NULL,
  registro_id TEXT,
  accion      TEXT NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE', 'CONTRATO')),
  detalle     TEXT,
  antes       JSONB,
  despues     JSONB,
  cambios     TEXT[],
  actor       TEXT,
  actor_id    BIGINT,
  origen      TEXT
);
CREATE INDEX IF NOT EXISTS bitacora_cambios_at_idx ON public.bitacora_cambios (at DESC);
ALTER TABLE public.bitacora_cambios ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.bitacora_cambios FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.bitacora_cambios TO authenticated;
REVOKE ALL ON SEQUENCE public.bitacora_cambios_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.bitacora_cambios_id_seq TO authenticated;
DROP POLICY IF EXISTS dueno_read ON public.bitacora_cambios;
CREATE POLICY dueno_read ON public.bitacora_cambios FOR SELECT TO authenticated USING (erp_es_dueno());
-- Solo desde un disparador (la escritura directa por REST tiene profundidad 0).
DROP POLICY IF EXISTS desde_disparador ON public.bitacora_cambios;
CREATE POLICY desde_disparador ON public.bitacora_cambios FOR INSERT TO authenticated WITH CHECK (pg_trigger_depth() > 0);

-- Actor, rol y origen los fija el servidor (nunca el valor que mande el cliente).
CREATE OR REPLACE FUNCTION public.bitacora_actor() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  NEW.at := now();
  NEW.actor := erp_actor_etiqueta();
  NEW.actor_id := erp_usuario_id();
  NEW.origen := COALESCE(fin_jwt_role(), 'sql');
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.bitacora_actor() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_bitacora_actor ON public.bitacora_cambios;
CREATE TRIGGER trg_bitacora_actor BEFORE INSERT ON public.bitacora_cambios FOR EACH ROW EXECUTE FUNCTION public.bitacora_actor();

-- Registra una escritura REST directa (los contratos corren como su dueño y no
-- pasan por aquí; dejan `auditoria`). SECURITY INVOKER: b4_escritura_api()
-- necesita el current_user real.
CREATE OR REPLACE FUNCTION public.bitacora_registrar() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes   JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) - 'updated_at' END;
  v_despues JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) - 'updated_at' END;
  v_cambios TEXT[];
BEGIN
  IF NOT b4_escritura_api() THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(k ORDER BY k) INTO v_cambios
      FROM jsonb_object_keys(v_despues) k
     WHERE v_antes -> k IS DISTINCT FROM v_despues -> k;
    IF v_cambios IS NULL THEN RETURN NULL; END IF;
  END IF;
  INSERT INTO bitacora_cambios (tabla, registro_id, accion, antes, despues, cambios)
  VALUES (TG_TABLE_NAME, COALESCE(v_despues ->> 'id', v_antes ->> 'id'), TG_OP, v_antes, v_despues, v_cambios);
  RETURN NULL;
END $$;
-- Sin EXECUTE por API: un disparador no requiere el privilegio al dispararse.
REVOKE ALL ON FUNCTION public.bitacora_registrar() FROM PUBLIC, anon, authenticated;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['usuarios', 'productos', 'precios_esp', 'cuentas_por_pagar', 'empleados', 'costos_fijos',
                           'costos_historial', 'movimientos_contables', 'configuracion_empresa', 'clientes',
                           'cuartos_frios', 'ordenes', 'rutas', 'camiones'] LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_bitacora ON public.%I', t);
    EXECUTE format('CREATE TRIGGER trg_bitacora AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.bitacora_registrar()', t);
  END LOOP;
END $$;

-- ═══ 6. Contratos de usuarios ═══
CREATE OR REPLACE FUNCTION public.guardar_usuario(
  p_usuario_id    BIGINT,
  p_nombre        TEXT,
  p_rol           TEXT,
  p_estatus       TEXT,
  p_accesos_extra TEXT[] DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_dueno   BOOLEAN;
  v_actor   BIGINT := erp_usuario_id();
  v_u       usuarios%ROWTYPE;
  v_nombre  TEXT := btrim(COALESCE(p_nombre, ''));
  v_accesos TEXT[];
  v_antes   JSONB;
  v_despues JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_usuario: no autorizado' USING ERRCODE = '42501';
  END IF;
  -- Mantenimiento (service_role / SQL de confianza) tiene la autoridad del dueño.
  v_dueno := erp_es_dueno() OR fin_jwt_role() IS DISTINCT FROM 'authenticated';

  SELECT * INTO v_u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'guardar_usuario: usuario % no existe', p_usuario_id USING ERRCODE = '22023';
  END IF;
  IF v_nombre = '' THEN
    RAISE EXCEPTION 'guardar_usuario: el nombre es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_estatus IS NULL OR p_estatus NOT IN ('Activo', 'Inactivo') THEN
    RAISE EXCEPTION 'guardar_usuario: estatus inválido' USING ERRCODE = '22023';
  END IF;
  -- Accesos: NULL = sin cambio; nunca el propio rol; Admin no lleva accesos.
  v_accesos := CASE WHEN p_accesos_extra IS NULL THEN v_u.accesos_extra
                    ELSE ARRAY(SELECT DISTINCT a FROM unnest(p_accesos_extra) a WHERE a IS NOT NULL ORDER BY a) END;
  v_accesos := ARRAY(SELECT a FROM unnest(v_accesos) a WHERE a <> p_rol ORDER BY a);
  IF p_rol = 'Admin' THEN v_accesos := '{}'; END IF;
  IF NOT (v_accesos <@ ARRAY['Ventas', 'Almacén Bolsas']::TEXT[]) THEN
    RAISE EXCEPTION 'guardar_usuario: acceso adicional no permitido (solo Ventas y Almacén Bolsas)' USING ERRCODE = '22023';
  END IF;

  IF v_u.es_dueno THEN
    IF NOT v_dueno THEN
      RAISE EXCEPTION 'guardar_usuario: solo el Dueño modifica su propia cuenta' USING ERRCODE = '42501';
    END IF;
    IF p_rol IS DISTINCT FROM 'Admin' OR p_estatus <> 'Activo' THEN
      RAISE EXCEPTION 'guardar_usuario: el Dueño no puede quitarse el rol ni desactivarse' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT v_dueno THEN
    IF v_u.id = v_actor AND (p_rol IS DISTINCT FROM v_u.rol OR p_estatus IS DISTINCT FROM v_u.estatus) THEN
      RAISE EXCEPTION 'guardar_usuario: no puedes cambiar tu propio rol ni tu estatus' USING ERRCODE = '42501';
    END IF;
    IF v_u.rol = 'Admin' AND (p_rol IS DISTINCT FROM v_u.rol OR p_estatus IS DISTINCT FROM v_u.estatus) THEN
      RAISE EXCEPTION 'guardar_usuario: solo el Dueño cambia el rol o el estatus de un Admin' USING ERRCODE = '42501';
    END IF;
    IF p_rol = 'Admin' AND v_u.rol IS DISTINCT FROM 'Admin' THEN
      RAISE EXCEPTION 'guardar_usuario: solo el Dueño asigna el rol Admin' USING ERRCODE = '42501';
    END IF;
    IF v_accesos IS DISTINCT FROM v_u.accesos_extra THEN
      RAISE EXCEPTION 'guardar_usuario: solo el Dueño asigna accesos adicionales' USING ERRCODE = '42501';
    END IF;
  END IF;

  v_antes := jsonb_build_object('nombre', v_u.nombre, 'rol', v_u.rol, 'estatus', v_u.estatus, 'accesos_extra', to_jsonb(v_u.accesos_extra));
  UPDATE usuarios SET nombre = v_nombre, rol = p_rol, estatus = p_estatus, accesos_extra = v_accesos, updated_at = now()
   WHERE id = p_usuario_id;
  v_despues := jsonb_build_object('nombre', v_nombre, 'rol', p_rol, 'estatus', p_estatus, 'accesos_extra', to_jsonb(v_accesos));
  IF v_antes IS DISTINCT FROM v_despues THEN
    INSERT INTO bitacora_cambios (tabla, registro_id, accion, detalle, antes, despues, cambios)
    VALUES ('usuarios', p_usuario_id::TEXT, 'CONTRATO', 'guardar_usuario', v_antes, v_despues,
            ARRAY(SELECT k FROM jsonb_object_keys(v_despues) k WHERE v_antes -> k IS DISTINCT FROM v_despues -> k ORDER BY k));
  END IF;
  RETURN jsonb_build_object('ok', true, 'id', p_usuario_id, 'rol', p_rol, 'estatus', p_estatus, 'accesos_extra', to_jsonb(v_accesos));
END $$;
REVOKE ALL ON FUNCTION public.guardar_usuario(BIGINT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_usuario(BIGINT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;

-- Tras crear o restablecer la contraseña en Auth (Netlify, service role): guarda
-- la huella de la temporal y obliga a cambiarla. Sin EXECUTE para authenticated.
CREATE OR REPLACE FUNCTION public.fijar_password_temporal(p_usuario_id BIGINT, p_por TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_u    usuarios%ROWTYPE;
  v_hash TEXT;
BEGIN
  SELECT * INTO v_u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT FOUND OR v_u.auth_id IS NULL THEN
    RAISE EXCEPTION 'fijar_password_temporal: usuario % sin cuenta de acceso', p_usuario_id USING ERRCODE = '22023';
  END IF;
  SELECT encrypted_password INTO v_hash FROM auth.users WHERE id = v_u.auth_id;
  IF v_hash IS NULL OR v_hash = '' THEN
    RAISE EXCEPTION 'fijar_password_temporal: la cuenta no tiene contraseña' USING ERRCODE = '22023';
  END IF;
  INSERT INTO usuarios_password_temporal (usuario_id, hash, fijada_at, fijada_por)
  VALUES (p_usuario_id, v_hash, now(), p_por)
  ON CONFLICT (usuario_id) DO UPDATE SET hash = EXCLUDED.hash, fijada_at = EXCLUDED.fijada_at, fijada_por = EXCLUDED.fijada_por;
  UPDATE usuarios SET debe_cambiar_password = true, updated_at = now() WHERE id = p_usuario_id;
  INSERT INTO bitacora_cambios (tabla, registro_id, accion, detalle, despues)
  VALUES ('usuarios', p_usuario_id::TEXT, 'CONTRATO', 'contraseña temporal fijada' || COALESCE(' por ' || p_por, ''),
          jsonb_build_object('debe_cambiar_password', true));
  RETURN jsonb_build_object('ok', true, 'id', p_usuario_id);
END $$;
REVOKE ALL ON FUNCTION public.fijar_password_temporal(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fijar_password_temporal(BIGINT, TEXT) TO service_role;

-- El propio usuario, después de cambiar su contraseña en Auth. Solo libera la
-- cuenta si la huella actual ya no es la de la temporal.
CREATE OR REPLACE FUNCTION public.confirmar_cambio_password() RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_u      usuarios%ROWTYPE;
  v_temp   TEXT;
  v_actual TEXT;
BEGIN
  SELECT * INTO v_u FROM usuarios
   WHERE auth_id IS NOT NULL AND auth_id = auth.uid() AND estatus = 'Activo'
   LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmar_cambio_password: sin perfil activo' USING ERRCODE = '42501';
  END IF;
  IF NOT v_u.debe_cambiar_password THEN
    RETURN jsonb_build_object('ok', true, 'replay', true);
  END IF;
  SELECT hash INTO v_temp FROM usuarios_password_temporal WHERE usuario_id = v_u.id;
  SELECT encrypted_password INTO v_actual FROM auth.users WHERE id = v_u.auth_id;
  IF v_temp IS NULL OR v_actual IS NULL OR v_actual = v_temp THEN
    RAISE EXCEPTION 'confirmar_cambio_password: la contraseña sigue siendo la temporal' USING ERRCODE = '22023';
  END IF;
  UPDATE usuarios SET debe_cambiar_password = false, updated_at = now() WHERE id = v_u.id;
  DELETE FROM usuarios_password_temporal WHERE usuario_id = v_u.id;
  INSERT INTO bitacora_cambios (tabla, registro_id, accion, detalle, despues)
  VALUES ('usuarios', v_u.id::TEXT, 'CONTRATO', 'contraseña propia establecida por ' || v_u.nombre, jsonb_build_object('debe_cambiar_password', false));
  RETURN jsonb_build_object('ok', true);
END $$;
REVOKE ALL ON FUNCTION public.confirmar_cambio_password() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirmar_cambio_password() TO authenticated, service_role;

COMMIT;
