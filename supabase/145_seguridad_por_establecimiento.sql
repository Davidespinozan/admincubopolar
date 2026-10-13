-- 145_seguridad_por_establecimiento.sql — Tiendas propias, E3: seguridad por
-- establecimiento. NO activa nada: con el interruptor de 143 apagado no puede existir
-- una tienda ni una asignación a tienda, así que ningún usuario actual cambia de perfil.
--
-- Diseño cerrado (D-S3, D-S4, D-S6, D-S10). Qué agrega:
--
--   1. PERFIL EFECTIVO «Ventas Tienda». Un usuario con rol guardado `Ventas` que tiene
--      al menos una asignación a un establecimiento que NO es el CEDIS deja de ser
--      Ventas central para el servidor: `erp_actor()` devuelve el rol `Ventas Tienda` y
--      `erp_roles_activos()` devuelve solo `{Ventas Tienda}` (sin accesos adicionales).
--      No es un rol guardado (`usuarios.rol` sigue siendo `Ventas`): es lo que el
--      servidor decide a partir de las asignaciones, que solo se escriben con SQL de
--      confianza. Consecuencia: todos los contratos y policies que piden `Ventas`,
--      `Admin`, `Producción`… dejan de aceptarlo sin tocar ninguno de ellos.
--      · La asignación a tienda SIEMPRE restringe; si la tienda se desactiva, el usuario
--        sigue siendo «Ventas Tienda» y no ve nada (no "regresa" a Ventas central).
--      · Solo aplica al rol guardado `Ventas`. Admin sigue viendo todo; Producción con
--        asignación (traspasos de 144) sigue siendo Producción.
--   2. LECTURA. `erp_lector_negocio()` excluye a «Ventas Tienda» (igual que al Empleado):
--      las 26 policies de lectura amplia dejan de aplicarle. A cambio recibe 5 policies
--      de lectura ACOTADA: cuartos de sus tiendas (y los del CEDIS solo con el permiso
--      `vende_desde_cedis`), kardex de los cuartos de sus tiendas, y órdenes, líneas y
--      pagos de sus tiendas. Nada más: sin clientes, productos, rutas, producción, CxC,
--      CxP, costos, nómina, mermas, empleados ni configuración por REST.
--   3. CLIENTES Y PRECIOS DEL POS, solo por contrato:
--      · `buscar_clientes_pos(establecimiento, texto)`: mínimo 3 letras, máximo 10
--        resultados, y de cada cliente solo id, nombre, nombre comercial y si se le
--        puede facturar (sí/no). Nunca RFC, domicilio, correo, saldo, crédito ni límite.
--        Cada tienda nace en modo `lista`: solo ve los clientes de
--        `establecimiento_clientes` (vacía → no ve ninguno). El modo `todos` lo pone el
--        dueño con SQL.
--      · `precios_pos(establecimiento, cliente, skus)`: el precio lo calcula el servidor
--        con `precio_canonico` (sucursal principal → cliente → lista). Sin cliente =
--        precio de lista. Un cliente fuera del alcance de la tienda se rechaza igual
--        exista o no.
--      · `mis_establecimientos()`: en qué tiendas trabaja el usuario y con qué permisos.
--   4. EXISTENCIAS. `cuartos_frios_guard_actor()` (144) pasa de "rechazar a Producción
--      y Chofer" a una lista de quién SÍ puede cambiar la existencia de un cuarto de
--      tienda: Administración, el «Ventas Tienda» asignado a esa tienda y el traspaso
--      autorizado de 144. Cierra el residual de E2: Ventas central ya no puede sacar
--      producto del congelador de una tienda con `completar_venta_directa` (el contrato
--      no cambia: la guarda corta el movimiento y la operación completa se deshace). En
--      el CEDIS, «Ventas Tienda» solo mueve existencia con el permiso `vende_desde_cedis`.
--
--   5. LO QUE HEREDABA COMO «USUARIO ACTIVO». `erp_es_activo()` y `erp_exigir_no_empleado()`
--      (119) solo excluían al Empleado; ahora excluyen también a «Ventas Tienda». Con eso
--      el usuario de tienda no inserta auditoría ni avisos, no marca avisos como leídos,
--      no usa el bucket de Storage `mermas` (sus 6 policies, 3 de ellas de storage.objects,
--      no cambian de texto: las protege la función) y no ejecuta los 4 ayudantes sí/no de
--      historia (`cuarto_tiene_historia`, `empaque_tiene_dependencias`,
--      `b4_ruta_con_historia`, `erp_foto_merma_en_uso`).
--
-- Contratos de identidad que cambian (los cinco autorizados para E3):
--   erp_actor()            27277fcf645f05134275473c7892b769 → e1a9770e1bc5cebd7f565c9cfdc2a880
--   erp_roles_activos()    53c2999e3a7e19c781999d73ea052c68 → 5da5963d56554336793351384f018d74
--   erp_lector_negocio()   d97f617862eda14b2d86100221e9885b → 858e98ff65b09e80477dde7298b164d2
--   erp_es_activo()        1e94bc1d08b13cd559e7e678c7e6347e → 9b87432b5056856944453a60c4e97ff2
--   erp_exigir_no_empleado(text) 51882a9b70cd7451ee315021c6db7bf0 → d87bc09bf29e8c06dcedff936e13c12f
-- Misma firma, mismo ACL, mismo search_path. Para todo usuario sin asignación a tienda
-- (todos los perfiles centrales y el Empleado) devuelven exactamente lo mismo que antes.
--
-- Lo que NO cambia: ningún contrato de negocio, ninguna policy existente (tampoco las
-- de Storage), ningún dato.
--
-- Idempotente. Reversión (sin tiendas ni asignaciones): volver las tres funciones a su
-- definición de 120/117, `erp_es_activo()` y `erp_exigir_no_empleado()` a la de 119 y la guarda a la de 144; DROP de las 5 policies `tienda_read`,
-- de las funciones nuevas, de `establecimiento_clientes` y de las columnas
-- `establecimientos.clientes_pos` y `usuario_establecimientos.vende_desde_cedis`.

