-- 135_correcciones_tanda1.sql — correcciones de la revisión profunda del 2026-10-10
-- (tanda 1): tres defectos de 130/133/134 hallados leyendo el código, antes de
-- que hubiera operación real. Idempotente. Mismas firmas, respuestas y permisos.
--
--   1. Comisiones (130): al generar la semana NUEVA antes de pagar la anterior,
--      el renglón nuevo se llevaba las entregas de la semana anterior (su ventana
--      empieza en la primera semana del concepto y gana quien calcula primero).
--      La anterior se pagaba con comisión $0 y el dinero salía una semana tarde.
--      Ahora lo entregado en OTRA semana en borrador (con recibo de la persona)
--      se queda en esa semana; solo se recoge lo de semanas pagadas o no generadas.
--   2. Recalcular (130): si lo ganado bajaba (se perdió el bono por faltas, se
--      canceló una venta comisionada) y había un descuento, el neto quedaba
--      negativo, el CHECK de 100 abortaba "Actualizar cálculos" para TODA la
--      semana y el mensaje no decía qué recibo. Ahora el descuento se recorta a
--      lo disponible (misma regla que al proponerlo, 128) y lo dice en el renglón.
--      Además: un renglón que fue automático se vuelve a calcular aunque al
--      concepto le hayan quitado la regla (antes se quedaba en $0).
--   3. Venta de picada / triturada (133): bloqueaba cuarto → bolsa, al revés que
--      Producción (bolsa → cuarto). Dos operaciones simultáneas en el mismo
--      cuarto podían abortar una con "deadlock detected". Ahora la venta bloquea
--      primero la bolsa. Sin cambio de resultado.
--   4. Evidencias (134): Facturación veía las filas pero el almacenamiento no le
--      deja abrir las fotos (policy del bucket, 072): tarjetas rotas. La lectura
--      queda para Admin y para quien subió la foto.
--
-- Reversión: volver a aplicar 130 (funciones), 133 (completar_venta_directa) y
-- la policy de 134.

-- ═══ 1. Comisión de un renglón (130 + lo de otra semana en borrador no se toca) ═══
CREATE OR REPLACE FUNCTION public.nomina_comision_linea(p_linea_id BIGINT, p_tasa NUMERIC, OUT monto NUMERIC, OUT detalle TEXT)
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_l       nomina_recibo_lineas%ROWTYPE;
  v_r       nomina_recibos%ROWTYPE;
  v_per     nomina_periodos%ROWTYPE;
  v_c       nomina_conceptos%ROWTYPE;
  v_usuario BIGINT;
  v_desde   DATE;
  v_hasta   DATE;
  v_n       INTEGER;
  v_prev    INTEGER;
  v_base    NUMERIC;
  v_uni     BIGINT;
  v_que     TEXT;
