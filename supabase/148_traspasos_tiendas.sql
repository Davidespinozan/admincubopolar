-- 148_traspasos_tiendas.sql — Tiendas propias, E7: tiendas remotas y abastecimiento por
-- traspaso con tránsito (despacho y recepción). NO activa nada: con el interruptor de 143
-- apagado no puede existir una tienda ni, por lo tanto, un traspaso.
--
-- Un traspaso NO es una ruta de clientes, ni un comodato, ni una venta, ni una cuenta por
-- cobrar: es producto de la empresa que cambia de lugar. No toca rutas, órdenes, pagos, CxC
-- ni contabilidad; solo cuartos y kardex.
--
-- TIENDAS REMOTAS (tipo `tienda`): identidad, personal, congeladores, cajas, inventario y
-- activación propios (los mismos contratos de 147). Una tienda remota NUNCA vende ni recibe
-- directo del CEDIS: `vende_desde_cedis` y `traspasa_con_cedis` siguen siendo solo de la
-- tienda de fábrica; se surte únicamente por traspaso con tránsito.
--
-- TRASPASO: CEDIS → tienda (abasto) o tienda → CEDIS (devolución). Nunca tienda ↔ tienda.
--   pendiente ──despachar──▶ en_transito ──recibir──▶ recibido (con o sin incidencia)
--       │                         └──retornar──▶ retornado (con o sin incidencia)
--       └──cancelar──▶ cancelado
--   · crear_traspaso      origen, destino, cuartos, productos, quién lo transporta. No mueve nada.
--   · despachar_traspaso  verifica existencia y la descuenta del cuarto de origen (kardex
--                         «Traspaso salida»). El destino TODAVÍA no sube: el producto va en camino.
--   · recibir_traspaso    por línea: recibido bueno, dañado y (lo que falte) faltante. Solo lo
--                         bueno sube al cuarto de destino (kardex «Traspaso entrada»). Dañado o
--                         faltante = incidencia, con nota obligatoria. Una sola recepción.
--   · cancelar_traspaso   solo ANTES de despachar. Uno despachado no se cancela: el producto ya
--                         salió; si regresa, se registra con retornar_traspaso.
--   · retornar_traspaso   el producto volvió al origen: recepción física en el cuarto de origen,
--                         con sus diferencias. No "deshace" el despacho: lo completa.
--   · cerrar_incidencia_traspaso  Administración deja constancia de cómo se resolvió.
--   · traspasos_consulta  pendientes, en tránsito, recibidos, incidencias, historial y
--                         movimientos, por establecimiento.
--
-- QUIÉN: crear, despachar, cancelar, retornar y cerrar incidencias → Administración.
--   Recibir → Administración, o el personal de la tienda destino con el permiso explícito
--   `recibe_traspasos` (definir_recepcion_tienda; apagado por omisión). Recibir en el CEDIS →
--   Administración. No se amplía ningún permiso de Producción, Chofer ni Ventas central.
--   Todo lo decide el servidor con el token de la petición; no hay banderas que mande el cliente.
--
-- CANDADOS (mismo orden en todos): traspaso → cuartos por id. La venta del POS (146) bloquea
-- turno → cuartos; ningún contrato toma los dos en orden inverso.
--
-- Contratos de E6 que cambian (con verificación de huella; todo lo demás, intacto):
--   tienda_checklist(bigint)                  7081e88c3573f9424e5013adca6fd74d → e82e731dfb92f198af09515be6977c3f
--       acepta el tipo `tienda`; el permiso de recibir solo vale para el personal de la tienda.
--   retirar_usuario_tienda(bigint,bigint,boolean) a55b0e8e00f3bf438a427338c468d19f → dd831c01be1739380348d10ee260bd58
--       una tienda ACTIVA no se queda sin su último cajero por un retiro ordinario (ULTIMO_CAJERO).
--   guardar_establecimiento(bigint,text,text) bfa5d07d32d2edcd5106dc59a0209855 → se sustituye por
--       guardar_establecimiento(bigint,text,text,text) 1ea7cfabf6fe2a9ccc0550db21ae60ca: mismo contrato con `p_tipo` opcional
--       (sin él crea una tienda de fábrica, como antes). El tipo no cambia después.
--
-- Idempotente. Reversión (sin traspasos ni tiendas remotas): volver las tres funciones a su
-- definición de 147; DROP de los 8 contratos, de las funciones internas traspaso_*, de las tablas
-- traspaso_eventos, traspaso_lineas y traspasos, de la secuencia folio_traspaso_seq y de la columna
-- usuario_establecimientos.recibe_traspasos.

-- ═══ 0. Precondiciones ═══
DO $$
DECLARE v TEXT;
BEGIN
  IF to_regprocedure('public.tienda_checklist(bigint)') IS NULL OR to_regprocedure('public.activar_tienda(uuid,bigint,boolean,text)') IS NULL THEN
    RAISE EXCEPTION '148: falta la migración 147. No se aplicó nada.';
  END IF;
  v := md5(pg_get_functiondef('public.tienda_checklist(bigint)'::regprocedure));
  IF v NOT IN ('7081e88c3573f9424e5013adca6fd74d', 'e82e731dfb92f198af09515be6977c3f') THEN
    RAISE EXCEPTION '148: tienda_checklist no tiene la definición auditada (md5 %). No se aplicó nada.', v;
  END IF;
  v := md5(pg_get_functiondef('public.retirar_usuario_tienda(bigint,bigint,boolean)'::regprocedure));
  IF v NOT IN ('a55b0e8e00f3bf438a427338c468d19f', 'dd831c01be1739380348d10ee260bd58') THEN
    RAISE EXCEPTION '148: retirar_usuario_tienda no tiene la definición auditada (md5 %). No se aplicó nada.', v;
  END IF;
  IF to_regprocedure('public.guardar_establecimiento(bigint,text,text)') IS NOT NULL THEN
    v := md5(pg_get_functiondef('public.guardar_establecimiento(bigint,text,text)'::regprocedure));
    IF v <> 'bfa5d07d32d2edcd5106dc59a0209855' THEN
      RAISE EXCEPTION '148: guardar_establecimiento no tiene la definición auditada (md5 %). No se aplicó nada.', v;
    END IF;
  ELSIF to_regprocedure('public.guardar_establecimiento(bigint,text,text,text)') IS NULL
     OR md5(pg_get_functiondef('public.guardar_establecimiento(bigint,text,text,text)'::regprocedure)) <> '1ea7cfabf6fe2a9ccc0550db21ae60ca' THEN
    RAISE EXCEPTION '148: guardar_establecimiento no está en ninguna de las dos definiciones esperadas. No se aplicó nada.';
  END IF;
END $$;

-- ═══ 1. Permiso de recibir traspasos (apagado por omisión, separado de los otros dos) ═══
ALTER TABLE public.usuario_establecimientos ADD COLUMN IF NOT EXISTS recibe_traspasos BOOLEAN NOT NULL DEFAULT false;
COMMENT ON COLUMN public.usuario_establecimientos.recibe_traspasos IS
  '148: esta persona (personal de la tienda) puede registrar la recepción de los traspasos que llegan a ESTA tienda. Apagado por omisión. No tiene que ver con vender desde el CEDIS ni con traspasar con el CEDIS.';