-- ═══ 0. Precondiciones ═══
CREATE OR REPLACE FUNCTION pg_temp.t145_exigir(p_firma TEXT, p_antes TEXT, p_despues TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE v TEXT := md5(pg_get_functiondef(p_firma::regprocedure));
BEGIN
  IF v NOT IN (p_antes, p_despues) THEN
    RAISE EXCEPTION '145: % no tiene la definición auditada (md5 %; se esperaba % o %). No se aplicó nada.', p_firma, v, p_antes, p_despues;
  END IF;
END $$;
DO $$
BEGIN
  IF to_regprocedure('public.cuartos_frios_guard_actor()') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                     AND table_name = 'usuario_establecimientos' AND column_name = 'traspasa_con_cedis') THEN
    RAISE EXCEPTION '145: faltan las migraciones 143 y 144. No se aplicó nada.';
  END IF;
  PERFORM pg_temp.t145_exigir('public.erp_actor()', '27277fcf645f05134275473c7892b769', 'e1a9770e1bc5cebd7f565c9cfdc2a880');
  PERFORM pg_temp.t145_exigir('public.erp_roles_activos()', '53c2999e3a7e19c781999d73ea052c68', '5da5963d56554336793351384f018d74');
  PERFORM pg_temp.t145_exigir('public.erp_lector_negocio()', 'd97f617862eda14b2d86100221e9885b', '858e98ff65b09e80477dde7298b164d2');
  PERFORM pg_temp.t145_exigir('public.erp_es_activo()', '1e94bc1d08b13cd559e7e678c7e6347e', '9b87432b5056856944453a60c4e97ff2');
  PERFORM pg_temp.t145_exigir('public.erp_exigir_no_empleado(text)', '51882a9b70cd7451ee315021c6db7bf0', 'd87bc09bf29e8c06dcedff936e13c12f');
END $$;

-- ═══ 1. Estructura: permiso de vender desde el CEDIS y alcance de clientes del POS ═══
ALTER TABLE public.usuario_establecimientos ADD COLUMN IF NOT EXISTS vende_desde_cedis BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.usuario_establecimientos.vende_desde_cedis IS
  '145: el usuario, trabajando en ESTA tienda de fábrica, puede ver y vender existencia del CEDIS (D-S4). Apagado por omisión; no vale en una tienda que no sea de fábrica.';

ALTER TABLE public.establecimientos ADD COLUMN IF NOT EXISTS clientes_pos TEXT NOT NULL DEFAULT 'lista';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'establecimientos_clientes_pos_check') THEN
    ALTER TABLE public.establecimientos ADD CONSTRAINT establecimientos_clientes_pos_check CHECK (clientes_pos IN ('lista', 'todos'));
  END IF;
