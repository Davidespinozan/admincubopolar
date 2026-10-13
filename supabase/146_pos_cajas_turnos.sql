-- 146_pos_cajas_turnos.sql — Tiendas propias, E4: POS transaccional, cajas y turnos.
-- NO activa nada: con el interruptor de 143 apagado no existe ninguna tienda, así que no
-- puede existir una caja, un turno ni una venta de tienda. Solo base de datos; la pantalla
-- es E5.
--
-- Diseño cerrado (D-S3 a D-S10). Reglas del MVP: pago inmediato (nunca crédito ni CxC),
-- una forma de pago por venta, sin descuentos, precio del servidor, varias cajas físicas
-- por tienda, un turno abierto por caja y un turno abierto por cajero; solo
-- Administración crea cajas, reabre turnos y corrige ventas.
--
-- ESTRUCTURA
--   cajas                      caja física de un establecimiento que no es el CEDIS.
--   turnos_caja                turno de un cajero en una caja: fondo, cierre, esperado,
--                              contado, diferencia, totales por forma de pago.
--   turnos_caja_eventos        apertura, cierre y reapertura (inmutable; lleva el
--                              operacion_id de cada una = idempotencia y auditoría).
--   ventas_tienda              una fila por venta del POS: operacion_id (idempotencia),
--                              orden, turno, caja, cajero y de qué cuarto salió cada cosa.
--   correcciones_venta_tienda  corrección administrativa de una venta: devolución, monto,
--                              medio y ESTADO del reembolso (registrado ≠ ejecutado).
--   ordenes.turno_id           opcional (las órdenes históricas y centrales quedan sin
--                              turno). Por API no se escribe; una venta solo nace en un
--                              turno ABIERTO de SU establecimiento y ya no cambia de turno.
--
-- CONTRATOS
--   guardar_caja               Admin: alta, nombre y activar/desactivar una caja.
--   abrir_turno_caja           el cajero (Ventas Tienda asignado) abre su turno.
--   vender_en_tienda           UNA transacción: valida actor, turno, tienda activada,
--                              cliente y origen del inventario; precio del servidor; crea
--                              la orden y sus líneas; y entrega y cobra con
--                              completar_venta_directa (modo contado), que NO se modifica:
--                              misma salida de cuarto, mismo kardex, mismo pago, mismo
--                              ingreso. Si algo falla no queda orden, pago ni movimiento.
--   cerrar_turno_caja          bloquea el turno (espera a la venta en curso), calcula el
--                              efectivo esperado desde los pagos reales y guarda lo
--                              contado, la diferencia y su motivo. No toca ningún pago.
--   reabrir_turno_caja         Admin, con motivo; no puede dejar dos turnos abiertos en
--                              la caja ni para el cajero.
--   corregir_venta_tienda      Admin: devolución con registrar_devolucion (que NO se
--                              modifica) + de dónde sale el dinero y si YA se entregó.
--   confirmar_reembolso_tienda Admin: marca como ejecutado un reembolso que estaba solo
--                              registrado (el electrónico exige la referencia del banco).
--   mi_turno_caja              lectura: turno abierto del cajero y cajas de sus tiendas.
--
-- ORDEN DE CANDADOS (igual en todos los contratos, para no cruzarse):
--   turno → orden → cliente → empaque (si hay picada/triturada) → cuartos por id.
--
-- Contratos históricos: NINGUNO cambia. Esta migración exige que los que reutiliza sean
-- los auditados (md5 = producción) y aborta sin aplicar nada si no lo son.
--
-- Idempotente. Reversión (sin cajas ni turnos): DROP de los 8 contratos y de las
-- funciones internas (pos_*, turno_caja_totales, guardas), del disparador
-- trg_ordenes_guard_turno, de la columna ordenes.turno_id y de las 5 tablas.

-- ═══ 0. Precondiciones ═══
DO $$
DECLARE r RECORD; v TEXT;
BEGIN
  IF to_regprocedure('public.erp_tienda_asignada(bigint,boolean)') IS NULL OR to_regprocedure('public.pos_cliente_disponible(bigint,text,bigint)') IS NULL THEN
    RAISE EXCEPTION '146: falta la migración 145 (seguridad por establecimiento). No se aplicó nada.';
  END IF;
  FOR r IN SELECT * FROM (VALUES
      ('public.completar_venta_directa(uuid,bigint,text,text,jsonb,text,text)', '2107586c1f5b8b59d7a4ff039a1fd0d6'),
      ('public.registrar_pago_orden(bigint,text,text,bigint)',                  'add148ab82529ea5f3b2c4d2fcdb10ca'),
      ('public.registrar_devolucion(uuid,bigint,jsonb,text,text,text,text,text)', 'ba3f4a250794e3b49f54cb167f4a45af'),
      ('public.lineas_canonicas(bigint,bigint,jsonb)',                          '1a84a57e4334218972341dcc76e00c28'),
      ('public.precio_canonico(bigint,bigint,text)',                            'c549682fbc47f9a3bb3be82e62a3b80f'),
      ('public.barra_surtir_cuarto(uuid,text,jsonb)',                           '49d3a848ffea9266bf62dd808541f193')) t(firma, md5) LOOP
    v := md5(pg_get_functiondef(r.firma::regprocedure));
    IF v <> r.md5 THEN
      RAISE EXCEPTION '146: % no tiene la definición auditada (md5 %; se esperaba %). El POS la reutiliza tal cual. No se aplicó nada.', r.firma, v, r.md5;
    END IF;
  END LOOP;
END $$;

-- ═══ 1. Cajas ═══
CREATE TABLE IF NOT EXISTS public.cajas (
  id                 BIGSERIAL PRIMARY KEY,
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  nombre             TEXT NOT NULL CHECK (length(btrim(nombre)) BETWEEN 1 AND 60),
  activa             BOOLEAN NOT NULL DEFAULT true,
  creada_por         BIGINT,
  creada_por_nombre  TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  modificada_por_nombre TEXT,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (id, establecimiento_id)
);
COMMENT ON TABLE public.cajas IS
  '146: caja física de una tienda (nunca del CEDIS). Varias por tienda (D-S9). Solo lectura por API; se escribe con guardar_caja (Admin).';
CREATE UNIQUE INDEX IF NOT EXISTS cajas_nombre_por_establecimiento ON public.cajas (establecimiento_id, lower(btrim(nombre)));

CREATE OR REPLACE FUNCTION public.cajas_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'cajas: no se escribe por API (usa guardar_caja)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.caja_id = OLD.id) THEN
      RAISE EXCEPTION 'cajas: una caja con turnos no se elimina (se desactiva)' USING ERRCODE = '23503';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.establecimiento_id IS DISTINCT FROM OLD.establecimiento_id THEN
    RAISE EXCEPTION 'cajas: una caja no cambia de establecimiento' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM establecimientos e WHERE e.id = NEW.establecimiento_id AND e.tipo = 'cedis') THEN
    RAISE EXCEPTION 'cajas: el CEDIS no tiene cajas de tienda' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cajas_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cajas_guard ON public.cajas;
CREATE TRIGGER trg_cajas_guard BEFORE INSERT OR UPDATE OR DELETE ON public.cajas
  FOR EACH ROW EXECUTE FUNCTION public.cajas_guard();

-- ═══ 2. Turnos de caja ═══
CREATE TABLE IF NOT EXISTS public.turnos_caja (
  id                 BIGSERIAL PRIMARY KEY,
  caja_id            BIGINT NOT NULL,
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  cajero_id          BIGINT NOT NULL REFERENCES public.usuarios(id),
  cajero_nombre      TEXT NOT NULL,
  estado             TEXT NOT NULL DEFAULT 'abierto' CHECK (estado IN ('abierto', 'cerrado')),
  abierto_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  fecha_negocio      DATE NOT NULL,
  fondo_inicial      NUMERIC(12,2) NOT NULL CHECK (fondo_inicial >= 0),
  cerrado_at         TIMESTAMPTZ,
  cerrado_por        BIGINT,
  cerrado_por_nombre TEXT,
  efectivo_esperado  NUMERIC(12,2),
  efectivo_contado   NUMERIC(12,2) CHECK (efectivo_contado IS NULL OR efectivo_contado >= 0),
  diferencia         NUMERIC(12,2),
  totales            JSONB,
  motivo_diferencia  TEXT,
  notas_cierre       TEXT,
  reaperturas        INTEGER NOT NULL DEFAULT 0,
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (caja_id, establecimiento_id) REFERENCES public.cajas (id, establecimiento_id),   -- el turno es del establecimiento de SU caja
  CHECK ((estado = 'abierto' AND cerrado_at IS NULL AND efectivo_contado IS NULL AND efectivo_esperado IS NULL AND diferencia IS NULL)
      OR (estado = 'cerrado' AND cerrado_at IS NOT NULL AND efectivo_contado IS NOT NULL AND efectivo_esperado IS NOT NULL
          AND diferencia = efectivo_contado - efectivo_esperado AND totales IS NOT NULL
          AND (diferencia = 0 OR length(btrim(COALESCE(motivo_diferencia, ''))) >= 3)))
);
COMMENT ON TABLE public.turnos_caja IS
  '146: turno de un cajero en una caja. Un turno abierto por caja y uno por cajero (índices únicos). Solo lectura por API; se escribe con abrir/cerrar/reabrir_turno_caja.';
