-- 142_recuperacion_admin_ruta.sql — T5-D2: recuperación administrativa y cierre
-- seguro de rutas.
--
-- Causa raíz (auditoría T5-D2, 2026-10-12, confirmada en código):
--   A. "Cerrar ruta (admin)" eran DOS llamadas del cliente: primero sellaba un
--      cierre financiero vacío (uno por ruta) y después intentaba el cierre de
--      inventario. Si el conteo no cuadraba, la marca quedaba y el chofer ya no
--      podía registrar su cierre ("ya tiene cierre financiero con otras entregas").
--   B. Una ruta Cargada (producto fuera del cuarto frío) con el chofer ausente no
--      tenía salida: no se puede cancelar, y el cierre exige En progreso.
--   C. El faltante del conteo se registraba como merma con causa libre: nada lo
--      distinguía de una merma comprobada.
--   D. Una entrega con link de pago sin cobrar quedaba sin cobro ni cuenta y sin
--      ningún aviso después del cierre.
--
-- Decisiones del dueño: faltante sin evidencia = FALTANTE NO JUSTIFICADO,
-- distinto de una merma (D2-1); un link pendiente no bloquea el cierre físico
-- pero sigue visible y pendiente (D2-2); todo cierre de Administración lleva
-- motivo, actor y hora del servidor, estado anterior y operación idempotente
-- (D2-3); si el camión nunca salió, sus órdenes se liberan a Creada en la misma
-- transacción (D2-5); cualquier Admin registra faltantes (D2-6).
--
--   1. `ruta_intervenciones` — una fila por intervención de Administración
--      (operación, tipo, motivo, actor, estado anterior, resultado). Sin API.
--   2. `ruta_faltantes` — liga una merma de ruta a un faltante no justificado.
--      La distinción es ESTRUCTURAL: una merma con fila aquí es un faltante; sin
--      ella, una merma ordinaria. Sin API.
--   3. `ruta_cobros_pendientes(ruta)` — lectura: entregas de ruta sin dinero
--      completo y sin cuenta por cobrar, clasificadas `link` (pago por link que
--      no ha llegado) o `sin_registro` (contado o crédito sin su registro).
--      Admin (todas, o una ruta) o el Chofer de esa ruta.
--   4. `conciliacion_ruta(ruta)` — lectura, Admin: lo que hay que ver antes de
--      cerrar (diagnóstico de 138 + cobrado por método, crédito, cobros
--      pendientes, mermas y faltantes, ventas rápidas, cierre de caja e
--      intervenciones). Solo datos que el servidor tiene.
--   5. `iniciar_ruta_admin(operación, ruta, motivo)` — el camión salió pero el
--      chofer no inició en la aplicación: Cargada → En progreso con motivo. No
--      inventa una hora de salida (el sistema nunca la ha registrado).
--   6. `cerrar_ruta_admin(operación, ruta, tipo, conteo, faltantes, motivo)` —
--      UNA transacción: candado de la ruta → sin órdenes pendientes (o, si el
--      camión no salió, las libera a Creada) → sin entregas sin registro
--      financiero → marca financiera (la existente, o `cerrar_ruta_financiero`
--      con lista vacía) → faltantes declarados = faltante real del conteo →
--      `finalizar_inventario_ruta` → intervención y auditoría. Si algo falla no
--      queda NADA: ni marca, ni estado, ni faltante, ni orden liberada.
--
-- Lo que NO cambia: `cerrar_ruta_financiero`, `finalizar_inventario_ruta`,
-- `registrar_merma`, `revertir_merma`, `registrar_no_entrega`,
-- `entregar_orden_ruta`, `revertir_entrega_ruta`, `diagnostico_ruta`,
-- `registrar_venta_rapida_ruta`, `cerrar_caja_ruta`, las guardas, costos y
-- contabilidad (una merma de ruta no genera egreso desde 106). No crea, mueve
-- ni repara datos.
--
-- Un faltante no justificado no se puede revertir: nace en la misma transacción
-- que cierra la ruta y `revertir_merma` (087) rechaza las mermas de una ruta
-- cerrada. Queda como registro permanente.
--
-- Idempotente. Reversión (sin intervenciones registradas): DROP de las seis
-- funciones y las dos tablas, y frontend anterior. Con intervenciones: conservar
-- las tablas (son el rastro) y volver solo al frontend anterior.