-- ═══ 2. Traspasos ═══
CREATE SEQUENCE IF NOT EXISTS public.folio_traspaso_seq;
REVOKE ALL ON SEQUENCE public.folio_traspaso_seq FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.traspasos (
  id                          BIGSERIAL PRIMARY KEY,
  folio                       TEXT NOT NULL UNIQUE,
  origen_establecimiento_id   BIGINT NOT NULL REFERENCES public.establecimientos(id),
  destino_establecimiento_id  BIGINT NOT NULL REFERENCES public.establecimientos(id),
  cuarto_origen               TEXT NOT NULL REFERENCES public.cuartos_frios(id),
  cuarto_destino              TEXT NOT NULL REFERENCES public.cuartos_frios(id),
  estado                      TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_transito', 'recibido', 'retornado', 'cancelado')),
  incidencia                  BOOLEAN NOT NULL DEFAULT false,      -- hubo faltante o dañado al recibir (o al retornar)
  responsable                 TEXT NOT NULL CHECK (length(btrim(responsable)) >= 3),   -- quién transporta el producto
  notas                       TEXT,
  creado_por                  BIGINT,
  creado_por_nombre           TEXT,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  despachado_at               TIMESTAMPTZ,
  despachado_por_nombre       TEXT,
  recibido_at                 TIMESTAMPTZ,                         -- recepción en destino o retorno al origen
  recibido_por                BIGINT,
  recibido_por_nombre         TEXT,
  notas_recepcion             TEXT,
  cancelado_at                TIMESTAMPTZ,
  cancelado_por_nombre        TEXT,
  motivo_cancelacion          TEXT,
  incidencia_cerrada_at       TIMESTAMPTZ,
  incidencia_cerrada_por      TEXT,
  incidencia_resolucion       TEXT,
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (origen_establecimiento_id <> destino_establecimiento_id AND cuarto_origen <> cuarto_destino),
  CHECK (origen_establecimiento_id = 1 OR destino_establecimiento_id = 1),          -- siempre con el CEDIS en un extremo
  CHECK ((estado = 'pendiente' AND despachado_at IS NULL AND recibido_at IS NULL AND cancelado_at IS NULL)
      OR (estado = 'en_transito' AND despachado_at IS NOT NULL AND recibido_at IS NULL AND cancelado_at IS NULL)
      OR (estado IN ('recibido', 'retornado') AND despachado_at IS NOT NULL AND recibido_at IS NOT NULL AND cancelado_at IS NULL)
      OR (estado = 'cancelado' AND despachado_at IS NULL AND recibido_at IS NULL AND cancelado_at IS NOT NULL)),
  CHECK (NOT incidencia OR estado IN ('recibido', 'retornado'))
);
COMMENT ON TABLE public.traspasos IS
  '148: movimiento de producto entre el CEDIS y una tienda propia, con tránsito. No es ruta de clientes, comodato, venta ni CxC. Sin acceso por REST: se lee con traspasos_consulta y se escribe con los contratos de traspaso.';
CREATE INDEX IF NOT EXISTS traspasos_origen ON public.traspasos (origen_establecimiento_id, estado);
CREATE INDEX IF NOT EXISTS traspasos_destino ON public.traspasos (destino_establecimiento_id, estado);

CREATE TABLE IF NOT EXISTS public.traspaso_lineas (
  traspaso_id         BIGINT NOT NULL REFERENCES public.traspasos(id),
  sku                 TEXT NOT NULL,
  cantidad            INTEGER NOT NULL CHECK (cantidad > 0),      -- lo que se pidió mover
  cantidad_despachada INTEGER CHECK (cantidad_despachada IS NULL OR cantidad_despachada = cantidad),
  cantidad_recibida   INTEGER CHECK (cantidad_recibida IS NULL OR cantidad_recibida >= 0),     -- llegó bien y entró al cuarto
  cantidad_danada     INTEGER CHECK (cantidad_danada IS NULL OR cantidad_danada >= 0),         -- llegó dañado: no entra al cuarto
  cantidad_faltante   INTEGER CHECK (cantidad_faltante IS NULL OR cantidad_faltante >= 0),     -- no llegó
  PRIMARY KEY (traspaso_id, sku),
  CHECK (cantidad_recibida IS NULL OR (cantidad_despachada IS NOT NULL AND cantidad_danada IS NOT NULL AND cantidad_faltante IS NOT NULL
                                       AND cantidad_recibida + cantidad_danada + cantidad_faltante = cantidad_despachada))
);
COMMENT ON TABLE public.traspaso_lineas IS
  '148: productos de un traspaso. Al cerrar: recibida + dañada + faltante = despachada, siempre.';

CREATE TABLE IF NOT EXISTS public.traspaso_eventos (
  id           BIGSERIAL PRIMARY KEY,
  traspaso_id  BIGINT NOT NULL REFERENCES public.traspasos(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('creacion', 'despacho', 'recepcion', 'retorno', 'cancelacion', 'cierre_incidencia')),
  operacion_id UUID NOT NULL UNIQUE,
  huella       TEXT NOT NULL,
  actor_id     BIGINT,
  actor        TEXT,
  datos        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.traspaso_eventos IS
  '148: historia inmutable de cada traspaso con el operacion_id de cada paso (idempotencia: un reintento devuelve `datos`).';
CREATE INDEX IF NOT EXISTS traspaso_eventos_traspaso ON public.traspaso_eventos (traspaso_id, id);

ALTER TABLE public.traspasos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traspaso_lineas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.traspaso_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.traspasos, public.traspaso_lineas, public.traspaso_eventos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.traspasos_id_seq, public.traspaso_eventos_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.traspasos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION '%: no se escribe por API (usa los contratos de traspaso)', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'traspaso_eventos') THEN
    RAISE EXCEPTION '%: un traspaso y su historia no se borran ni se reescriben', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'traspasos' THEN
    IF (NEW.folio, NEW.origen_establecimiento_id, NEW.destino_establecimiento_id, NEW.cuarto_origen, NEW.cuarto_destino)
       IS DISTINCT FROM (OLD.folio, OLD.origen_establecimiento_id, OLD.destino_establecimiento_id, OLD.cuarto_origen, OLD.cuarto_destino) THEN
      RAISE EXCEPTION 'traspasos: origen, destino y cuartos de un traspaso no cambian' USING ERRCODE = '22023';
    END IF;
    -- Un traspaso cerrado no vuelve atrás (solo se le puede cerrar la incidencia).
    IF OLD.estado IN ('recibido', 'retornado', 'cancelado') AND NEW.estado <> OLD.estado THEN
      RAISE EXCEPTION 'traspasos: un traspaso % no cambia de estado', OLD.estado USING ERRCODE = '22023';
    END IF;
    NEW.updated_at := now();
  END IF;
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'traspaso_lineas' THEN
    IF (NEW.traspaso_id, NEW.sku, NEW.cantidad) IS DISTINCT FROM (OLD.traspaso_id, OLD.sku, OLD.cantidad) THEN
      RAISE EXCEPTION 'traspaso_lineas: el producto y la cantidad de un traspaso no cambian' USING ERRCODE = '22023';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.traspasos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_traspasos_guard ON public.traspasos;
CREATE TRIGGER trg_traspasos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.traspasos FOR EACH ROW EXECUTE FUNCTION public.traspasos_guard();
DROP TRIGGER IF EXISTS trg_traspaso_lineas_guard ON public.traspaso_lineas;
CREATE TRIGGER trg_traspaso_lineas_guard BEFORE INSERT OR UPDATE OR DELETE ON public.traspaso_lineas FOR EACH ROW EXECUTE FUNCTION public.traspasos_guard();
DROP TRIGGER IF EXISTS trg_traspaso_eventos_guard ON public.traspaso_eventos;
CREATE TRIGGER trg_traspaso_eventos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.traspaso_eventos FOR EACH ROW EXECUTE FUNCTION public.traspasos_guard();

