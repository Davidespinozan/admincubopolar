-- 134_evidencias_orden.sql — evidencias de una venta: foto del comprobante de
-- transferencia y foto de la entrega, guardadas en el sistema.
--
-- Aditiva e idempotente. Compatible con el frontend desplegado antes.
--
-- Qué había: el Chofer toma la foto del comprobante (obligatoria en
-- transferencia) y la de la entrega, pero se quedaban en SU teléfono
-- (localStorage): Administración nunca las veía y no podía conciliar.
--
-- Qué agrega:
--   1. `orden_evidencias` — una fila por foto, ligada a la orden: tipo
--      (`comprobante_pago` / `entrega`), ruta del archivo en el bucket privado
--      `mermas` (el único con policies; una migración no puede crear policies
--      de storage), referencia escrita y quién la subió. Inmutable por API.
--   2. `registrar_evidencia_orden(orden, tipo, ruta, referencia)` — Admin
--      (cualquier orden), Ventas (sus órdenes) y Chofer (órdenes de SU ruta).
--      Exige que el archivo exista, esté en la carpeta del propio usuario y en
--      `…/ordenes/<orden>/`. Idempotente por ruta (un reintento no duplica).
--   3. `erp_foto_merma_en_uso` también protege estas fotos: quien la subió ya
--      no puede borrarla del almacenamiento (la policy de borrado la consulta).
--
-- Lectura: Admin y Facturación ven todas; cada quien ve las que subió. El
-- archivo lo abren Admin y Producción (policy de lectura del bucket, 072) y
-- quien lo subió.
--
-- No mueve dinero, pagos, CxC ni el estatus de la orden: es solo evidencia.
--
-- Reversión: restaurar `erp_foto_merma_en_uso` de 119 y borrar la función y la
-- tabla (sin evidencias registradas). Con evidencias: no borrar historia.

