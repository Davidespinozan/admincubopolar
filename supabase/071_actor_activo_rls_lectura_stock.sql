-- 071_actor_activo_rls_lectura_stock.sql — Fase B, parche de emergencia P0.
--
-- P0-B1: Supabase Auth permite auto-registro; muchas policies eran
--        `TO authenticated USING (true)`. Cualquier JWT `authenticated`
--        (sin perfil en usuarios, perfil inactivo o borrado) leía clientes,
--        órdenes, ledger, webhooks y configuración, y escribía cuentas por
--        pagar, pagos a proveedores y costos.
-- P0-B2: update_stocks_atomic / update_productos_stock_atomic (SECURITY
--        DEFINER) no verificaban actor ni rol y aceptaban la atribución
--        (`usuario`) del cliente.
--
-- CONTRATO DE ACTOR (erp_actor): el actor autorizado del ERP es la fila de
-- `usuarios` cuyo `auth_id = auth.uid()` y cuyo `estatus = 'Activo'`. Sin
-- esa fila no hay autoridad. La resolución por email (get_my_rol,
-- get_my_user_id) NO se toca en esta fase (≈70 policies, B3); solo las
-- policies y RPC de este parche usan el contrato nuevo. fin_mi_rol_activo()
-- (Fase A) pasa a delegar en erp_rol_activo(), así los contratos
-- financieros también exigen auth.uid().
--
-- Backfill: usuarios.auth_id se rellena desde auth.users por email para los
-- perfiles que aún no lo tenían (1 en producción). Sin auth_id un perfil
-- deja de tener autoridad por REST, aunque siga pudiendo iniciar sesión.
--
-- Fuera de alcance (B1-B4): mermas, vista GPS, get_my_rol global,
-- confirmar_produccion, rename_sku, TRUNCATE/REFERENCES/TRIGGER, secuencias,
-- INSERT de auditoria/error_log/notificaciones.
--
-- Idempotente y forward-only. Sin cambios en datos financieros.

-- ═══════════════════════════════════════════════════════════════
-- 0. BACKFILL auth_id (antes de que las policies dependan de él)
-- ═══════════════════════════════════════════════════════════════
UPDATE usuarios u
   SET auth_id = au.id
  FROM auth.users au
 WHERE u.auth_id IS NULL
   AND lower(au.email) = lower(u.email);

-- ═══════════════════════════════════════════════════════════════
-- 1. CONTRATO DE ACTOR
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION erp_actor()
RETURNS TABLE (id BIGINT, rol TEXT, nombre TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT u.id, u.rol::TEXT, u.nombre
    FROM usuarios u
   WHERE u.auth_id IS NOT NULL
     AND u.auth_id = auth.uid()
     AND u.estatus = 'Activo'
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION erp_rol_activo() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT rol FROM erp_actor()
$$;

CREATE OR REPLACE FUNCTION erp_usuario_id() RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT id FROM erp_actor()
$$;

CREATE OR REPLACE FUNCTION erp_actor_nombre() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT nombre FROM erp_actor()
$$;

CREATE OR REPLACE FUNCTION erp_es_activo() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT erp_rol_activo() IS NOT NULL
$$;

-- Fase A: el helper de rol activo pasa a resolver por auth.uid().
CREATE OR REPLACE FUNCTION fin_mi_rol_activo() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT erp_rol_activo()
$$;

-- Etiqueta de actor para auditoría: el usuario real del ERP, o el origen
-- técnico explícito. Nunca el valor que mande el cliente.
CREATE OR REPLACE FUNCTION erp_actor_etiqueta() RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(
    erp_actor_nombre(),
    CASE fin_jwt_role()
      WHEN 'service_role' THEN 'service_role'
      WHEN NULL THEN 'sql'
      ELSE 'jwt-sin-perfil'
    END,
    'sql'
  )
$$;

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('erp_actor', 'erp_rol_activo', 'erp_usuario_id', 'erp_actor_nombre',
                         'erp_es_activo', 'erp_actor_etiqueta', 'fin_mi_rol_activo')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.fn);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 2. LECTURA: de `USING (true)` a perfil activo