-- ═══ 3. Contratos de E6 ajustados (definición de 147 + las líneas marcadas "148") ═══
CREATE OR REPLACE FUNCTION public.tienda_checklist(p_establecimiento_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_e         establecimientos%ROWTYPE;
  v_cuartos   INTEGER;
  v_cajas     INTEGER;
  v_cajeros   INTEGER;
  v_mal       INTEGER;
  v_clientes  INTEGER;
  v_colgadas  INTEGER;
  v_extras    INTEGER;
  v_seg       BOOLEAN;
BEGIN
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id;
  SELECT count(*) INTO v_cuartos FROM cuartos_frios WHERE establecimiento_id = v_e.id;
  SELECT count(*) INTO v_cajas FROM cajas WHERE establecimiento_id = v_e.id AND activa;
  SELECT count(*) INTO v_cajeros FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas' AND u.estatus = 'Activo';
  -- Permisos que no corresponden: persona inactiva o de un rol que no se asigna; vender desde el CEDIS
  -- sin ser cajero; traspasar siendo cajero; cualquiera de los dos fuera de una tienda de fábrica.
  SELECT count(*) INTO v_mal FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id
     AND (u.estatus <> 'Activo' OR u.rol NOT IN ('Ventas', 'Producción', 'Admin')
          OR (ue.vende_desde_cedis AND (u.rol <> 'Ventas' OR v_e.tipo <> 'tienda_fabrica'))
          OR (ue.traspasa_con_cedis AND (u.rol NOT IN ('Producción', 'Admin') OR v_e.tipo <> 'tienda_fabrica'))
          OR (ue.recibe_traspasos AND u.rol <> 'Ventas'));                                                    -- 148: recibir es del personal de la tienda
  SELECT count(*) INTO v_clientes FROM establecimiento_clientes ec JOIN clientes c ON c.id = ec.cliente_id
   WHERE ec.establecimiento_id = v_e.id AND c.estatus = 'Activo' AND c.fusionado_en IS NULL;
  -- Incompatible: un cajero con ventas centrales sin terminar se quedaría sin poder atenderlas.
  SELECT count(*) INTO v_colgadas FROM ordenes o
   WHERE o.establecimiento_id IS NULL AND o.estatus IN ('Creada', 'Asignada', 'En ruta')
     AND o.vendedor_id IN (SELECT ue.usuario_id FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                            WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas');
  SELECT count(*) INTO v_extras FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
   WHERE ue.establecimiento_id = v_e.id AND u.rol = 'Ventas' AND cardinality(COALESCE(u.accesos_extra, '{}'::text[])) > 0;
  v_seg := to_regprocedure('public.erp_usuario_de_tienda(bigint)') IS NOT NULL
       AND to_regprocedure('public.erp_tienda_asignada(bigint,boolean)') IS NOT NULL
       AND to_regprocedure('public.vender_en_tienda(uuid,bigint,jsonb,text,bigint,text,boolean)') IS NOT NULL
       AND to_regprocedure('public.cerrar_turno_caja(uuid,bigint,numeric,text,text)') IS NOT NULL
       AND pg_get_functiondef('public.erp_actor()'::regprocedure) LIKE '%Ventas Tienda%'
       AND pg_get_functiondef('public.erp_lector_negocio()'::regprocedure) LIKE '%Ventas Tienda%'
       AND pg_get_functiondef('public.erp_es_activo()'::regprocedure) LIKE '%Ventas Tienda%'
       AND (SELECT count(*) FROM pg_trigger WHERE tgname IN ('trg_cuartos_frios_actor', 'trg_ordenes_guard_turno', 'trg_ordenes_guard_establecimiento')
              AND NOT tgisinternal AND tgenabled = 'O') = 3
       AND (SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND policyname = 'tienda_read') >= 7
       AND (SELECT bool_and(c.relrowsecurity) FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace
              AND c.relname IN ('establecimientos', 'usuario_establecimientos', 'establecimiento_clientes', 'cajas', 'turnos_caja', 'ventas_tienda'));
  RETURN jsonb_build_array(
    jsonb_build_object('clave', 'interruptor', 'obligatorio', true, 'ok', tiendas_habilitadas(), 'texto', 'Tiendas propias habilitadas por el dueño'),
    jsonb_build_object('clave', 'tipo', 'obligatorio', true, 'ok', v_e.tipo IN ('tienda_fabrica', 'tienda'),            -- 148: también tiendas remotas
                       'texto', CASE v_e.tipo WHEN 'tienda' THEN 'Es una tienda (vende solo su inventario; se surte por traspaso)' ELSE 'Es una tienda de fábrica' END),
    jsonb_build_object('clave', 'cuarto', 'obligatorio', true, 'ok', v_cuartos > 0, 'texto', 'Tiene al menos un congelador propio', 'cantidad', v_cuartos),
    jsonb_build_object('clave', 'caja', 'obligatorio', true, 'ok', v_cajas > 0, 'texto', 'Tiene al menos una caja activa', 'cantidad', v_cajas),
    jsonb_build_object('clave', 'personal', 'obligatorio', true, 'ok', v_cajeros > 0, 'texto', 'Tiene al menos un cajero (rol Ventas, activo) asignado', 'cantidad', v_cajeros),
    jsonb_build_object('clave', 'permisos', 'obligatorio', true, 'ok', v_mal = 0, 'texto', 'Las personas asignadas y sus permisos de inventario son válidos', 'cantidad', v_mal),
    jsonb_build_object('clave', 'ventas_centrales', 'obligatorio', true, 'ok', v_colgadas = 0,
                       'texto', 'Ningún cajero tiene ventas centrales sin terminar (dejaría de poder atenderlas)', 'cantidad', v_colgadas),
    jsonb_build_object('clave', 'seguridad', 'obligatorio', true, 'ok', COALESCE(v_seg, false), 'texto', 'Permisos, guardas y lectura acotada de tiendas instalados'),
    jsonb_build_object('clave', 'clientes', 'obligatorio', false, 'ok', v_e.clientes_pos = 'todos' OR v_clientes > 0,
                       'texto', CASE WHEN v_e.clientes_pos = 'todos' THEN 'El POS puede elegir a cualquier cliente vigente'
                                     WHEN v_clientes > 0 THEN 'El POS puede elegir a ' || v_clientes || ' cliente(s) de su lista'
                                     ELSE 'Sin clientes elegibles: la tienda solo vende al público en general' END, 'cantidad', v_clientes),
    jsonb_build_object('clave', 'accesos_adicionales', 'obligatorio', false, 'ok', v_extras = 0,
                       'texto', CASE WHEN v_extras = 0 THEN 'Ningún cajero pierde accesos adicionales'
                                     ELSE v_extras || ' cajero(s) tienen accesos adicionales que dejan de valer en la tienda' END, 'cantidad', v_extras));
END $$;

CREATE OR REPLACE FUNCTION public.retirar_usuario_tienda(p_establecimiento_id BIGINT, p_usuario_id BIGINT, p_confirmar_ventas_central BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq TEXT := erp_actor_etiqueta();
  v_e   establecimientos%ROWTYPE;
  v_u   usuarios%ROWTYPE;
  v_queda_central BOOLEAN;
BEGIN
  PERFORM tienda_exigir_admin('retirar_usuario_tienda');
  v_e := tienda_cargar('retirar_usuario_tienda', p_establecimiento_id);
  SELECT * INTO v_u FROM usuarios WHERE id = p_usuario_id FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM usuario_establecimientos WHERE usuario_id = p_usuario_id AND establecimiento_id = v_e.id) THEN
    RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', p_usuario_id, 'retirado', false, 'sin_cambio', true);   -- reintento: ya no estaba
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.cajero_id = p_usuario_id AND t.establecimiento_id = v_e.id AND t.estado = 'abierto') THEN
    RAISE EXCEPTION 'retirar_usuario_tienda: esa persona tiene un turno de caja abierto en la tienda; ciérralo primero' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_ABIERTO')::text;
  END IF;
  -- 148: una tienda ACTIVA no se queda sin su último cajero por un retiro ordinario. Primero se asigna
  -- otro cajero o se desactiva la tienda (activar_tienda con su motivo): las dos cosas quedan registradas.
  IF v_e.activo AND v_u.rol = 'Ventas' AND v_u.estatus = 'Activo'
     AND NOT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                      WHERE ue.establecimiento_id = v_e.id AND ue.usuario_id <> p_usuario_id AND u.rol = 'Ventas' AND u.estatus = 'Activo') THEN
    RAISE EXCEPTION 'retirar_usuario_tienda: % es el último cajero de una tienda activa; asigna antes a otro cajero o desactiva la tienda', v_u.nombre
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ULTIMO_CAJERO')::text;
  END IF;
  -- Un cajero sin ninguna tienda vuelve a ser Ventas CENTRAL (lee y vende todo lo central): no pasa sin que alguien lo confirme.
  v_queda_central := v_u.rol = 'Ventas' AND v_u.estatus = 'Activo'
    AND NOT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN establecimientos e ON e.id = ue.establecimiento_id
                     WHERE ue.usuario_id = p_usuario_id AND ue.establecimiento_id <> v_e.id AND e.tipo <> 'cedis');
  IF v_queda_central AND NOT COALESCE(p_confirmar_ventas_central, false) THEN
    RAISE EXCEPTION 'retirar_usuario_tienda: al quitarle su única tienda, % volvería a ser Ventas central (vería y vendería lo central). Si ya no trabaja en la empresa, dalo de baja; si de verdad pasa a Ventas central, confírmalo.', v_u.nombre
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'QUEDARIA_VENTAS_CENTRAL')::text;
  END IF;
  DELETE FROM usuario_establecimientos WHERE usuario_id = p_usuario_id AND establecimiento_id = v_e.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Retiro de tienda', 'Tiendas', v_e.clave || ' — ' || COALESCE(v_u.nombre, p_usuario_id::text) || CASE WHEN v_queda_central THEN ' — queda como Ventas central (confirmado)' ELSE '' END);
  RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', p_usuario_id, 'retirado', true, 'queda_ventas_central', v_queda_central);