CREATE UNIQUE INDEX IF NOT EXISTS turnos_caja_un_abierto_por_caja   ON public.turnos_caja (caja_id)   WHERE estado = 'abierto';
CREATE UNIQUE INDEX IF NOT EXISTS turnos_caja_un_abierto_por_cajero ON public.turnos_caja (cajero_id) WHERE estado = 'abierto';
CREATE INDEX IF NOT EXISTS turnos_caja_establecimiento ON public.turnos_caja (establecimiento_id, abierto_at);

CREATE OR REPLACE FUNCTION public.turnos_caja_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'turnos_caja: no se escribe por API (usa los contratos de turno)' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'turnos_caja: un turno no se elimina' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.caja_id, NEW.establecimiento_id, NEW.cajero_id, NEW.abierto_at, NEW.fecha_negocio, NEW.fondo_inicial)
                       IS DISTINCT FROM (OLD.caja_id, OLD.establecimiento_id, OLD.cajero_id, OLD.abierto_at, OLD.fecha_negocio, OLD.fondo_inicial) THEN
    RAISE EXCEPTION 'turnos_caja: caja, establecimiento, cajero, apertura y fondo de un turno no cambian' USING ERRCODE = '22023';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.turnos_caja_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_turnos_caja_guard ON public.turnos_caja;
CREATE TRIGGER trg_turnos_caja_guard BEFORE INSERT OR UPDATE OR DELETE ON public.turnos_caja
  FOR EACH ROW EXECUTE FUNCTION public.turnos_caja_guard();

CREATE TABLE IF NOT EXISTS public.turnos_caja_eventos (
  id           BIGSERIAL PRIMARY KEY,
  turno_id     BIGINT NOT NULL REFERENCES public.turnos_caja(id),
  tipo         TEXT NOT NULL CHECK (tipo IN ('apertura', 'cierre', 'reapertura')),
  operacion_id UUID NOT NULL UNIQUE,
  huella       TEXT NOT NULL,
  actor_id     BIGINT,
  actor        TEXT,
  motivo       TEXT,
  datos        JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.turnos_caja_eventos IS
  '146: historia inmutable de cada turno (apertura, cierre, reapertura) con el operacion_id que la hizo. Un reintento con el mismo operacion_id devuelve `datos`.';
CREATE INDEX IF NOT EXISTS turnos_caja_eventos_turno ON public.turnos_caja_eventos (turno_id, id);

-- ═══ 3. Ventas de tienda y correcciones ═══
CREATE TABLE IF NOT EXISTS public.ventas_tienda (
  operacion_id       UUID PRIMARY KEY,
  orden_id           BIGINT NOT NULL UNIQUE REFERENCES public.ordenes(id),
  turno_id           BIGINT NOT NULL REFERENCES public.turnos_caja(id),
  caja_id            BIGINT NOT NULL,
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  cajero_id          BIGINT NOT NULL,
  cliente_id         BIGINT,
  metodo             TEXT NOT NULL CHECK (metodo IN ('Efectivo', 'Tarjeta (terminal)', 'Transferencia SPEI')),
  referencia         TEXT,
  total              NUMERIC(12,2) NOT NULL CHECK (total > 0),
  asignacion         JSONB NOT NULL,          -- [{sku, cuarto_id, cantidad}]: de qué cuarto salió cada producto
  desde_cedis        BOOLEAN NOT NULL DEFAULT false,
  huella             TEXT NOT NULL,
  resultado          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE public.ventas_tienda IS
  '146: una fila por venta del POS. operacion_id = idempotencia (un reintento devuelve `resultado`). Liga la orden con su turno, caja, cajero y cuartos de origen.';
CREATE INDEX IF NOT EXISTS ventas_tienda_turno ON public.ventas_tienda (turno_id);

CREATE TABLE IF NOT EXISTS public.correcciones_venta_tienda (
  id                    BIGSERIAL PRIMARY KEY,
  operacion_id          UUID NOT NULL UNIQUE,
  orden_id              BIGINT NOT NULL UNIQUE REFERENCES public.ordenes(id),     -- una corrección por venta (como la devolución)
  turno_venta_id        BIGINT NOT NULL REFERENCES public.turnos_caja(id),
  establecimiento_id    BIGINT NOT NULL REFERENCES public.establecimientos(id),
  devolucion_id         BIGINT NOT NULL REFERENCES public.devoluciones(id),
  motivo                TEXT NOT NULL,
  total_devuelto        NUMERIC(12,2) NOT NULL,
  reembolso_monto       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (reembolso_monto >= 0),
  reembolso_medio       TEXT CHECK (reembolso_medio IN ('efectivo_caja', 'efectivo_administracion', 'electronico')),
  reembolso_estado      TEXT NOT NULL CHECK (reembolso_estado IN ('sin_reembolso', 'registrado', 'ejecutado')),
  reembolso_turno_id    BIGINT REFERENCES public.turnos_caja(id),                 -- caja de la que SALIÓ el efectivo
  reembolso_referencia  TEXT,
  reembolso_ejecutado_at TIMESTAMPTZ,
  reembolso_ejecutado_por TEXT,
  operacion_ejecucion   UUID UNIQUE,
  huella                TEXT NOT NULL,
  resultado             JSONB NOT NULL DEFAULT '{}'::jsonb,
  actor_id              BIGINT,
  actor                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((reembolso_estado = 'sin_reembolso' AND reembolso_monto = 0 AND reembolso_medio IS NULL)
      OR (reembolso_estado IN ('registrado', 'ejecutado') AND reembolso_monto > 0 AND reembolso_medio IS NOT NULL)),
  CHECK (reembolso_estado <> 'ejecutado' OR reembolso_ejecutado_at IS NOT NULL),
  CHECK (reembolso_estado = 'ejecutado' OR (reembolso_ejecutado_at IS NULL AND reembolso_turno_id IS NULL)),
  CHECK (NOT (reembolso_estado = 'ejecutado' AND reembolso_medio = 'efectivo_caja') OR reembolso_turno_id IS NOT NULL),
  CHECK (NOT (reembolso_estado = 'ejecutado' AND reembolso_medio = 'electronico') OR length(btrim(COALESCE(reembolso_referencia, ''))) >= 3)
);
COMMENT ON TABLE public.correcciones_venta_tienda IS
  '146: corrección administrativa de una venta del POS. reembolso_estado distingue el reembolso REGISTRADO (se debe) del EJECUTADO (el dinero ya salió): el electrónico nunca nace ejecutado.';
CREATE INDEX IF NOT EXISTS correcciones_venta_tienda_turno_reembolso ON public.correcciones_venta_tienda (reembolso_turno_id) WHERE reembolso_turno_id IS NOT NULL;

-- Las tres tablas de historia no se escriben por API y sus filas no se borran.
CREATE OR REPLACE FUNCTION public.pos_historia_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION '%: no se escribe por API', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'turnos_caja_eventos') THEN
    RAISE EXCEPTION '%: la historia no se modifica ni se borra', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pos_historia_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_turnos_caja_eventos_guard ON public.turnos_caja_eventos;
CREATE TRIGGER trg_turnos_caja_eventos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.turnos_caja_eventos
  FOR EACH ROW EXECUTE FUNCTION public.pos_historia_guard();
DROP TRIGGER IF EXISTS trg_ventas_tienda_guard ON public.ventas_tienda;
CREATE TRIGGER trg_ventas_tienda_guard BEFORE INSERT OR UPDATE OR DELETE ON public.ventas_tienda
  FOR EACH ROW EXECUTE FUNCTION public.pos_historia_guard();
DROP TRIGGER IF EXISTS trg_correcciones_venta_tienda_guard ON public.correcciones_venta_tienda;
CREATE TRIGGER trg_correcciones_venta_tienda_guard BEFORE INSERT OR UPDATE OR DELETE ON public.correcciones_venta_tienda
  FOR EACH ROW EXECUTE FUNCTION public.pos_historia_guard();

-- ═══ 4. La venta queda ligada a su turno ═══
ALTER TABLE public.ordenes ADD COLUMN IF NOT EXISTS turno_id BIGINT REFERENCES public.turnos_caja(id);
COMMENT ON COLUMN public.ordenes.turno_id IS
  '146: turno de caja de una venta de tienda. NULL en las órdenes históricas y centrales. Por API no se escribe.';
CREATE INDEX IF NOT EXISTS ordenes_turno ON public.ordenes (turno_id) WHERE turno_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ordenes_guard_turno() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_t turnos_caja%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.turno_id IS NOT DISTINCT FROM OLD.turno_id
     AND (NEW.turno_id IS NULL OR NEW.establecimiento_id IS NOT DISTINCT FROM OLD.establecimiento_id) THEN
    RETURN NEW;
  END IF;
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'ordenes: el turno de caja de una venta no se escribe por API' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.turno_id IS NOT NULL THEN
    RAISE EXCEPTION 'ordenes: una venta de tienda no cambia de turno ni de establecimiento' USING ERRCODE = '22023';
  END IF;
  IF NEW.turno_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO v_t FROM turnos_caja WHERE id = NEW.turno_id;
  IF v_t.estado IS DISTINCT FROM 'abierto' THEN
    RAISE EXCEPTION 'ordenes: no se registra una venta en un turno cerrado' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('codigo', 'TURNO_CERRADO')::text;
  END IF;
  IF NEW.establecimiento_id IS DISTINCT FROM v_t.establecimiento_id THEN
    RAISE EXCEPTION 'ordenes: la venta y su turno deben ser del mismo establecimiento' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_DISTINTO')::text;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_turno() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_turno ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_turno BEFORE INSERT OR UPDATE OF turno_id, establecimiento_id ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_turno();

-- ═══ 5. Lectura por API: RLS restrictiva, sin escritura ═══
ALTER TABLE public.cajas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnos_caja ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.turnos_caja_eventos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ventas_tienda ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.correcciones_venta_tienda ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cajas, public.turnos_caja, public.turnos_caja_eventos, public.ventas_tienda, public.correcciones_venta_tienda FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.cajas, public.turnos_caja, public.turnos_caja_eventos, public.ventas_tienda, public.correcciones_venta_tienda TO authenticated;
REVOKE ALL ON SEQUENCE public.cajas_id_seq, public.turnos_caja_id_seq, public.turnos_caja_eventos_id_seq, public.correcciones_venta_tienda_id_seq FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS admin_read ON public.cajas;
CREATE POLICY admin_read ON public.cajas FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');
DROP POLICY IF EXISTS tienda_read ON public.cajas;
CREATE POLICY tienda_read ON public.cajas FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND erp_tienda_asignada(establecimiento_id, false));

