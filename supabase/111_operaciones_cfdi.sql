-- 111_operaciones_cfdi.sql — OL-03B (aditiva): una operación CFDI a la vez por orden.
--
-- Problema (OL-03 / OL-03A): dos solicitudes de timbrado (o de cancelación)
-- realmente simultáneas sobre la misma orden podían cruzar ambas la frontera
-- del proveedor (Facturama) y emitir dos CFDI; OL-03A solo detectaba al
-- perdedor DESPUÉS del proveedor.
--
-- Modelo: cada operación externa de CFDI (emisión o cancelación) es una fila de
-- cfdi_operaciones. Antes de llamar al proveedor, la Netlify Function reserva la
-- operación en una transacción CORTA (reservar_operacion_cfdi: bloquea la orden,
-- revalida, crea la fila 'en_curso'); el índice único parcial permite UNA sola
-- operación activa o sin resolver por orden. La llamada HTTP ocurre FUERA de
-- cualquier transacción. Después, otra transacción corta (finalizar_operacion_cfdi)
-- registra el resultado y, si procede, mueve la orden.
--
-- Estados (sin texto libre):
--   en_curso               reservada; el proveedor puede haber sido contactado.
--   exitosa                emisión timbrada y orden Facturada, o cancelación
--                          confirmada y orden de vuelta a Entregada.
--   fallida                el proveedor rechazó de forma definitiva (nada se
--                          emitió / nada se canceló). Libera la orden.
--   incierta               resultado desconocido tras cruzar la frontera del
--                          proveedor (timeout, red, 5xx, respuesta ilegible) o
--                          lease vencido. NUNCA se reintenta sola: requiere
--                          conciliación.
--   cancelacion_pendiente  el proveedor/SAT aceptó la solicitud de cancelación
--                          pero no la ha confirmado; la orden sigue Facturada.
--   revision               el proveedor tuvo éxito pero la orden ya no estaba en
--                          el estado esperado (no se movió); requiere revisión.
--   descartada             conciliada: se confirmó que el efecto NO ocurrió.
--                          Libera la orden.
-- Activos/sin resolver (uno por orden): en_curso, incierta,
-- cancelacion_pendiente, revision.
--
-- Generación: n.º de cancelaciones confirmadas de la orden + 1. La emisión de la
-- generación N y la cancelación de su CFDI comparten N; tras una cancelación
-- confirmada la siguiente emisión es N+1. Se calcula con la orden bloqueada.
--
-- Lease: la reserva vence (por defecto 120 s, entre 30 y 900). Un 'en_curso'
-- vencido pasa a 'incierta' (jamás a 'fallida'): sin evidencia del proveedor,
-- vencer no hace reintentable la operación.
--
-- Este archivo NO cambia ninguna guarda ni transición de ordenes: la
-- contención (Facturada solo desde Entregada, cancelación solo por contrato y
-- el cierre de ruta que conserva Facturada) es 112, que se activa después de que
-- las Netlify Functions compatibles estén publicadas.
--
-- Seguridad: tabla con RLS (lectura Admin / Facturación); nadie escribe la tabla
-- salvo los contratos (SECURITY DEFINER). Los contratos se ejecutan SOLO con
-- service role (las Netlify Functions); revalidan rol y dueño del actor.
--
-- Reversión (solo si no hay operaciones activas/sin resolver; ver runbook):
--   DROP FUNCTION IF EXISTS public.conciliar_operacion_cfdi(uuid, text, jsonb, bigint);
--   DROP FUNCTION IF EXISTS public.vencer_operaciones_cfdi();
--   DROP FUNCTION IF EXISTS public.finalizar_operacion_cfdi(uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.cfdi_aplicar_resultado(uuid, text, jsonb);
--   DROP FUNCTION IF EXISTS public.reservar_operacion_cfdi(bigint, text, bigint, text, text, text, integer);
--   (la tabla se conserva como historial)

CREATE TABLE IF NOT EXISTS public.cfdi_operaciones (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  orden_id       BIGINT NOT NULL REFERENCES public.ordenes(id),
  tipo           TEXT NOT NULL CHECK (tipo IN ('emision', 'cancelacion')),
  generacion     INTEGER NOT NULL CHECK (generacion >= 1),
  estado         TEXT NOT NULL DEFAULT 'en_curso'
                 CHECK (estado IN ('en_curso', 'exitosa', 'fallida', 'incierta', 'cancelacion_pendiente', 'revision', 'descartada')),
  huella         TEXT NOT NULL,
  payload_hash   TEXT,
  lease_hasta    TIMESTAMPTZ NOT NULL,
  actor_id       BIGINT,
  actor          TEXT,
  motivo         TEXT CHECK (motivo IS NULL OR motivo IN ('01', '02', '03', '04')),
  uuid_sustituto TEXT,
  proveedor_id   TEXT,
  cfdi_uuid      TEXT,
  proveedor_estatus TEXT,
  detalle        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finalizada_at  TIMESTAMPTZ,
  CONSTRAINT cfdi_operaciones_cierre CHECK ((estado IN ('exitosa', 'fallida', 'descartada')) = (finalizada_at IS NOT NULL)),
  CONSTRAINT cfdi_operaciones_cancelacion CHECK (tipo <> 'cancelacion' OR (motivo IS NOT NULL AND cfdi_uuid IS NOT NULL))
);

-- Una sola operación activa o sin resolver por orden (emisión O cancelación).
CREATE UNIQUE INDEX IF NOT EXISTS idx_cfdi_operaciones_activa ON public.cfdi_operaciones (orden_id)
  WHERE estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision');
CREATE INDEX IF NOT EXISTS idx_cfdi_operaciones_orden ON public.cfdi_operaciones (orden_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cfdi_operaciones_sin_resolver ON public.cfdi_operaciones (estado, updated_at)
  WHERE estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision');

ALTER TABLE public.cfdi_operaciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cfdi_operaciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.cfdi_operaciones TO authenticated, service_role;
DROP POLICY IF EXISTS cfdi_operaciones_lectura ON public.cfdi_operaciones;
CREATE POLICY cfdi_operaciones_lectura ON public.cfdi_operaciones FOR SELECT TO authenticated
  USING (erp_rol_activo() IN ('Admin', 'Facturación'));

-- ── Reserva ────────────────────────────────────────────────────────────────
-- Devuelve jsonb. Conflictos y estados no elegibles se DEVUELVEN (ok=false)
-- en lugar de lanzar, para que el vencimiento 'en_curso' → 'incierta' que se
-- haya hecho en esta misma transacción quede registrado.
CREATE OR REPLACE FUNCTION public.reservar_operacion_cfdi(
  p_orden_id BIGINT, p_tipo TEXT, p_actor_id BIGINT, p_payload_hash TEXT,
  p_motivo TEXT DEFAULT NULL, p_uuid_sustituto TEXT DEFAULT NULL, p_lease_segundos INTEGER DEFAULT 120
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor  usuarios%ROWTYPE;
  v_ord    ordenes%ROWTYPE;
  v_act    cfdi_operaciones%ROWTYPE;
  v_gen    INTEGER;
  v_lease  INTEGER := LEAST(GREATEST(COALESCE(p_lease_segundos, 120), 30), 900);
  v_params TEXT;
  v_id     UUID;
BEGIN
  IF p_tipo IS NULL OR p_tipo NOT IN ('emision', 'cancelacion') THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: tipo inválido (%)', p_tipo USING ERRCODE = '22023';
  END IF;
  IF p_orden_id IS NULL THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: orden requerida' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'emision' AND NULLIF(btrim(COALESCE(p_payload_hash, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: la emisión requiere la huella del CFDI armado por el servidor' USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'cancelacion' AND (p_motivo IS NULL OR p_motivo NOT IN ('01', '02', '03', '04')) THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: motivo SAT inválido (%)', p_motivo USING ERRCODE = '22023';
  END IF;
  IF p_tipo = 'cancelacion' AND p_motivo = '01' AND NULLIF(btrim(COALESCE(p_uuid_sustituto, '')), '') IS NULL THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: el motivo 01 requiere el UUID sustituto' USING ERRCODE = '22023';
  END IF;

  -- Defensa en profundidad: el actor que la Function ya autenticó.
  SELECT * INTO v_actor FROM usuarios WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.estatus IS DISTINCT FROM 'Activo' OR v_actor.rol NOT IN ('Admin', 'Facturación', 'Ventas') THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: actor no autorizado para facturar' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: la orden % no existe', p_orden_id USING ERRCODE = '22023';
  END IF;
  IF v_actor.rol = 'Ventas' AND v_ord.vendedor_id IS DISTINCT FROM v_actor.id THEN
    RAISE EXCEPTION 'reservar_operacion_cfdi: Ventas solo factura sus propias órdenes' USING ERRCODE = '42501';
  END IF;

  -- Un 'en_curso' vencido de esta orden pasa a 'incierta' (nunca a 'fallida').
  UPDATE cfdi_operaciones
     SET estado = 'incierta', updated_at = now(),
         detalle = detalle || jsonb_build_object('lease_vencido_at', now())
   WHERE orden_id = p_orden_id AND estado = 'en_curso' AND lease_hasta < now();

  SELECT * INTO v_act FROM cfdi_operaciones
   WHERE orden_id = p_orden_id AND estado IN ('en_curso', 'incierta', 'cancelacion_pendiente', 'revision');
  IF FOUND THEN
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_act.id, 'tipo_activo', v_act.tipo, 'estado', v_act.estado,
      'codigo', CASE v_act.estado WHEN 'en_curso' THEN 'OPERACION_EN_CURSO' WHEN 'incierta' THEN 'OPERACION_INCIERTA'
                                  WHEN 'cancelacion_pendiente' THEN 'CANCELACION_PENDIENTE' ELSE 'OPERACION_EN_REVISION' END);
  END IF;

  IF p_tipo = 'emision' THEN
    IF v_ord.facturama_uuid IS NOT NULL AND v_ord.cfdi_cancelado_at IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'CFDI_VIGENTE', 'facturama_uuid', v_ord.facturama_uuid, 'facturama_folio', v_ord.facturama_folio);
    END IF;
    IF v_ord.estatus IS DISTINCT FROM 'Entregada' THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'ESTATUS_NO_FACTURABLE', 'estatus', v_ord.estatus);
    END IF;
  ELSE
    IF v_ord.facturama_uuid IS NULL OR v_ord.facturama_id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'SIN_CFDI');
    END IF;
    IF v_ord.cfdi_cancelado_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'YA_CANCELADA');
    END IF;
    IF v_ord.estatus IS DISTINCT FROM 'Facturada' THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'ESTATUS_NO_CANCELABLE', 'estatus', v_ord.estatus);
    END IF;
  END IF;

  v_gen := 1 + (SELECT count(*) FROM cfdi_operaciones WHERE orden_id = p_orden_id AND tipo = 'cancelacion' AND estado = 'exitosa');
  v_params := CASE WHEN p_tipo = 'emision' THEN btrim(p_payload_hash)
                   ELSE concat_ws('|', v_ord.facturama_id, v_ord.facturama_uuid, p_motivo, NULLIF(btrim(COALESCE(p_uuid_sustituto, '')), '')) END;

  INSERT INTO cfdi_operaciones (orden_id, tipo, generacion, estado, huella, payload_hash, lease_hasta, actor_id, actor,
                                motivo, uuid_sustituto, proveedor_id, cfdi_uuid)
  VALUES (p_orden_id, p_tipo, v_gen, 'en_curso',
          encode(sha256(convert_to(concat_ws('|', 'cfdi', p_orden_id, p_tipo, v_gen, v_params), 'UTF8')), 'hex'),
          NULLIF(btrim(COALESCE(p_payload_hash, '')), ''), now() + make_interval(secs => v_lease), v_actor.id, v_actor.nombre,
          CASE WHEN p_tipo = 'cancelacion' THEN p_motivo END,
          CASE WHEN p_tipo = 'cancelacion' THEN NULLIF(btrim(COALESCE(p_uuid_sustituto, '')), '') END,
          CASE WHEN p_tipo = 'cancelacion' THEN v_ord.facturama_id END,
          CASE WHEN p_tipo = 'cancelacion' THEN v_ord.facturama_uuid END)
  RETURNING id INTO v_id;

  RETURN jsonb_build_object('ok', true, 'operacion_id', v_id, 'tipo', p_tipo, 'generacion', v_gen, 'estado', 'en_curso',
    'lease_hasta', now() + make_interval(secs => v_lease),
    'facturama_id', CASE WHEN p_tipo = 'cancelacion' THEN v_ord.facturama_id END,
    'facturama_uuid', CASE WHEN p_tipo = 'cancelacion' THEN v_ord.facturama_uuid END);