END $$;

-- guardar_establecimiento gana `p_tipo` (opcional): la firma cambia, así que la de 147 se retira.
DROP FUNCTION IF EXISTS public.guardar_establecimiento(BIGINT, TEXT, TEXT);
CREATE OR REPLACE FUNCTION public.guardar_establecimiento(p_id BIGINT, p_clave TEXT, p_nombre TEXT, p_tipo TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_clave  TEXT := upper(btrim(COALESCE(p_clave, '')));
  v_nombre TEXT := regexp_replace(btrim(COALESCE(p_nombre, '')), '\s+', ' ', 'g');
  v_etq    TEXT := erp_actor_etiqueta();
  v_tipo   TEXT := NULLIF(btrim(COALESCE(p_tipo, '')), '');     -- 148
  v_e      establecimientos%ROWTYPE;
BEGIN
  PERFORM tienda_exigir_admin('guardar_establecimiento');
  IF length(v_nombre) NOT BETWEEN 2 AND 80 THEN
    RAISE EXCEPTION 'guardar_establecimiento: escribe el nombre de la tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOMBRE_INVALIDO')::text;
  END IF;
  IF v_tipo IS NOT NULL AND v_tipo NOT IN ('tienda_fabrica', 'tienda') THEN                                  -- 148
    RAISE EXCEPTION 'guardar_establecimiento: el tipo es tienda_fabrica o tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIPO_INVALIDO')::text;
  END IF;
  IF p_id IS NULL THEN
    IF v_clave !~ '^[A-Z0-9][A-Z0-9-]{1,19}$' THEN
      RAISE EXCEPTION 'guardar_establecimiento: la clave lleva de 2 a 20 letras, números o guiones' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_INVALIDA')::text;
    END IF;
    BEGIN
      -- Nace INACTIVA. 148: tienda de fábrica (por omisión) o tienda remota. Solo activar_tienda la enciende.
      INSERT INTO establecimientos (clave, nombre, tipo, activo) VALUES (v_clave, v_nombre, COALESCE(v_tipo, 'tienda_fabrica'), false) RETURNING * INTO v_e;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'guardar_establecimiento: ya existe un establecimiento con la clave %', v_clave USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_REPETIDA')::text;
    END;
    INSERT INTO establecimiento_eventos (establecimiento_id, tipo, actor_id, actor, datos)
    VALUES (v_e.id, 'alta', erp_usuario_id(), v_etq, jsonb_build_object('clave', v_e.clave, 'nombre', v_e.nombre, 'tipo', v_e.tipo));
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Alta de tienda', 'Tiendas', v_e.clave || ' — ' || v_e.nombre || ' (inactiva)');
  ELSE
    v_e := tienda_cargar('guardar_establecimiento', p_id);
    IF v_clave <> '' AND v_clave <> v_e.clave THEN
      RAISE EXCEPTION 'guardar_establecimiento: la clave de una tienda no cambia' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLAVE_INVALIDA')::text;
    END IF;
    IF v_tipo IS NOT NULL AND v_tipo <> v_e.tipo THEN                                                         -- 148
      RAISE EXCEPTION 'guardar_establecimiento: el tipo de una tienda no cambia' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIPO_INVALIDO')::text;
    END IF;
    UPDATE establecimientos SET nombre = v_nombre WHERE id = v_e.id RETURNING * INTO v_e;
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Cambio de tienda', 'Tiendas', v_e.clave || ' — ' || v_e.nombre);
  END IF;
  RETURN jsonb_build_object('id', v_e.id, 'clave', v_e.clave, 'nombre', v_e.nombre, 'tipo', v_e.tipo, 'activo', v_e.activo, 'clientes_pos', v_e.clientes_pos);
END $$;

-- ═══ 4. Funciones internas de traspasos (sin EXECUTE por API) ═══
-- Idempotencia: candado por operación y, si ya existe, su resultado.
CREATE OR REPLACE FUNCTION public.traspaso_replay(p_operacion_id UUID, p_tipo TEXT, p_huella TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e traspaso_eventos%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  SELECT * INTO v_e FROM traspaso_eventos WHERE operacion_id = p_operacion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_e.tipo <> p_tipo OR v_e.huella <> p_huella THEN
    RAISE EXCEPTION 'traspaso: esa operación ya se usó con otros datos' USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'OPERACION_REPETIDA')::text;
  END IF;
  RETURN v_e.datos || jsonb_build_object('replay', true);
END $$;

-- El traspaso completo, como lo ve quien lo consulta.
CREATE OR REPLACE FUNCTION public.traspaso_json(p_traspaso_id BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'traspaso_id', t.id, 'folio', t.folio, 'estado', t.estado, 'incidencia', t.incidencia, 'incidencia_cerrada', t.incidencia_cerrada_at IS NOT NULL,
    'origen', jsonb_build_object('id', eo.id, 'nombre', eo.nombre, 'tipo', eo.tipo, 'cuarto_id', t.cuarto_origen),
    'destino', jsonb_build_object('id', ed.id, 'nombre', ed.nombre, 'tipo', ed.tipo, 'cuarto_id', t.cuarto_destino),
    'responsable', t.responsable, 'notas', t.notas, 'creado_por', t.creado_por_nombre, 'created_at', t.created_at,
    'despachado_at', t.despachado_at, 'despachado_por', t.despachado_por_nombre,
    'recibido_at', t.recibido_at, 'recibido_por', t.recibido_por_nombre, 'notas_recepcion', t.notas_recepcion,
    'cancelado_at', t.cancelado_at, 'cancelado_por', t.cancelado_por_nombre, 'motivo_cancelacion', t.motivo_cancelacion,
    'incidencia_resolucion', t.incidencia_resolucion, 'incidencia_cerrada_por', t.incidencia_cerrada_por,
    'lineas', (SELECT jsonb_agg(jsonb_build_object('sku', l.sku, 'nombre', p.nombre, 'cantidad', l.cantidad, 'despachada', l.cantidad_despachada,
                                                   'recibida', l.cantidad_recibida, 'danada', l.cantidad_danada, 'faltante', l.cantidad_faltante) ORDER BY l.sku)
                 FROM traspaso_lineas l LEFT JOIN productos p ON p.sku = l.sku WHERE l.traspaso_id = t.id))
    FROM traspasos t JOIN establecimientos eo ON eo.id = t.origen_establecimiento_id JOIN establecimientos ed ON ed.id = t.destino_establecimiento_id
   WHERE t.id = p_traspaso_id
$$;

-- ¿El actor puede registrar la llegada de producto a este establecimiento?
-- Administración (o una sesión de confianza); o el personal de ESA tienda con el permiso explícito. Al CEDIS, solo Administración.
CREATE OR REPLACE FUNCTION public.traspaso_puede_recibir(p_establecimiento_id BIGINT) RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF pos_es_admin() THEN RETURN TRUE; END IF;
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR p_establecimiento_id IS NULL OR p_establecimiento_id = 1 THEN RETURN FALSE; END IF;
  RETURN erp_tienda_asignada(p_establecimiento_id, false)
     AND EXISTS (SELECT 1 FROM usuario_establecimientos ue WHERE ue.usuario_id = erp_usuario_id() AND ue.establecimiento_id = p_establecimiento_id AND ue.recibe_traspasos);
END $$;