DROP POLICY IF EXISTS admin_read ON public.turnos_caja;
CREATE POLICY admin_read ON public.turnos_caja FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');
-- El cajero ve SUS turnos (no los de otro cajero), y solo mientras siga asignado a esa tienda.
DROP POLICY IF EXISTS tienda_read ON public.turnos_caja;
CREATE POLICY tienda_read ON public.turnos_caja FOR SELECT TO authenticated
  USING ((SELECT erp_rol_activo()) = 'Ventas Tienda' AND cajero_id = (SELECT erp_usuario_id()) AND erp_tienda_asignada(establecimiento_id, false));

DROP POLICY IF EXISTS admin_read ON public.turnos_caja_eventos;
CREATE POLICY admin_read ON public.turnos_caja_eventos FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');
DROP POLICY IF EXISTS admin_read ON public.ventas_tienda;
CREATE POLICY admin_read ON public.ventas_tienda FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');
DROP POLICY IF EXISTS admin_read ON public.correcciones_venta_tienda;
CREATE POLICY admin_read ON public.correcciones_venta_tienda FOR SELECT TO authenticated USING ((SELECT erp_rol_activo()) = 'Admin');

-- ═══ 6. Funciones internas (sin EXECUTE por API) ═══
-- Administración con sesión, o una sesión de confianza (servidor, SQL del dueño).
CREATE OR REPLACE FUNCTION public.pos_es_admin() RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN RETURN TRUE; END IF;
  RETURN v_jwt = 'authenticated' AND COALESCE(erp_rol_activo() = 'Admin', false);
END $$;

