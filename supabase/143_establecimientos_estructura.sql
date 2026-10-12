-- 143_establecimientos_estructura.sql — Tiendas propias, E1: estructura de
-- establecimientos. NO activa nada.
--
-- Diseño cerrado (D-S1 a D-S10, reporte "STORES FINAL DESIGN CLOSURE"): la empresa
-- tendrá tiendas propias con inventario, ventas y caja por establecimiento. E1 solo
-- prepara la estructura; el comportamiento de hoy no cambia.
--
--   1. `establecimientos` — CEDIS, tienda de fábrica o tienda. Nace con UN solo
--      registro: el CEDIS (id 1). No es la tabla `sucursales`, que es de clientes.
--   2. `tiendas_activacion` — el interruptor. Una sola fila, apagada. Mientras esté
--      apagada, la base de datos rechaza cualquier establecimiento que no sea el
--      CEDIS, venga de donde venga (API, contrato o SQL). No hay contrato ni pantalla
--      que lo encienda: lo enciende el dueño con SQL cuando existan la protección del
--      CEDIS, el aislamiento por tienda, el POS y la caja (bloque E6).
--   3. `cuartos_frios.establecimiento_id` — de qué establecimiento es cada cuarto o
--      congelador. Los cuartos existentes quedan en el CEDIS y un cuarto nuevo nace
--      en el CEDIS (así la pantalla actual de Congeladores sigue igual). Por API no
--      se cambia; fuera de la API solo se cambia un cuarto vacío.
--   4. `usuario_establecimientos` — a qué establecimientos pertenece cada usuario.
--      Nace vacía y todavía no la lee ningún permiso (eso es E3).
--   5. `ordenes.establecimiento_id` — opcional y sin valor por omisión: las órdenes
--      existentes y las que se sigan creando quedan sin establecimiento ("Central").
--      Por API no se escribe.
--
-- Lo que NO cambia: ningún contrato (rutas, ventas, pagos, CxC, caja, inventario,
-- kardex, mermas), ningún rol, ninguna policy ni permiso existente, ningún dato.
-- Las tablas nuevas no tienen acceso por API (RLS activa, sin policies, sin grants).
--
-- Idempotente. Reversión (con el interruptor apagado no hay datos de tienda):
--   DROP TRIGGER trg_ordenes_guard_establecimiento ON ordenes; ALTER TABLE ordenes DROP COLUMN establecimiento_id;
--   DROP TRIGGER trg_cuartos_frios_establecimiento ON cuartos_frios; ALTER TABLE cuartos_frios DROP COLUMN establecimiento_id;
--   DROP TABLE usuario_establecimientos, establecimientos, tiendas_activacion;
--   DROP FUNCTION tiendas_habilitadas(), establecimientos_guard(), tiendas_activacion_guard(),
--                 cuartos_frios_guard_establecimiento(), ordenes_guard_establecimiento();

-- ═══ 1. Interruptor de activación de tiendas (apagado) ═══
CREATE TABLE IF NOT EXISTS public.tiendas_activacion (
  id             BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),      -- una sola fila
  habilitada     BOOLEAN NOT NULL DEFAULT false,
  habilitada_at  TIMESTAMPTZ,
  habilitada_por TEXT,
  nota           TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (NOT habilitada OR (habilitada_at IS NOT NULL AND length(btrim(COALESCE(habilitada_por, ''))) > 0))
);
COMMENT ON TABLE public.tiendas_activacion IS
  '143: interruptor de tiendas propias (una fila). Apagado, la base rechaza todo establecimiento que no sea el CEDIS. Sin acceso por API: lo enciende el dueño con SQL (bloque E6), dejando quién y cuándo.';
INSERT INTO public.tiendas_activacion (id, habilitada) VALUES (true, false) ON CONFLICT (id) DO NOTHING;
ALTER TABLE public.tiendas_activacion ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tiendas_activacion FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tiendas_habilitadas() RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE((SELECT t.habilitada FROM tiendas_activacion t WHERE t.id), false)
$$;
REVOKE ALL ON FUNCTION public.tiendas_habilitadas() FROM PUBLIC, anon, authenticated;