-- Cantidades de una recepción o de un retorno: una partida por cada producto del traspaso, con lo que
-- llegó bien y lo que llegó dañado. Lo que no llegó (faltante) lo calcula el servidor. Devuelve las líneas normalizadas.
CREATE OR REPLACE FUNCTION public.traspaso_leer_recepcion(p_fn TEXT, p_traspaso_id BIGINT, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_out JSONB;
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION '%: captura lo que llegó de cada producto', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RECEPCION_INCOMPLETA')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e
              WHERE jsonb_typeof(e.value) <> 'object' OR btrim(COALESCE(e.value ->> 'sku', '')) = ''
                 OR COALESCE(e.value ->> 'recibida', '') !~ '^[0-9]{1,6}$' OR COALESCE(e.value ->> 'danada', '0') !~ '^[0-9]{1,6}$') THEN
    RAISE EXCEPTION '%: cada producto lleva cuánto llegó bien y cuánto dañado (enteros, 0 o más)', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CANTIDAD_INVALIDA')::text;
  END IF;
  IF (SELECT count(*) <> count(DISTINCT btrim(e.value ->> 'sku')) FROM jsonb_array_elements(p_items) e)
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE NOT EXISTS (SELECT 1 FROM traspaso_lineas l WHERE l.traspaso_id = p_traspaso_id AND l.sku = btrim(e.value ->> 'sku')))
     OR EXISTS (SELECT 1 FROM traspaso_lineas l WHERE l.traspaso_id = p_traspaso_id AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE btrim(e.value ->> 'sku') = l.sku)) THEN
    RAISE EXCEPTION '%: hay que capturar cada producto del traspaso, una sola vez, y ninguno más', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RECEPCION_INCOMPLETA')::text;
  END IF;
  -- Nunca entra más de lo que salió: un sobrante no se "recibe" (se revisa con Administración).
  IF EXISTS (SELECT 1 FROM traspaso_lineas l JOIN jsonb_array_elements(p_items) e ON btrim(e.value ->> 'sku') = l.sku
              WHERE l.traspaso_id = p_traspaso_id AND (e.value ->> 'recibida')::INTEGER + COALESCE(e.value ->> 'danada', '0')::INTEGER > l.cantidad_despachada) THEN
    RAISE EXCEPTION '%: no puede llegar más producto del que se despachó', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RECEPCION_EXCEDE')::text;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('sku', l.sku, 'recibida', (e.value ->> 'recibida')::INTEGER, 'danada', COALESCE(e.value ->> 'danada', '0')::INTEGER,
                                      'faltante', l.cantidad_despachada - (e.value ->> 'recibida')::INTEGER - COALESCE(e.value ->> 'danada', '0')::INTEGER) ORDER BY l.sku)
    INTO v_out
    FROM traspaso_lineas l JOIN jsonb_array_elements(p_items) e ON btrim(e.value ->> 'sku') = l.sku WHERE l.traspaso_id = p_traspaso_id;
  RETURN v_out;
END $$;
REVOKE ALL ON FUNCTION public.traspaso_replay(UUID, TEXT, TEXT), public.traspaso_json(BIGINT), public.traspaso_puede_recibir(BIGINT), public.traspaso_leer_recepcion(TEXT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

-- ═══ 5. definir_recepcion_tienda (Admin) ═══
CREATE OR REPLACE FUNCTION public.definir_recepcion_tienda(p_establecimiento_id BIGINT, p_usuario_id BIGINT, p_recibe BOOLEAN) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq TEXT := erp_actor_etiqueta();
  v_e   establecimientos%ROWTYPE;
  v_u   usuarios%ROWTYPE;
BEGIN
  PERFORM tienda_exigir_admin('definir_recepcion_tienda');
  v_e := tienda_cargar('definir_recepcion_tienda', p_establecimiento_id);
  IF p_recibe IS NULL THEN
    RAISE EXCEPTION 'definir_recepcion_tienda: indica sí o no' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PERMISOS_EXPLICITOS')::text;
  END IF;
  SELECT u.* INTO v_u FROM usuarios u JOIN usuario_establecimientos ue ON ue.usuario_id = u.id WHERE u.id = p_usuario_id AND ue.establecimiento_id = v_e.id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'definir_recepcion_tienda: esa persona no está asignada a la tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'USUARIO_NO_VALIDO')::text;
  END IF;
  IF p_recibe AND (v_u.rol <> 'Ventas' OR v_u.estatus <> 'Activo') THEN
    RAISE EXCEPTION 'definir_recepcion_tienda: recibir traspasos es del personal de la tienda (rol Ventas, activo)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PERMISO_NO_CORRESPONDE')::text;
  END IF;
  UPDATE usuario_establecimientos SET recibe_traspasos = p_recibe WHERE usuario_id = p_usuario_id AND establecimiento_id = v_e.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Permiso de recepción de tienda', 'Tiendas', v_e.clave || ' — ' || v_u.nombre || ' — recibe traspasos: ' || CASE WHEN p_recibe THEN 'sí' ELSE 'no' END);
  RETURN jsonb_build_object('establecimiento_id', v_e.id, 'usuario_id', p_usuario_id, 'recibe_traspasos', p_recibe);
END $$;

-- ═══ 6. crear_traspaso (Admin) ═══
CREATE OR REPLACE FUNCTION public.crear_traspaso(p_operacion_id UUID, p_origen_establecimiento_id BIGINT, p_destino_establecimiento_id BIGINT,
                                                 p_cuarto_origen TEXT, p_cuarto_destino TEXT, p_items JSONB, p_responsable TEXT, p_notas TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_resp   TEXT := regexp_replace(btrim(COALESCE(p_responsable, '')), '\s+', ' ', 'g');
  v_notas  TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_co     TEXT := btrim(COALESCE(p_cuarto_origen, ''));
  v_cd     TEXT := btrim(COALESCE(p_cuarto_destino, ''));
  v_items  JSONB;
  v_huella TEXT;
  v_prev   JSONB;
  v_tienda establecimientos%ROWTYPE;
  v_id     BIGINT;
  v_seq    TEXT;
  v_res    JSONB;
BEGIN
  PERFORM tienda_exigir_admin('crear_traspaso');
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'crear_traspaso: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF length(v_resp) < 3 THEN
    RAISE EXCEPTION 'crear_traspaso: escribe quién transporta el producto' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RESPONSABLE_REQUERIDO')::text;
  END IF;
  -- Productos: {sku, cantidad}, enteros mayores a 0, sin repetir, solo producto terminado.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 100
     OR EXISTS (SELECT 1 FROM jsonb_array_elements(p_items) e WHERE jsonb_typeof(e.value) <> 'object' OR btrim(COALESCE(e.value ->> 'sku', '')) = ''
                   OR COALESCE(e.value ->> 'cantidad', '') !~ '^[0-9]{1,6}$' OR (e.value ->> 'cantidad')::INTEGER <= 0)
     OR (SELECT count(*) <> count(DISTINCT btrim(e.value ->> 'sku')) FROM jsonb_array_elements(p_items) e) THEN
    RAISE EXCEPTION 'crear_traspaso: cada producto lleva sku y una cantidad entera mayor a 0, sin repetir' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CANTIDAD_INVALIDA')::text;
  END IF;
  SELECT jsonb_agg(jsonb_build_object('sku', btrim(e.value ->> 'sku'), 'cantidad', (e.value ->> 'cantidad')::INTEGER) ORDER BY btrim(e.value ->> 'sku')) INTO v_items FROM jsonb_array_elements(p_items) e;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_items) e WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.sku = e.value ->> 'sku' AND p.tipo = 'Producto Terminado')) THEN
    RAISE EXCEPTION 'crear_traspaso: solo se traspasa producto terminado del catálogo' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PRODUCTO_NO_VENDIBLE')::text;
  END IF;
  v_huella := jsonb_build_object('origen', p_origen_establecimiento_id, 'destino', p_destino_establecimiento_id, 'co', v_co, 'cd', v_cd, 'items', v_items, 'responsable', v_resp, 'notas', v_notas)::text;
  v_prev := traspaso_replay(p_operacion_id, 'creacion', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  -- Siempre CEDIS ↔ una tienda ACTIVA. Nunca tienda ↔ tienda ni dentro del mismo establecimiento.
  IF NOT ((p_origen_establecimiento_id = 1) <> (p_destino_establecimiento_id = 1)) OR p_origen_establecimiento_id IS NULL OR p_destino_establecimiento_id IS NULL THEN
    RAISE EXCEPTION 'crear_traspaso: un traspaso va del CEDIS a una tienda o de una tienda al CEDIS' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_VALIDO')::text;
  END IF;
  SELECT * INTO v_tienda FROM establecimientos WHERE id = CASE WHEN p_origen_establecimiento_id = 1 THEN p_destino_establecimiento_id ELSE p_origen_establecimiento_id END;
  IF NOT FOUND OR v_tienda.tipo = 'cedis' OR NOT v_tienda.activo THEN
    RAISE EXCEPTION 'crear_traspaso: la tienda no existe o no está activa' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuartos_frios c WHERE c.id = v_co AND c.establecimiento_id = p_origen_establecimiento_id)
     OR NOT EXISTS (SELECT 1 FROM cuartos_frios c WHERE c.id = v_cd AND c.establecimiento_id = p_destino_establecimiento_id) THEN
    RAISE EXCEPTION 'crear_traspaso: el cuarto de origen debe ser del establecimiento de origen y el de destino, del de destino' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_NO_VALIDO')::text;
  END IF;

  v_seq := pg_catalog.nextval('folio_traspaso_seq'::regclass)::TEXT;
  INSERT INTO traspasos (folio, origen_establecimiento_id, destino_establecimiento_id, cuarto_origen, cuarto_destino, responsable, notas, creado_por, creado_por_nombre)
  VALUES ('TR-' || lpad(v_seq, greatest(4, length(v_seq)), '0'), p_origen_establecimiento_id, p_destino_establecimiento_id, v_co, v_cd, v_resp, v_notas, erp_usuario_id(), v_etq)
  RETURNING id INTO v_id;
  INSERT INTO traspaso_lineas (traspaso_id, sku, cantidad)
  SELECT v_id, e.value ->> 'sku', (e.value ->> 'cantidad')::INTEGER FROM jsonb_array_elements(v_items) e;
  v_res := traspaso_json(v_id) || jsonb_build_object('replay', false);
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_id, 'creacion', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Traspaso creado', 'Tiendas', (v_res ->> 'folio') || ' — ' || (v_res -> 'origen' ->> 'nombre') || ' → ' || (v_res -> 'destino' ->> 'nombre') || ' — transporta ' || v_resp);
  RETURN v_res;