END $$;
COMMENT ON COLUMN public.establecimientos.clientes_pos IS
  '145: qué clientes puede buscar el POS de este establecimiento. lista = solo los de establecimiento_clientes (por omisión; vacía = ninguno); todos = cualquier cliente vigente.';

CREATE TABLE IF NOT EXISTS public.establecimiento_clientes (
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  cliente_id         BIGINT NOT NULL REFERENCES public.clientes(id) ON DELETE CASCADE,
  asignado_por       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (establecimiento_id, cliente_id)
);
COMMENT ON TABLE public.establecimiento_clientes IS
  '145: clientes que el POS de una tienda en modo lista puede buscar y elegir. Sin acceso por API (RLS activa, sin policies, sin grants): se escribe con SQL de confianza.';
CREATE INDEX IF NOT EXISTS establecimiento_clientes_cliente ON public.establecimiento_clientes (cliente_id);
ALTER TABLE public.establecimiento_clientes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.establecimiento_clientes FROM PUBLIC, anon, authenticated;

-- ═══ 2. Quién es usuario de tienda ═══
-- Interna (sin EXECUTE por API). No mira si la tienda está activa: desactivar una tienda
-- no le devuelve a nadie el perfil de Ventas central.
CREATE OR REPLACE FUNCTION public.erp_usuario_de_tienda(p_usuario_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN establecimientos e ON e.id = ue.establecimiento_id
                  WHERE ue.usuario_id = p_usuario_id AND e.tipo <> 'cedis')
$$;
REVOKE ALL ON FUNCTION public.erp_usuario_de_tienda(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 3. Identidad: perfil efectivo (definiciones de 120 + la línea marcada "145") ═══
CREATE OR REPLACE FUNCTION public.erp_actor()
 RETURNS TABLE(id bigint, rol text, nombre text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT u.id,
         CASE WHEN u.rol = 'Ventas' AND erp_usuario_de_tienda(u.id) THEN 'Ventas Tienda' ELSE u.rol::TEXT END,  -- 145
         u.nombre
    FROM usuarios u
   WHERE u.auth_id IS NOT NULL
     AND u.auth_id = auth.uid()
     AND u.estatus = 'Activo'
     AND NOT u.debe_cambiar_password
   LIMIT 1
$function$;

CREATE OR REPLACE FUNCTION public.erp_roles_activos()
 RETURNS text[]
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE WHEN u.rol = 'Ventas' AND erp_usuario_de_tienda(u.id) THEN ARRAY['Ventas Tienda']  -- 145
              ELSE ARRAY[u.rol::TEXT] || u.accesos_extra END
    FROM usuarios u
   WHERE u.auth_id IS NOT NULL
     AND u.auth_id = auth.uid()
     AND u.estatus = 'Activo'
     AND NOT u.debe_cambiar_password
   LIMIT 1
$function$;

-- 117 + 145: la lectura amplia del negocio no es para el Empleado ni para Ventas Tienda.
CREATE OR REPLACE FUNCTION public.erp_lector_negocio()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT COALESCE(erp_rol_activo() IS NOT NULL AND erp_rol_activo() NOT IN ('Empleado', 'Ventas Tienda'), false)
$function$;

-- 119 + 145: «usuario activo» para auditoría, avisos y el bucket de mermas (6 policies, 3 de
-- storage.objects que una migración no puede alterar): ni el Empleado ni Ventas Tienda.
CREATE OR REPLACE FUNCTION public.erp_es_activo()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_rol_activo() IS NOT NULL AND erp_rol_activo() NOT IN ('Empleado', 'Ventas Tienda')
$function$;

-- 119 + 145: los 4 ayudantes sí/no de historia rechazan al Empleado y a Ventas Tienda.
CREATE OR REPLACE FUNCTION public.erp_exigir_no_empleado(p_fn text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF erp_rol_activo() IN ('Empleado', 'Ventas Tienda') THEN
    RAISE EXCEPTION '%: no autorizado', p_fn USING ERRCODE = '42501';
  END IF;
  RETURN true;
END $function$;

-- ═══ 4. Alcance del usuario de tienda (lo evalúan las policies: nunca fallan, solo sí/no) ═══
-- p_con_cedis = true: además de sus tiendas, el CEDIS si tiene el permiso en una tienda de fábrica.
CREATE OR REPLACE FUNCTION public.erp_tienda_asignada(p_establecimiento_id BIGINT, p_con_cedis BOOLEAN DEFAULT false) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(erp_rol_activo() = 'Ventas Tienda' AND p_establecimiento_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM usuario_establecimientos ue JOIN establecimientos e ON e.id = ue.establecimiento_id
     WHERE ue.usuario_id = erp_usuario_id() AND e.activo AND e.tipo <> 'cedis'
       AND (ue.establecimiento_id = p_establecimiento_id
            OR (COALESCE(p_con_cedis, false) AND p_establecimiento_id = 1 AND ue.vende_desde_cedis AND e.tipo = 'tienda_fabrica'))), false)
$$;

CREATE OR REPLACE FUNCTION public.erp_tienda_ve_cuarto(p_cuarto_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT erp_tienda_asignada(c.establecimiento_id, false) FROM cuartos_frios c WHERE c.id = p_cuarto_id), false)
$$;

CREATE OR REPLACE FUNCTION public.erp_tienda_ve_orden(p_orden_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT erp_tienda_asignada(o.establecimiento_id, false) FROM ordenes o WHERE o.id = p_orden_id), false)
$$;

