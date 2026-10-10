-- 123_multisucursal.sql — MULTISUCURSAL (2026-10-09): un cliente (razón social,
-- RFC, crédito, saldo, CxC, pagos, facturación) con varias sucursales (domicilio,
-- ubicación, contacto, zona de ruta). Aditiva e idempotente; compatible con el
-- frontend anterior (sucursal_id es opcional en todos los contratos).
--
-- Decisiones del dueño (2026-10-09): crédito y saldo por cadena (cliente);
-- precio especial por sucursal, con el precio del cliente como respaldo y el de
-- lista al final; la factura siempre a la razón social del cliente; LEVIN y
-- VENEGAS ya cargados como clientes separados se fusionan en sucursales.
--
--   1. `sucursales`: una fila por punto de entrega. Cada cliente tiene UNA
--      principal (índice único parcial) que nace del domicilio actual del
--      cliente (backfill) y que un disparador mantiene igual a las columnas de
--      dirección de `clientes` (sentido único clientes → principal: el
--      formulario del cliente sigue editando la principal; las demás van por
--      contrato). Sin DML REST: solo lectura (erp_lector_negocio) y el contrato
--      `guardar_sucursal` (Admin / Ventas, también por acceso adicional).
--   2. `ordenes.sucursal_id` (debe pertenecer al cliente de la orden; inmutable
--      por REST: solo los contratos). `crear_orden` y `update_orden_atomic` la
--      aceptan; sin ella, con cliente, usan la principal. La dirección y las
--      coordenadas de la sucursal se COPIAN a la orden cuando el payload no trae
--      dirección propia (historia: la orden conserva dónde se entregó aunque la
--      sucursal cambie después).
--   3. `precios_esp.sucursal_id` (NULL = precio del cliente). Unicidad: una fila
--      por (cliente, sku) sin sucursal y una por (sucursal, sku).
--      `precio_canonico(cliente, sucursal, sku)`: sucursal → cliente → lista.
--      Las firmas de dos argumentos (088) siguen existiendo y equivalen a
--      "sin sucursal" (el cierre de ruta 112 y la venta exprés no cambian).
--   4. `fusionar_cliente_en_sucursal(origen, destino, nombre)` (Admin): la
--      principal del origen pasa a ser una sucursal del destino; sus órdenes,
--      CxC, pagos, devoluciones, comodatos y precios se REAPUNTAN (no se
--      reescriben montos ni fechas; `cliente_nombre` de la orden se conserva
--      como foto histórica); el saldo del origen se suma al destino; el origen
--      queda Inactivo con `clientes.fusionado_en`. Reintento = misma respuesta.
--      RFC: solo si ambos son genéricos o iguales. `rutas.clientes_asignados`
--      (solo cuenta clientes) no se reescribe.
--
-- Nota: en producción se aplicó el 2026-10-09 (~23:51Z) con el nombre de archivo 122_multisucursal.sql
-- (el número 122 quedó para 122_zona_negocio_durango.sql); el contenido es este.
--
-- Reversión (sin órdenes con sucursal ni fusiones): DROP de los disparadores,
-- contratos y columnas de 123 y volver `precio_canonico`/`lineas_canonicas`,
-- `crear_orden` y `update_orden_atomic` a 088. Con historia: no borrar.

-- ═══ 1. Tabla de sucursales ═══
CREATE TABLE IF NOT EXISTS public.sucursales (
  id                BIGSERIAL PRIMARY KEY,
  cliente_id        BIGINT NOT NULL REFERENCES public.clientes(id),
  nombre            TEXT NOT NULL,
  es_principal      BOOLEAN NOT NULL DEFAULT false,
  calle             TEXT,
  numero_exterior   TEXT,
  numero_interior   TEXT,
  colonia           TEXT,
  ciudad            TEXT,
  estado            TEXT,
  codigo_postal     TEXT,
  latitud           NUMERIC(10, 7),
  longitud          NUMERIC(10, 7),
  zona              TEXT,
  contacto          TEXT,
  telefono          TEXT,
  referencia        TEXT,
  estatus           TEXT NOT NULL DEFAULT 'Activa' CHECK (estatus IN ('Activa', 'Inactiva')),
  origen_cliente_id BIGINT REFERENCES public.clientes(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT sucursales_nombre_no_vacio CHECK (btrim(nombre) <> '')
);
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_cliente_nombre_key ON public.sucursales (cliente_id, lower(btrim(nombre)));
CREATE UNIQUE INDEX IF NOT EXISTS sucursales_principal_key ON public.sucursales (cliente_id) WHERE es_principal;
CREATE INDEX IF NOT EXISTS sucursales_cliente_idx ON public.sucursales (cliente_id);
ALTER TABLE public.sucursales ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sucursales FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.sucursales TO authenticated;
REVOKE ALL ON SEQUENCE public.sucursales_id_seq FROM PUBLIC, anon, authenticated;
DROP POLICY IF EXISTS read_all ON public.sucursales;
CREATE POLICY read_all ON public.sucursales FOR SELECT TO authenticated USING (erp_lector_negocio());
DROP TRIGGER IF EXISTS trg_sucursales_upd ON public.sucursales;
CREATE TRIGGER trg_sucursales_upd BEFORE UPDATE ON public.sucursales FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE public.clientes ADD COLUMN IF NOT EXISTS fusionado_en BIGINT REFERENCES public.clientes(id);
ALTER TABLE public.ordenes ADD COLUMN IF NOT EXISTS sucursal_id BIGINT REFERENCES public.sucursales(id);
CREATE INDEX IF NOT EXISTS idx_ordenes_sucursal ON public.ordenes (sucursal_id) WHERE sucursal_id IS NOT NULL;
ALTER TABLE public.precios_esp ADD COLUMN IF NOT EXISTS sucursal_id BIGINT REFERENCES public.sucursales(id) ON DELETE CASCADE;

-- Unicidad del precio especial: por cliente (sin sucursal) y por sucursal.
ALTER TABLE public.precios_esp DROP CONSTRAINT IF EXISTS precios_esp_cliente_sku_key;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'precios_esp_cliente_id_sku_key' AND conrelid = 'public.precios_esp'::regclass) THEN
    ALTER TABLE public.precios_esp DROP CONSTRAINT precios_esp_cliente_id_sku_key;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS precios_esp_cliente_sku_key ON public.precios_esp (cliente_id, sku) WHERE sucursal_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS precios_esp_sucursal_sku_key ON public.precios_esp (sucursal_id, sku) WHERE sucursal_id IS NOT NULL;