-- Idempotencia de las operaciones de turno: candado por operación y, si ya existe, su resultado.
CREATE OR REPLACE FUNCTION public.pos_evento_replay(p_operacion_id UUID, p_tipo TEXT, p_huella TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e turnos_caja_eventos%ROWTYPE;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  SELECT * INTO v_e FROM turnos_caja_eventos WHERE operacion_id = p_operacion_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_e.tipo <> p_tipo OR v_e.huella <> p_huella THEN
    RAISE EXCEPTION 'caja: esa operación ya se usó con otros datos' USING ERRCODE = '23505',
      DETAIL = jsonb_build_object('codigo', 'OPERACION_REPETIDA')::text;
  END IF;
  RETURN v_e.datos || jsonb_build_object('replay', true);
END $$;

-- Totales de un turno, SIEMPRE desde las operaciones reales: pagos de sus ventas y
-- reembolsos en efectivo que salieron de su caja.
CREATE OR REPLACE FUNCTION public.turno_caja_totales(p_turno_id BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'fondo_inicial', t.fondo_inicial,
    'ventas', (SELECT count(*) FROM ordenes o WHERE o.turno_id = t.id),
    'total_vendido', (SELECT COALESCE(sum(o.total), 0) FROM ordenes o WHERE o.turno_id = t.id),
    'cobrado_por_metodo', COALESCE((SELECT jsonb_object_agg(m.metodo_pago, m.monto)
                                      FROM (SELECT p.metodo_pago, round(sum(p.monto), 2) AS monto
                                              FROM pagos p JOIN ordenes o ON o.id = p.orden_id
                                             WHERE o.turno_id = t.id GROUP BY p.metodo_pago) m), '{}'::jsonb),
    'cobrado_efectivo', (SELECT COALESCE(round(sum(p.monto), 2), 0) FROM pagos p JOIN ordenes o ON o.id = p.orden_id
                          WHERE o.turno_id = t.id AND p.metodo_pago = 'Efectivo'),
    'reembolsos_efectivo_caja', (SELECT COALESCE(round(sum(c.reembolso_monto), 2), 0) FROM correcciones_venta_tienda c
                                  WHERE c.reembolso_turno_id = t.id AND c.reembolso_estado = 'ejecutado' AND c.reembolso_medio = 'efectivo_caja'),
    'correcciones_de_sus_ventas', (SELECT count(*) FROM correcciones_venta_tienda c WHERE c.turno_venta_id = t.id))
    FROM turnos_caja t WHERE t.id = p_turno_id
$$;
REVOKE ALL ON FUNCTION public.pos_es_admin(), public.pos_evento_replay(UUID, TEXT, TEXT), public.turno_caja_totales(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 7. guardar_caja (Admin) ═══
CREATE OR REPLACE FUNCTION public.guardar_caja(p_id BIGINT, p_establecimiento_id BIGINT, p_nombre TEXT, p_activa BOOLEAN DEFAULT true) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_nombre TEXT := regexp_replace(btrim(COALESCE(p_nombre, '')), '\s+', ' ', 'g');
  v_etq    TEXT := erp_actor_etiqueta();
  v_e      establecimientos%ROWTYPE;
  v_c      cajas%ROWTYPE;
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION 'guardar_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'guardar_caja: las tiendas todavía no están activadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  IF length(v_nombre) NOT BETWEEN 1 AND 60 THEN
    RAISE EXCEPTION 'guardar_caja: escribe el nombre de la caja (máximo 60 letras)' USING ERRCODE = '22023';
  END IF;
  IF p_id IS NULL THEN
    SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id;
    IF NOT FOUND OR NOT v_e.activo OR v_e.tipo = 'cedis' THEN
      RAISE EXCEPTION 'guardar_caja: el establecimiento no es una tienda activa' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
    END IF;
    BEGIN
      INSERT INTO cajas (establecimiento_id, nombre, activa, creada_por, creada_por_nombre, modificada_por_nombre)
      VALUES (v_e.id, v_nombre, COALESCE(p_activa, true), erp_usuario_id(), v_etq, v_etq) RETURNING * INTO v_c;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'guardar_caja: esa tienda ya tiene una caja llamada "%"', v_nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_REPETIDA')::text;
    END;
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (v_etq, 'Alta de caja', 'Tiendas', v_e.nombre || ' — ' || v_nombre);
  ELSE
    SELECT * INTO v_c FROM cajas WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'guardar_caja: la caja no existe' USING ERRCODE = '22023';
    END IF;
    IF p_establecimiento_id IS NOT NULL AND p_establecimiento_id <> v_c.establecimiento_id THEN
      RAISE EXCEPTION 'guardar_caja: una caja no cambia de tienda' USING ERRCODE = '22023';
    END IF;
    IF NOT COALESCE(p_activa, true) AND EXISTS (SELECT 1 FROM turnos_caja t WHERE t.caja_id = v_c.id AND t.estado = 'abierto') THEN
      RAISE EXCEPTION 'guardar_caja: la caja tiene un turno abierto; ciérralo antes de desactivarla' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_CON_TURNO_ABIERTO')::text;
    END IF;
    BEGIN
      UPDATE cajas SET nombre = v_nombre, activa = COALESCE(p_activa, true), modificada_por_nombre = v_etq WHERE id = v_c.id RETURNING * INTO v_c;
    EXCEPTION WHEN unique_violation THEN
      RAISE EXCEPTION 'guardar_caja: esa tienda ya tiene una caja llamada "%"', v_nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_REPETIDA')::text;
    END;
    INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (v_etq, 'Cambio de caja', 'Tiendas', 'Caja ' || v_c.id || ' — ' || v_c.nombre || CASE WHEN v_c.activa THEN ' (activa)' ELSE ' (inactiva)' END);
  END IF;
  RETURN jsonb_build_object('id', v_c.id, 'establecimiento_id', v_c.establecimiento_id, 'nombre', v_c.nombre, 'activa', v_c.activa);
END $$;

-- ═══ 8. abrir_turno_caja (cajero) ═══
CREATE OR REPLACE FUNCTION public.abrir_turno_caja(p_operacion_id UUID, p_caja_id BIGINT, p_fondo_inicial NUMERIC) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid   BIGINT := erp_usuario_id();
  v_etq   TEXT := erp_actor_etiqueta();
  v_c     cajas%ROWTYPE;
  v_t     turnos_caja%ROWTYPE;
  v_prev  JSONB;
  v_res   JSONB;
  v_huella TEXT;
  v_cons  TEXT;
BEGIN
  -- 1. Quién: un usuario de tienda asignado al establecimiento de ESA caja (lo decide el servidor).
  SELECT * INTO v_c FROM cajas WHERE id = p_caja_id;
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR v_c.id IS NULL OR NOT erp_tienda_asignada(v_c.establecimiento_id, false) THEN
    RAISE EXCEPTION 'abrir_turno_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'abrir_turno_caja: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'abrir_turno_caja: las tiendas todavía no están activadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  IF p_fondo_inicial IS NULL OR p_fondo_inicial < 0 OR p_fondo_inicial > 1000000 OR p_fondo_inicial <> round(p_fondo_inicial, 2) THEN
    RAISE EXCEPTION 'abrir_turno_caja: fondo inicial inválido (0 o más, hasta centavos)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'FONDO_INVALIDO')::text;
  END IF;
  v_huella := jsonb_build_object('caja', p_caja_id, 'cajero', v_uid, 'fondo', round(p_fondo_inicial, 2))::text;

  -- 2. Reintento → mismo resultado.
  v_prev := pos_evento_replay(p_operacion_id, 'apertura', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  -- 3. Caja bloqueada: dos aperturas de la misma caja van una tras otra.
  SELECT * INTO v_c FROM cajas WHERE id = p_caja_id FOR UPDATE;
  IF NOT v_c.activa THEN
    RAISE EXCEPTION 'abrir_turno_caja: la caja "%" está desactivada', v_c.nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_INACTIVA')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.caja_id = v_c.id AND t.estado = 'abierto') THEN
    RAISE EXCEPTION 'abrir_turno_caja: la caja "%" ya tiene un turno abierto', v_c.nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_OCUPADA')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja t WHERE t.cajero_id = v_uid AND t.estado = 'abierto') THEN
    RAISE EXCEPTION 'abrir_turno_caja: ya tienes un turno abierto; ciérralo antes de abrir otro' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJERO_CON_TURNO')::text;
  END IF;

  -- 4. Alta. Los dos índices únicos son el respaldo final ante aperturas simultáneas.
  BEGIN
    INSERT INTO turnos_caja (caja_id, establecimiento_id, cajero_id, cajero_nombre, fecha_negocio, fondo_inicial)
    VALUES (v_c.id, v_c.establecimiento_id, v_uid, COALESCE(erp_actor_nombre(), v_etq), fin_hoy(), round(p_fondo_inicial, 2))
    RETURNING * INTO v_t;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    IF v_cons = 'turnos_caja_un_abierto_por_cajero' THEN
      RAISE EXCEPTION 'abrir_turno_caja: ya tienes un turno abierto; ciérralo antes de abrir otro' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJERO_CON_TURNO')::text;
    END IF;
    RAISE EXCEPTION 'abrir_turno_caja: la caja "%" ya tiene un turno abierto', v_c.nombre USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_OCUPADA')::text;
  END;

  v_res := jsonb_build_object('turno_id', v_t.id, 'estado', v_t.estado, 'caja_id', v_c.id, 'caja', v_c.nombre, 'establecimiento_id', v_t.establecimiento_id,
                              'cajero_id', v_uid, 'cajero', v_t.cajero_nombre, 'fondo_inicial', v_t.fondo_inicial, 'abierto_at', v_t.abierto_at,
                              'fecha_negocio', v_t.fecha_negocio, 'replay', false);
  INSERT INTO turnos_caja_eventos (turno_id, tipo, operacion_id, huella, actor_id, actor, datos)
  VALUES (v_t.id, 'apertura', p_operacion_id, v_huella, v_uid, v_etq, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Apertura de turno', 'Tiendas', 'Turno ' || v_t.id || ' — caja ' || v_c.nombre || ' — fondo $' || v_t.fondo_inicial);
  RETURN v_res;
END $$;

-- ═══ 9. vender_en_tienda (cajero, una transacción) ═══
CREATE OR REPLACE FUNCTION public.vender_en_tienda(p_operacion_id UUID, p_turno_id BIGINT, p_items JSONB, p_metodo TEXT,
                                                   p_cliente_id BIGINT DEFAULT NULL, p_referencia TEXT DEFAULT NULL, p_requiere_factura BOOLEAN DEFAULT false)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid     BIGINT := erp_usuario_id();
  v_etq     TEXT := erp_actor_etiqueta();
  v_metodo  TEXT := btrim(COALESCE(p_metodo, ''));
  v_ref     TEXT := NULLIF(regexp_replace(btrim(COALESCE(p_referencia, '')), '\s+', ' ', 'g'), '');
  v_t       turnos_caja%ROWTYPE;
  v_e       establecimientos%ROWTYPE;
  v_c       cajas%ROWTYPE;
  v_el      JSONB;
  v_sku     TEXT;
  v_cuarto  TEXT;
  v_raw     TEXT;
  v_unico   TEXT;
  v_n_cuartos INTEGER;
  v_asig    JSONB := '[]'::jsonb;
  v_items   JSONB;
  v_huella  TEXT;
  v_prev    ventas_tienda%ROWTYPE;
  v_cedis   BOOLEAN := false;
  v_perm_cedis BOOLEAN;
  v_rooms   TEXT[];
  v_r       RECORD;
  v_disp    INTEGER;
  v_modo    TEXT;
  v_suc     BIGINT;
  v_nombre  TEXT;
  v_lin     JSONB;
  v_total   NUMERIC;
  v_seq     TEXT;
  v_folio   TEXT;
  v_ord_id  BIGINT;
  v_vd      JSONB;
  v_res     JSONB;
BEGIN
  -- 1. Quién: el cajero de ESE turno. Un turno ajeno o inexistente responde lo mismo.
  SELECT * INTO v_t FROM turnos_caja WHERE id = p_turno_id;
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR v_t.id IS NULL OR v_t.cajero_id IS DISTINCT FROM v_uid
     OR COALESCE(erp_rol_activo(), '') <> 'Ventas Tienda' THEN
    RAISE EXCEPTION 'vender_en_tienda: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'vender_en_tienda: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;

  -- 2. Forma de pago: una, inmediata. Nunca crédito.
  IF v_metodo NOT IN ('Efectivo', 'Tarjeta (terminal)', 'Transferencia SPEI') THEN
    RAISE EXCEPTION 'vender_en_tienda: la venta de tienda se cobra al momento (Efectivo, Tarjeta (terminal) o Transferencia SPEI); no hay crédito'
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'SOLO_PAGO_INMEDIATO')::text;
  END IF;

  -- 3. Partidas: {sku, cantidad, cuarto_id?}. Cualquier precio, descuento o total del cliente se rechaza.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 OR jsonb_array_length(p_items) > 200 THEN
    RAISE EXCEPTION 'vender_en_tienda: la venta no tiene productos' USING ERRCODE = '22023';
  END IF;
  SELECT count(*), min(cf.id) INTO v_n_cuartos, v_unico FROM cuartos_frios cf WHERE cf.establecimiento_id = v_t.establecimiento_id;
  FOR v_el IN SELECT value FROM jsonb_array_elements(p_items) LOOP
    IF jsonb_typeof(v_el) <> 'object' THEN
      RAISE EXCEPTION 'vender_en_tienda: cada partida lleva sku y cantidad' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(v_el) k WHERE k NOT IN ('sku', 'cantidad', 'cuarto_id')) THEN
      RAISE EXCEPTION 'vender_en_tienda: el precio, el descuento y el total los pone el servidor; la partida solo lleva sku, cantidad y cuarto_id'
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PRECIO_NO_PERMITIDO')::text;
    END IF;
    v_sku := btrim(COALESCE(v_el ->> 'sku', ''));
    v_raw := btrim(COALESCE(v_el ->> 'cantidad', ''));
    IF v_sku = '' OR v_raw !~ '^[0-9]{1,6}$' OR v_raw::INTEGER <= 0 THEN
      RAISE EXCEPTION 'vender_en_tienda: cada partida lleva sku y una cantidad entera mayor a 0' USING ERRCODE = '22023';
    END IF;
    v_cuarto := NULLIF(btrim(COALESCE(v_el ->> 'cuarto_id', '')), '');
    IF v_cuarto IS NULL THEN
      IF v_n_cuartos <> 1 THEN
        RAISE EXCEPTION 'vender_en_tienda: indica de qué congelador sale % (la tienda tiene %)', v_sku, v_n_cuartos
          USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_REQUERIDO')::text;
      END IF;
      v_cuarto := v_unico;
    END IF;
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) a WHERE a.value ->> 'sku' = v_sku AND a.value ->> 'cuarto_id' = v_cuarto) THEN
      RAISE EXCEPTION 'vender_en_tienda: % de % aparece más de una vez', v_sku, v_cuarto USING ERRCODE = '22023';
    END IF;
    v_asig := v_asig || jsonb_build_array(jsonb_build_object('sku', v_sku, 'cuarto_id', v_cuarto, 'cantidad', v_raw::INTEGER));
  END LOOP;
  SELECT jsonb_agg(a.value ORDER BY a.value ->> 'sku', a.value ->> 'cuarto_id') INTO v_asig FROM jsonb_array_elements(v_asig) a;
  SELECT jsonb_agg(jsonb_build_object('sku', x.sku, 'cantidad', x.q) ORDER BY x.sku) INTO v_items
    FROM (SELECT a.value ->> 'sku' AS sku, sum((a.value ->> 'cantidad')::INTEGER) AS q FROM jsonb_array_elements(v_asig) a GROUP BY 1) x;
  v_huella := jsonb_build_object('turno', p_turno_id, 'metodo', v_metodo, 'cliente', p_cliente_id, 'referencia', v_ref,
                                 'factura', COALESCE(p_requiere_factura, false), 'asignacion', v_asig)::text;

  -- 4. Idempotencia: el mismo operacion_id con los mismos datos devuelve la venta original
  --    (reintento tras perder la conexión, doble clic). Con otros datos se rechaza.
  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  SELECT * INTO v_prev FROM ventas_tienda WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella <> v_huella THEN
      RAISE EXCEPTION 'vender_en_tienda: esa operación ya se usó con otros datos' USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'OPERACION_REPETIDA')::text;
    END IF;
    RETURN v_prev.resultado || jsonb_build_object('replay', true);
  END IF;

  -- 5. Turno bloqueado: el cierre espera a esta venta y esta venta ve si el turno ya cerró.
  SELECT * INTO v_t FROM turnos_caja WHERE id = p_turno_id FOR UPDATE;
  IF v_t.estado <> 'abierto' THEN
    RAISE EXCEPTION 'vender_en_tienda: el turno ya está cerrado' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_CERRADO')::text;
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'vender_en_tienda: las tiendas todavía no están activadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  SELECT * INTO v_e FROM establecimientos WHERE id = v_t.establecimiento_id;
  SELECT * INTO v_c FROM cajas WHERE id = v_t.caja_id;
  -- La asignación se revisa OTRA VEZ en cada venta: quitarla corta el turno abierto.
  IF NOT v_e.activo OR v_e.tipo = 'cedis' OR NOT v_c.activa OR NOT erp_tienda_asignada(v_e.id, false) THEN
    RAISE EXCEPTION 'vender_en_tienda: ya no puedes vender en esta tienda o en esta caja' USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'TIENDA_NO_DISPONIBLE')::text;
  END IF;

  -- 6. Cliente (opcional): solo uno que el POS de ESTA tienda pueda usar. Mismo rechazo exista o no.
  IF p_cliente_id IS NOT NULL THEN
    PERFORM 1 FROM clientes WHERE id = p_cliente_id FOR SHARE;       -- una fusión en curso espera a esta venta
    IF NOT pos_cliente_disponible(v_e.id, v_e.clientes_pos, p_cliente_id) THEN
      RAISE EXCEPTION 'vender_en_tienda: el cliente no está disponible en esta tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CLIENTE_NO_DISPONIBLE')::text;
    END IF;
    SELECT c.nombre INTO v_nombre FROM clientes c WHERE c.id = p_cliente_id;
    SELECT s.id INTO v_suc FROM sucursales s WHERE s.cliente_id = p_cliente_id AND s.es_principal;
  ELSE
    IF COALESCE(p_requiere_factura, false) THEN
      RAISE EXCEPTION 'vender_en_tienda: para facturar elige un cliente' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'FACTURA_SIN_CLIENTE')::text;
    END IF;
    v_nombre := 'Público en general';
  END IF;

  -- 7. Precio del servidor (sucursal principal → cliente → lista), igual que un pedido.
  v_lin := lineas_canonicas(p_cliente_id, v_suc, v_items);
  v_total := (v_lin ->> 'total')::NUMERIC;
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_lin -> 'lineas') l JOIN productos p ON p.sku = l.value ->> 'sku' WHERE p.tipo <> 'Producto Terminado') THEN
    RAISE EXCEPTION 'vender_en_tienda: solo se vende producto terminado' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'PRODUCTO_NO_VENDIBLE')::text;
  END IF;

  -- 8. Origen físico: cuartos de ESTA tienda; del CEDIS solo una tienda de fábrica y solo
  --    con el permiso de este usuario EN esta tienda (D-S4). Nunca de otra tienda.
  SELECT COALESCE((SELECT ue.vende_desde_cedis FROM usuario_establecimientos ue WHERE ue.usuario_id = v_uid AND ue.establecimiento_id = v_e.id), false)
         AND v_e.tipo = 'tienda_fabrica' INTO v_perm_cedis;
  SELECT array_agg(DISTINCT a.value ->> 'cuarto_id' ORDER BY a.value ->> 'cuarto_id') INTO v_rooms FROM jsonb_array_elements(v_asig) a;
  FOR v_r IN SELECT pedido, cf.id, cf.establecimiento_id FROM unnest(v_rooms) AS pedido LEFT JOIN cuartos_frios cf ON cf.id = pedido ORDER BY 1 LOOP
    IF v_r.id IS NULL OR (v_r.establecimiento_id <> v_e.id AND v_r.establecimiento_id <> 1) THEN
      -- Un cuarto inexistente y el de otra tienda responden lo mismo.
      RAISE EXCEPTION 'vender_en_tienda: el congelador % no es de esta tienda', v_r.pedido USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'INVENTARIO_DE_OTRA_TIENDA')::text;
    END IF;
    IF v_r.establecimiento_id = 1 THEN
      IF NOT v_perm_cedis THEN
        RAISE EXCEPTION 'vender_en_tienda: esta tienda no tiene permiso para vender desde el CEDIS' USING ERRCODE = '42501', DETAIL = jsonb_build_object('codigo', 'CEDIS_SIN_PERMISO')::text;
      END IF;
      v_cedis := true;
    END IF;
  END LOOP;
  -- Candados en el orden de siempre: empaque (si hay picada o triturada) y luego cuartos por id.
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) a WHERE a.value ->> 'sku' IN ('HIP-25K', 'HIT-25K')) THEN
    PERFORM 1 FROM productos
      WHERE sku IN (SELECT p.empaque_sku FROM productos p WHERE p.sku IN ('HIP-25K', 'HIT-25K') AND p.empaque_sku IS NOT NULL)
      ORDER BY sku FOR UPDATE;
  END IF;
  PERFORM 1 FROM cuartos_frios WHERE id = ANY (v_rooms) ORDER BY id FOR UPDATE;
  -- La tienda vende lo que TIENE: no parte ni prepara barra al cobrar (eso es de Producción).
  FOR v_r IN SELECT a.value ->> 'sku' AS sku, a.value ->> 'cuarto_id' AS cuarto_id, (a.value ->> 'cantidad')::INTEGER AS cantidad
               FROM jsonb_array_elements(v_asig) a ORDER BY 2, 1 LOOP
    SELECT GREATEST(COALESCE(NULLIF(cf.stock ->> v_r.sku, '')::INTEGER, 0), 0) INTO v_disp FROM cuartos_frios cf WHERE cf.id = v_r.cuarto_id;
    IF v_disp < v_r.cantidad THEN
      RAISE EXCEPTION 'vender_en_tienda: no hay suficiente % en % (hay %, se piden %)', v_r.sku, v_r.cuarto_id, v_disp, v_r.cantidad
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'SIN_EXISTENCIA', 'sku', v_r.sku, 'cuarto_id', v_r.cuarto_id, 'disponible', v_disp, 'pedido', v_r.cantidad)::text;
    END IF;
  END LOOP;

  -- 9. Orden y líneas, ya ligadas a la tienda y al turno.
  v_seq := pg_catalog.nextval('folio_ov_seq'::regclass)::TEXT;
  v_folio := 'OV-' || lpad(v_seq, greatest(4, length(v_seq)), '0');
  INSERT INTO ordenes (folio, cliente_id, sucursal_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, vendedor_id, tipo_cobro,
                       requiere_factura, establecimiento_id, turno_id)
  VALUES (v_folio, p_cliente_id, v_suc, v_nombre, v_lin ->> 'productos', fin_hoy(), v_total, 'Creada', v_metodo, v_uid, 'Contado',
          COALESCE(p_requiere_factura, false), v_e.id, v_t.id)
  RETURNING id INTO v_ord_id;
  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT v_ord_id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
    FROM jsonb_array_elements(v_lin -> 'lineas') l;
  INSERT INTO ventas_tienda (operacion_id, orden_id, turno_id, caja_id, establecimiento_id, cajero_id, cliente_id, metodo, referencia, total, asignacion, desde_cedis, huella)
  VALUES (p_operacion_id, v_ord_id, v_t.id, v_t.caja_id, v_e.id, v_uid, p_cliente_id, v_metodo, v_ref, v_total, v_asig, v_cedis, v_huella);

  -- 10. Entrega y cobro con el contrato de venta directa, sin modificarlo: salida de los
  --     cuartos indicados, kardex, pago e ingreso. La referencia va con el folio delante
  --     para que nunca coincida con la de otro origen (links de pago, abonos).
  PERFORM fin_marcar_ctx();
  v_vd := completar_venta_directa(p_operacion_id, v_ord_id, 'contado', v_metodo, v_asig, CASE WHEN v_ref IS NULL THEN NULL ELSE v_folio || ' · ' || v_ref END, NULL);
  IF v_vd ->> 'estatus' IS DISTINCT FROM 'Entregada' OR COALESCE((v_vd -> 'pago' ->> 'aplicado')::BOOLEAN, false) IS NOT TRUE
     OR (v_vd -> 'pago' ->> 'monto')::NUMERIC IS DISTINCT FROM v_total THEN
    RAISE EXCEPTION 'vender_en_tienda: la venta no quedó entregada y cobrada completa; no se registró nada' USING ERRCODE = '22023';
  END IF;

  v_res := jsonb_build_object('orden_id', v_ord_id, 'folio', v_folio, 'estatus', 'Entregada', 'total', v_total, 'metodo', v_metodo,
                              'pago_id', (v_vd -> 'pago' ->> 'pago_id')::BIGINT, 'referencia', v_vd -> 'pago' ->> 'referencia',
                              'lineas', v_lin -> 'lineas', 'asignacion', v_asig, 'desde_cedis', v_cedis,
                              'cliente_id', p_cliente_id, 'cliente_nombre', v_nombre, 'requiere_factura', COALESCE(p_requiere_factura, false),
                              'turno_id', v_t.id, 'caja_id', v_t.caja_id, 'establecimiento_id', v_e.id, 'cajero_id', v_uid, 'replay', false);
  UPDATE ventas_tienda SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;