BEGIN
  SELECT * INTO v_l FROM nomina_recibo_lineas WHERE id = p_linea_id;
  SELECT * INTO v_r FROM nomina_recibos WHERE id = v_l.recibo_id;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_r.periodo_id;
  SELECT * INTO v_c FROM nomina_conceptos WHERE id = v_l.concepto_id;
  SELECT usuario_id INTO v_usuario FROM empleados WHERE id = v_r.empleado_id;

  DELETE FROM nomina_linea_ordenes WHERE linea_id = p_linea_id;
  IF v_c.base_rol IN ('vendedor', 'chofer') AND v_usuario IS NULL THEN
    monto := 0; detalle := 'Sin usuario ligado a la persona: no se pudo calcular';
    RETURN;
  END IF;

  SELECT LEAST(v_per.fecha_inicio, min(p.fecha_inicio)) INTO v_desde
    FROM nomina_recibo_lineas l JOIN nomina_recibos r ON r.id = l.recibo_id JOIN nomina_periodos p ON p.id = r.periodo_id
   WHERE l.concepto_id = v_c.id AND r.empleado_id = v_r.empleado_id;
  v_desde := GREATEST(COALESCE(v_desde, v_per.fecha_inicio), COALESCE(v_c.vigente_desde, v_per.fecha_inicio - 3650));
  v_hasta := LEAST(v_per.fecha_fin, COALESCE(v_c.vigente_hasta, v_per.fecha_fin));

  INSERT INTO nomina_linea_ordenes (linea_id, concepto_id, empleado_id, orden_id, base, unidades)
  SELECT p_linea_id, v_c.id, v_r.empleado_id, o.id,
         CASE WHEN x.n = 0 THEN COALESCE(o.total, 0) ELSE x.base END, x.unidades
    FROM ordenes o
    LEFT JOIN rutas ru ON ru.id = o.ruta_id
    CROSS JOIN LATERAL (SELECT COALESCE(sum(ol.subtotal), 0) AS base, COALESCE(sum(ol.cantidad), 0)::INTEGER AS unidades, count(*) AS n
                          FROM orden_lineas ol
                         WHERE ol.orden_id = o.id AND (v_c.skus IS NULL OR ol.sku::TEXT = ANY (v_c.skus))) x
   WHERE o.delivered_at IS NOT NULL AND o.estatus IN ('Entregada', 'Facturada')
     AND (o.delivered_at AT TIME ZONE fin_zona_negocio())::date BETWEEN v_desde AND v_hasta
     AND (x.n > 0 OR v_c.skus IS NULL)
     -- 135: lo entregado en OTRA semana que sigue en borrador (con recibo de la persona) es de
     -- esa semana: no se le quita. Solo se recoge lo de semanas ya pagadas o nunca generadas.
     AND NOT EXISTS (SELECT 1 FROM nomina_periodos p2 JOIN nomina_recibos r2 ON r2.periodo_id = p2.id
                      WHERE p2.id <> v_per.id AND p2.estatus <> 'Pagado' AND r2.empleado_id = v_r.empleado_id
                        AND (o.delivered_at AT TIME ZONE fin_zona_negocio())::date BETWEEN p2.fecha_inicio AND p2.fecha_fin)
     AND CASE v_c.base_rol WHEN 'vendedor' THEN o.vendedor_id = v_usuario
                           WHEN 'chofer' THEN ru.chofer_id = v_usuario
                           ELSE ru.ayudante_id = v_r.empleado_id END
  ON CONFLICT ON CONSTRAINT nomina_linea_ordenes_una_vez DO NOTHING;

  SELECT count(*), COALESCE(sum(lo.base), 0), COALESCE(sum(lo.unidades), 0),
         count(*) FILTER (WHERE (o.delivered_at AT TIME ZONE fin_zona_negocio())::date < v_per.fecha_inicio)
    INTO v_n, v_base, v_uni, v_prev
    FROM nomina_linea_ordenes lo JOIN ordenes o ON o.id = lo.orden_id WHERE lo.linea_id = p_linea_id;

  v_que := CASE WHEN v_c.base_rol = 'vendedor' THEN CASE WHEN v_n = 1 THEN 'venta' ELSE 'ventas' END
                ELSE CASE WHEN v_n = 1 THEN 'entrega' ELSE 'entregas' END END;
  IF v_c.calculo = 'porcentaje_ventas' THEN
    monto := round(v_base * p_tasa / 100, 2);
    detalle := v_n || ' ' || v_que || ' · $' || to_char(v_base, 'FM999,999,990.00') || ' × ' || trim(to_char(p_tasa, 'FM990.99'), '.') || '%';
  ELSIF v_c.calculo = 'por_unidad' THEN
    monto := round(v_uni * p_tasa, 2);
    detalle := v_n || ' ' || v_que || ' · ' || v_uni || CASE WHEN v_uni = 1 THEN ' bolsa' ELSE ' bolsas' END || ' × $' || to_char(p_tasa, 'FM999,990.00');
  ELSE
    monto := round(v_n * p_tasa, 2);
    detalle := v_n || ' ' || v_que || ' × $' || to_char(p_tasa, 'FM999,990.00');
  END IF;
  IF v_prev > 0 THEN
    detalle := detalle || ' (incluye ' || v_prev || ' de semanas anteriores)';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.nomina_comision_linea(BIGINT, NUMERIC) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Proponer / recalcular un recibo (130 + recorte de descuentos y renglones que fueron automáticos) ═══