-- Texto de la dirección (mismo formato que formatDireccion del frontend).
CREATE OR REPLACE FUNCTION public.sucursal_direccion_texto(s public.sucursales) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(array_to_string(ARRAY[
    NULLIF(concat_ws(' ', NULLIF(btrim(COALESCE(s.calle, '')), ''), NULLIF(btrim(COALESCE(s.numero_exterior, '')), '')), ''),
    CASE WHEN NULLIF(btrim(COALESCE(s.numero_interior, '')), '') IS NOT NULL THEN 'Int. ' || btrim(s.numero_interior) END,
    NULLIF(btrim(COALESCE(s.colonia, '')), ''),
    NULLIF(btrim(COALESCE(s.ciudad, '')), ''),
    NULLIF(btrim(COALESCE(s.estado, '')), ''),
    CASE WHEN NULLIF(btrim(COALESCE(s.codigo_postal, '')), '') IS NOT NULL THEN 'C.P. ' || btrim(s.codigo_postal) END
  ], ', '), '')
$$;
-- (REVOKE añadido tras el gate local; en producción ya era así por los privilegios por defecto de postgres — no-op)
REVOKE ALL ON FUNCTION public.sucursal_direccion_texto(public.sucursales) FROM PUBLIC, anon, authenticated;

-- ¿La sucursal tiene domicilio capturado? (sin calle ni colonia, no se copia nada a la orden)
CREATE OR REPLACE FUNCTION public.sucursal_con_domicilio(s public.sucursales) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(btrim(COALESCE(s.calle, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(s.colonia, '')), '') IS NOT NULL
$$;
REVOKE ALL ON FUNCTION public.sucursal_con_domicilio(public.sucursales) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Principal = domicilio del cliente (backfill y sincronía clientes → principal) ═══
CREATE OR REPLACE FUNCTION public.clientes_sync_sucursal_principal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_cp TEXT; v_con_dom BOOLEAN;
BEGIN
  -- Un cliente fusionado ya no tiene principal propia (su domicilio es una sucursal del destino).
  IF NEW.fusionado_en IS NOT NULL THEN RETURN NEW; END IF;
  v_con_dom := NULLIF(btrim(COALESCE(NEW.calle, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(NEW.colonia, '')), '') IS NOT NULL;
  v_cp := CASE WHEN v_con_dom THEN COALESCE(NULLIF(btrim(COALESCE(NEW.codigo_postal, '')), ''), NULLIF(btrim(COALESCE(NEW.cp, '')), '')) END;
  INSERT INTO sucursales (cliente_id, nombre, es_principal, calle, numero_exterior, numero_interior, colonia, ciudad, estado,
                          codigo_postal, latitud, longitud, zona, contacto)
  VALUES (NEW.id, 'Principal', true, NEW.calle, NEW.numero_exterior, NEW.numero_interior, NEW.colonia,
          CASE WHEN v_con_dom THEN NEW.ciudad END, CASE WHEN v_con_dom THEN NEW.estado END,
          v_cp, NEW.latitud, NEW.longitud, NEW.zona, NEW.contacto)
  ON CONFLICT (cliente_id) WHERE es_principal DO UPDATE SET
    calle = EXCLUDED.calle, numero_exterior = EXCLUDED.numero_exterior, numero_interior = EXCLUDED.numero_interior,
    colonia = EXCLUDED.colonia, ciudad = EXCLUDED.ciudad, estado = EXCLUDED.estado, codigo_postal = EXCLUDED.codigo_postal,
    latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, zona = EXCLUDED.zona, contacto = EXCLUDED.contacto;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.clientes_sync_sucursal_principal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_clientes_sync_sucursal ON public.clientes;
CREATE TRIGGER trg_clientes_sync_sucursal AFTER INSERT OR UPDATE OF calle, numero_exterior, numero_interior, colonia, ciudad, estado,
  codigo_postal, cp, latitud, longitud, zona, contacto ON public.clientes
  FOR EACH ROW EXECUTE FUNCTION public.clientes_sync_sucursal_principal();

-- Backfill: toda fila de clientes sin principal recibe una (un cliente ya fusionado no).
INSERT INTO public.sucursales (cliente_id, nombre, es_principal, calle, numero_exterior, numero_interior, colonia, ciudad, estado,
                               codigo_postal, latitud, longitud, zona, contacto)
SELECT c.id, 'Principal', true, c.calle, c.numero_exterior, c.numero_interior, c.colonia,
       CASE WHEN d.con THEN c.ciudad END, CASE WHEN d.con THEN c.estado END,
       CASE WHEN d.con THEN COALESCE(NULLIF(btrim(COALESCE(c.codigo_postal, '')), ''), NULLIF(btrim(COALESCE(c.cp, '')), '')) END,
       c.latitud, c.longitud, c.zona, c.contacto
  FROM public.clientes c
  CROSS JOIN LATERAL (SELECT NULLIF(btrim(COALESCE(c.calle, '')), '') IS NOT NULL OR NULLIF(btrim(COALESCE(c.colonia, '')), '') IS NOT NULL AS con) d
 WHERE c.fusionado_en IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.sucursales s WHERE s.cliente_id = c.id AND s.es_principal);

-- ═══ 3. Guardas ═══
-- sucursales: cliente_id inmutable y la principal no se desactiva (salvo contrato / SQL de confianza).
CREATE OR REPLACE FUNCTION public.sucursales_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo() THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.cliente_id IS DISTINCT FROM OLD.cliente_id THEN
    RAISE EXCEPTION 'sucursales: la sucursal no cambia de cliente (usa fusionar_cliente_en_sucursal)' USING ERRCODE = '42501';
  END IF;
  IF NEW.es_principal AND NEW.estatus <> 'Activa' THEN
    RAISE EXCEPTION 'sucursales: la sucursal principal no se desactiva' USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.sucursales_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_sucursales_guard ON public.sucursales;
CREATE TRIGGER trg_sucursales_guard BEFORE INSERT OR UPDATE ON public.sucursales FOR EACH ROW EXECUTE FUNCTION public.sucursales_guard();

-- ordenes: la sucursal pertenece al cliente; por REST no se cambia.
CREATE OR REPLACE FUNCTION public.ordenes_guard_sucursal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_jwt TEXT := fin_jwt_role();
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
     AND NOT (v_jwt IS NULL OR v_jwt = 'service_role' OR fin_ctx_activo()) THEN
    RAISE EXCEPTION 'ordenes: la sucursal solo la cambia el contrato de edición' USING ERRCODE = '42501';
  END IF;
  IF NEW.sucursal_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.sucursal_id IS DISTINCT FROM OLD.sucursal_id
                                      OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id)
     AND NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.id = NEW.sucursal_id AND s.cliente_id = NEW.cliente_id) THEN
    RAISE EXCEPTION 'ordenes: la sucursal % no pertenece al cliente %', NEW.sucursal_id, NEW.cliente_id USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.ordenes_guard_sucursal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_ordenes_guard_sucursal ON public.ordenes;