-- ═══ 10. cerrar_turno_caja (cajero del turno o Admin) ═══
CREATE OR REPLACE FUNCTION public.cerrar_turno_caja(p_operacion_id UUID, p_turno_id BIGINT, p_efectivo_contado NUMERIC,
                                                    p_motivo_diferencia TEXT DEFAULT NULL, p_notas TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    BIGINT := erp_usuario_id();
  v_etq    TEXT := erp_actor_etiqueta();
  v_admin  BOOLEAN := pos_es_admin();
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo_diferencia, '')), '');
  v_notas  TEXT := NULLIF(btrim(COALESCE(p_notas, '')), '');
  v_t      turnos_caja%ROWTYPE;
  v_prev   JSONB;
  v_tot    JSONB;
  v_esp    NUMERIC;
  v_dif    NUMERIC;
  v_huella TEXT;
  v_res    JSONB;
BEGIN
  SELECT * INTO v_t FROM turnos_caja WHERE id = p_turno_id;
  IF NOT v_admin AND (v_t.id IS NULL OR v_t.cajero_id IS DISTINCT FROM v_uid OR COALESCE(erp_rol_activo(), '') <> 'Ventas Tienda') THEN
    RAISE EXCEPTION 'cerrar_turno_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR v_t.id IS NULL THEN
    RAISE EXCEPTION 'cerrar_turno_caja: operación y turno son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_efectivo_contado IS NULL OR p_efectivo_contado < 0 OR p_efectivo_contado > 10000000 OR p_efectivo_contado <> round(p_efectivo_contado, 2) THEN
    RAISE EXCEPTION 'cerrar_turno_caja: escribe el efectivo contado (0 o más, hasta centavos)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CONTADO_INVALIDO')::text;
  END IF;
  v_huella := jsonb_build_object('turno', p_turno_id, 'contado', round(p_efectivo_contado, 2), 'motivo', v_motivo, 'notas', v_notas)::text;
  v_prev := pos_evento_replay(p_operacion_id, 'cierre', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  -- Candado exclusivo: espera a la venta o al reembolso que esté en curso en este turno.
  SELECT * INTO v_t FROM turnos_caja WHERE id = p_turno_id FOR UPDATE;
  IF v_t.estado <> 'abierto' THEN
    RAISE EXCEPTION 'cerrar_turno_caja: el turno ya está cerrado' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_CERRADO')::text;
  END IF;
  IF v_t.cajero_id IS DISTINCT FROM v_uid AND v_notas IS NULL THEN
    RAISE EXCEPTION 'cerrar_turno_caja: al cerrar el turno de otra persona escribe por qué (notas)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NOTAS_REQUERIDAS')::text;
  END IF;

  v_tot := turno_caja_totales(v_t.id);
  v_esp := round(v_t.fondo_inicial + (v_tot ->> 'cobrado_efectivo')::NUMERIC - (v_tot ->> 'reembolsos_efectivo_caja')::NUMERIC, 2);
  v_dif := round(p_efectivo_contado, 2) - v_esp;
  IF v_dif <> 0 AND (v_motivo IS NULL OR length(v_motivo) < 3) THEN
    -- No se dice cuánto falta o sobra: quien cuenta no debe poder "ajustar" el conteo.
    RAISE EXCEPTION 'cerrar_turno_caja: el efectivo contado no coincide con el esperado; vuelve a contar o escribe el motivo de la diferencia'
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_DIFERENCIA')::text;
  END IF;

  UPDATE turnos_caja
     SET estado = 'cerrado', cerrado_at = now(), cerrado_por = v_uid, cerrado_por_nombre = v_etq, efectivo_esperado = v_esp,
         efectivo_contado = round(p_efectivo_contado, 2), diferencia = v_dif, totales = v_tot,
         motivo_diferencia = CASE WHEN v_dif <> 0 THEN v_motivo END, notas_cierre = v_notas
   WHERE id = v_t.id
  RETURNING * INTO v_t;

  v_res := jsonb_build_object('turno_id', v_t.id, 'estado', 'cerrado', 'caja_id', v_t.caja_id, 'establecimiento_id', v_t.establecimiento_id,
                              'cajero_id', v_t.cajero_id, 'cerrado_at', v_t.cerrado_at, 'cerrado_por', v_etq, 'fondo_inicial', v_t.fondo_inicial,
                              'efectivo_esperado', v_esp, 'efectivo_contado', v_t.efectivo_contado, 'diferencia', v_dif,
                              'motivo_diferencia', v_t.motivo_diferencia, 'totales', v_tot, 'replay', false);
  INSERT INTO turnos_caja_eventos (turno_id, tipo, operacion_id, huella, actor_id, actor, motivo, datos)
  VALUES (v_t.id, 'cierre', p_operacion_id, v_huella, v_uid, v_etq, v_t.motivo_diferencia, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Cierre de turno', 'Tiendas', 'Turno ' || v_t.id || ' — esperado $' || v_esp || ', contado $' || v_t.efectivo_contado || ', diferencia $' || v_dif
          || COALESCE(' — ' || v_t.motivo_diferencia, ''));
  RETURN v_res;