-- ═══════════════════════════════════════════════════════════════
-- Contrato mínimo compatible con los callers reales: el store carga estas
-- tablas para todos los roles del ERP. Sin perfil activo → 0 filas.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('camiones',               'read_all'),
      ('cierres_diarios',        'read_all_cierres'),
      ('clientes',               'read_all'),
      ('comodatos',              'read_all'),
      ('configuracion_empresa',  'read_all'),
      ('costos_fijos',           'costos_fijos_read'),
      ('costos_historial',       'costos_historial_read'),
      ('cuartos_frios',          'read_all'),
      ('cuentas_por_cobrar',     'read_all'),
      ('cuentas_por_pagar',      'cxp_read'),
      ('devoluciones',           'read_all_devoluciones'),
      ('inventario_mov',         'read_all'),
      ('invoice_attempts',       'invoice_attempts_read_authenticated'),
      ('mermas',                 'read_all'),
      ('notificaciones',         'read_all'),
      ('orden_lineas',           'read_all'),
      ('ordenes',                'read_all'),
      ('pagos',                  'read_all'),
      ('pagos_proveedores',      'pagos_prov_read'),
      ('payment_intents',        'payment_intents_read_authenticated'),
      ('payment_webhook_events', 'payment_webhook_events_read_authenticated'),
      ('precios_esp',            'read_all'),
      ('produccion',             'read_all'),
      ('productos',              'read_all'),
      ('rutas',                  'read_all'),
      ('umbrales',               'read_all')
    ) AS v(tabla, pol)
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I', r.pol, r.tabla);
    EXECUTE format('CREATE POLICY %I ON %I FOR SELECT TO authenticated USING (erp_es_activo())', r.pol, r.tabla);
  END LOOP;
END $$;

-- ═══════════════════════════════════════════════════════════════
-- 3. ESCRITURA: fuera `USING (true) WITH CHECK (true)`
-- ═══════════════════════════════════════════════════════════════
-- cuentas_por_pagar: Admin (admin_all, existente) + alta por compra a crédito
-- de empaques desde movimientoBolsa (Almacén Bolsas / Producción).
DROP POLICY IF EXISTS "cxp_write" ON cuentas_por_pagar;
DROP POLICY IF EXISTS "cxp_insert_compra" ON cuentas_por_pagar;
CREATE POLICY "cxp_insert_compra" ON cuentas_por_pagar FOR INSERT TO authenticated
  WITH CHECK (erp_rol_activo() IN ('Almacén Bolsas', 'Producción') AND categoria = 'Proveedores');

-- pagos_proveedores: solo Admin (pagarCuentaPorPagar vive en el shell Admin).
DROP POLICY IF EXISTS "pagos_prov_write" ON pagos_proveedores;

-- costos_fijos: solo Admin (CostosView).
DROP POLICY IF EXISTS "costos_fijos_write" ON costos_fijos;

-- costos_historial: Admin + costo de empaque generado por addProduccion (Producción).
DROP POLICY IF EXISTS "costos_historial_write" ON costos_historial;
DROP POLICY IF EXISTS "costos_historial_produccion_insert" ON costos_historial;
CREATE POLICY "costos_historial_produccion_insert" ON costos_historial FOR INSERT TO authenticated
  WITH CHECK (erp_rol_activo() = 'Producción' AND categoria = 'Costo de Ventas');

-- camiones: la policy `camiones_auth` (ALL a public con auth.role()) permitía
-- escribir a cualquier JWT. Escritura: Admin (admin_all existente).
DROP POLICY IF EXISTS "camiones_auth" ON camiones;

-- notificaciones: `notificaciones_auth` (ALL a public) permitía UPDATE/DELETE
-- a cualquier JWT. Marcar leída (UPDATE) → perfil activo. INSERT queda como
-- está (deuda B4, insert_all).
DROP POLICY IF EXISTS "notificaciones_auth" ON notificaciones;
DROP POLICY IF EXISTS "notificaciones_update_activo" ON notificaciones;
CREATE POLICY "notificaciones_update_activo" ON notificaciones FOR UPDATE TO authenticated
  USING (erp_es_activo()) WITH CHECK (erp_es_activo());

-- ═══════════════════════════════════════════════════════════════
-- 4. RPC DE STOCK: actor y rol verificados; atribución real
-- ═══════════════════════════════════════════════════════════════
-- Roles derivados de los callers reales (supaStore):
--   update_stocks_atomic: Admin (deleteProduccion, cancelarRutaConDevolucion,
--     borrarMermaConReverso, registrarDevolucion, firmarCarga desde
--     BotonFirmasPendientes), Chofer (marcarNoEntregada, confirmarCargaRuta,
--     firmarCarga, registrarMerma, cerrarRutaCompleta), Producción
--     (addTransformacion, meter/sacar/traspaso cuartos, confirmarProduccion,
--     registrarMerma). Anidada: cerrar_ruta_atomic (contexto rpc).
--   update_productos_stock_atomic: Admin (deleteProduccion), Producción
--     (addTransformacion), Almacén Bolsas (movimientoBolsa).
-- Ventas NO tiene ningún flujo de stock.