REVOKE ALL ON FUNCTION public.erp_tienda_asignada(BIGINT, BOOLEAN), public.erp_tienda_ve_cuarto(TEXT), public.erp_tienda_ve_orden(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.erp_tienda_asignada(BIGINT, BOOLEAN), public.erp_tienda_ve_cuarto(TEXT), public.erp_tienda_ve_orden(BIGINT) TO authenticated, service_role;

-- ═══ 5. Lectura acotada (se suman a las policies existentes, que no cambian) ═══
-- `(SELECT erp_rol_activo())` se evalúa una vez por consulta: para los demás perfiles la
-- policy se descarta sin consultar nada por fila.
DROP POLICY IF EXISTS tienda_read ON public.cuartos_frios;
CREATE POLICY tienda_read ON public.cuartos_frios FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND erp_tienda_asignada(establecimiento_id, true));

DROP POLICY IF EXISTS tienda_read ON public.inventario_mov;
CREATE POLICY tienda_read ON public.inventario_mov FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND cuarto_id IS NOT NULL AND erp_tienda_ve_cuarto(cuarto_id));

DROP POLICY IF EXISTS tienda_read ON public.ordenes;
CREATE POLICY tienda_read ON public.ordenes FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND establecimiento_id IS NOT NULL AND erp_tienda_asignada(establecimiento_id, false));

DROP POLICY IF EXISTS tienda_read ON public.orden_lineas;
CREATE POLICY tienda_read ON public.orden_lineas FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND erp_tienda_ve_orden(orden_id));

DROP POLICY IF EXISTS tienda_read ON public.pagos;
CREATE POLICY tienda_read ON public.pagos FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND orden_id IS NOT NULL AND erp_tienda_ve_orden(orden_id));

-- ═══ 6. Guarda de existencias: lista de quién SÍ mueve el inventario de una tienda ═══
-- Sustituye la de 144 (misma función, mismo disparador). Corre en CADA cambio de existencia
-- de un cuarto, lo dispare quien lo dispare (todo contrato pasa por stock_mov_cuarto →
-- UPDATE cuartos_frios); el actor es el del token de la petición, también dentro de una
-- función SECURITY DEFINER.
CREATE OR REPLACE FUNCTION public.cuartos_frios_guard_actor() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT;
  v_rol TEXT;