END $$;

-- ═══ 11. reabrir_turno_caja (Admin) ═══
CREATE OR REPLACE FUNCTION public.reabrir_turno_caja(p_operacion_id UUID, p_turno_id BIGINT, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq    TEXT := erp_actor_etiqueta();
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_t      turnos_caja%ROWTYPE;
  v_c      cajas%ROWTYPE;
  v_prev   JSONB;
  v_huella TEXT;
  v_res    JSONB;
  v_cons   TEXT;
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION 'reabrir_turno_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_turno_id IS NULL THEN
    RAISE EXCEPTION 'reabrir_turno_caja: operación y turno son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'reabrir_turno_caja: escribe el motivo de la reapertura' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
  END IF;
  v_huella := jsonb_build_object('turno', p_turno_id, 'motivo', v_motivo)::text;
  v_prev := pos_evento_replay(p_operacion_id, 'reapertura', v_huella);
  IF v_prev IS NOT NULL THEN RETURN v_prev; END IF;

  SELECT * INTO v_t FROM turnos_caja WHERE id = p_turno_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reabrir_turno_caja: el turno no existe' USING ERRCODE = '22023';
  END IF;
  IF v_t.estado <> 'cerrado' THEN
    RAISE EXCEPTION 'reabrir_turno_caja: el turno ya está abierto' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_ABIERTO')::text;
  END IF;
  IF NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'reabrir_turno_caja: las tiendas no están activadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TIENDAS_NO_ACTIVADAS')::text;
  END IF;
  SELECT * INTO v_c FROM cajas WHERE id = v_t.caja_id FOR UPDATE;
  IF NOT v_c.activa OR NOT EXISTS (SELECT 1 FROM establecimientos e WHERE e.id = v_t.establecimiento_id AND e.activo) THEN
    RAISE EXCEPTION 'reabrir_turno_caja: la caja o la tienda están desactivadas' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_INACTIVA')::text;
  END IF;
  -- El cajero tiene que seguir siendo de esa tienda: reabrir no le devuelve acceso a nadie.
  IF NOT EXISTS (SELECT 1 FROM usuarios u JOIN usuario_establecimientos ue ON ue.usuario_id = u.id
                  WHERE u.id = v_t.cajero_id AND u.estatus = 'Activo' AND u.rol = 'Ventas' AND ue.establecimiento_id = v_t.establecimiento_id) THEN
    RAISE EXCEPTION 'reabrir_turno_caja: el cajero de ese turno ya no trabaja en esa tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJERO_NO_DISPONIBLE')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja x WHERE x.caja_id = v_t.caja_id AND x.estado = 'abierto') THEN
    RAISE EXCEPTION 'reabrir_turno_caja: la caja tiene otro turno abierto; ciérralo primero' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJA_OCUPADA')::text;
  END IF;
  IF EXISTS (SELECT 1 FROM turnos_caja x WHERE x.cajero_id = v_t.cajero_id AND x.estado = 'abierto') THEN
    RAISE EXCEPTION 'reabrir_turno_caja: el cajero tiene otro turno abierto; ciérralo primero' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CAJERO_CON_TURNO')::text;
  END IF;

  -- El cierre anterior no se pierde: queda completo en el evento de reapertura.
  v_res := jsonb_build_object('turno_id', v_t.id, 'estado', 'abierto', 'caja_id', v_t.caja_id, 'establecimiento_id', v_t.establecimiento_id,
                              'cajero_id', v_t.cajero_id, 'reaperturas', v_t.reaperturas + 1, 'motivo', v_motivo, 'reabierto_por', v_etq,
                              'cierre_anterior', jsonb_build_object('cerrado_at', v_t.cerrado_at, 'cerrado_por', v_t.cerrado_por_nombre,
                                 'efectivo_esperado', v_t.efectivo_esperado, 'efectivo_contado', v_t.efectivo_contado, 'diferencia', v_t.diferencia,
                                 'motivo_diferencia', v_t.motivo_diferencia, 'notas_cierre', v_t.notas_cierre, 'totales', v_t.totales),
                              'replay', false);
  BEGIN
    UPDATE turnos_caja
       SET estado = 'abierto', cerrado_at = NULL, cerrado_por = NULL, cerrado_por_nombre = NULL, efectivo_esperado = NULL, efectivo_contado = NULL,
           diferencia = NULL, totales = NULL, motivo_diferencia = NULL, notas_cierre = NULL, reaperturas = reaperturas + 1
     WHERE id = v_t.id;
  EXCEPTION WHEN unique_violation THEN
    GET STACKED DIAGNOSTICS v_cons = CONSTRAINT_NAME;
    RAISE EXCEPTION 'reabrir_turno_caja: la caja o el cajero ya tienen otro turno abierto' USING ERRCODE = '22023',
      DETAIL = jsonb_build_object('codigo', CASE WHEN v_cons = 'turnos_caja_un_abierto_por_cajero' THEN 'CAJERO_CON_TURNO' ELSE 'CAJA_OCUPADA' END)::text;
  END;
  INSERT INTO turnos_caja_eventos (turno_id, tipo, operacion_id, huella, actor_id, actor, motivo, datos)
  VALUES (v_t.id, 'reapertura', p_operacion_id, v_huella, erp_usuario_id(), v_etq, v_motivo, v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Reapertura de turno', 'Tiendas', 'Turno ' || v_t.id || ' — ' || v_motivo);
  RETURN v_res;
END $$;

-- ═══ 12. corregir_venta_tienda (Admin) ═══
-- Devuelve producto y dinero de UNA venta del POS con registrar_devolucion (sin tocarlo):
-- una devolución por venta, cantidades hasta lo vendido, producto reintegrado a un cuarto
-- o dado de merma, y el egreso contable de siempre. Lo propio de la tienda es decir de
-- DÓNDE sale el dinero y si YA se entregó:
--   efectivo_caja            sale del cajón de un turno ABIERTO de la misma tienda (baja su efectivo esperado).
--   efectivo_administracion  lo entrega Administración fuera de las cajas.
--   electronico              devolución a tarjeta o transferencia: requiere una acción FUERA del sistema;
--                            aquí solo queda REGISTRADA hasta confirmar_reembolso_tienda con su referencia.
CREATE OR REPLACE FUNCTION public.corregir_venta_tienda(p_operacion_id UUID, p_orden_id BIGINT, p_motivo TEXT, p_disposicion TEXT,
                                                        p_cuarto_id TEXT DEFAULT NULL, p_items JSONB DEFAULT NULL,
                                                        p_reembolso_medio TEXT DEFAULT 'efectivo_administracion',
                                                        p_reembolso_entregado BOOLEAN DEFAULT false, p_turno_reembolso_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq     TEXT := erp_actor_etiqueta();
  v_motivo  TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_disp    TEXT := btrim(COALESCE(p_disposicion, ''));
  v_cuarto  TEXT := NULLIF(btrim(COALESCE(p_cuarto_id, '')), '');
  v_medio   TEXT := btrim(COALESCE(p_reembolso_medio, ''));
  v_entregado BOOLEAN := COALESCE(p_reembolso_entregado, false);
  v_items   JSONB;
  v_huella  TEXT;
  v_prev    correcciones_venta_tienda%ROWTYPE;
  v_v       ventas_tienda%ROWTYPE;
  v_tr      turnos_caja%ROWTYPE;
  v_dev     JSONB;
  v_reemb   NUMERIC;
  v_estado  TEXT;
  v_id      BIGINT;
  v_res     JSONB;
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION 'corregir_venta_tienda: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_orden_id IS NULL THEN
    RAISE EXCEPTION 'corregir_venta_tienda: operación y venta son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'corregir_venta_tienda: escribe el motivo de la corrección' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MOTIVO_REQUERIDO')::text;
  END IF;
  IF v_medio NOT IN ('efectivo_caja', 'efectivo_administracion', 'electronico') THEN
    RAISE EXCEPTION 'corregir_venta_tienda: medio de reembolso inválido (efectivo_caja, efectivo_administracion o electronico)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_v FROM ventas_tienda WHERE orden_id = p_orden_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'corregir_venta_tienda: esa orden no es una venta de tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NO_ES_VENTA_DE_TIENDA')::text;
  END IF;
  -- Sin partidas = la venta completa.
  IF p_items IS NULL THEN
    SELECT jsonb_agg(jsonb_build_object('sku', l.sku, 'cantidad', l.q) ORDER BY l.sku) INTO v_items
      FROM (SELECT sku, sum(cantidad)::INTEGER AS q FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku HAVING sum(cantidad) > 0) l;
  ELSE
    v_items := p_items;
  END IF;
  v_huella := jsonb_build_object('orden', p_orden_id, 'motivo', v_motivo, 'disposicion', v_disp, 'cuarto', v_cuarto, 'items', v_items,
                                 'medio', v_medio, 'entregado', v_entregado, 'turno', p_turno_reembolso_id)::text;

  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  SELECT * INTO v_prev FROM correcciones_venta_tienda WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella <> v_huella THEN
      RAISE EXCEPTION 'corregir_venta_tienda: esa operación ya se usó con otros datos' USING ERRCODE = '23505', DETAIL = jsonb_build_object('codigo', 'OPERACION_REPETIDA')::text;
    END IF;
    RETURN v_prev.resultado || jsonb_build_object('replay', true);
  END IF;
  IF EXISTS (SELECT 1 FROM correcciones_venta_tienda WHERE orden_id = p_orden_id) THEN
    RAISE EXCEPTION 'corregir_venta_tienda: esa venta ya tiene una corrección (una por venta)' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'YA_CORREGIDA')::text;
  END IF;

  -- Medio del reembolso.
  IF v_medio = 'electronico' THEN
    IF v_v.metodo = 'Efectivo' THEN
      RAISE EXCEPTION 'corregir_venta_tienda: la venta se cobró en efectivo; el reembolso es en efectivo' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'MEDIO_NO_CORRESPONDE')::text;
    END IF;
    IF v_entregado THEN
      RAISE EXCEPTION 'corregir_venta_tienda: una devolución a tarjeta o transferencia se hace fuera del sistema; regístrala y confírmala después con su referencia'
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'REEMBOLSO_EXTERNO_PENDIENTE')::text;
    END IF;
  END IF;
  IF p_turno_reembolso_id IS NOT NULL AND NOT (v_medio = 'efectivo_caja' AND v_entregado) THEN
    RAISE EXCEPTION 'corregir_venta_tienda: el turno solo se indica cuando el efectivo YA salió de una caja' USING ERRCODE = '22023';
  END IF;
  -- Candado del turno ANTES que la orden y los cuartos (orden de candados del POS).
  IF v_medio = 'efectivo_caja' AND v_entregado THEN
    SELECT * INTO v_tr FROM turnos_caja WHERE id = p_turno_reembolso_id FOR UPDATE;
    IF NOT FOUND OR v_tr.estado <> 'abierto' OR v_tr.establecimiento_id <> v_v.establecimiento_id THEN
      RAISE EXCEPTION 'corregir_venta_tienda: el efectivo solo puede salir de un turno ABIERTO de la misma tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_REEMBOLSO_INVALIDO')::text;
    END IF;
  END IF;

  -- Producto: vuelve a un cuarto de la misma tienda o al cuarto del que salió (trazabilidad).
  IF v_disp = 'Reintegrar' THEN
    IF v_cuarto IS NULL AND (SELECT count(DISTINCT a.value ->> 'cuarto_id') FROM jsonb_array_elements(v_v.asignacion) a) = 1 THEN
      v_cuarto := v_v.asignacion -> 0 ->> 'cuarto_id';
    END IF;
    IF v_cuarto IS NULL OR NOT (EXISTS (SELECT 1 FROM jsonb_array_elements(v_v.asignacion) a WHERE a.value ->> 'cuarto_id' = v_cuarto)
                             OR EXISTS (SELECT 1 FROM cuartos_frios cf WHERE cf.id = v_cuarto AND cf.establecimiento_id = v_v.establecimiento_id)) THEN
      RAISE EXCEPTION 'corregir_venta_tienda: el producto vuelve a un congelador de la misma tienda o al cuarto del que salió' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'CUARTO_NO_VALIDO')::text;
    END IF;
  END IF;

  -- Devolución con el contrato de siempre (valida estatus, cantidades, una por orden; mueve kardex y egreso).
  v_dev := registrar_devolucion(p_operacion_id, p_orden_id, v_items, 'Efectivo', v_disp, v_cuarto, v_motivo, 'Corrección de venta de tienda');
  v_reemb := round(COALESCE((v_dev ->> 'reembolso')::NUMERIC, 0), 2);
  v_estado := CASE WHEN v_reemb = 0 THEN 'sin_reembolso' WHEN v_entregado THEN 'ejecutado' ELSE 'registrado' END;

  INSERT INTO correcciones_venta_tienda (operacion_id, orden_id, turno_venta_id, establecimiento_id, devolucion_id, motivo, total_devuelto, reembolso_monto,
                                         reembolso_medio, reembolso_estado, reembolso_turno_id, reembolso_ejecutado_at, reembolso_ejecutado_por, huella, actor_id, actor)
  VALUES (p_operacion_id, p_orden_id, v_v.turno_id, v_v.establecimiento_id, (v_dev ->> 'devolucion_id')::BIGINT, v_motivo, (v_dev ->> 'total')::NUMERIC, v_reemb,
          CASE WHEN v_reemb > 0 THEN v_medio END, v_estado,
          CASE WHEN v_estado = 'ejecutado' AND v_medio = 'efectivo_caja' THEN v_tr.id END,
          CASE WHEN v_estado = 'ejecutado' THEN now() END, CASE WHEN v_estado = 'ejecutado' THEN v_etq END,
          v_huella, erp_usuario_id(), v_etq)
  RETURNING id INTO v_id;

  v_res := jsonb_build_object('correccion_id', v_id, 'orden_id', p_orden_id, 'folio', v_dev ->> 'folio', 'devolucion_id', (v_dev ->> 'devolucion_id')::BIGINT,
                              'total_devuelto', (v_dev ->> 'total')::NUMERIC, 'items', v_dev -> 'items', 'disposicion', v_disp, 'cuarto_id', v_dev ->> 'cuarto_id',
                              'venta', jsonb_build_object('turno_id', v_v.turno_id, 'caja_id', v_v.caja_id, 'metodo', v_v.metodo, 'total', v_v.total, 'asignacion', v_v.asignacion),
                              'reembolso', jsonb_build_object('monto', v_reemb, 'medio', CASE WHEN v_reemb > 0 THEN v_medio END, 'estado', v_estado,
                                 'turno_id', CASE WHEN v_estado = 'ejecutado' AND v_medio = 'efectivo_caja' THEN v_tr.id END,
                                 'dinero_devuelto', v_estado = 'ejecutado',
                                 'pendiente', CASE WHEN v_estado <> 'registrado' THEN NULL
                                                   WHEN v_medio = 'electronico' THEN 'Falta hacer la devolución en la terminal o en el banco y confirmarla aquí con su referencia.'
                                                   ELSE 'Falta entregar el efectivo y confirmarlo aquí.' END),
                              'motivo', v_motivo, 'actor', v_etq, 'replay', false);
  UPDATE correcciones_venta_tienda SET resultado = v_res WHERE id = v_id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Corrección de venta de tienda', 'Tiendas', COALESCE(v_dev ->> 'folio', p_orden_id::text) || ' — devuelto $' || (v_dev ->> 'total')
          || ' — reembolso $' || v_reemb || ' ' || COALESCE(v_medio, '') || ' (' || v_estado || ') — ' || v_motivo);
  RETURN v_res;