CREATE TRIGGER trg_ordenes_guard_sucursal BEFORE INSERT OR UPDATE ON public.ordenes FOR EACH ROW EXECUTE FUNCTION public.ordenes_guard_sucursal();

-- precios_esp: la sucursal pertenece al cliente del precio.
CREATE OR REPLACE FUNCTION public.precios_esp_guard_sucursal() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.sucursal_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM sucursales s WHERE s.id = NEW.sucursal_id AND s.cliente_id = NEW.cliente_id) THEN
    RAISE EXCEPTION 'precios_esp: la sucursal % no pertenece al cliente %', NEW.sucursal_id, NEW.cliente_id USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.precios_esp_guard_sucursal() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_precios_esp_guard_sucursal ON public.precios_esp;
CREATE TRIGGER trg_precios_esp_guard_sucursal BEFORE INSERT OR UPDATE ON public.precios_esp FOR EACH ROW EXECUTE FUNCTION public.precios_esp_guard_sucursal();

-- ═══ 4. Precio canónico: sucursal → cliente → lista ═══
CREATE OR REPLACE FUNCTION public.precio_canonico(p_cliente_id BIGINT, p_sucursal_id BIGINT, p_sku TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT round(COALESCE(
           (SELECT e.precio FROM precios_esp e WHERE p_sucursal_id IS NOT NULL AND e.sucursal_id = p_sucursal_id AND e.sku = p.sku),
           (SELECT e.precio FROM precios_esp e WHERE e.cliente_id = p_cliente_id AND e.sucursal_id IS NULL AND e.sku = p.sku),
           p.precio, 0), 2)
    FROM productos p WHERE p.sku = btrim(COALESCE(p_sku, ''))
$$;
REVOKE ALL ON FUNCTION public.precio_canonico(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- Firma de 088: sin sucursal.
CREATE OR REPLACE FUNCTION public.precio_canonico(p_cliente_id BIGINT, p_sku TEXT) RETURNS NUMERIC
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT precio_canonico(p_cliente_id, NULL::BIGINT, p_sku)
$$;
REVOKE ALL ON FUNCTION public.precio_canonico(BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lineas_canonicas(p_cliente_id BIGINT, p_sucursal_id BIGINT, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_i      JSONB;
  v_sku    TEXT;
  v_raw    TEXT;
  v_q      INTEGER;
  v_p      NUMERIC;
  v_sub    NUMERIC;
  v_total  NUMERIC := 0;
  v_lineas JSONB := '[]'::jsonb;
  v_vistos TEXT[] := ARRAY[]::TEXT[];
  v_txt    TEXT[] := ARRAY[]::TEXT[];
BEGIN
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'venta: la venta no tiene productos' USING ERRCODE = '22023';
  END IF;
  FOR v_i IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_sku := btrim(COALESCE(v_i ->> 'sku', ''));
    IF v_sku = '' THEN
      RAISE EXCEPTION 'venta: SKU requerido' USING ERRCODE = '22023';
    END IF;
    v_raw := btrim(COALESCE(v_i ->> 'cantidad', ''));
    IF v_raw !~ '^[0-9]+(\.0+)?$' OR v_raw::NUMERIC <= 0 OR v_raw::NUMERIC > 1000000 THEN
      RAISE EXCEPTION 'venta: cantidad inválida para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_q := v_raw::NUMERIC::INTEGER;
    IF v_sku = ANY (v_vistos) THEN
      RAISE EXCEPTION 'venta: SKU repetido en la venta: %', v_sku USING ERRCODE = '22023';
    END IF;
    v_p := precio_canonico(p_cliente_id, p_sucursal_id, v_sku);
    IF v_p IS NULL THEN
      RAISE EXCEPTION 'venta: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
    END IF;
    IF v_p < 0 THEN
      RAISE EXCEPTION 'venta: precio inválido para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_sub := round(v_q * v_p, 2);
    v_total := v_total + v_sub;
    v_vistos := v_vistos || v_sku;
    v_txt := v_txt || (v_q || '×' || v_sku);
    v_lineas := v_lineas || jsonb_build_object('sku', v_sku, 'cantidad', v_q, 'precio_unit', v_p, 'subtotal', v_sub);
  END LOOP;
  v_total := round(v_total, 2);
  IF v_total <= 0 THEN
    RAISE EXCEPTION 'venta: el total de la orden debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object('lineas', v_lineas, 'total', v_total, 'productos', array_to_string(v_txt, ', '));
END $$;
REVOKE ALL ON FUNCTION public.lineas_canonicas(BIGINT, BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.lineas_canonicas(p_cliente_id BIGINT, p_items JSONB) RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT lineas_canonicas(p_cliente_id, NULL::BIGINT, p_items)
$$;
REVOKE ALL ON FUNCTION public.lineas_canonicas(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

-- Resuelve la sucursal de una orden: la pedida (del cliente y activa) o la principal.
CREATE OR REPLACE FUNCTION public.sucursal_para_orden(p_cliente_id BIGINT, p_sucursal_id BIGINT, p_contrato TEXT) RETURNS BIGINT
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_s sucursales%ROWTYPE;
BEGIN
  IF p_cliente_id IS NULL THEN
    IF p_sucursal_id IS NOT NULL THEN
      RAISE EXCEPTION '%: una sucursal requiere cliente', p_contrato USING ERRCODE = '22023';
    END IF;
    RETURN NULL;
  END IF;
  IF p_sucursal_id IS NOT NULL THEN
    SELECT * INTO v_s FROM sucursales WHERE id = p_sucursal_id;
    IF NOT FOUND OR v_s.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION '%: la sucursal % no pertenece al cliente %', p_contrato, p_sucursal_id, p_cliente_id USING ERRCODE = '22023';
    END IF;
    IF v_s.estatus <> 'Activa' THEN
      RAISE EXCEPTION '%: la sucursal "%" está inactiva', p_contrato, v_s.nombre USING ERRCODE = '22023';
    END IF;
    RETURN v_s.id;
  END IF;
  RETURN (SELECT id FROM sucursales WHERE cliente_id = p_cliente_id AND es_principal);
END $$;
REVOKE ALL ON FUNCTION public.sucursal_para_orden(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon, authenticated;

-- ═══ 5. crear_orden con sucursal (088 + sucursal y dirección copiada) ═══
CREATE OR REPLACE FUNCTION public.crear_orden(p_orden JSONB, p_items JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cli_id   BIGINT;
  v_cli      RECORD;
  v_suc_id   BIGINT;
  v_suc      sucursales%ROWTYPE;
  v_nombre   TEXT;
  v_tipo     TEXT;
  v_metodo   TEXT;
  v_fecha    DATE;
  v_folio    TEXT;
  v_seq      TEXT;
  v_total    NUMERIC;
  v_lin      JSONB;
  v_l        JSONB;
  v_disp     INTEGER;
  v_dir      TEXT;
  v_lat      NUMERIC;
  v_lng      NUMERIC;
  v_ord      ordenes%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'crear_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden IS NULL OR jsonb_typeof(p_orden) <> 'object' THEN
    RAISE EXCEPTION 'crear_orden: datos de la orden requeridos' USING ERRCODE = '22023';
  END IF;

  v_cli_id := NULLIF(p_orden ->> 'cliente_id', '')::BIGINT;
  IF v_cli_id IS NOT NULL THEN
    -- Candado del cliente: una fusión en curso espera a esta venta (o esta venta ve al cliente ya fusionado).
    SELECT id, nombre, fusionado_en INTO v_cli FROM clientes WHERE id = v_cli_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'crear_orden: cliente no encontrado: %', v_cli_id USING ERRCODE = '22023';
    END IF;
    IF v_cli.fusionado_en IS NOT NULL THEN
      RAISE EXCEPTION 'crear_orden: el cliente % fue fusionado como sucursal del cliente %; vende al cliente destino', v_cli_id, v_cli.fusionado_en USING ERRCODE = '22023';
    END IF;
    v_nombre := v_cli.nombre;
  ELSE
    v_nombre := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'cliente_nombre', '')), ''), 'Público en general');
  END IF;
  v_suc_id := sucursal_para_orden(v_cli_id, NULLIF(p_orden ->> 'sucursal_id', '')::BIGINT, 'crear_orden');

  v_tipo := COALESCE(NULLIF(p_orden ->> 'tipo_cobro', ''), 'Contado');
  IF v_tipo NOT IN ('Contado', 'Credito') THEN
    RAISE EXCEPTION 'crear_orden: tipo de cobro inválido: %', v_tipo USING ERRCODE = '22023';
  END IF;
  v_metodo := COALESCE(NULLIF(btrim(COALESCE(p_orden ->> 'metodo_pago', '')), ''), 'Efectivo');
  IF v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
    RAISE EXCEPTION 'crear_orden: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
  END IF;
  v_fecha := COALESCE(NULLIF(p_orden ->> 'fecha', '')::DATE, fin_hoy());
  v_dir := NULLIF(btrim(COALESCE(p_orden ->> 'direccion_entrega', '')), '');
  v_lat := NULLIF(p_orden ->> 'latitud_entrega', '')::NUMERIC;
  v_lng := NULLIF(p_orden ->> 'longitud_entrega', '')::NUMERIC;
  -- Sin dirección propia: se copia la de la sucursal (texto y coordenadas).
  IF v_dir IS NULL AND v_suc_id IS NOT NULL THEN
    SELECT * INTO v_suc FROM sucursales WHERE id = v_suc_id;
    IF sucursal_con_domicilio(v_suc) THEN
      v_dir := sucursal_direccion_texto(v_suc);
      IF v_lat IS NULL OR v_lng IS NULL THEN
        v_lat := v_suc.latitud; v_lng := v_suc.longitud;
      END IF;
    END IF;
  END IF;

  -- Líneas y total del servidor (precio canónico: sucursal → cliente → lista).
  v_lin := lineas_canonicas(v_cli_id, v_suc_id, p_items);
  v_total := (v_lin ->> 'total')::NUMERIC;

  -- Disponibilidad (misma regla que el cliente: suma de cuartos fríos).
  FOR v_l IN SELECT * FROM jsonb_array_elements(v_lin -> 'lineas') LOOP
    SELECT COALESCE(SUM(COALESCE((stock ->> (v_l ->> 'sku'))::INTEGER, 0)), 0) INTO v_disp FROM cuartos_frios;
    IF (v_l ->> 'cantidad')::INTEGER > v_disp THEN
      RAISE EXCEPTION 'Stock insuficiente para % (disponible: %, pedido: %)', v_l ->> 'sku', v_disp, v_l ->> 'cantidad' USING ERRCODE = '22023';
    END IF;
  END LOOP;

  -- Crédito: por cadena (cliente); misma ecuación y mismo candado que la venta exprés.
  IF v_tipo = 'Credito' AND v_cli_id IS NOT NULL THEN
    PERFORM fin_validar_credito(v_cli_id, v_total);
  END IF;

  -- Folio: misma semántica que el frontend (OV- + padStart(4, '0')).
  v_seq := pg_catalog.nextval('folio_ov_seq'::regclass)::TEXT;
  v_folio := 'OV-' || lpad(v_seq, greatest(4, length(v_seq)), '0');

  INSERT INTO ordenes (folio, cliente_id, sucursal_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, vendedor_id, tipo_cobro,
                       requiere_factura, folio_nota, direccion_entrega, referencia_entrega, latitud_entrega, longitud_entrega)
  VALUES (v_folio, v_cli_id, v_suc_id, v_nombre, v_lin ->> 'productos', v_fecha, v_total, 'Creada', v_metodo, fin_actor_id(NULL), v_tipo,
          COALESCE((p_orden ->> 'requiere_factura')::BOOLEAN, false),
          NULLIF(btrim(COALESCE(p_orden ->> 'folio_nota', '')), ''),
          v_dir,
          NULLIF(btrim(COALESCE(p_orden ->> 'referencia_entrega', '')), ''),
          v_lat, v_lng)
  RETURNING * INTO v_ord;

  INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
  SELECT v_ord.id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
    FROM jsonb_array_elements(v_lin -> 'lineas') l;

  RETURN jsonb_build_object('id', v_ord.id, 'folio', v_ord.folio, 'cliente_id', v_ord.cliente_id, 'sucursal_id', v_ord.sucursal_id,
    'cliente_nombre', v_ord.cliente_nombre,
    'productos', v_ord.productos, 'total', v_ord.total, 'estatus', v_ord.estatus, 'fecha', v_ord.fecha, 'metodo_pago', v_ord.metodo_pago,
    'tipo_cobro', v_ord.tipo_cobro, 'requiere_factura', v_ord.requiere_factura, 'direccion_entrega', v_ord.direccion_entrega,
    'referencia_entrega', v_ord.referencia_entrega, 'latitud_entrega', v_ord.latitud_entrega, 'longitud_entrega', v_ord.longitud_entrega,
    'vendedor_id', v_ord.vendedor_id, 'lineas', v_lin -> 'lineas');
END $$;
REVOKE ALL ON FUNCTION public.crear_orden(JSONB, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_orden(JSONB, JSONB) TO authenticated, service_role;

-- ═══ 6. update_orden_atomic con sucursal (088 + sucursal) ═══
CREATE OR REPLACE FUNCTION public.update_orden_atomic(p_orden_id BIGINT, p_update_fields JSONB, p_lineas JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_estatus TEXT;
  v_cli     BIGINT;
  v_suc     BIGINT;
  v_suc_row sucursales%ROWTYPE;
  v_items   JSONB;
  v_lin     JSONB;
  v_n       INTEGER := 0;
  v_cambia_suc BOOLEAN := false;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'update_orden_atomic: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();

  SELECT estatus INTO v_estatus FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Orden % no existe', p_orden_id; END IF;
  IF v_estatus <> 'Creada' THEN
    RAISE EXCEPTION 'Solo se pueden editar órdenes en estatus Creada (actual: %)', v_estatus;
  END IF;

  -- Campos no financieros. total y productos del cliente se ignoran (088):
  -- los deriva el servidor de las líneas.
  IF p_update_fields IS NOT NULL AND jsonb_typeof(p_update_fields) = 'object' THEN
    IF NULLIF(p_update_fields ->> 'cliente_id', '') IS NOT NULL THEN
      PERFORM 1 FROM clientes WHERE id = (p_update_fields ->> 'cliente_id')::BIGINT FOR UPDATE;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'update_orden_atomic: cliente no encontrado' USING ERRCODE = '22023';
      END IF;
      IF EXISTS (SELECT 1 FROM clientes WHERE id = (p_update_fields ->> 'cliente_id')::BIGINT AND fusionado_en IS NOT NULL) THEN
        RAISE EXCEPTION 'update_orden_atomic: el cliente fue fusionado como sucursal de otro; usa el cliente destino' USING ERRCODE = '22023';
      END IF;
    END IF;
    UPDATE ordenes SET
      cliente_nombre     = COALESCE(p_update_fields ->> 'cliente_nombre', cliente_nombre),
      cliente_id         = COALESCE((p_update_fields ->> 'cliente_id')::BIGINT, cliente_id),
      fecha              = COALESCE((p_update_fields ->> 'fecha')::DATE, fecha),
      tipo_cobro         = COALESCE(p_update_fields ->> 'tipo_cobro', tipo_cobro),
      folio_nota         = CASE WHEN p_update_fields ? 'folio_nota' THEN p_update_fields ->> 'folio_nota' ELSE folio_nota END,
      direccion_entrega  = CASE WHEN p_update_fields ? 'direccion_entrega' THEN p_update_fields ->> 'direccion_entrega' ELSE direccion_entrega END,
      referencia_entrega = CASE WHEN p_update_fields ? 'referencia_entrega' THEN p_update_fields ->> 'referencia_entrega' ELSE referencia_entrega END,
      latitud_entrega    = CASE WHEN p_update_fields ? 'latitud_entrega' THEN NULLIF(p_update_fields ->> 'latitud_entrega', '')::NUMERIC ELSE latitud_entrega END,
      longitud_entrega   = CASE WHEN p_update_fields ? 'longitud_entrega' THEN NULLIF(p_update_fields ->> 'longitud_entrega', '')::NUMERIC ELSE longitud_entrega END,
      updated_at         = NOW()
    WHERE id = p_orden_id;

    -- Sucursal (122): la pedida, o la principal si cambió el cliente y no se pidió otra.
    IF p_update_fields ? 'sucursal_id' OR p_update_fields ? 'cliente_id' THEN
      SELECT cliente_id INTO v_cli FROM ordenes WHERE id = p_orden_id;
      v_suc := sucursal_para_orden(v_cli,
                 CASE WHEN p_update_fields ? 'sucursal_id' THEN NULLIF(p_update_fields ->> 'sucursal_id', '')::BIGINT
                      ELSE NULL END, 'update_orden_atomic');
      UPDATE ordenes SET sucursal_id = v_suc WHERE id = p_orden_id AND sucursal_id IS DISTINCT FROM v_suc;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      v_cambia_suc := v_n > 0;
      v_n := 0;
      -- Cambió la sucursal y no vino dirección propia: se copia la de la sucursal nueva.
      IF v_cambia_suc AND v_suc IS NOT NULL AND NOT (p_update_fields ? 'direccion_entrega') THEN
        SELECT * INTO v_suc_row FROM sucursales WHERE id = v_suc;
        UPDATE ordenes SET
          direccion_entrega = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN sucursal_direccion_texto(v_suc_row) ELSE NULL END,
          latitud_entrega   = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN v_suc_row.latitud ELSE NULL END,
          longitud_entrega  = CASE WHEN sucursal_con_domicilio(v_suc_row) THEN v_suc_row.longitud ELSE NULL END
        WHERE id = p_orden_id;
      END IF;
    END IF;
  END IF;

  SELECT cliente_id, sucursal_id INTO v_cli, v_suc FROM ordenes WHERE id = p_orden_id;
  IF p_lineas IS NOT NULL AND jsonb_typeof(p_lineas) = 'array' THEN
    SELECT jsonb_agg(jsonb_build_object('sku', e ->> 'sku', 'cantidad', e -> 'cantidad')) INTO v_items FROM jsonb_array_elements(p_lineas) e;
    IF v_items IS NULL THEN v_items := '[]'::jsonb; END IF;
  ELSE
    SELECT jsonb_agg(jsonb_build_object('sku', sku, 'cantidad', cantidad) ORDER BY id) INTO v_items FROM orden_lineas WHERE orden_id = p_orden_id;
  END IF;

  IF v_items IS NOT NULL THEN
    v_lin := lineas_canonicas(v_cli, v_suc, v_items);
    DELETE FROM orden_lineas WHERE orden_id = p_orden_id;
    INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
    SELECT p_orden_id, l ->> 'sku', (l ->> 'cantidad')::INTEGER, (l ->> 'precio_unit')::NUMERIC, (l ->> 'subtotal')::NUMERIC
      FROM jsonb_array_elements(v_lin -> 'lineas') l;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    UPDATE ordenes SET total = (v_lin ->> 'total')::NUMERIC, productos = v_lin ->> 'productos', updated_at = NOW() WHERE id = p_orden_id;
  END IF;

  RETURN jsonb_build_object('success', true, 'orden_id', p_orden_id, 'sucursal_id', v_suc, 'lineas_insertadas', v_n, 'total', (v_lin ->> 'total')::NUMERIC);
END $$;

-- ═══ 7. Contrato: guardar sucursal (Admin / Ventas) ═══
CREATE OR REPLACE FUNCTION public.guardar_sucursal(p_id BIGINT, p_cliente_id BIGINT, p_datos JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_s       sucursales%ROWTYPE;
  v_nombre  TEXT;
  v_estatus TEXT;
  v_lat     NUMERIC;
  v_lng     NUMERIC;
  v_accion  TEXT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas']) THEN
    RAISE EXCEPTION 'guardar_sucursal: no autorizado' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'guardar_sucursal: datos requeridos' USING ERRCODE = '22023';
  END IF;
  IF p_cliente_id IS NULL OR NOT EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id) THEN
    RAISE EXCEPTION 'guardar_sucursal: cliente no encontrado' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM clientes WHERE id = p_cliente_id AND fusionado_en IS NOT NULL) THEN
    RAISE EXCEPTION 'guardar_sucursal: el cliente fue fusionado en otro; captura la sucursal en el cliente destino' USING ERRCODE = '22023';
  END IF;
  v_nombre := NULLIF(btrim(COALESCE(p_datos ->> 'nombre', '')), '');
  v_estatus := COALESCE(NULLIF(btrim(COALESCE(p_datos ->> 'estatus', '')), ''), 'Activa');
  IF v_estatus NOT IN ('Activa', 'Inactiva') THEN
    RAISE EXCEPTION 'guardar_sucursal: estatus inválido' USING ERRCODE = '22023';
  END IF;
  v_lat := NULLIF(p_datos ->> 'latitud', '')::NUMERIC;
  v_lng := NULLIF(p_datos ->> 'longitud', '')::NUMERIC;
  IF (v_lat IS NULL) <> (v_lng IS NULL) OR v_lat NOT BETWEEN -90 AND 90 OR v_lng NOT BETWEEN -180 AND 180 THEN
    RAISE EXCEPTION 'guardar_sucursal: coordenadas inválidas' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NULL THEN
    IF v_nombre IS NULL THEN
      RAISE EXCEPTION 'guardar_sucursal: el nombre de la sucursal es obligatorio' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = p_cliente_id AND lower(btrim(nombre)) = lower(v_nombre)) THEN
      RAISE EXCEPTION 'guardar_sucursal: el cliente ya tiene una sucursal llamada "%"', v_nombre USING ERRCODE = '23505';
    END IF;
    INSERT INTO sucursales (cliente_id, nombre, es_principal, calle, numero_exterior, numero_interior, colonia, ciudad, estado, codigo_postal,
                            latitud, longitud, zona, contacto, telefono, referencia, estatus)
    VALUES (p_cliente_id, v_nombre, false,
            NULLIF(btrim(COALESCE(p_datos ->> 'calle', '')), ''), NULLIF(btrim(COALESCE(p_datos ->> 'numero_exterior', '')), ''),
            NULLIF(btrim(COALESCE(p_datos ->> 'numero_interior', '')), ''), NULLIF(btrim(COALESCE(p_datos ->> 'colonia', '')), ''),
            NULLIF(btrim(COALESCE(p_datos ->> 'ciudad', '')), ''), NULLIF(btrim(COALESCE(p_datos ->> 'estado', '')), ''),
            NULLIF(btrim(COALESCE(p_datos ->> 'codigo_postal', '')), ''), v_lat, v_lng,
            NULLIF(btrim(COALESCE(p_datos ->> 'zona', '')), ''), NULLIF(btrim(COALESCE(p_datos ->> 'contacto', '')), ''),
            NULLIF(btrim(COALESCE(p_datos ->> 'telefono', '')), ''), NULLIF(btrim(COALESCE(p_datos ->> 'referencia', '')), ''), v_estatus)
    RETURNING * INTO v_s;
    v_accion := 'Crear sucursal';
  ELSE
    SELECT * INTO v_s FROM sucursales WHERE id = p_id FOR UPDATE;
    IF NOT FOUND OR v_s.cliente_id <> p_cliente_id THEN
      RAISE EXCEPTION 'guardar_sucursal: sucursal no encontrada para el cliente' USING ERRCODE = '22023';
    END IF;
    IF v_s.es_principal THEN
      -- La principal es el domicilio del cliente: se edita en el cliente (sincronía clientes → principal).
      IF v_estatus <> 'Activa' THEN
        RAISE EXCEPTION 'guardar_sucursal: la sucursal principal no se desactiva' USING ERRCODE = '22023';
      END IF;
      UPDATE sucursales SET
        nombre = COALESCE(v_nombre, nombre),
        telefono = CASE WHEN p_datos ? 'telefono' THEN NULLIF(btrim(COALESCE(p_datos ->> 'telefono', '')), '') ELSE telefono END,
        referencia = CASE WHEN p_datos ? 'referencia' THEN NULLIF(btrim(COALESCE(p_datos ->> 'referencia', '')), '') ELSE referencia END
      WHERE id = p_id RETURNING * INTO v_s;
    ELSE
      IF v_nombre IS NOT NULL AND EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = p_cliente_id AND id <> p_id AND lower(btrim(nombre)) = lower(v_nombre)) THEN
        RAISE EXCEPTION 'guardar_sucursal: el cliente ya tiene una sucursal llamada "%"', v_nombre USING ERRCODE = '23505';
      END IF;
      UPDATE sucursales SET
        nombre          = COALESCE(v_nombre, nombre),
        calle           = CASE WHEN p_datos ? 'calle' THEN NULLIF(btrim(COALESCE(p_datos ->> 'calle', '')), '') ELSE calle END,
        numero_exterior = CASE WHEN p_datos ? 'numero_exterior' THEN NULLIF(btrim(COALESCE(p_datos ->> 'numero_exterior', '')), '') ELSE numero_exterior END,
        numero_interior = CASE WHEN p_datos ? 'numero_interior' THEN NULLIF(btrim(COALESCE(p_datos ->> 'numero_interior', '')), '') ELSE numero_interior END,
        colonia         = CASE WHEN p_datos ? 'colonia' THEN NULLIF(btrim(COALESCE(p_datos ->> 'colonia', '')), '') ELSE colonia END,
        ciudad          = CASE WHEN p_datos ? 'ciudad' THEN NULLIF(btrim(COALESCE(p_datos ->> 'ciudad', '')), '') ELSE ciudad END,
        estado          = CASE WHEN p_datos ? 'estado' THEN NULLIF(btrim(COALESCE(p_datos ->> 'estado', '')), '') ELSE estado END,
        codigo_postal   = CASE WHEN p_datos ? 'codigo_postal' THEN NULLIF(btrim(COALESCE(p_datos ->> 'codigo_postal', '')), '') ELSE codigo_postal END,
        latitud         = CASE WHEN p_datos ? 'latitud' THEN v_lat ELSE latitud END,
        longitud        = CASE WHEN p_datos ? 'longitud' THEN v_lng ELSE longitud END,
        zona            = CASE WHEN p_datos ? 'zona' THEN NULLIF(btrim(COALESCE(p_datos ->> 'zona', '')), '') ELSE zona END,
        contacto        = CASE WHEN p_datos ? 'contacto' THEN NULLIF(btrim(COALESCE(p_datos ->> 'contacto', '')), '') ELSE contacto END,
        telefono        = CASE WHEN p_datos ? 'telefono' THEN NULLIF(btrim(COALESCE(p_datos ->> 'telefono', '')), '') ELSE telefono END,
        referencia      = CASE WHEN p_datos ? 'referencia' THEN NULLIF(btrim(COALESCE(p_datos ->> 'referencia', '')), '') ELSE referencia END,
        estatus         = CASE WHEN p_datos ? 'estatus' THEN v_estatus ELSE estatus END
      WHERE id = p_id RETURNING * INTO v_s;
    END IF;
    v_accion := 'Editar sucursal';
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), v_accion, 'Clientes',
          (SELECT nombre FROM clientes WHERE id = p_cliente_id) || ' · ' || v_s.nombre || ' (#' || v_s.id || ', ' || v_s.estatus || ')');

  RETURN jsonb_build_object('id', v_s.id, 'cliente_id', v_s.cliente_id, 'nombre', v_s.nombre, 'es_principal', v_s.es_principal,
    'estatus', v_s.estatus, 'direccion', sucursal_direccion_texto(v_s), 'latitud', v_s.latitud, 'longitud', v_s.longitud, 'zona', v_s.zona);
END $$;
REVOKE ALL ON FUNCTION public.guardar_sucursal(BIGINT, BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_sucursal(BIGINT, BIGINT, JSONB) TO authenticated, service_role;

-- ═══ 8. Contrato: fusionar un cliente como sucursal de otro (Admin) ═══
CREATE OR REPLACE FUNCTION public.fusionar_cliente_en_sucursal(p_origen BIGINT, p_destino BIGINT, p_nombre_sucursal TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_o      clientes%ROWTYPE;
  v_d      clientes%ROWTYPE;
  v_suc    sucursales%ROWTYPE;
  v_nombre TEXT;
  v_rfc_o  TEXT;
  v_rfc_d  TEXT;
  n_ord    INTEGER := 0; n_cxc INTEGER := 0; n_pag INTEGER := 0; n_dev INTEGER := 0; n_com INTEGER := 0; n_pre INTEGER := 0; n_suc INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: solo Admin' USING ERRCODE = '42501';
  END IF;
  PERFORM fin_marcar_ctx();
  IF p_origen IS NULL OR p_destino IS NULL OR p_origen = p_destino THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: origen y destino deben ser dos clientes distintos' USING ERRCODE = '22023';
  END IF;
  -- Orden fijo de bloqueo (dos fusiones cruzadas no se interbloquean).
  PERFORM 1 FROM clientes WHERE id IN (p_origen, p_destino) ORDER BY id FOR UPDATE;
  SELECT * INTO v_o FROM clientes WHERE id = p_origen;
  IF NOT FOUND THEN RAISE EXCEPTION 'fusionar_cliente_en_sucursal: cliente origen no encontrado' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_d FROM clientes WHERE id = p_destino;
  IF NOT FOUND THEN RAISE EXCEPTION 'fusionar_cliente_en_sucursal: cliente destino no encontrado' USING ERRCODE = '22023'; END IF;

  -- Reintento: ya fusionado en ese destino → misma respuesta.
  IF v_o.fusionado_en = p_destino THEN
    SELECT * INTO v_suc FROM sucursales WHERE origen_cliente_id = p_origen AND cliente_id = p_destino ORDER BY id LIMIT 1;
    RETURN jsonb_build_object('ok', true, 'repetida', true, 'origen', p_origen, 'destino', p_destino, 'sucursal_id', v_suc.id, 'sucursal', v_suc.nombre);
  END IF;
  IF v_o.fusionado_en IS NOT NULL THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el cliente % ya fue fusionado en el cliente %', p_origen, v_o.fusionado_en USING ERRCODE = '22023';
  END IF;
  IF v_d.fusionado_en IS NOT NULL THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el destino % fue fusionado en el cliente %', p_destino, v_d.fusionado_en USING ERRCODE = '22023';
  END IF;
  IF v_d.estatus <> 'Activo' THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el cliente destino está inactivo' USING ERRCODE = '22023';
  END IF;
  v_rfc_o := upper(btrim(COALESCE(v_o.rfc, '')));
  v_rfc_d := upper(btrim(COALESCE(v_d.rfc, '')));
  IF v_rfc_o NOT IN ('', 'XAXX010101000', 'XEXX010101000') AND v_rfc_o <> v_rfc_d THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el RFC del origen (%) no coincide con el del destino (%): son razones sociales distintas', v_rfc_o, v_rfc_d USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM cfdi_operaciones co JOIN ordenes o ON o.id = co.orden_id WHERE o.cliente_id = p_origen
              AND co.estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision')) THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el origen tiene operaciones CFDI sin resolver' USING ERRCODE = '22023';
  END IF;

  v_nombre := COALESCE(NULLIF(btrim(COALESCE(p_nombre_sucursal, '')), ''), btrim(v_o.nombre));
  IF EXISTS (SELECT 1 FROM sucursales WHERE cliente_id = p_destino AND lower(btrim(nombre)) = lower(v_nombre)) THEN
    RAISE EXCEPTION 'fusionar_cliente_en_sucursal: el destino ya tiene una sucursal llamada "%"', v_nombre USING ERRCODE = '23505';
  END IF;

  -- La principal del origen pasa a ser sucursal del destino (conserva su id, sus coordenadas y su zona).
  UPDATE sucursales SET cliente_id = p_destino, es_principal = false, nombre = v_nombre, origen_cliente_id = p_origen,
         contacto = COALESCE(contacto, NULLIF(btrim(COALESCE(v_o.contacto, '')), ''))
   WHERE cliente_id = p_origen AND es_principal RETURNING * INTO v_suc;
  IF v_suc.id IS NULL THEN
    INSERT INTO sucursales (cliente_id, nombre, es_principal, calle, numero_exterior, numero_interior, colonia, ciudad, estado, codigo_postal,
                            latitud, longitud, zona, contacto, origen_cliente_id)
    VALUES (p_destino, v_nombre, false, v_o.calle, v_o.numero_exterior, v_o.numero_interior, v_o.colonia, v_o.ciudad, v_o.estado,
            COALESCE(NULLIF(v_o.codigo_postal, ''), NULLIF(v_o.cp, '')), v_o.latitud, v_o.longitud, v_o.zona, v_o.contacto, p_origen)
    RETURNING * INTO v_suc;
  END IF;
  -- Otras sucursales del origen: al destino (mismo nombre → con el prefijo del origen).
  UPDATE sucursales s SET cliente_id = p_destino, origen_cliente_id = p_origen,
         nombre = CASE WHEN EXISTS (SELECT 1 FROM sucursales d WHERE d.cliente_id = p_destino AND lower(btrim(d.nombre)) = lower(btrim(s.nombre)))
                       THEN btrim(v_o.nombre) || ' · ' || s.nombre ELSE s.nombre END
   WHERE s.cliente_id = p_origen;
  GET DIAGNOSTICS n_suc = ROW_COUNT;

  -- Reapuntar la historia (sin reescribir montos, fechas ni la foto del nombre en la orden).
  UPDATE ordenes SET cliente_id = p_destino, sucursal_id = COALESCE(sucursal_id, v_suc.id) WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_ord = ROW_COUNT;
  UPDATE cuentas_por_cobrar SET cliente_id = p_destino WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_cxc = ROW_COUNT;
  UPDATE pagos SET cliente_id = p_destino WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_pag = ROW_COUNT;
  UPDATE devoluciones SET cliente_id = p_destino WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_dev = ROW_COUNT;
  UPDATE comodatos SET cliente_id = p_destino WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_com = ROW_COUNT;
  -- Precios del origen: los "de cliente" pasan a ser de la sucursal nueva; los de sus sucursales conservan la sucursal.
  UPDATE precios_esp SET cliente_id = p_destino, sucursal_id = COALESCE(sucursal_id, v_suc.id) WHERE cliente_id = p_origen;
  GET DIAGNOSTICS n_pre = ROW_COUNT;

  -- Saldo por cadena: el adeudo del origen se suma al destino. Crédito: el del destino.
  UPDATE clientes SET saldo = round(COALESCE(saldo, 0) + COALESCE(v_o.saldo, 0), 2), updated_at = now() WHERE id = p_destino;
  UPDATE clientes SET saldo = 0, estatus = 'Inactivo', fusionado_en = p_destino, updated_at = now() WHERE id = p_origen;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Fusionar cliente', 'Clientes',
          v_o.nombre || ' (#' || p_origen || ') → sucursal "' || v_nombre || '" (#' || v_suc.id || ') de ' || v_d.nombre || ' (#' || p_destino || '). '
          || 'Reapuntado: ' || n_ord || ' órdenes, ' || n_cxc || ' CxC, ' || n_pag || ' pagos, ' || n_dev || ' devoluciones, ' || n_com || ' comodatos, '
          || n_pre || ' precios, ' || n_suc || ' sucursales; saldo sumado: ' || COALESCE(v_o.saldo, 0));

  RETURN jsonb_build_object('ok', true, 'repetida', false, 'origen', p_origen, 'destino', p_destino, 'sucursal_id', v_suc.id, 'sucursal', v_nombre,
    'ordenes', n_ord, 'cxc', n_cxc, 'pagos', n_pag, 'devoluciones', n_dev, 'comodatos', n_com, 'precios', n_pre, 'sucursales', n_suc,
    'saldo_sumado', COALESCE(v_o.saldo, 0));
END $$;
REVOKE ALL ON FUNCTION public.fusionar_cliente_en_sucursal(BIGINT, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fusionar_cliente_en_sucursal(BIGINT, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 9. Realtime (la app ya escucha clientes; sucursales igual) ═══
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'sucursales') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.sucursales;
  END IF;
END $$;

COMMENT ON TABLE public.sucursales IS '123: puntos de entrega de un cliente. Una principal por cliente = domicilio del cliente (sincronía clientes → principal). Escritura solo por guardar_sucursal / fusionar_cliente_en_sucursal.';
COMMENT ON COLUMN public.ordenes.sucursal_id IS '123: sucursal elegida (del cliente de la orden). Su dirección se copia a direccion_entrega al crear si no viene propia.';
COMMENT ON COLUMN public.precios_esp.sucursal_id IS '123: NULL = precio del cliente (toda la cadena); con sucursal = solo esa sucursal (prioridad sobre el del cliente).';
COMMENT ON COLUMN public.clientes.fusionado_en IS '123: cliente destino cuando este cliente pasó a ser una sucursal (fusionar_cliente_en_sucursal).';