CREATE OR REPLACE FUNCTION update_stocks_atomic(p_changes JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  change      JSONB;
  v_cuarto_id TEXT;
  v_sku       TEXT;
  v_delta     INTEGER;
  v_tipo      TEXT;
  v_origen    TEXT;
  v_usuario   TEXT;
  v_current   INTEGER;
  v_new       INTEGER;
  v_updated   INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer', 'Producción']) THEN
    RAISE EXCEPTION 'update_stocks_atomic: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  -- Atribución: el actor autenticado real; nunca el valor del cliente.
  v_usuario := erp_actor_etiqueta();

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'update_stocks_atomic: p_changes debe ser un array';
  END IF;

  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_cuarto_id := change->>'cuarto_id';
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');

    IF v_cuarto_id IS NULL OR v_sku IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'update_stocks_atomic: cuarto_id, sku y delta son obligatorios';
    END IF;

    -- Bloquea la fila del cuarto y lee el stock actual del SKU
    SELECT COALESCE((stock->>v_sku)::INTEGER, 0)
      INTO v_current
      FROM cuartos_frios
     WHERE id = v_cuarto_id
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Cuarto frío no encontrado: %', v_cuarto_id;
    END IF;

    v_new := v_current + v_delta;

    -- Defensa: descuento que llevaría a negativo aborta toda la operación
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%',
        v_sku, v_cuarto_id, v_current, ABS(v_delta);
    END IF;

    UPDATE cuartos_frios
       SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_sku], to_jsonb(v_new)),
           updated_at = NOW()
     WHERE id = v_cuarto_id;

    -- Auditoría: cada cambio queda en inventario_mov (append-only)
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'actor', v_usuario);
END;
$$;

CREATE OR REPLACE FUNCTION update_productos_stock_atomic(p_changes JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  change      JSONB;
  v_sku       TEXT;
  v_delta     INTEGER;
  v_tipo      TEXT;
  v_origen    TEXT;
  v_usuario   TEXT;
  v_current   INTEGER;
  v_new       INTEGER;
  v_updated   INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'update_productos_stock_atomic: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_usuario := erp_actor_etiqueta();

  IF p_changes IS NULL OR jsonb_typeof(p_changes) <> 'array' THEN
    RAISE EXCEPTION 'update_productos_stock_atomic: p_changes debe ser un array';
  END IF;

  FOR change IN SELECT * FROM jsonb_array_elements(p_changes)
  LOOP
    v_sku       := change->>'sku';
    v_delta     := (change->>'delta')::INTEGER;
    v_tipo      := COALESCE(change->>'tipo', CASE WHEN v_delta >= 0 THEN 'Entrada' ELSE 'Salida' END);
    v_origen    := COALESCE(change->>'origen', 'Sistema');

    IF v_sku IS NULL OR v_delta IS NULL THEN
      RAISE EXCEPTION 'update_productos_stock_atomic: sku y delta son obligatorios';
    END IF;

    SELECT COALESCE(stock, 0)
      INTO v_current
      FROM productos
     WHERE sku = v_sku
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'SKU no encontrado: %', v_sku;
    END IF;

    v_new := v_current + v_delta;
    IF v_new < 0 THEN
      RAISE EXCEPTION 'Stock insuficiente de %: disponible=%, requerido=%',
        v_sku, v_current, ABS(v_delta);
    END IF;

    UPDATE productos SET stock = v_new WHERE sku = v_sku;

    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario)
    VALUES (v_tipo, v_sku, ABS(v_delta), v_origen, v_usuario);

    v_updated := v_updated + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'updated', v_updated, 'actor', v_usuario);
END;
$$;

-- El frontend invoca ambas directamente (17 + 4 sitios): authenticated
-- conserva EXECUTE; la autorización real ocurre dentro. anon/PUBLIC no.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS fn
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('update_stocks_atomic', 'update_productos_stock_atomic')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.fn);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.fn);
  END LOOP;
END $$;

COMMENT ON FUNCTION erp_actor() IS
  'Contrato de actor del ERP: fila de usuarios con auth_id = auth.uid() y estatus Activo. Sin fila → sin autoridad (Fase B, mig 071).';