CREATE OR REPLACE FUNCTION public.nomina_proponer_recibo(p_recibo_id BIGINT, p_recalcular BOOLEAN) RETURNS INTEGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_r     nomina_recibos%ROWTYPE;
  v_per   nomina_periodos%ROWTYPE;
  v_c     RECORD;
  v_as    RECORD;
  v_m     NUMERIC;
  v_prop  NUMERIC;
  v_disp  NUMERIC;
  v_det   TEXT;
  v_lid   BIGINT;
  v_nueva BOOLEAN;
  v_antes NUMERIC;
  v_final NUMERIC;
  v_n     INTEGER := 0;
  v_exc   NUMERIC;
  v_d     RECORD;
  v_q     NUMERIC;
BEGIN
  SELECT * INTO v_r FROM nomina_recibos WHERE id = p_recibo_id FOR UPDATE;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_r.periodo_id;
  -- Serializa los topes de esta persona (128).
  PERFORM 1 FROM nomina_concepto_empleados WHERE empleado_id = v_r.empleado_id AND limite_total IS NOT NULL ORDER BY concepto_id FOR UPDATE;

  FOR v_c IN
    SELECT x.*, l.id AS linea_id, l.monto AS l_monto, l.propuesto AS l_propuesto
      FROM nomina_conceptos_propuestos(v_r.empleado_id, v_per.fecha_inicio, v_per.fecha_fin, v_r.salario_diario, p_recibo_id) x
      LEFT JOIN nomina_recibo_lineas l ON l.recibo_id = p_recibo_id AND l.concepto_id = x.concepto_id
     -- 135: un renglón que FUE automático (tiene explicación) se vuelve a calcular aunque al
     -- concepto ya le hayan quitado la regla: si no, se quedaba en 0 para siempre.
     WHERE l.id IS NULL OR (COALESCE(p_recalcular, false) AND (x.automatico OR l.detalle IS NOT NULL))
     ORDER BY (x.tipo = 'descuento'), x.concepto_id
  LOOP
    IF NOT v_c.automatico AND v_c.linea_id IS NULL THEN
      -- Concepto fijo o % del salario diario: exactamente como 128.
      v_m := v_c.monto;
      IF v_c.tipo = 'descuento' THEN
        SELECT v_r.sueldo + v_r.septimo_dia + COALESCE(sum(l.monto) FILTER (WHERE l.tipo = 'percepcion'), 0)
               - COALESCE(sum(l.monto) FILTER (WHERE l.tipo = 'descuento'), 0)
          INTO v_disp FROM nomina_recibo_lineas l WHERE l.recibo_id = p_recibo_id;
        v_m := LEAST(v_m, GREATEST(v_disp, 0));
      END IF;
      CONTINUE WHEN v_m <= 0;
      INSERT INTO nomina_recibo_lineas (recibo_id, concepto_id, nombre, tipo, categoria, monto, propuesto)
      VALUES (p_recibo_id, v_c.concepto_id, v_c.nombre, v_c.tipo, v_c.categoria, v_m, v_c.monto);
      v_n := v_n + 1;
      CONTINUE;
    END IF;

    -- Automático (solo percepciones): la línea existe aunque quede en 0, para explicar por qué.
    v_lid := v_c.linea_id; v_nueva := v_lid IS NULL; v_det := NULL;
    IF v_nueva THEN
      INSERT INTO nomina_recibo_lineas (recibo_id, concepto_id, nombre, tipo, categoria, monto, propuesto)
      VALUES (p_recibo_id, v_c.concepto_id, v_c.nombre, v_c.tipo, v_c.categoria, 0, 0)
      RETURNING id INTO v_lid;
    END IF;

    IF v_c.calculo IN ('porcentaje_ventas', 'por_unidad', 'por_entrega') THEN
      SELECT k.monto, k.detalle INTO v_m, v_det FROM nomina_comision_linea(v_lid, v_c.tasa) k;
      IF v_c.limite_total IS NOT NULL THEN
        v_m := LEAST(v_m, GREATEST(v_c.limite_total - nomina_acumulado_concepto(v_c.concepto_id, v_r.empleado_id, p_recibo_id), 0));
      END IF;
    ELSE
      v_m := v_c.monto;
    END IF;

    IF v_c.regla_asistencia THEN
      SELECT * INTO v_as FROM nomina_asistencia_semana(v_r.empleado_id, v_per.fecha_inicio, v_per.fecha_fin);
      IF v_as.dias_programados + v_as.asistencias = 0 THEN
        v_det := concat_ws(' · ', v_det, 'Sin turno esta semana: la asistencia no se evaluó');
      ELSIF v_as.retardos > v_c.max_retardos OR v_as.faltas > v_c.max_faltas THEN
        v_m := 0;
        v_det := 'No aplica: ' || v_as.retardos || CASE WHEN v_as.retardos = 1 THEN ' retardo' ELSE ' retardos' END
                 || ' y ' || v_as.faltas || CASE WHEN v_as.faltas = 1 THEN ' falta' ELSE ' faltas' END
                 || ' (se permiten ' || v_c.max_retardos || ' y ' || v_c.max_faltas || ')';
      ELSE
        v_det := concat_ws(' · ', v_det, 'Asistencia: ' || v_as.retardos || CASE WHEN v_as.retardos = 1 THEN ' retardo' ELSE ' retardos' END
                 || ', ' || v_as.faltas || CASE WHEN v_as.faltas = 1 THEN ' falta' ELSE ' faltas' END);
      END IF;
    END IF;

    v_prop := GREATEST(COALESCE(v_m, 0), 0);
    v_antes := CASE WHEN v_nueva THEN NULL ELSE v_c.l_monto END;
    -- Importe intacto (igual al sugerido anterior) → sigue al cálculo; editado a mano → se respeta.
    v_final := CASE WHEN v_nueva OR v_c.l_monto IS NOT DISTINCT FROM v_c.l_propuesto THEN v_prop ELSE v_c.l_monto END;
    UPDATE nomina_recibo_lineas
       SET monto = v_final, propuesto = v_prop, detalle = left(v_det, 240), updated_at = now()
     WHERE id = v_lid AND (monto, propuesto, detalle) IS DISTINCT FROM (v_final, v_prop, left(v_det, 240));
    IF v_nueva OR v_antes IS DISTINCT FROM v_final THEN v_n := v_n + 1; END IF;
  END LOOP;

  -- 135: si al recalcular baja lo ganado (se perdió un bono, se canceló una venta) y los
  -- descuentos ya no caben, se recortan a lo disponible (como al proponerlos en 128) en vez
  -- de dejar el neto en negativo y abortar toda la semana. Primero los manuales y los últimos.
  SELECT COALESCE(sum(l.monto) FILTER (WHERE l.tipo = 'descuento'), 0)
         - (v_r.sueldo + v_r.septimo_dia + COALESCE(sum(l.monto) FILTER (WHERE l.tipo = 'percepcion'), 0))
    INTO v_exc FROM nomina_recibo_lineas l WHERE l.recibo_id = p_recibo_id;
  IF v_exc > 0 THEN
    FOR v_d IN SELECT id, monto, concepto_id FROM nomina_recibo_lineas
                WHERE recibo_id = p_recibo_id AND tipo = 'descuento' AND monto > 0
                ORDER BY (concepto_id IS NOT NULL), id DESC LOOP
      EXIT WHEN v_exc <= 0;
      v_q := LEAST(v_d.monto, v_exc);
      IF v_d.concepto_id IS NULL AND v_q >= v_d.monto THEN
        DELETE FROM nomina_recibo_lineas WHERE id = v_d.id;        -- un manual no puede quedar en 0
      ELSE
        UPDATE nomina_recibo_lineas
           SET monto = monto - v_q, detalle = 'Recortado: lo ganado esta semana no alcanza para el descuento completo', updated_at = now()
         WHERE id = v_d.id;
      END IF;
      v_exc := v_exc - v_q;
      v_n := v_n + 1;
    END LOOP;
  END IF;

  PERFORM nomina_recalcular_recibo(p_recibo_id);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.nomina_proponer_recibo(BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ═══ 3. completar_venta_directa (133 + orden de bloqueo bolsa → cuarto) ═══
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

  -- 8a (135). Si la venta puede tener que picar o triturar, se bloquea PRIMERO la bolsa
  -- (empaque) y después los cuartos: el mismo orden que usan los contratos de Producción
  -- (registrar_produccion, preparar, reversos). Con el orden inverso, una venta y una
  -- producción simultáneas en el mismo cuarto podían abortar con "deadlock detected".
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'sku' IN ('HIP-25K', 'HIT-25K')) THEN
    PERFORM 1 FROM productos
      WHERE sku IN (SELECT p.empaque_sku FROM productos p WHERE p.sku IN ('HIP-25K', 'HIT-25K') AND p.empaque_sku IS NOT NULL)
      ORDER BY sku FOR UPDATE;
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
    -- 133: media barra, picada y triturada salen de la barra entera del MISMO cuarto (se revisa abajo).
    CONTINUE WHEN v_a.sku IN ('HIB-25K', 'HIP-25K', 'HIT-25K');
    SELECT COALESCE((stock ->> v_a.sku)::INTEGER, 0) INTO v_disp FROM cuartos_frios WHERE id = v_a.cuarto_id;
    IF v_disp < v_a.cantidad THEN
      RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%', v_a.sku, v_a.cuarto_id, v_disp, v_a.cantidad USING ERRCODE = '22023';
    END IF;
  END LOOP;
  FOR v_cuarto IN SELECT unnest(v_rooms) LOOP
    PERFORM barra_exigir_disponible(
      (SELECT COALESCE(jsonb_object_agg(e.value ->> 'sku', (e.value ->> 'cantidad')::INTEGER), '{}'::jsonb)
         FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'cuarto_id' = v_cuarto),
      (SELECT COALESCE(stock, '{}'::jsonb) FROM cuartos_frios WHERE id = v_cuarto),
      v_cuarto);
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

  -- 10b (133). Lo que falte de media barra, picada o triturada se saca de la barra
  -- entera del mismo cuarto, con los contratos de Producción (partir / preparar):
  -- mismo kardex, mismo empaque, mismas filas de producción y sus reversos.
  FOR v_cuarto IN SELECT unnest(v_rooms) LOOP
    PERFORM barra_surtir_cuarto(p_operacion_id, v_cuarto,
      (SELECT COALESCE(jsonb_object_agg(e.value ->> 'sku', (e.value ->> 'cantidad')::INTEGER), '{}'::jsonb)
         FROM jsonb_array_elements(v_asig) e WHERE e.value ->> 'cuarto_id' = v_cuarto));
  END LOOP;

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

-- ═══ 4. Evidencias: lectura de Admin y de quien la subió ═══
DROP POLICY IF EXISTS evidencias_read ON public.orden_evidencias;
CREATE POLICY evidencias_read ON public.orden_evidencias FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin' OR (erp_lector_negocio() AND subido_por = erp_usuario_id()));