BEGIN
  IF NEW.stock IS NOT DISTINCT FROM OLD.stock THEN
    RETURN NEW;
  END IF;
  v_jwt := fin_jwt_role();
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN
    RETURN NEW;                       -- sesión de confianza: sin actor que restringir
  END IF;
  v_rol := erp_rol_activo();

  IF OLD.establecimiento_id = 1 THEN
    -- CEDIS: todo sigue como hoy para los perfiles centrales. Un usuario de tienda solo
    -- con el permiso de vender desde el CEDIS (tienda de fábrica, D-S4).
    IF v_rol = 'Ventas Tienda' AND NOT erp_tienda_asignada(1, true) THEN
      RAISE EXCEPTION 'El cuarto % es del CEDIS: tu tienda no tiene permiso para mover su inventario.', OLD.id
        USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'INVENTARIO_DEL_CEDIS', 'cuarto_id', OLD.id)::text;
    END IF;
    RETURN NEW;
  END IF;

  IF v_rol = 'Admin' THEN
    RETURN NEW;
  END IF;
  IF v_rol = 'Ventas Tienda' AND erp_tienda_asignada(OLD.establecimiento_id, false) THEN
    RETURN NEW;
  END IF;
  -- Traspaso CEDIS ↔ tienda de fábrica que traspaso_cuartos YA autorizó (144): marca local
  -- a la transacción, fijada solo por ese contrato y solo para sus dos cuartos.
  IF v_rol = 'Producción'
     AND OLD.id = ANY (string_to_array(COALESCE(current_setting('app.traspaso_ctx', true), ''), '|')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'El cuarto % es de una tienda: % no puede mover su inventario.', OLD.id, COALESCE(v_rol, 'un usuario sin perfil activo')
    USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'INVENTARIO_DE_TIENDA', 'cuarto_id', OLD.id, 'establecimiento', OLD.establecimiento_id)::text;
END $$;
REVOKE ALL ON FUNCTION public.cuartos_frios_guard_actor() FROM PUBLIC, anon, authenticated;

-- ═══ 7. Contratos de lectura del POS ═══
-- Autoriza y valida el establecimiento para los tres contratos. Devuelve el modo de clientes.
CREATE OR REPLACE FUNCTION public.pos_exigir_establecimiento(p_fn TEXT, p_establecimiento_id BIGINT) RETURNS TEXT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_e   establecimientos%ROWTYPE;
BEGIN
  IF v_jwt IS NOT NULL AND v_jwt <> 'service_role' THEN
    IF v_jwt <> 'authenticated'
       OR NOT COALESCE(erp_rol_activo() = 'Admin' OR erp_tienda_asignada(p_establecimiento_id, false), false) THEN
      RAISE EXCEPTION '%: no autorizado', p_fn USING ERRCODE = '42501';
    END IF;
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION '%: las tiendas todavía no están activadas', p_fn
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id;
  IF NOT FOUND OR NOT v_e.activo OR v_e.tipo = 'cedis' THEN
    RAISE EXCEPTION '%: el establecimiento no es una tienda activa', p_fn
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
  RETURN v_e.clientes_pos;
END $$;
REVOKE ALL ON FUNCTION public.pos_exigir_establecimiento(TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

-- ¿El POS de este establecimiento puede usar a este cliente? Interna.
CREATE OR REPLACE FUNCTION public.pos_cliente_disponible(p_establecimiento_id BIGINT, p_modo TEXT, p_cliente_id BIGINT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM clientes c
     WHERE c.id = p_cliente_id AND c.estatus = 'Activo' AND c.fusionado_en IS NULL
       AND (p_modo = 'todos' OR EXISTS (SELECT 1 FROM establecimiento_clientes ec
                                         WHERE ec.establecimiento_id = p_establecimiento_id AND ec.cliente_id = c.id)))
$$;
REVOKE ALL ON FUNCTION public.pos_cliente_disponible(BIGINT, TEXT, BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.mis_establecimientos() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_rol TEXT := erp_rol_activo();
  v_uid BIGINT := erp_usuario_id();
BEGIN
  IF v_jwt IS NOT NULL AND v_jwt <> 'service_role'
     AND (v_jwt <> 'authenticated' OR v_rol IS NULL OR v_rol NOT IN ('Admin', 'Ventas Tienda')) THEN
    RAISE EXCEPTION 'mis_establecimientos: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'tiendas_habilitadas', tiendas_habilitadas(),
    'perfil', v_rol,
    'establecimientos', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', e.id, 'clave', e.clave, 'nombre', e.nombre, 'tipo', e.tipo, 'clientes_pos', e.clientes_pos,
               'vende_desde_cedis', COALESCE(ue.vende_desde_cedis AND e.tipo = 'tienda_fabrica', false),
               'traspasa_con_cedis', COALESCE(ue.traspasa_con_cedis AND e.tipo = 'tienda_fabrica', false)) ORDER BY e.id)
        FROM establecimientos e
        LEFT JOIN usuario_establecimientos ue ON ue.establecimiento_id = e.id AND ue.usuario_id = v_uid
       WHERE e.activo
         AND (v_rol IS DISTINCT FROM 'Ventas Tienda' OR (ue.usuario_id IS NOT NULL AND e.tipo <> 'cedis'))), '[]'::jsonb));