EXCEPTION WHEN unique_violation THEN
  -- Respaldo del índice único: otra reserva ganó (no debería ocurrir con la orden bloqueada).
  RETURN jsonb_build_object('ok', false, 'codigo', 'OPERACION_EN_CURSO');
END $$;

-- ── Aplicación de un resultado (interna; la usan finalizar y conciliar) ──────
-- Mueve la orden SOLO desde el estado esperado y dentro del contexto estrecho
-- app.cfdi_ctx ('emision' o 'cancelacion'), que 112 exige para entrar o salir
-- de Facturada. Si la orden ya no está en el estado esperado, la operación
-- queda en 'revision' (el efecto del proveedor sí ocurrió).
CREATE OR REPLACE FUNCTION public.cfdi_aplicar_resultado(p_operacion_id UUID, p_resultado TEXT, p_datos JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op   cfdi_operaciones%ROWTYPE;
  v_ord  ordenes%ROWTYPE;
  v_n    INTEGER := 0;
  v_d    JSONB := COALESCE(p_datos, '{}'::jsonb);
  v_pid  TEXT := NULLIF(btrim(COALESCE(v_d->>'proveedor_id', '')), '');
  v_uuid TEXT := NULLIF(btrim(COALESCE(v_d->>'cfdi_uuid', '')), '');
  v_pst  TEXT := NULLIF(btrim(COALESCE(v_d->>'proveedor_estatus', '')), '');
  v_det  JSONB := COALESCE(v_d->'detalle', '{}'::jsonb);
BEGIN
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  SELECT * INTO v_ord FROM ordenes WHERE id = v_op.orden_id FOR UPDATE;

  IF p_resultado = 'emitida' THEN
    IF v_pid IS NULL OR v_uuid IS NULL THEN
      RAISE EXCEPTION 'cfdi: una emisión exitosa requiere proveedor_id y cfdi_uuid' USING ERRCODE = '22023';
    END IF;
    IF v_ord.estatus = 'Entregada' AND NOT (v_ord.facturama_uuid IS NOT NULL AND v_ord.cfdi_cancelado_at IS NULL) THEN
      BEGIN
        PERFORM set_config('app.cfdi_ctx', 'emision', true);
        UPDATE ordenes
           SET estatus = 'Facturada', facturama_id = v_pid, facturama_folio = NULLIF(v_d->>'folio', ''), facturama_uuid = v_uuid,
               cfdi_cancelado_at = NULL, cfdi_cancelado_motivo = NULL, cfdi_cancelado_motivo_detalle = NULL,
               cfdi_cancelado_uuid_sustituto = NULL, cfdi_cancelado_por = NULL
         WHERE id = v_ord.id AND estatus = 'Entregada';
        GET DIAGNOSTICS v_n = ROW_COUNT;
        PERFORM set_config('app.cfdi_ctx', '', true);
      EXCEPTION WHEN unique_violation THEN
        PERFORM set_config('app.cfdi_ctx', '', true);
        v_n := 0; v_det := v_det || jsonb_build_object('error_local', 'uuid duplicado en otra orden');
      END;
    END IF;
    UPDATE cfdi_operaciones
       SET estado = CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
           finalizada_at = CASE WHEN v_n = 1 THEN now() END,
           proveedor_id = v_pid, cfdi_uuid = v_uuid, proveedor_estatus = COALESCE(v_pst, proveedor_estatus),
           detalle = detalle || v_det || CASE WHEN v_n = 1 THEN '{}'::jsonb
                     ELSE jsonb_build_object('revision', 'el proveedor emitió el CFDI pero la orden no estaba Entregada sin CFDI vigente', 'estatus_orden', v_ord.estatus) END,
           updated_at = now()
     WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', v_n = 1, 'operacion_id', v_op.id, 'estado', CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
                              'orden_estatus', CASE WHEN v_n = 1 THEN 'Facturada' ELSE v_ord.estatus END);

  ELSIF p_resultado = 'cancelada' THEN
    IF v_ord.estatus = 'Facturada' AND v_ord.facturama_uuid = v_op.cfdi_uuid AND v_ord.cfdi_cancelado_at IS NULL THEN
      PERFORM set_config('app.cfdi_ctx', 'cancelacion', true);
      UPDATE ordenes
         SET estatus = 'Entregada', cfdi_cancelado_at = now(), cfdi_cancelado_motivo = v_op.motivo,
             cfdi_cancelado_motivo_detalle = NULLIF(btrim(COALESCE(v_d->>'motivo_detalle', '')), ''),
             cfdi_cancelado_uuid_sustituto = v_op.uuid_sustituto,
             cfdi_cancelado_por = COALESCE(NULLIF(v_d->>'cancelado_por', ''), v_op.actor, 'Sistema')
       WHERE id = v_ord.id AND estatus = 'Facturada' AND facturama_uuid = v_op.cfdi_uuid AND cfdi_cancelado_at IS NULL;
      GET DIAGNOSTICS v_n = ROW_COUNT;
      PERFORM set_config('app.cfdi_ctx', '', true);
    END IF;
    UPDATE cfdi_operaciones
       SET estado = CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
           finalizada_at = CASE WHEN v_n = 1 THEN now() END,
           proveedor_estatus = COALESCE(v_pst, 'canceled'),
           detalle = detalle || v_det || CASE WHEN v_n = 1 THEN '{}'::jsonb
                     ELSE jsonb_build_object('revision', 'el proveedor confirmó la cancelación pero la orden ya no estaba Facturada con ese CFDI', 'estatus_orden', v_ord.estatus) END,
           updated_at = now()
     WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', v_n = 1, 'operacion_id', v_op.id, 'estado', CASE WHEN v_n = 1 THEN 'exitosa' ELSE 'revision' END,
                              'orden_estatus', CASE WHEN v_n = 1 THEN 'Entregada' ELSE v_ord.estatus END);

  ELSIF p_resultado = 'cancelacion_solicitada' THEN
    UPDATE cfdi_operaciones SET estado = 'cancelacion_pendiente', proveedor_estatus = COALESCE(v_pst, 'requested'),
           detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', true, 'operacion_id', v_op.id, 'estado', 'cancelacion_pendiente', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado IN ('fallida', 'cancelacion_rechazada') THEN
    UPDATE cfdi_operaciones SET estado = 'fallida', finalizada_at = now(),
           proveedor_estatus = COALESCE(v_pst, CASE WHEN p_resultado = 'cancelacion_rechazada' THEN 'rejected' END, proveedor_estatus),
           proveedor_id = COALESCE(v_pid, proveedor_id),
           detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_op.id, 'estado', 'fallida', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado = 'incierta' THEN
    UPDATE cfdi_operaciones SET estado = 'incierta', proveedor_id = COALESCE(v_pid, proveedor_id), cfdi_uuid = COALESCE(cfdi_uuid, v_uuid),
           proveedor_estatus = COALESCE(v_pst, proveedor_estatus), detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', false, 'operacion_id', v_op.id, 'estado', 'incierta', 'orden_estatus', v_ord.estatus);

  ELSIF p_resultado = 'descartada' THEN
    UPDATE cfdi_operaciones SET estado = 'descartada', finalizada_at = now(), detalle = detalle || v_det, updated_at = now() WHERE id = v_op.id;
    RETURN jsonb_build_object('ok', true, 'operacion_id', v_op.id, 'estado', 'descartada', 'orden_estatus', v_ord.estatus);
  END IF;

  RAISE EXCEPTION 'cfdi: resultado inválido (%)', p_resultado USING ERRCODE = '22023';