CREATE TABLE IF NOT EXISTS public.orden_evidencias (
  id          BIGSERIAL PRIMARY KEY,
  orden_id    BIGINT NOT NULL REFERENCES public.ordenes(id),
  tipo        TEXT NOT NULL CHECK (tipo IN ('comprobante_pago', 'entrega')),
  foto_path   TEXT NOT NULL UNIQUE CHECK (btrim(foto_path) <> '' AND char_length(foto_path) <= 300),
  referencia  TEXT CHECK (referencia IS NULL OR char_length(referencia) <= 80),
  subido_por  BIGINT,
  subido_por_nombre TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_orden_evidencias_orden ON public.orden_evidencias (orden_id);

ALTER TABLE public.orden_evidencias ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.orden_evidencias FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.orden_evidencias TO authenticated;
GRANT ALL ON public.orden_evidencias TO service_role;
DROP POLICY IF EXISTS evidencias_read ON public.orden_evidencias;
CREATE POLICY evidencias_read ON public.orden_evidencias FOR SELECT TO authenticated
  USING (erp_rol_activo() IN ('Admin', 'Facturación') OR (erp_lector_negocio() AND subido_por = erp_usuario_id()));
REVOKE ALL ON SEQUENCE public.orden_evidencias_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.orden_evidencias_id_seq TO service_role;

-- La evidencia registrada no se edita ni se borra (tampoco con service_role).
CREATE OR REPLACE FUNCTION public.orden_evidencias_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  RAISE EXCEPTION 'orden_evidencias: la evidencia registrada es inmutable' USING ERRCODE = '42501';
END $$;
REVOKE ALL ON FUNCTION public.orden_evidencias_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_orden_evidencias_guard ON public.orden_evidencias;
CREATE TRIGGER trg_orden_evidencias_guard BEFORE UPDATE OR DELETE ON public.orden_evidencias
  FOR EACH ROW EXECUTE FUNCTION public.orden_evidencias_guard();

CREATE OR REPLACE FUNCTION public.registrar_evidencia_orden(p_orden_id BIGINT, p_tipo TEXT, p_foto_path TEXT, p_referencia TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt    TEXT := fin_jwt_role();
  v_rol    TEXT;
  v_actor  BIGINT := erp_usuario_id();
  v_path   TEXT := btrim(COALESCE(p_foto_path, ''));
  v_ref    TEXT := NULLIF(left(btrim(COALESCE(p_referencia, '')), 80), '');
  v_ord    RECORD;
  v_prev   orden_evidencias%ROWTYPE;
  v_id     BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Ventas', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_evidencia_orden: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden_id IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('comprobante_pago', 'entrega') OR v_path = '' OR char_length(v_path) > 300 THEN
    RAISE EXCEPTION 'registrar_evidencia_orden: orden, tipo (comprobante_pago o entrega) y foto requeridos' USING ERRCODE = '22023';
  END IF;

  -- Reintento con la misma foto: misma respuesta.
  SELECT * INTO v_prev FROM orden_evidencias WHERE foto_path = v_path;
  IF FOUND THEN
    IF v_prev.orden_id <> p_orden_id OR v_prev.tipo <> p_tipo THEN
      RAISE EXCEPTION 'registrar_evidencia_orden: esa foto ya está registrada en otra venta' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'orden_id', v_prev.orden_id, 'tipo', v_prev.tipo, 'replay', true);
  END IF;

  SELECT o.id, o.folio, o.vendedor_id, o.ruta_id, r.chofer_id INTO v_ord
    FROM ordenes o LEFT JOIN rutas r ON r.id = o.ruta_id WHERE o.id = p_orden_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_evidencia_orden: la venta no existe' USING ERRCODE = '22023';
  END IF;

  IF v_jwt = 'authenticated' THEN
    v_rol := COALESCE(fin_mi_rol_activo(), '');
    -- Admin: cualquier venta. Chofer: las de su ruta. Los demás (Ventas o acceso adicional): las suyas.
    IF v_rol <> 'Admin' THEN
      IF v_rol = 'Chofer' THEN
        IF v_ord.chofer_id IS DISTINCT FROM v_actor THEN
          RAISE EXCEPTION 'registrar_evidencia_orden: la venta % no es de tu ruta', v_ord.folio USING ERRCODE = '42501';
        END IF;
      ELSIF v_ord.vendedor_id IS DISTINCT FROM v_actor THEN
        RAISE EXCEPTION 'registrar_evidencia_orden: la venta % no es tuya', v_ord.folio USING ERRCODE = '42501';
      END IF;
    END IF;
    -- La foto es del propio usuario y de ESTA venta: <uid>/ordenes/<orden>/archivo
    IF v_path NOT LIKE auth.uid()::TEXT || '/ordenes/' || p_orden_id || '/%' THEN
      RAISE EXCEPTION 'registrar_evidencia_orden: la foto no corresponde a esta venta' USING ERRCODE = '22023';
    END IF;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'mermas' AND o.name = v_path) THEN
    RAISE EXCEPTION 'registrar_evidencia_orden: la foto no se subió' USING ERRCODE = '22023';
  END IF;
  IF (SELECT count(*) FROM orden_evidencias WHERE orden_id = p_orden_id) >= 8 THEN
    RAISE EXCEPTION 'registrar_evidencia_orden: la venta % ya tiene el máximo de fotos', v_ord.folio USING ERRCODE = '22023';
  END IF;

  INSERT INTO orden_evidencias (orden_id, tipo, foto_path, referencia, subido_por, subido_por_nombre)
  VALUES (p_orden_id, p_tipo, v_path, v_ref, v_actor, erp_actor_etiqueta())
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('id', v_id, 'orden_id', p_orden_id, 'tipo', p_tipo, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.registrar_evidencia_orden(BIGINT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_evidencia_orden(BIGINT, TEXT, TEXT, TEXT) TO authenticated, service_role;

-- La policy de borrado del bucket consulta esta función: una foto ya ligada a
-- una merma (072) O a una venta (134) no se puede borrar.
CREATE OR REPLACE FUNCTION public.erp_foto_merma_en_uso(p_name text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT erp_exigir_no_empleado('erp_foto_merma_en_uso');
  SELECT COALESCE(p_name, '') <> '' AND (EXISTS (SELECT 1 FROM mermas WHERE foto_url = p_name)
                                         OR EXISTS (SELECT 1 FROM orden_evidencias WHERE foto_path = p_name))
$function$;