-- La fila no se borra ni se duplica, y por API no se toca (además de no tener grants).
CREATE OR REPLACE FUNCTION public.tiendas_activacion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'tiendas_activacion: la activación de tiendas no se cambia por API' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'tiendas_activacion: el interruptor no se elimina' USING ERRCODE = '42501';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.tiendas_activacion_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_tiendas_activacion_guard ON public.tiendas_activacion;
CREATE TRIGGER trg_tiendas_activacion_guard BEFORE UPDATE OR DELETE ON public.tiendas_activacion
  FOR EACH ROW EXECUTE FUNCTION public.tiendas_activacion_guard();

-- ═══ 2. Establecimientos ═══
CREATE TABLE IF NOT EXISTS public.establecimientos (
  id          BIGSERIAL PRIMARY KEY,
  clave       TEXT NOT NULL UNIQUE CHECK (clave = upper(btrim(clave)) AND length(clave) BETWEEN 2 AND 20),
  nombre      TEXT NOT NULL CHECK (length(btrim(nombre)) >= 2),
  tipo        TEXT NOT NULL CHECK (tipo IN ('cedis', 'tienda_fabrica', 'tienda')),
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Un solo CEDIS.
CREATE UNIQUE INDEX IF NOT EXISTS establecimientos_un_cedis ON public.establecimientos ((tipo)) WHERE tipo = 'cedis';
COMMENT ON TABLE public.establecimientos IS
  '143: lugares propios de la empresa (CEDIS, tienda de fábrica, tiendas). El CEDIS es el id 1. NO son clientes ni sucursales de clientes. Sin acceso por API; mientras tiendas_activacion esté apagada solo existe el CEDIS.';
ALTER TABLE public.establecimientos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.establecimientos FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.establecimientos_id_seq FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.establecimientos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'establecimientos: no se escriben por API' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.tipo = 'cedis' THEN
      RAISE EXCEPTION 'establecimientos: el CEDIS no se elimina' USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'establecimientos: el identificador no cambia' USING ERRCODE = '42501';
    END IF;
    IF OLD.tipo = 'cedis' AND (NEW.tipo <> 'cedis' OR NOT NEW.activo) THEN
      RAISE EXCEPTION 'establecimientos: el CEDIS no cambia de tipo ni se desactiva' USING ERRCODE = '42501';
    END IF;
  END IF;
  -- El interruptor: sin activación no existe ningún establecimiento que no sea el CEDIS.
  IF NEW.tipo <> 'cedis' AND NOT tiendas_habilitadas() THEN
    RAISE EXCEPTION 'Las tiendas propias todavía no están activadas: no se puede crear ni modificar "%" (%)', NEW.nombre, NEW.tipo
      USING ERRCODE = '22023', DETAIL = '{"codigo":"TIENDAS_NO_ACTIVADAS"}';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.establecimientos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_establecimientos_guard ON public.establecimientos;
CREATE TRIGGER trg_establecimientos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.establecimientos
  FOR EACH ROW EXECUTE FUNCTION public.establecimientos_guard();

-- El CEDIS: único registro inicial, con id 1 (los cuartos y los contratos futuros lo referencian).
INSERT INTO public.establecimientos (id, clave, nombre, tipo)
SELECT 1, 'CEDIS', 'CEDIS', 'cedis'
 WHERE NOT EXISTS (SELECT 1 FROM public.establecimientos WHERE tipo = 'cedis');
SELECT setval('public.establecimientos_id_seq', GREATEST((SELECT max(id) FROM public.establecimientos), 1), true);
DO $$
BEGIN
  IF (SELECT count(*) FROM public.establecimientos WHERE id = 1 AND tipo = 'cedis') <> 1 THEN
    RAISE EXCEPTION '143: el CEDIS debe ser el establecimiento 1 (revisar antes de continuar)';
  END IF;
END $$;

-- ═══ 3. Cada cuarto frío pertenece a un establecimiento (los actuales, al CEDIS) ═══
-- NOT NULL con valor por omisión 1 (el CEDIS): las filas existentes quedan en el CEDIS y un
-- cuarto nuevo nace en el CEDIS sin que nada tenga que cambiar.
ALTER TABLE public.cuartos_frios ADD COLUMN IF NOT EXISTS establecimiento_id BIGINT NOT NULL DEFAULT 1 REFERENCES public.establecimientos(id);
CREATE INDEX IF NOT EXISTS cuartos_frios_establecimiento ON public.cuartos_frios (establecimiento_id);
COMMENT ON COLUMN public.cuartos_frios.establecimiento_id IS
  '143: establecimiento dueño del cuarto o congelador (1 = CEDIS). No se cambia por API; fuera de la API solo se cambia un cuarto vacío.';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.cuartos_frios WHERE establecimiento_id <> 1) AND NOT public.tiendas_habilitadas() THEN
    RAISE EXCEPTION '143: hay cuartos fuera del CEDIS con las tiendas apagadas (revisar antes de continuar)';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.cuartos_frios_guard_establecimiento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Por API un cuarto nuevo nace en el CEDIS (es lo que hace la pantalla actual, que no manda este dato).
    IF b4_escritura_api() AND NEW.establecimiento_id IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'cuartos_frios: un cuarto nuevo nace en el CEDIS; el establecimiento no se elige por API' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.establecimiento_id IS NOT DISTINCT FROM OLD.establecimiento_id THEN
    RETURN NEW;
  END IF;
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'cuartos_frios: el establecimiento de un cuarto no se cambia por API' USING ERRCODE = '42501';
  END IF;
  -- Cambiar de establecimiento un cuarto con producto movería inventario sin registro.
  IF EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(OLD.stock, '{}'::jsonb)) k WHERE COALESCE(k.value, '0') NOT IN ('0', '0.0')) THEN
    RAISE EXCEPTION 'cuartos_frios: el cuarto % tiene existencia; vacíalo antes de cambiarlo de establecimiento', OLD.id USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cuartos_frios_guard_establecimiento() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cuartos_frios_establecimiento ON public.cuartos_frios;