END $$;

-- ═══ 7. despachar_traspaso (Admin) ═══
CREATE OR REPLACE FUNCTION public.despachar_traspaso(p_operacion_id UUID, p_traspaso_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_t      traspasos%ROWTYPE;
  v_prev   JSONB;
  v_huella TEXT;
  v_l      RECORD;
  v_disp   INTEGER;
  v_res    JSONB;
BEGIN
  PERFORM tienda_exigir_admin('despachar_traspaso');
  IF p_operacion_id IS NULL OR p_traspaso_id IS NULL THEN
    RAISE EXCEPTION 'despachar_traspaso: operación y traspaso son obligatorios' USING ERRCODE = '22023';
  END IF;
  v_huella := jsonb_build_object('traspaso', p_traspaso_id)::text;
  v_prev := traspaso_replay(p_operacion_id, 'despacho', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'despachar_traspaso: el traspaso no existe' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_VALIDO')::text;
  END IF;
  IF v_t.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'despachar_traspaso: el traspaso % ya está % (solo se despacha uno pendiente)', v_t.folio, v_t.estado USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_YA_DESPACHADO')::text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM establecimientos e WHERE e.id IN (v_t.origen_establecimiento_id, v_t.destino_establecimiento_id) AND e.tipo <> 'cedis' AND e.activo) THEN
    RAISE EXCEPTION 'despachar_traspaso: la tienda ya no está activa' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
  -- Los cuartos siguen siendo de donde dice el traspaso (uno vacío pudo cambiar de establecimiento).
  IF NOT EXISTS (SELECT 1 FROM cuartos_frios c WHERE c.id = v_t.cuarto_origen AND c.establecimiento_id = v_t.origen_establecimiento_id)
     OR NOT EXISTS (SELECT 1 FROM cuartos_frios c WHERE c.id = v_t.cuarto_destino AND c.establecimiento_id = v_t.destino_establecimiento_id) THEN
    RAISE EXCEPTION 'despachar_traspaso: los cuartos del traspaso ya no corresponden a su establecimiento' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_NO_VALIDO')::text;
  END IF;

  -- Cuarto de origen bloqueado: dos traspasos (o un traspaso y una venta) por el mismo producto van uno tras otro.
  PERFORM 1 FROM cuartos_frios WHERE id = v_t.cuarto_origen FOR UPDATE;
  FOR v_l IN SELECT sku, cantidad FROM traspaso_lineas WHERE traspaso_id = v_t.id ORDER BY sku LOOP
    SELECT GREATEST(COALESCE(NULLIF(c.stock ->> v_l.sku, '')::INTEGER, 0), 0) INTO v_disp FROM cuartos_frios c WHERE c.id = v_t.cuarto_origen;
    IF v_disp < v_l.cantidad THEN
      RAISE EXCEPTION 'despachar_traspaso: no hay suficiente % en % (hay %, se piden %)', v_l.sku, v_t.cuarto_origen, v_disp, v_l.cantidad
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'SIN_EXISTENCIA', 'sku', v_l.sku, 'cuarto_id', v_t.cuarto_origen, 'disponible', v_disp, 'pedido', v_l.cantidad)::text;
    END IF;
  END LOOP;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'traspaso', 'traspaso_transito|despacho|' || v_t.folio, erp_usuario_id(), v_etq, '{}'::jsonb);
  -- Sale del origen. El destino NO sube: el producto va en camino hasta que alguien lo reciba.
  FOR v_l IN SELECT sku, cantidad FROM traspaso_lineas WHERE traspaso_id = v_t.id ORDER BY sku LOOP
    PERFORM stock_mov_cuarto(v_t.cuarto_origen, v_l.sku, -v_l.cantidad, 'Traspaso salida', v_t.cuarto_origen || ' → ' || v_t.cuarto_destino || ' (en tránsito)', v_t.cuarto_destino,
                             'traspaso/' || v_t.folio, v_etq, NULL, p_operacion_id);
  END LOOP;
  UPDATE traspaso_lineas SET cantidad_despachada = cantidad WHERE traspaso_id = v_t.id;
  UPDATE traspasos SET estado = 'en_transito', despachado_at = now(), despachado_por_nombre = v_etq WHERE id = v_t.id;

  v_res := traspaso_json(v_t.id) || jsonb_build_object('replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_t.id, 'despacho', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Traspaso despachado', 'Tiendas', v_t.folio || ' — salió de ' || v_t.cuarto_origen || ' — transporta ' || v_t.responsable);
  RETURN v_res;
END $$;