END $$;

-- ═══ 13. confirmar_reembolso_tienda (Admin) ═══
CREATE OR REPLACE FUNCTION public.confirmar_reembolso_tienda(p_operacion_id UUID, p_correccion_id BIGINT, p_referencia TEXT DEFAULT NULL,
                                                             p_turno_reembolso_id BIGINT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_etq TEXT := erp_actor_etiqueta();
  v_ref TEXT := NULLIF(btrim(COALESCE(p_referencia, '')), '');
  v_c   correcciones_venta_tienda%ROWTYPE;
  v_tr  turnos_caja%ROWTYPE;
  v_res JSONB;
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_correccion_id IS NULL THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: operación y corrección son obligatorias' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('pos_op:' || p_operacion_id::text));
  -- Candado del turno antes que la corrección (mismo orden que corregir y cerrar).
  IF p_turno_reembolso_id IS NOT NULL THEN
    SELECT * INTO v_tr FROM turnos_caja WHERE id = p_turno_reembolso_id FOR UPDATE;
  END IF;
  SELECT * INTO v_c FROM correcciones_venta_tienda WHERE id = p_correccion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: la corrección no existe' USING ERRCODE = '22023';
  END IF;
  IF v_c.operacion_ejecucion = p_operacion_id THEN
    RETURN (v_c.resultado -> 'reembolso') || jsonb_build_object('correccion_id', v_c.id, 'replay', true);
  END IF;
  IF v_c.reembolso_estado <> 'registrado' THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: ese reembolso no está pendiente (%)', v_c.reembolso_estado USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'REEMBOLSO_NO_PENDIENTE')::text;
  END IF;
  IF v_c.reembolso_medio = 'electronico' AND (v_ref IS NULL OR length(v_ref) < 3) THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: escribe la referencia de la devolución que dio la terminal o el banco' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'REFERENCIA_REQUERIDA')::text;
  END IF;
  IF v_c.reembolso_medio = 'efectivo_caja' THEN
    IF v_tr.id IS NULL OR v_tr.estado <> 'abierto' OR v_tr.establecimiento_id <> v_c.establecimiento_id THEN
      RAISE EXCEPTION 'confirmar_reembolso_tienda: el efectivo solo puede salir de un turno ABIERTO de la misma tienda' USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'TURNO_REEMBOLSO_INVALIDO')::text;
    END IF;
  ELSIF p_turno_reembolso_id IS NOT NULL THEN
    RAISE EXCEPTION 'confirmar_reembolso_tienda: ese reembolso no sale de una caja' USING ERRCODE = '22023';
  END IF;

  v_res := jsonb_build_object('monto', v_c.reembolso_monto, 'medio', v_c.reembolso_medio, 'estado', 'ejecutado', 'dinero_devuelto', true, 'pendiente', NULL,
                              'turno_id', CASE WHEN v_c.reembolso_medio = 'efectivo_caja' THEN v_tr.id END, 'referencia', v_ref, 'confirmado_por', v_etq);
  UPDATE correcciones_venta_tienda
     SET reembolso_estado = 'ejecutado', reembolso_ejecutado_at = now(), reembolso_ejecutado_por = v_etq, reembolso_referencia = v_ref,
         reembolso_turno_id = CASE WHEN reembolso_medio = 'efectivo_caja' THEN v_tr.id END, operacion_ejecucion = p_operacion_id,
         resultado = jsonb_set(resultado, '{reembolso}', v_res)
   WHERE id = v_c.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etq, 'Reembolso de tienda ejecutado', 'Tiendas', 'Corrección ' || v_c.id || ' — $' || v_c.reembolso_monto || ' ' || v_c.reembolso_medio || COALESCE(' — ref ' || v_ref, ''));
  RETURN v_res || jsonb_build_object('correccion_id', v_c.id, 'replay', false);