-- ═══ 1. Intervenciones de Administración sobre una ruta ═══
CREATE TABLE IF NOT EXISTS public.ruta_intervenciones (
  operacion_id    UUID PRIMARY KEY,
  ruta_id         BIGINT NOT NULL REFERENCES public.rutas(id),
  tipo            TEXT NOT NULL CHECK (tipo IN ('cierre_admin', 'no_salio', 'inicio_admin')),
  motivo          TEXT NOT NULL CHECK (length(btrim(motivo)) >= 10),
  huella          TEXT NOT NULL,
  actor_id        BIGINT,
  actor           TEXT NOT NULL,
  estado_anterior JSONB NOT NULL,
  resultado       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ruta_intervenciones_ruta ON public.ruta_intervenciones (ruta_id);
COMMENT ON TABLE public.ruta_intervenciones IS
  '142: una fila por intervención de Administración en una ruta (cierre, camión que no salió, inicio excepcional): operación idempotente, motivo, actor y hora del servidor, estado anterior y resultado. Solo la escriben cerrar_ruta_admin e iniciar_ruta_admin; sin acceso por API.';
ALTER TABLE public.ruta_intervenciones ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ruta_intervenciones FROM PUBLIC, anon, authenticated;

-- ═══ 2. Faltantes no justificados ═══
CREATE TABLE IF NOT EXISTS public.ruta_faltantes (
  id            BIGSERIAL PRIMARY KEY,
  merma_id      BIGINT NOT NULL UNIQUE REFERENCES public.mermas(id),
  ruta_id       BIGINT NOT NULL REFERENCES public.rutas(id),
  operacion_id  UUID NOT NULL REFERENCES public.ruta_intervenciones(operacion_id),
  sku           TEXT NOT NULL,
  cantidad      INTEGER NOT NULL CHECK (cantidad > 0),
  motivo        TEXT NOT NULL CHECK (length(btrim(motivo)) >= 10),
  actor_id      BIGINT,
  actor         TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ruta_faltantes_ruta ON public.ruta_faltantes (ruta_id);
COMMENT ON TABLE public.ruta_faltantes IS
  '142: faltante NO justificado del conteo de una ruta. Cada fila liga la fila de mermas que cuadra el balance del camión con su motivo, actor y hora: una merma con fila aquí NO es una merma comprobada. Solo la escribe cerrar_ruta_admin; sin acceso por API.';
ALTER TABLE public.ruta_faltantes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ruta_faltantes FROM PUBLIC, anon, authenticated;
REVOKE ALL ON SEQUENCE public.ruta_faltantes_id_seq FROM PUBLIC, anon, authenticated;

-- ═══ 3. Cobros pendientes de entregas de ruta ═══
-- Interno: sin autorización propia, sin EXECUTE por API.
CREATE OR REPLACE FUNCTION public.ruta_cobros_pendientes_interno(p_ruta_id BIGINT)
RETURNS TABLE (orden_id BIGINT, folio TEXT, cliente TEXT, ruta_id BIGINT, ruta_folio TEXT, ruta_estatus TEXT, estatus TEXT, metodo TEXT,
               total NUMERIC, cobrado NUMERIC, falta NUMERIC, tipo TEXT, entregada_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT o.id, o.folio, o.cliente_nombre, o.ruta_id, r.folio, r.estatus, o.estatus, o.metodo_pago,
         round(COALESCE(o.total, 0), 2), p.cobrado, round(COALESCE(o.total, 0), 2) - p.cobrado,
         CASE WHEN o.metodo_pago = 'QR / Link de pago' THEN 'link' ELSE 'sin_registro' END,
         o.delivered_at
    FROM ordenes o
    JOIN rutas r ON r.id = o.ruta_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(pg.monto), 0)::NUMERIC AS cobrado FROM pagos pg WHERE pg.orden_id = o.id) p
   WHERE o.ruta_id IS NOT NULL
     AND (p_ruta_id IS NULL OR o.ruta_id = p_ruta_id)
     AND o.estatus IN ('Entregada', 'Facturada')
     AND round(COALESCE(o.total, 0), 2) > 0
     AND p.cobrado < round(COALESCE(o.total, 0), 2)
     AND NOT EXISTS (SELECT 1 FROM cuentas_por_cobrar x WHERE x.orden_id = o.id)
   ORDER BY o.id
$$;
REVOKE ALL ON FUNCTION public.ruta_cobros_pendientes_interno(BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.ruta_cobros_pendientes(p_ruta_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol TEXT := fin_mi_rol_activo();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'ruta_cobros_pendientes: no autorizado' USING ERRCODE = '42501';
  END IF;
  -- El Chofer solo consulta SU ruta (para continuar su cierre); nunca el listado general.
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer' THEN
    IF p_ruta_id IS NULL OR NOT EXISTS (SELECT 1 FROM rutas r WHERE r.id = p_ruta_id AND r.chofer_id = erp_usuario_id()) THEN
      RAISE EXCEPTION 'ruta_cobros_pendientes: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.orden_id) FROM ruta_cobros_pendientes_interno(p_ruta_id) c), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.ruta_cobros_pendientes(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ruta_cobros_pendientes(BIGINT) TO authenticated, service_role;

-- ═══ 4. Conciliación de una ruta (lectura, solo Admin) ═══
CREATE OR REPLACE FUNCTION public.conciliacion_ruta(p_ruta_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_diag JSONB;
  v_ruta rutas%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'conciliacion_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  v_diag := diagnostico_ruta(p_ruta_id);   -- valida la ruta; inventario, órdenes, pendientes y revertidas (138)
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id;
  RETURN v_diag || jsonb_build_object(
    'chofer_id', v_ruta.chofer_id, 'chofer', v_ruta.chofer_nombre, 'fecha', v_ruta.fecha,
    'carga_confirmada_at', v_ruta.carga_confirmada_at, 'cierre_at', v_ruta.cierre_at,
    -- Dinero REGISTRADO, por la forma de cada pago (no por el método de la orden).
    'cobros_por_metodo', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('metodo', m.metodo, 'pagos', m.n, 'monto', m.monto) ORDER BY m.metodo)
        FROM (SELECT COALESCE(NULLIF(btrim(pg.metodo_pago), ''), 'Sin método') AS metodo, count(*) AS n, sum(pg.monto) AS monto
                FROM pagos pg JOIN ordenes o ON o.id = pg.orden_id WHERE o.ruta_id = p_ruta_id GROUP BY 1) m), '[]'::jsonb),
    'credito', (SELECT jsonb_build_object('cuentas', count(*), 'monto', COALESCE(sum(x.monto_original), 0), 'saldo', COALESCE(sum(x.saldo_pendiente), 0))
                  FROM cuentas_por_cobrar x JOIN ordenes o ON o.id = x.orden_id WHERE o.ruta_id = p_ruta_id),
    'cobros_pendientes', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY c.orden_id) FROM ruta_cobros_pendientes_interno(p_ruta_id) c), '[]'::jsonb),
    -- Mermas activas de la ruta; `faltante` = tiene fila en ruta_faltantes (no es una merma comprobada).
    'mermas', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('id', m.id, 'sku', m.sku, 'cantidad', m.cantidad, 'causa', m.causa, 'fecha', m.fecha,
                                          'con_foto', COALESCE(m.foto_url, '') <> '', 'faltante', f.id IS NOT NULL,
                                          'motivo', f.motivo, 'actor', f.actor) ORDER BY m.id)
        FROM mermas m LEFT JOIN ruta_faltantes f ON f.merma_id = m.id
       WHERE m.ruta_id = p_ruta_id AND m.estatus = 'Activa'), '[]'::jsonb),
    'ventas_rapidas', (SELECT jsonb_build_object('ventas', count(*), 'total', COALESCE(sum(o.total), 0))
                         FROM ventas_rapidas_ruta v JOIN ordenes o ON o.id = v.orden_id WHERE v.ruta_id = p_ruta_id),
    -- Efectivo contado contra esperado: es un paso aparte (cerrar_caja_ruta). NULL = no se ha hecho.
    'cierre_caja', (SELECT jsonb_build_object('fecha', d.fecha, 'esperado_efectivo', d.esperado_efectivo, 'contado_efectivo', d.contado_efectivo,
                                              'diferencia', d.diferencia, 'motivo_diferencia', d.motivo_diferencia, 'cerrado_por', d.cerrado_por)
                      FROM cierres_diarios d WHERE d.ruta_id = p_ruta_id ORDER BY d.id DESC LIMIT 1),
    'intervenciones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('operacion_id', i.operacion_id, 'tipo', i.tipo, 'motivo', i.motivo, 'actor', i.actor, 'fecha', i.created_at,
                                          'estado_anterior', i.estado_anterior ->> 'estatus') ORDER BY i.created_at)
        FROM ruta_intervenciones i WHERE i.ruta_id = p_ruta_id), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.conciliacion_ruta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.conciliacion_ruta(BIGINT) TO authenticated, service_role;