-- ═══ 8. recibir_traspaso (Admin, o personal de la tienda destino con permiso) ═══
CREATE OR REPLACE FUNCTION public.recibir_traspaso(p_operacion_id UUID, p_traspaso_id BIGINT, p_items JSONB, p_notas TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_notas  TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_t      traspasos%ROWTYPE;
  v_prev   JSONB;
  v_huella TEXT;
  v_lin    JSONB;
  v_l      RECORD;
  v_inc    BOOLEAN;
  v_res    JSONB;
BEGIN
  -- Quién: se decide con el destino del traspaso. Uno inexistente o ajeno responde lo mismo.
  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id;
  IF v_t.id IS NULL OR NOT traspaso_puede_recibir(v_t.destino_establecimiento_id) THEN
    RAISE EXCEPTION 'recibir_traspaso: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'recibir_traspaso: las tiendas propias no están activadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'recibir_traspaso: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  v_huella := jsonb_build_object('traspaso', p_traspaso_id, 'items', p_items, 'notas', v_notas)::text;
  v_prev := traspaso_replay(p_operacion_id, 'recepcion', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF v_t.estado <> 'en_transito' THEN
    -- Aquí cae la SEGUNDA recepción (otra persona, otro operacion_id): el traspaso ya no está en tránsito.
    RAISE EXCEPTION 'recibir_traspaso: el traspaso % está %; solo se recibe uno en tránsito', v_t.folio, v_t.estado USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_EN_TRANSITO')::text;
  END IF;
  v_lin := traspaso_leer_recepcion('recibir_traspaso', v_t.id, p_items);
  v_inc := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lin) e WHERE (e.value ->> 'danada')::INTEGER > 0 OR (e.value ->> 'faltante')::INTEGER > 0);
  IF v_inc AND (v_notas IS NULL OR length(v_notas) < 5) THEN
    RAISE EXCEPTION 'recibir_traspaso: llegó producto dañado o faltó producto; escribe qué pasó' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOTA_INCIDENCIA_REQUERIDA')::text;
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'traspaso', 'traspaso_transito|recepcion|' || v_t.folio, erp_usuario_id(), v_etq, '{}'::jsonb);
  PERFORM 1 FROM cuartos_frios WHERE id = v_t.cuarto_destino FOR UPDATE;
  -- Solo lo que llegó BIEN entra al cuarto. Lo dañado y lo faltante quedan en el traspaso como incidencia.
  FOR v_l IN SELECT e.value ->> 'sku' AS sku, (e.value ->> 'recibida')::INTEGER AS recibida, (e.value ->> 'danada')::INTEGER AS danada, (e.value ->> 'faltante')::INTEGER AS faltante
               FROM jsonb_array_elements(v_lin) e ORDER BY 1 LOOP
    IF v_l.recibida > 0 THEN
      PERFORM stock_mov_cuarto(v_t.cuarto_destino, v_l.sku, v_l.recibida, 'Traspaso entrada', v_t.cuarto_origen || ' → ' || v_t.cuarto_destino, v_t.cuarto_destino,
                               'traspaso/' || v_t.folio, v_etq, NULL, p_operacion_id);
    END IF;
    UPDATE traspaso_lineas SET cantidad_recibida = v_l.recibida, cantidad_danada = v_l.danada, cantidad_faltante = v_l.faltante WHERE traspaso_id = v_t.id AND sku = v_l.sku;
  END LOOP;
  UPDATE traspasos SET estado = 'recibido', incidencia = v_inc, recibido_at = now(), recibido_por = erp_usuario_id(), recibido_por_nombre = v_etq, notas_recepcion = v_notas WHERE id = v_t.id;

  v_res := traspaso_json(v_t.id) || jsonb_build_object('replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_t.id, 'recepcion', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, CASE WHEN v_inc THEN 'Traspaso recibido con incidencia' ELSE 'Traspaso recibido' END, 'Tiendas', v_t.folio || ' — entró a ' || v_t.cuarto_destino || COALESCE(' — ' || v_notas, ''));
  RETURN v_res;
END $$;

-- ═══ 9. cancelar_traspaso (Admin) — solo antes de despachar ═══
CREATE OR REPLACE FUNCTION public.cancelar_traspaso(p_operacion_id UUID, p_traspaso_id BIGINT, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_t      traspasos%ROWTYPE;
  v_prev   JSONB;
  v_huella TEXT;
  v_res    JSONB;
BEGIN
  PERFORM tienda_exigir_admin('cancelar_traspaso');
  IF p_operacion_id IS NULL OR p_traspaso_id IS NULL THEN
    RAISE EXCEPTION 'cancelar_traspaso: operación y traspaso son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'cancelar_traspaso: escribe el motivo' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
  END IF;
  v_huella := jsonb_build_object('traspaso', p_traspaso_id, 'motivo', v_motivo)::text;
  v_prev := traspaso_replay(p_operacion_id, 'cancelacion', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cancelar_traspaso: el traspaso no existe' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_VALIDO')::text;
  END IF;
  IF v_t.estado = 'en_transito' THEN
    -- El producto ya salió del cuarto: cancelarlo lo haría desaparecer. Si regresó, eso se registra como retorno.
    RAISE EXCEPTION 'cancelar_traspaso: el traspaso % ya se despachó; el producto está en camino. Recíbelo en la tienda o registra su retorno al origen', v_t.folio
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_EN_TRANSITO')::text;
  END IF;
  IF v_t.estado <> 'pendiente' THEN
    RAISE EXCEPTION 'cancelar_traspaso: el traspaso % ya está %', v_t.folio, v_t.estado USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_CERRADO')::text;
  END IF;
  UPDATE traspasos SET estado = 'cancelado', cancelado_at = now(), cancelado_por_nombre = v_etq, motivo_cancelacion = v_motivo WHERE id = v_t.id;
  v_res := traspaso_json(v_t.id) || jsonb_build_object('replay', false);
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_t.id, 'cancelacion', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Traspaso cancelado', 'Tiendas', v_t.folio || ' — ' || v_motivo);
  RETURN v_res;
END $$;

-- ═══ 10. retornar_traspaso (Admin) — el producto en tránsito volvió al origen ═══
CREATE OR REPLACE FUNCTION public.retornar_traspaso(p_operacion_id UUID, p_traspaso_id BIGINT, p_items JSONB, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_t      traspasos%ROWTYPE;
  v_prev   JSONB;
  v_huella TEXT;
  v_lin    JSONB;
  v_l      RECORD;
  v_inc    BOOLEAN;
  v_res    JSONB;
BEGIN
  PERFORM tienda_exigir_admin('retornar_traspaso');
  IF p_operacion_id IS NULL OR p_traspaso_id IS NULL THEN
    RAISE EXCEPTION 'retornar_traspaso: operación y traspaso son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'retornar_traspaso: escribe por qué regresó el producto' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
  END IF;
  v_huella := jsonb_build_object('traspaso', p_traspaso_id, 'items', p_items, 'motivo', v_motivo)::text;
  v_prev := traspaso_replay(p_operacion_id, 'retorno', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF NOT FOUND OR v_t.estado <> 'en_transito' THEN
    RAISE EXCEPTION 'retornar_traspaso: solo regresa al origen un traspaso que está en tránsito' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TRASPASO_NO_EN_TRANSITO')::text;
  END IF;
  v_lin := traspaso_leer_recepcion('retornar_traspaso', v_t.id, p_items);
  v_inc := EXISTS (SELECT 1 FROM jsonb_array_elements(v_lin) e WHERE (e.value ->> 'danada')::INTEGER > 0 OR (e.value ->> 'faltante')::INTEGER > 0);

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'traspaso', 'traspaso_transito|retorno|' || v_t.folio, erp_usuario_id(), v_etq, '{}'::jsonb);
  PERFORM 1 FROM cuartos_frios WHERE id = v_t.cuarto_origen FOR UPDATE;
  -- Recepción física en el cuarto de ORIGEN: vuelve solo lo que regresó en buen estado.
  FOR v_l IN SELECT e.value ->> 'sku' AS sku, (e.value ->> 'recibida')::INTEGER AS recibida, (e.value ->> 'danada')::INTEGER AS danada, (e.value ->> 'faltante')::INTEGER AS faltante
               FROM jsonb_array_elements(v_lin) e ORDER BY 1 LOOP
    IF v_l.recibida > 0 THEN
      PERFORM stock_mov_cuarto(v_t.cuarto_origen, v_l.sku, v_l.recibida, 'Traspaso entrada', 'Retorno de ' || v_t.folio, v_t.cuarto_origen, 'traspaso/' || v_t.folio, v_etq, NULL, p_operacion_id);
    END IF;
    UPDATE traspaso_lineas SET cantidad_recibida = v_l.recibida, cantidad_danada = v_l.danada, cantidad_faltante = v_l.faltante WHERE traspaso_id = v_t.id AND sku = v_l.sku;
  END LOOP;
  UPDATE traspasos SET estado = 'retornado', incidencia = v_inc, recibido_at = now(), recibido_por = erp_usuario_id(), recibido_por_nombre = v_etq, notas_recepcion = v_motivo WHERE id = v_t.id;

  v_res := traspaso_json(v_t.id) || jsonb_build_object('replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_t.id, 'retorno', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Traspaso retornado al origen', 'Tiendas', v_t.folio || ' — volvió a ' || v_t.cuarto_origen || ' — ' || v_motivo);
  RETURN v_res;
END $$;

-- ═══ 11. cerrar_incidencia_traspaso (Admin) ═══
CREATE OR REPLACE FUNCTION public.cerrar_incidencia_traspaso(p_operacion_id UUID, p_traspaso_id BIGINT, p_resolucion TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq   TEXT := erp_actor_etiqueta();
  v_txt   TEXT := NULLIF(btrim(COALESCE(p_resolucion, '')), '');
  v_t     traspasos%ROWTYPE;
  v_prev  JSONB;
  v_huella TEXT;
  v_res   JSONB;
BEGIN
  PERFORM tienda_exigir_admin('cerrar_incidencia_traspaso');
  IF p_operacion_id IS NULL OR p_traspaso_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_incidencia_traspaso: operación y traspaso son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_txt IS NULL OR length(v_txt) < 5 THEN
    RAISE EXCEPTION 'cerrar_incidencia_traspaso: escribe cómo se resolvió' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
  END IF;
  v_huella := jsonb_build_object('traspaso', p_traspaso_id, 'resolucion', v_txt)::text;
  v_prev := traspaso_replay(p_operacion_id, 'cierre_incidencia', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;
  SELECT * INTO v_t FROM traspasos WHERE id = p_traspaso_id FOR UPDATE;
  IF NOT FOUND OR NOT v_t.incidencia OR v_t.incidencia_cerrada_at IS NOT NULL THEN
    RAISE EXCEPTION 'cerrar_incidencia_traspaso: ese traspaso no tiene una incidencia abierta' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'SIN_INCIDENCIA')::text;
  END IF;
  -- Solo deja constancia. No mueve inventario: si hay que ajustar algo, se hace con los contratos de inventario.
  UPDATE traspasos SET incidencia_cerrada_at = now(), incidencia_cerrada_por = v_etq, incidencia_resolucion = v_txt WHERE id = v_t.id;
  v_res := traspaso_json(v_t.id) || jsonb_build_object('replay', false);
  INSERT INTO traspaso_eventos (traspaso_id, tipo, operacion_id, huella, actor_id, actor, datos) VALUES (v_t.id, 'cierre_incidencia', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Incidencia de traspaso cerrada', 'Tiendas', v_t.folio || ' — ' || v_txt);
  RETURN v_res;
END $$;

-- ═══ 12. traspasos_consulta (lectura) ═══
-- Administración: todos (o los de un establecimiento). Personal de tienda: solo los de SUS tiendas.
-- p_estado: pendiente | en_transito | recibido | retornado | cancelado | incidencias | NULL (todos).
CREATE OR REPLACE FUNCTION public.traspasos_consulta(p_establecimiento_id BIGINT DEFAULT NULL, p_estado TEXT DEFAULT NULL, p_limite INTEGER DEFAULT 100) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_admin BOOLEAN := pos_es_admin();
  v_rol   TEXT := erp_rol_activo();
  v_est   TEXT := NULLIF(btrim(COALESCE(p_estado, '')), '');
  v_lim   INTEGER := LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500);
BEGIN
  IF NOT v_admin AND COALESCE(v_rol, '') <> 'Ventas Tienda' THEN
    RAISE EXCEPTION 'traspasos_consulta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_est IS NOT NULL AND v_est NOT IN ('pendiente', 'en_transito', 'recibido', 'retornado', 'cancelado', 'incidencias') THEN
    RAISE EXCEPTION 'traspasos_consulta: estado inválido' USING ERRCODE = '22023';
  END IF;
  RETURN (
    WITH visibles AS (
      SELECT t.* FROM traspasos t
       WHERE (v_admin OR erp_tienda_asignada(t.destino_establecimiento_id, false) OR erp_tienda_asignada(t.origen_establecimiento_id, false))
         AND (p_establecimiento_id IS NULL OR p_establecimiento_id IN (t.origen_establecimiento_id, t.destino_establecimiento_id))
    )
    SELECT jsonb_build_object(
      'puede_recibir', COALESCE(traspaso_puede_recibir(p_establecimiento_id), false),
      'resumen', jsonb_build_object(
        'pendientes', (SELECT count(*) FROM visibles WHERE estado = 'pendiente'),
        'en_transito', (SELECT count(*) FROM visibles WHERE estado = 'en_transito'),
        'recibidos', (SELECT count(*) FROM visibles WHERE estado = 'recibido'),
        'retornados', (SELECT count(*) FROM visibles WHERE estado = 'retornado'),
        'cancelados', (SELECT count(*) FROM visibles WHERE estado = 'cancelado'),
        'incidencias_abiertas', (SELECT count(*) FROM visibles WHERE incidencia AND incidencia_cerrada_at IS NULL)),
      -- Producto que salió y todavía no llega a ningún cuarto.
      'en_camino', COALESCE((SELECT jsonb_object_agg(x.sku, x.q) FROM (SELECT l.sku, sum(l.cantidad_despachada) AS q FROM visibles v JOIN traspaso_lineas l ON l.traspaso_id = v.id
                                                                         WHERE v.estado = 'en_transito' GROUP BY l.sku) x), '{}'::jsonb),
      'traspasos', COALESCE((SELECT jsonb_agg(traspaso_json(f.id) ORDER BY f.id DESC)
                               FROM (SELECT v.id FROM visibles v
                                      WHERE v_est IS NULL OR (v_est = 'incidencias' AND v.incidencia) OR v.estado = v_est
                                      ORDER BY v.id DESC LIMIT v_lim) f), '[]'::jsonb),
      -- Solo Administración: quién puede recibir en la tienda consultada y su kardex de traspasos.
      'receptores', CASE WHEN v_admin AND p_establecimiento_id IS NOT NULL THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('usuario_id', u.id, 'nombre', u.nombre, 'rol', u.rol, 'recibe_traspasos', ue.recibe_traspasos) ORDER BY u.nombre, u.id)
            FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id WHERE ue.establecimiento_id = p_establecimiento_id), '[]'::jsonb) END,
      'movimientos', CASE WHEN v_admin AND p_establecimiento_id IS NOT NULL THEN COALESCE((
          SELECT jsonb_agg(jsonb_build_object('fecha', m.fecha, 'tipo', m.tipo, 'sku', m.producto, 'cantidad', m.cantidad, 'cuarto_id', m.cuarto_id, 'referencia', m.referencia, 'usuario', m.usuario) ORDER BY m.id DESC)
            FROM (SELECT i.* FROM inventario_mov i JOIN cuartos_frios c ON c.id = i.cuarto_id
                   WHERE c.establecimiento_id = p_establecimiento_id AND i.referencia LIKE 'traspaso/%' ORDER BY i.id DESC LIMIT 200) m), '[]'::jsonb) END)
  );
END $$;

REVOKE ALL ON FUNCTION public.guardar_establecimiento(BIGINT, TEXT, TEXT, TEXT), public.definir_recepcion_tienda(BIGINT, BIGINT, BOOLEAN),
  public.crear_traspaso(UUID, BIGINT, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT), public.despachar_traspaso(UUID, BIGINT), public.recibir_traspaso(UUID, BIGINT, JSONB, TEXT),
  public.cancelar_traspaso(UUID, BIGINT, TEXT), public.retornar_traspaso(UUID, BIGINT, JSONB, TEXT), public.cerrar_incidencia_traspaso(UUID, BIGINT, TEXT),
  public.traspasos_consulta(BIGINT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_establecimiento(BIGINT, TEXT, TEXT, TEXT), public.definir_recepcion_tienda(BIGINT, BIGINT, BOOLEAN),
  public.crear_traspaso(UUID, BIGINT, BIGINT, TEXT, TEXT, JSONB, TEXT, TEXT), public.despachar_traspaso(UUID, BIGINT), public.recibir_traspaso(UUID, BIGINT, JSONB, TEXT),
  public.cancelar_traspaso(UUID, BIGINT, TEXT), public.retornar_traspaso(UUID, BIGINT, JSONB, TEXT), public.cerrar_incidencia_traspaso(UUID, BIGINT, TEXT),
  public.traspasos_consulta(BIGINT, TEXT, INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