END $$;

-- ── Finalización (la llama la Function que reservó, tras el proveedor) ───────
CREATE OR REPLACE FUNCTION public.finalizar_operacion_cfdi(p_operacion_id UUID, p_resultado TEXT, p_datos JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op cfdi_operaciones%ROWTYPE;
BEGIN
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalizar_operacion_cfdi: operación % no existe', p_operacion_id USING ERRCODE = '22023';
  END IF;
  IF NOT ((v_op.tipo = 'emision' AND p_resultado IN ('emitida', 'fallida', 'incierta'))
       OR (v_op.tipo = 'cancelacion' AND p_resultado IN ('cancelada', 'cancelacion_solicitada', 'cancelacion_rechazada', 'fallida', 'incierta'))) THEN
    RAISE EXCEPTION 'finalizar_operacion_cfdi: resultado % no aplica a una %', p_resultado, v_op.tipo USING ERRCODE = '22023';
  END IF;
  -- Solo la operación viva (o la que venció mientras su proceso seguía: la
  -- respuesta definitiva del proveedor que llega tarde es la verdad).
  IF v_op.estado NOT IN ('en_curso', 'incierta') THEN
    IF (v_op.estado = 'exitosa' AND p_resultado IN ('emitida', 'cancelada') AND v_op.cfdi_uuid IS NOT DISTINCT FROM COALESCE(NULLIF(p_datos->>'cfdi_uuid', ''), v_op.cfdi_uuid))
       OR (v_op.estado = 'fallida' AND p_resultado IN ('fallida', 'cancelacion_rechazada')) THEN
      RETURN jsonb_build_object('ok', v_op.estado = 'exitosa', 'operacion_id', v_op.id, 'estado', v_op.estado, 'replay', true);
    END IF;
    RAISE EXCEPTION 'finalizar_operacion_cfdi: la operación ya está % (usa la conciliación)', v_op.estado USING ERRCODE = '55000';
  END IF;
  IF v_op.estado = 'incierta' AND p_resultado = 'incierta' THEN
    RETURN cfdi_aplicar_resultado(v_op.id, 'incierta', p_datos);
  END IF;
  RETURN cfdi_aplicar_resultado(v_op.id, p_resultado, p_datos);
END $$;

-- ── Vencimiento explícito (runbook / tarea programada) ──────────────────────
CREATE OR REPLACE FUNCTION public.vencer_operaciones_cfdi()
RETURNS INTEGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_n INTEGER;
BEGIN
  UPDATE cfdi_operaciones
     SET estado = 'incierta', updated_at = now(), detalle = detalle || jsonb_build_object('lease_vencido_at', now())
   WHERE estado = 'en_curso' AND lease_hasta < now();
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END $$;

-- ── Conciliación (operador Admin / Facturación, vía service role) ───────────
-- Resuelve una operación sin resolver con evidencia del proveedor:
--   emision:     'emitida' (con proveedor_id y cfdi_uuid) | 'no_emitida'
--   cancelacion: 'cancelada' | 'no_cancelada'
-- Exige una nota de evidencia. Nunca la puede invocar un cliente del navegador.
CREATE OR REPLACE FUNCTION public.conciliar_operacion_cfdi(p_operacion_id UUID, p_resolucion TEXT, p_datos JSONB, p_actor_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_op    cfdi_operaciones%ROWTYPE;
  v_actor usuarios%ROWTYPE;
  v_nota  TEXT := NULLIF(btrim(COALESCE(p_datos->>'evidencia', '')), '');
  v_d     JSONB;
BEGIN
  SELECT * INTO v_actor FROM usuarios WHERE id = p_actor_id;
  IF NOT FOUND OR v_actor.estatus IS DISTINCT FROM 'Activo' OR v_actor.rol NOT IN ('Admin', 'Facturación') THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: solo Admin o Facturación concilian' USING ERRCODE = '42501';
  END IF;
  IF v_nota IS NULL THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la conciliación requiere evidencia (consulta al proveedor)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_op FROM cfdi_operaciones WHERE id = p_operacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: operación % no existe', p_operacion_id USING ERRCODE = '22023';
  END IF;
  IF v_op.estado = 'en_curso' AND v_op.lease_hasta >= now() THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la operación sigue en curso (lease vigente)' USING ERRCODE = '55000';
  END IF;
  IF v_op.estado NOT IN ('en_curso', 'incierta', 'revision', 'cancelacion_pendiente') THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: la operación ya está resuelta (%)', v_op.estado USING ERRCODE = '55000';
  END IF;
  IF NOT ((v_op.tipo = 'emision' AND p_resolucion IN ('emitida', 'no_emitida'))
       OR (v_op.tipo = 'cancelacion' AND p_resolucion IN ('cancelada', 'no_cancelada'))) THEN
    RAISE EXCEPTION 'conciliar_operacion_cfdi: resolución % no aplica a una %', p_resolucion, v_op.tipo USING ERRCODE = '22023';
  END IF;
  v_d := COALESCE(p_datos, '{}'::jsonb) || jsonb_build_object('detalle', jsonb_build_object('conciliacion',
           jsonb_build_object('resolucion', p_resolucion, 'evidencia', v_nota, 'actor', v_actor.nombre, 'actor_id', v_actor.id, 'at', now(), 'estado_previo', v_op.estado)));
  RETURN cfdi_aplicar_resultado(v_op.id,
    CASE p_resolucion WHEN 'emitida' THEN 'emitida' WHEN 'cancelada' THEN 'cancelada' ELSE 'descartada' END, v_d);
END $$;

REVOKE ALL ON FUNCTION public.reservar_operacion_cfdi(BIGINT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cfdi_aplicar_resultado(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.finalizar_operacion_cfdi(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.vencer_operaciones_cfdi() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.conciliar_operacion_cfdi(UUID, TEXT, JSONB, BIGINT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reservar_operacion_cfdi(BIGINT, TEXT, BIGINT, TEXT, TEXT, TEXT, INTEGER) TO service_role;
GRANT EXECUTE ON FUNCTION public.finalizar_operacion_cfdi(UUID, TEXT, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.vencer_operaciones_cfdi() TO service_role;
GRANT EXECUTE ON FUNCTION public.conciliar_operacion_cfdi(UUID, TEXT, JSONB, BIGINT) TO service_role;