END $$;

CREATE OR REPLACE FUNCTION public.buscar_clientes_pos(p_establecimiento_id BIGINT, p_texto TEXT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_modo  TEXT := pos_exigir_establecimiento('buscar_clientes_pos', p_establecimiento_id);
  v_texto TEXT := regexp_replace(btrim(COALESCE(p_texto, '')), '\s+', ' ', 'g');
  v_pat   TEXT;
  v_filas JSONB;
BEGIN
  IF length(v_texto) < 3 THEN
    RAISE EXCEPTION 'buscar_clientes_pos: escribe al menos 3 letras del nombre'
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'BUSQUEDA_CORTA')::text;
  END IF;
  -- El texto se busca literal: % y _ no son comodines.
  v_pat := '%' || replace(replace(replace(v_texto, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  SELECT COALESCE(jsonb_agg(f.j ORDER BY f.nombre, f.id), '[]'::jsonb) INTO v_filas
    FROM (
      SELECT c.id, c.nombre,
             jsonb_build_object(
               'id', c.id, 'nombre', c.nombre, 'nombre_comercial', NULLIF(btrim(COALESCE(c.nombre_comercial, '')), ''),
               'puede_facturar',
                 upper(btrim(COALESCE(c.rfc, ''))) ~ '^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$'
                 AND upper(btrim(COALESCE(c.rfc, ''))) NOT IN ('XAXX010101000', 'XEXX010101000')
                 AND btrim(COALESCE(c.regimen, '')) ~ '^[0-9]{3}'
                 AND length(btrim(COALESCE(c.uso_cfdi, ''))) > 0
                 AND COALESCE(NULLIF(btrim(COALESCE(c.cp, '')), ''), btrim(COALESCE(c.codigo_postal, ''))) ~ '^[0-9]{5}$') AS j
        FROM clientes c
       WHERE c.estatus = 'Activo' AND c.fusionado_en IS NULL
         AND (c.nombre ILIKE v_pat ESCAPE '\' OR COALESCE(c.nombre_comercial, '') ILIKE v_pat ESCAPE '\')
         AND (v_modo = 'todos' OR EXISTS (SELECT 1 FROM establecimiento_clientes ec
                                           WHERE ec.establecimiento_id = p_establecimiento_id AND ec.cliente_id = c.id))
       ORDER BY c.nombre, c.id
       LIMIT 11) f;
  RETURN jsonb_build_object(
    'clientes', (SELECT COALESCE(jsonb_agg(t.value ORDER BY t.ordinality), '[]'::jsonb)
                   FROM jsonb_array_elements(v_filas) WITH ORDINALITY AS t WHERE t.ordinality <= 10),
    'hay_mas', jsonb_array_length(v_filas) > 10);
END $$;

CREATE OR REPLACE FUNCTION public.precios_pos(p_establecimiento_id BIGINT, p_cliente_id BIGINT DEFAULT NULL, p_skus TEXT[] DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_modo     TEXT := pos_exigir_establecimiento('precios_pos', p_establecimiento_id);
  v_sucursal BIGINT;
BEGIN
  IF p_cliente_id IS NOT NULL THEN
    -- Mismo rechazo si el cliente no existe, está inactivo, se fusionó o no es de esta tienda.
    IF NOT pos_cliente_disponible(p_establecimiento_id, v_modo, p_cliente_id) THEN
      RAISE EXCEPTION 'precios_pos: el cliente no está disponible en esta tienda'
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLIENTE_NO_DISPONIBLE')::text;
    END IF;
    SELECT s.id INTO v_sucursal FROM sucursales s WHERE s.cliente_id = p_cliente_id AND s.es_principal;
  END IF;
  RETURN jsonb_build_object(
    'cliente_id', p_cliente_id,
    'precios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('sku', p.sku, 'nombre', p.nombre,
                                          'precio', precio_canonico(p_cliente_id, v_sucursal, p.sku)) ORDER BY p.sku)
        FROM productos p
       WHERE p.tipo = 'Producto Terminado'
         AND (p_skus IS NULL OR p.sku = ANY (p_skus))), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.mis_establecimientos(), public.buscar_clientes_pos(BIGINT, TEXT), public.precios_pos(BIGINT, BIGINT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mis_establecimientos(), public.buscar_clientes_pos(BIGINT, TEXT), public.precios_pos(BIGINT, BIGINT, TEXT[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