END $$;

-- ═══ 14. mi_turno_caja (lectura) ═══
-- El cajero no ve los turnos de otros; aquí sí sabe qué cajas de SU tienda están ocupadas.
-- No devuelve cuánto efectivo se espera: el conteo del cierre es a ciegas.
CREATE OR REPLACE FUNCTION public.mi_turno_caja() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid BIGINT := erp_usuario_id();
  v_rol TEXT := erp_rol_activo();
BEGIN
  IF fin_jwt_role() IS DISTINCT FROM 'authenticated' OR v_rol IS NULL OR v_rol NOT IN ('Admin', 'Ventas Tienda') THEN
    RAISE EXCEPTION 'mi_turno_caja: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'tiendas_habilitadas', tiendas_habilitadas(),
    'turno', (SELECT jsonb_build_object('turno_id', t.id, 'caja_id', t.caja_id, 'caja', c.nombre, 'establecimiento_id', t.establecimiento_id,
                                        'abierto_at', t.abierto_at, 'fecha_negocio', t.fecha_negocio, 'fondo_inicial', t.fondo_inicial,
                                        'ventas', (SELECT count(*) FROM ordenes o WHERE o.turno_id = t.id))
                FROM turnos_caja t JOIN cajas c ON c.id = t.caja_id
               WHERE t.cajero_id = v_uid AND t.estado = 'abierto' AND v_rol = 'Ventas Tienda' AND erp_tienda_asignada(t.establecimiento_id, false)),
    'cajas', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', c.id, 'nombre', c.nombre, 'establecimiento_id', c.establecimiento_id, 'activa', c.activa,
                                                          'ocupada', EXISTS (SELECT 1 FROM turnos_caja t WHERE t.caja_id = c.id AND t.estado = 'abierto'))
                                        ORDER BY c.establecimiento_id, c.nombre, c.id)
                         FROM cajas c
                        WHERE v_rol = 'Admin' OR (c.activa AND erp_tienda_asignada(c.establecimiento_id, false))), '[]'::jsonb));
END $$;

REVOKE ALL ON FUNCTION public.guardar_caja(BIGINT, BIGINT, TEXT, BOOLEAN), public.abrir_turno_caja(UUID, BIGINT, NUMERIC),
  public.vender_en_tienda(UUID, BIGINT, JSONB, TEXT, BIGINT, TEXT, BOOLEAN), public.cerrar_turno_caja(UUID, BIGINT, NUMERIC, TEXT, TEXT),
  public.reabrir_turno_caja(UUID, BIGINT, TEXT), public.corregir_venta_tienda(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, BIGINT),
  public.confirmar_reembolso_tienda(UUID, BIGINT, TEXT, BIGINT), public.mi_turno_caja() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_caja(BIGINT, BIGINT, TEXT, BOOLEAN), public.abrir_turno_caja(UUID, BIGINT, NUMERIC),
  public.vender_en_tienda(UUID, BIGINT, JSONB, TEXT, BIGINT, TEXT, BOOLEAN), public.cerrar_turno_caja(UUID, BIGINT, NUMERIC, TEXT, TEXT),
  public.reabrir_turno_caja(UUID, BIGINT, TEXT), public.corregir_venta_tienda(UUID, BIGINT, TEXT, TEXT, TEXT, JSONB, TEXT, BOOLEAN, BIGINT),
  public.confirmar_reembolso_tienda(UUID, BIGINT, TEXT, BIGINT), public.mi_turno_caja() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