CREATE TRIGGER trg_cuartos_frios_establecimiento BEFORE INSERT OR UPDATE OF establecimiento_id ON public.cuartos_frios
  FOR EACH ROW EXECUTE FUNCTION public.cuartos_frios_guard_establecimiento();

-- ═══ 4. Usuarios asignados a establecimientos (vacía; todavía no la lee ningún permiso) ═══
CREATE TABLE IF NOT EXISTS public.usuario_establecimientos (
  usuario_id         BIGINT NOT NULL REFERENCES public.usuarios(id) ON DELETE CASCADE,
  establecimiento_id BIGINT NOT NULL REFERENCES public.establecimientos(id),
  asignado_por       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (usuario_id, establecimiento_id)
);
CREATE INDEX IF NOT EXISTS usuario_establecimientos_est ON public.usuario_establecimientos (establecimiento_id);
COMMENT ON TABLE public.usuario_establecimientos IS
  '143: a qué establecimientos pertenece cada usuario. Estructura para los permisos por tienda (E3): hoy está vacía y ningún permiso la consulta. Sin acceso por API.';
ALTER TABLE public.usuario_establecimientos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.usuario_establecimientos FROM PUBLIC, anon, authenticated;

-- ═══ 5. Establecimiento de una orden (opcional; la historia queda sin valor) ═══
ALTER TABLE public.ordenes ADD COLUMN IF NOT EXISTS establecimiento_id BIGINT REFERENCES public.establecimientos(id);
CREATE INDEX IF NOT EXISTS ordenes_establecimiento ON public.ordenes (establecimiento_id) WHERE establecimiento_id IS NOT NULL;
COMMENT ON COLUMN public.ordenes.establecimiento_id IS
  '143: establecimiento que hizo la venta. NULL = venta central (toda la historia anterior a las tiendas, y lo que no nace en un punto de venta de tienda). No se escribe por API.';

CREATE OR REPLACE FUNCTION public.ordenes_guard_establecimiento() RETURNS TRIGGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.establecimiento_id IS NOT NULL THEN
      RAISE EXCEPTION 'ordenes: el establecimiento de una venta no se escribe por API' USING ERRCODE = '42501';
    END IF;
  ELSIF NEW.establecimiento_id IS DISTINCT FROM OLD.establecimiento_id THEN
    RAISE EXCEPTION 'ordenes: el establecimiento de una venta no se cambia por API' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_establecimiento() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_establecimiento ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_establecimiento BEFORE INSERT OR UPDATE OF establecimiento_id ON public.ordenes
  FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_establecimiento();