-- ═══ 5. Inicio excepcional por Administración (el camión salió sin inicio digital) ═══
CREATE OR REPLACE FUNCTION public.iniciar_ruta_admin(p_operacion_id UUID, p_ruta_id BIGINT, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_motivo   TEXT := btrim(COALESCE(p_motivo, ''));
  v_huella   TEXT;
  v_prev     ruta_intervenciones%ROWTYPE;
  v_ruta     rutas%ROWTYPE;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'iniciar_ruta_admin: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'iniciar_ruta_admin: operación y ruta son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escribe el motivo de la intervención (mínimo 10 letras): por qué Administración inicia esta ruta' USING ERRCODE = '22023';
  END IF;
  v_huella := md5(jsonb_build_object('ruta', p_ruta_id, 'tipo', 'inicio_admin', 'motivo', v_motivo)::text);

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'iniciar_ruta_admin: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_prev FROM ruta_intervenciones WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella AND v_prev.ruta_id = p_ruta_id THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true);
    END IF;
    RAISE EXCEPTION 'iniciar_ruta_admin: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus <> 'Cargada' OR v_ruta.carga_confirmada_at IS NULL THEN
    RAISE EXCEPTION 'La ruta % está %: Administración solo inicia una ruta con el camión cargado y sin iniciar.', COALESCE(v_ruta.folio, p_ruta_id::text), v_ruta.estatus
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTADO_NO_VALIDO', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;

  PERFORM fin_marcar_ctx();
  UPDATE rutas SET estatus = 'En progreso' WHERE id = p_ruta_id;

  v_res := jsonb_build_object('ok', true, 'replay', false, 'tipo', 'inicio_admin', 'ruta_id', p_ruta_id, 'folio', v_ruta.folio,
                              'estatus_anterior', 'Cargada', 'estatus', 'En progreso', 'operacion_id', p_operacion_id,
                              'actor', v_etiqueta, 'registrada_at', now());
  INSERT INTO ruta_intervenciones (operacion_id, ruta_id, tipo, motivo, huella, actor_id, actor, estado_anterior, resultado)
  VALUES (p_operacion_id, p_ruta_id, 'inicio_admin', v_motivo, v_huella, v_actor_id, v_etiqueta,
          jsonb_build_object('estatus', v_ruta.estatus, 'carga_confirmada_at', v_ruta.carga_confirmada_at, 'chofer_id', v_ruta.chofer_id, 'chofer', v_ruta.chofer_nombre), v_res);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Iniciar ruta (Administración)', 'Rutas',
          left('Ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text) || ' — Cargada → En progreso por Administración (el chofer no la inició). Motivo: ' || v_motivo, 500));
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.iniciar_ruta_admin(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.iniciar_ruta_admin(UUID, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 6. Cierre de ruta por Administración: todo o nada ═══
CREATE OR REPLACE FUNCTION public.cerrar_ruta_admin(
  p_operacion_id UUID, p_ruta_id BIGINT, p_tipo TEXT, p_conteo JSONB, p_faltantes JSONB, p_motivo TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id  BIGINT := erp_usuario_id();
  v_etiqueta  TEXT := erp_actor_etiqueta();
  v_tipo      TEXT := btrim(COALESCE(p_tipo, ''));
  v_motivo    TEXT := btrim(COALESCE(p_motivo, ''));
  v_conteo    JSONB := '{}'::jsonb;
  v_falt      JSONB := '{}'::jsonb;     -- declarado: {sku: cantidad}
  v_real      JSONB := '{}'::jsonb;     -- faltante real del conteo: {sku: cantidad}
  v_k         TEXT;
  v_v         JSONB;
  v_f         JSONB;
  v_q         INTEGER;
  v_huella    TEXT;
  v_prev      ruta_intervenciones%ROWTYPE;
  v_ruta      rutas%ROWTYPE;
  v_antes     JSONB;
  v_pend      JSONB;
  v_sinreg    JSONB;
  v_links     JSONB;
  v_ops       TEXT;
  v_liberadas JSONB := '[]'::jsonb;
  v_marca     TEXT;
  v_b         RECORD;
  v_m         JSONB;
  v_faltantes JSONB := '[]'::jsonb;
  v_inv       JSONB;
  v_res       JSONB;
BEGIN
  -- Autorización ANTES de marcar el contexto (dentro de fin_ctx los contratos internos ya no revisan rol).
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: operación y ruta son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_tipo <> ALL (ARRAY['cierre_admin', 'no_salio']) THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: tipo de cierre inválido: %', COALESCE(NULLIF(v_tipo, ''), '(vacío)') USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 10 THEN
    RAISE EXCEPTION 'Escribe el motivo de la intervención (mínimo 10 letras): por qué cierra Administración y no el chofer' USING ERRCODE = '22023';
  END IF;
  IF p_conteo IS NULL OR jsonb_typeof(p_conteo) <> 'object' THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: el conteo debe ser un objeto {sku: cantidad}' USING ERRCODE = '22023';
  END IF;
  -- Conteo normalizado como en finalizar_inventario_ruta: enteros ≥ 0; los ceros se omiten.
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_conteo) LOOP
    IF jsonb_typeof(v_v) NOT IN ('number', 'string') OR (v_v #>> '{}') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'cerrar_ruta_admin: cantidad inválida en el conteo para %', v_k USING ERRCODE = '22023';
    END IF;
    v_q := (v_v #>> '{}')::INTEGER;
    IF v_q > 0 THEN
      v_conteo := v_conteo || jsonb_build_object(btrim(v_k), v_q + COALESCE((v_conteo ->> btrim(v_k))::INTEGER, 0));
    END IF;
  END LOOP;
  -- Faltantes declarados: [{sku, cantidad}], enteros > 0, un renglón por producto.
  IF p_faltantes IS NOT NULL AND jsonb_typeof(p_faltantes) NOT IN ('array', 'null') THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: los faltantes deben ser una lista [{sku, cantidad}]' USING ERRCODE = '22023';
  END IF;
  IF p_faltantes IS NOT NULL AND jsonb_typeof(p_faltantes) = 'array' THEN
    FOR v_f IN SELECT * FROM jsonb_array_elements(p_faltantes) LOOP
      v_k := btrim(COALESCE(v_f ->> 'sku', ''));
      IF v_k = '' OR COALESCE(v_f ->> 'cantidad', '') !~ '^[0-9]+$' OR (v_f ->> 'cantidad')::INTEGER <= 0 THEN
        RAISE EXCEPTION 'cerrar_ruta_admin: faltante inválido (producto y cantidad entera mayor a 0)' USING ERRCODE = '22023';
      END IF;
      IF v_falt ? v_k THEN
        RAISE EXCEPTION 'cerrar_ruta_admin: el producto % está repetido en los faltantes', v_k USING ERRCODE = '22023';
      END IF;
      v_falt := v_falt || jsonb_build_object(v_k, (v_f ->> 'cantidad')::INTEGER);
    END LOOP;
  END IF;
  v_huella := md5(jsonb_build_object('ruta', p_ruta_id, 'tipo', v_tipo, 'conteo', v_conteo, 'faltantes', v_falt, 'motivo', v_motivo)::text);

  -- Candado de la ruta: el mismo que toman entregas, ventas rápidas, mermas y el cierre del chofer.
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'cerrar_ruta_admin: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;

  -- Reintento (doble clic, respuesta perdida): misma operación y mismos datos = misma respuesta.
  SELECT * INTO v_prev FROM ruta_intervenciones WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella AND v_prev.ruta_id = p_ruta_id THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true);
    END IF;
    RAISE EXCEPTION 'cerrar_ruta_admin: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus IN ('Cerrada', 'Cancelada', 'Completada') THEN
    RAISE EXCEPTION 'La ruta % ya está %: no hay nada que cerrar.', COALESCE(v_ruta.folio, p_ruta_id::text), lower(v_ruta.estatus)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RUTA_YA_CERRADA', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;
  IF v_ruta.carga_confirmada_at IS NULL THEN
    RAISE EXCEPTION 'La ruta % no tiene carga confirmada: no hay producto que devolver. Cancélala desde Rutas.', COALESCE(v_ruta.folio, p_ruta_id::text)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'SIN_CARGA', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;

  IF v_tipo = 'no_salio' THEN
    -- El camión nunca salió: solo desde Cargada y sin NINGUNA operación de ruta.
    IF v_ruta.estatus <> 'Cargada' THEN
      RAISE EXCEPTION 'La ruta % está %: "el camión no salió" solo aplica con el camión cargado y la ruta sin iniciar.', COALESCE(v_ruta.folio, p_ruta_id::text), v_ruta.estatus
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTADO_NO_VALIDO', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
    END IF;
    v_ops := concat_ws(', ',
      (SELECT count(*) || ' entrega(s)' FROM ordenes WHERE ruta_id = p_ruta_id AND estatus IN ('Entregada', 'Facturada') HAVING count(*) > 0),
      (SELECT count(*) || ' venta(s) rápida(s)' FROM ventas_rapidas_ruta WHERE ruta_id = p_ruta_id HAVING count(*) > 0),
      (SELECT count(*) || ' merma(s)' FROM mermas WHERE ruta_id = p_ruta_id AND estatus = 'Activa' HAVING count(*) > 0),
      (SELECT count(*) || ' orden(es) No entregada(s)' FROM ordenes WHERE ruta_id = p_ruta_id AND estatus = 'No entregada' HAVING count(*) > 0));
    IF COALESCE(v_ops, '') <> '' THEN
      RAISE EXCEPTION 'La ruta % ya tiene operaciones (%): el camión sí salió. Regístralo con "El camión salió" y ciérrala con su conteo.', COALESCE(v_ruta.folio, p_ruta_id::text), v_ops
        USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'NO_SALIO_CON_OPERACIONES', 'ruta_id', p_ruta_id, 'operaciones', v_ops)::text;
    END IF;
  ELSIF v_ruta.estatus <> 'En progreso' THEN
    RAISE EXCEPTION 'La ruta % está %: elige si el camión no salió (devolver toda la carga) o si salió sin iniciar (registrar la salida) antes de cerrarla.', COALESCE(v_ruta.folio, p_ruta_id::text), v_ruta.estatus
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTADO_NO_VALIDO', 'ruta_id', p_ruta_id, 'estatus', v_ruta.estatus)::text;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('orden_id', o.id, 'folio', o.folio, 'cliente', o.cliente_nombre, 'estatus', o.estatus) ORDER BY o.id), '[]'::jsonb)
    INTO v_pend FROM ordenes o WHERE o.ruta_id = p_ruta_id AND o.estatus IN ('Asignada', 'En ruta');
  IF v_tipo = 'cierre_admin' AND jsonb_array_length(v_pend) > 0 THEN
    RAISE EXCEPTION 'La ruta % tiene % orden(es) sin resolver (%). Resuélvelas una por una (entregada o no entregada) antes de cerrar.', COALESCE(v_ruta.folio, p_ruta_id::text),
      jsonb_array_length(v_pend), (SELECT string_agg(x ->> 'folio', ', ') FROM jsonb_array_elements(v_pend) x)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ORDENES_PENDIENTES', 'ruta_id', p_ruta_id, 'ordenes', v_pend)::text;
  END IF;

  -- Dinero: una entrega de contado o a crédito sin su registro bloquea; un link pendiente NO
  -- (D2-2): se conserva como fotografía y sigue pendiente después del cierre.
  SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.orden_id) FILTER (WHERE c.tipo = 'sin_registro'), '[]'::jsonb),
         COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.orden_id) FILTER (WHERE c.tipo = 'link'), '[]'::jsonb)
    INTO v_sinreg, v_links FROM ruta_cobros_pendientes_interno(p_ruta_id) c;
  IF jsonb_array_length(v_sinreg) > 0 THEN
    RAISE EXCEPTION 'La ruta % tiene % entrega(s) sin cobro ni cuenta por cobrar (%). Registra cómo se cobró cada una antes de cerrar.', COALESCE(v_ruta.folio, p_ruta_id::text),
      jsonb_array_length(v_sinreg), (SELECT string_agg(x ->> 'folio', ', ') FROM jsonb_array_elements(v_sinreg) x)
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ENTREGAS_SIN_REGISTRO', 'ruta_id', p_ruta_id, 'ordenes', v_sinreg)::text;
  END IF;

  v_antes := jsonb_build_object(
    'estatus', v_ruta.estatus, 'chofer_id', v_ruta.chofer_id, 'chofer', v_ruta.chofer_nombre, 'carga_confirmada_at', v_ruta.carga_confirmada_at,
    'marca_financiera', EXISTS (SELECT 1 FROM cierres_financieros_ruta c WHERE c.ruta_id = p_ruta_id),
    'inventario', (SELECT COALESCE(jsonb_agg(to_jsonb(b) ORDER BY b.sku), '[]'::jsonb) FROM ruta_inventario_resumen(p_ruta_id) b),
    'ordenes_pendientes', v_pend, 'links_pendientes', v_links);

  PERFORM fin_marcar_ctx();

  IF v_tipo = 'no_salio' THEN
    -- D2-5: nadie intentó entregarlas. Vuelven a Creada, sin ruta (como al cancelar una ruta sin carga).
    WITH lib AS (
      UPDATE ordenes SET estatus = 'Creada', ruta_id = NULL
       WHERE ruta_id = p_ruta_id AND estatus IN ('Asignada', 'En ruta')
      RETURNING id, folio)
    SELECT COALESCE(jsonb_agg(jsonb_build_object('orden_id', id, 'folio', folio) ORDER BY id), '[]'::jsonb) INTO v_liberadas FROM lib;
    -- Paso técnico: finalizar_inventario_ruta exige En progreso. Ocurre dentro de la transacción,
    -- no registra hora de salida y la intervención queda como `no_salio` (estado anterior: Cargada).
    UPDATE rutas SET estatus = 'En progreso' WHERE id = p_ruta_id;
  END IF;

  -- Marca financiera: la que exista se reutiliza (ya se comprobó arriba que ninguna entrega quedó
  -- sin registro); si no existe se crea AQUÍ, dentro de la transacción.
  IF EXISTS (SELECT 1 FROM cierres_financieros_ruta c WHERE c.ruta_id = p_ruta_id) THEN
    v_marca := 'reutilizada';
  ELSE
    PERFORM cerrar_ruta_financiero(md5(p_operacion_id::text || ':fin')::uuid, p_ruta_id, '[]'::jsonb, NULL, NULL);
    v_marca := 'creada';
  END IF;

  -- D2-1: el faltante declarado debe ser EXACTAMENTE el faltante real del conteo.
  FOR v_b IN SELECT * FROM balance_ruta_interno(p_ruta_id) LOOP
    v_q := v_b.restante - COALESCE((v_conteo ->> v_b.sku)::INTEGER, 0);
    IF v_q > 0 THEN
      v_real := v_real || jsonb_build_object(v_b.sku, v_q);
    END IF;
  END LOOP;
  IF v_real <> v_falt THEN
    RAISE EXCEPTION 'El faltante declarado no coincide con el conteo: falta % y se declaró %. No se cerró nada: revisa el conteo y declara cada faltante.',
      CASE WHEN v_real = '{}'::jsonb THEN 'nada' ELSE v_real::text END, CASE WHEN v_falt = '{}'::jsonb THEN 'nada' ELSE v_falt::text END
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'FALTANTE_NO_COINCIDE', 'ruta_id', p_ruta_id, 'faltante', v_real, 'declarado', v_falt)::text;
  END IF;

  -- La intervención va antes de sus faltantes (llave foránea); el resultado se completa al final.
  INSERT INTO ruta_intervenciones (operacion_id, ruta_id, tipo, motivo, huella, actor_id, actor, estado_anterior, resultado)
  VALUES (p_operacion_id, p_ruta_id, v_tipo, v_motivo, v_huella, v_actor_id, v_etiqueta, v_antes, '{}'::jsonb);

  -- El faltante cuadra el balance con la fila de mermas (el ledger existente: sin egreso contable
  -- ni cambio de costo desde 106); ruta_faltantes dice que NO es una merma comprobada.
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(v_falt) ORDER BY key LOOP
    v_m := registrar_merma(v_k, (v_v #>> '{}')::INTEGER, left('FALTANTE NO JUSTIFICADO — ' || v_motivo, 300), NULL, NULL, p_ruta_id, true);
    INSERT INTO ruta_faltantes (merma_id, ruta_id, operacion_id, sku, cantidad, motivo, actor_id, actor)
    VALUES ((v_m ->> 'id')::BIGINT, p_ruta_id, p_operacion_id, v_k, (v_v #>> '{}')::INTEGER, v_motivo, v_actor_id, v_etiqueta);
    v_faltantes := v_faltantes || jsonb_build_object('sku', v_k, 'cantidad', (v_v #>> '{}')::INTEGER, 'merma_id', (v_m ->> 'id')::BIGINT);
  END LOOP;

  -- Conteo, devolución a los cuartos de origen y cierre: el contrato de siempre. Si rechaza
  -- (sobrante, pendientes, balance ambiguo), TODO lo anterior se deshace.
  v_inv := finalizar_inventario_ruta(md5(p_operacion_id::text || ':inv')::uuid, p_ruta_id, v_conteo);

  v_res := jsonb_build_object('ok', true, 'replay', false, 'tipo', v_tipo, 'ruta_id', p_ruta_id, 'folio', v_ruta.folio,
                              'estatus_anterior', v_ruta.estatus, 'estatus', 'Cerrada', 'devolucion', v_inv -> 'devolucion',
                              'faltantes', v_faltantes, 'ordenes_liberadas', v_liberadas, 'links_pendientes', jsonb_array_length(v_links),
                              'marca_financiera', v_marca, 'operacion_id', p_operacion_id, 'actor', v_etiqueta, 'registrada_at', now());
  UPDATE ruta_intervenciones SET resultado = v_res WHERE operacion_id = p_operacion_id;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, CASE WHEN v_tipo = 'no_salio' THEN 'Cerrar ruta: el camión no salió' ELSE 'Cerrar ruta (Administración)' END, 'Rutas',
          left('Ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text) || ' — ' || v_ruta.estatus || ' → Cerrada — devuelto: '
               || COALESCE((SELECT string_agg(value || '×' || key, ', ' ORDER BY key) FROM jsonb_each_text(v_conteo)), '0')
               || CASE WHEN jsonb_array_length(v_faltantes) > 0 THEN ' — FALTANTE NO JUSTIFICADO: '
                         || (SELECT string_agg((x ->> 'cantidad') || '×' || (x ->> 'sku'), ', ') FROM jsonb_array_elements(v_faltantes) x) ELSE '' END
               || CASE WHEN jsonb_array_length(v_liberadas) > 0 THEN ' — ' || jsonb_array_length(v_liberadas) || ' orden(es) liberada(s)' ELSE '' END
               || CASE WHEN jsonb_array_length(v_links) > 0 THEN ' — ' || jsonb_array_length(v_links) || ' link(s) de pago pendiente(s)' ELSE '' END
               || ' — Motivo: ' || v_motivo, 500));
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.cerrar_ruta_admin(UUID, BIGINT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cerrar_ruta_admin(UUID, BIGINT, TEXT, JSONB, JSONB, TEXT) TO authenticated, service_role;
