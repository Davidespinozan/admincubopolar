-- 130_nomina_automatica.sql — NOM-2: comisiones calculadas con ventas o
-- entregas y percepciones condicionadas a la asistencia (bono de puntualidad).
--
-- Aditiva e idempotente. Compatible con el frontend desplegado antes de esta
-- migración (128): los conceptos existentes (`fijo`, `porcentaje_sd`) se
-- calculan EXACTAMENTE igual; `generar_recibos_nomina`, `guardar_recibo_nomina`,
-- `editar_recibo_nomina`, `pagar_nomina`, guardas y CHECK de 100/128 no cambian.
--
-- Qué había (128): cada concepto es un monto fijo o un % del salario diario.
-- Las comisiones y el "perdió el bono por llegar tarde" se capturan a mano.
--
-- Qué agrega:
--   1. Cálculo del concepto: además de `fijo` y `porcentaje_sd`,
--        `porcentaje_ventas` (% del importe), `por_unidad` ($ por bolsa) y
--        `por_entrega` ($ por venta/entrega), sobre las órdenes ENTREGADAS de
--        la persona: como `vendedor` (ordenes.vendedor_id), como `chofer`
--        (chofer de la ruta) o como `ayudante` (ayudante de la ruta).
--        Opcional: solo ciertos productos (`skus`). La tasa por persona es el
--        "monto propio" que ya existía.
--   2. `nomina_linea_ordenes` — qué órdenes cubre cada renglón de comisión.
--        Una orden se comisiona UNA sola vez por concepto y persona (índice
--        único): si la nómina se paga antes de que termine la semana, lo
--        entregado después entra solo a la semana siguiente; nunca dos veces.
--   3. Condición de asistencia (`regla_asistencia`, `max_retardos`,
--        `max_faltas`) para cualquier percepción: si en la semana la persona
--        pasó de los retardos o faltas permitidos (reloj checador, 116), el
--        renglón se propone en 0 con el motivo. Sin turno en la semana no se
--        evalúa (se propone completo y lo dice).
--   4. `nomina_recibo_lineas.detalle` — de dónde salió el número
--        ("12 ventas · $12,400.00 × 2%", "No aplica: 2 retardos…").
--   5. `aplicar_conceptos_nomina` ahora también RECALCULA los renglones
--        automáticos del borrador: si Admin no tocó el importe, sigue al nuevo
--        cálculo; si lo cambió a mano, su importe se respeta y solo se
--        actualiza el "sugerido".
--
-- Decisiones (delegadas por el dueño el 2026-10-09: "lo más pro, siempre
-- modificable"):
--   - Todo es una PROPUESTA: Admin edita el importe en el recibo y cambia la
--     regla en el catálogo cuando quiera. Un periodo Pagado no cambia.
--   - Cuenta lo ENTREGADO (sello del servidor `delivered_at`, día de negocio),
--     no lo levantado ni lo cobrado. Una orden cancelada no cuenta.
--   - Retardo = el del reloj checador (tolerancia del turno; una corrección de
--     Admin lo reclasifica). Falta = turno programado ya terminado sin marca.
--   - Bono condicionado: todo o nada (no proporcional).
--
-- No incluye: comisión sobre lo cobrado, ajuste por devoluciones posteriores,
-- permisos/vacaciones (Admin corrige el renglón), bono proporcional.
--
-- Reversión (sin conceptos automáticos creados): restaurar
-- `guardar_concepto_nomina`, `aplicar_conceptos_nomina`,
-- `nomina_aplicar_conceptos_recibo` y `nomina_conceptos_propuestos` de 128,
-- borrar las funciones y la tabla nuevas y las columnas agregadas. Con
-- renglones automáticos en recibos: no borrar historia.

-- ═══ 1. Catálogo: nuevas formas de cálculo y condición de asistencia ═══
ALTER TABLE public.nomina_conceptos ADD COLUMN IF NOT EXISTS base_rol TEXT;
ALTER TABLE public.nomina_conceptos ADD COLUMN IF NOT EXISTS skus TEXT[];
ALTER TABLE public.nomina_conceptos ADD COLUMN IF NOT EXISTS regla_asistencia BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.nomina_conceptos ADD COLUMN IF NOT EXISTS max_retardos INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.nomina_conceptos ADD COLUMN IF NOT EXISTS max_faltas INTEGER NOT NULL DEFAULT 0;

ALTER TABLE public.nomina_conceptos DROP CONSTRAINT IF EXISTS nomina_conceptos_calculo;
ALTER TABLE public.nomina_conceptos ADD CONSTRAINT nomina_conceptos_calculo
  CHECK (calculo IN ('fijo', 'porcentaje_sd', 'porcentaje_ventas', 'por_unidad', 'por_entrega'));
ALTER TABLE public.nomina_conceptos DROP CONSTRAINT IF EXISTS nomina_conceptos_monto;
ALTER TABLE public.nomina_conceptos ADD CONSTRAINT nomina_conceptos_monto
  CHECK (monto >= 0 AND (calculo <> 'porcentaje_sd' OR monto <= 700) AND (calculo <> 'porcentaje_ventas' OR monto <= 100));
ALTER TABLE public.nomina_conceptos DROP CONSTRAINT IF EXISTS nomina_conceptos_base;
ALTER TABLE public.nomina_conceptos ADD CONSTRAINT nomina_conceptos_base
  CHECK ((calculo IN ('porcentaje_ventas', 'por_unidad', 'por_entrega')) = (base_rol IS NOT NULL)
         AND (base_rol IS NULL OR (base_rol IN ('vendedor', 'chofer', 'ayudante') AND tipo = 'percepcion'))
         AND (skus IS NULL OR (base_rol IS NOT NULL AND cardinality(skus) BETWEEN 1 AND 50)));
ALTER TABLE public.nomina_conceptos DROP CONSTRAINT IF EXISTS nomina_conceptos_regla;
ALTER TABLE public.nomina_conceptos ADD CONSTRAINT nomina_conceptos_regla
  CHECK (max_retardos BETWEEN 0 AND 7 AND max_faltas BETWEEN 0 AND 7 AND (NOT regla_asistencia OR tipo = 'percepcion'));

-- ═══ 2. Renglón: de dónde salió el número ═══
ALTER TABLE public.nomina_recibo_lineas ADD COLUMN IF NOT EXISTS detalle TEXT;
ALTER TABLE public.nomina_recibo_lineas DROP CONSTRAINT IF EXISTS nomina_recibo_lineas_detalle;
ALTER TABLE public.nomina_recibo_lineas ADD CONSTRAINT nomina_recibo_lineas_detalle CHECK (detalle IS NULL OR char_length(detalle) <= 240);

-- ═══ 3. Órdenes que cubre cada renglón de comisión ═══
CREATE TABLE IF NOT EXISTS public.nomina_linea_ordenes (
  linea_id    BIGINT NOT NULL REFERENCES public.nomina_recibo_lineas(id) ON DELETE CASCADE,
  concepto_id BIGINT NOT NULL REFERENCES public.nomina_conceptos(id),
  empleado_id BIGINT NOT NULL REFERENCES public.empleados(id),
  orden_id    BIGINT NOT NULL REFERENCES public.ordenes(id),
  base        NUMERIC(14,2) NOT NULL CHECK (base >= 0),
  unidades    INTEGER NOT NULL CHECK (unidades >= 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (linea_id, orden_id),
  -- Una orden se comisiona una sola vez por concepto y persona.
  CONSTRAINT nomina_linea_ordenes_una_vez UNIQUE (concepto_id, empleado_id, orden_id)
);
CREATE INDEX IF NOT EXISTS nomina_linea_ordenes_orden ON public.nomina_linea_ordenes (orden_id);

ALTER TABLE public.nomina_linea_ordenes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.nomina_linea_ordenes FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.nomina_linea_ordenes TO authenticated;
GRANT ALL ON public.nomina_linea_ordenes TO service_role;
DROP POLICY IF EXISTS admin_read ON public.nomina_linea_ordenes;
CREATE POLICY admin_read ON public.nomina_linea_ordenes FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin');

-- Por API solo con los contratos; lo de un periodo Pagado es inmutable.
CREATE OR REPLACE FUNCTION public.nomina_linea_ordenes_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'nomina_linea_ordenes: el detalle de la comisión solo lo escribe la nómina' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'nomina_linea_ordenes: el detalle de la comisión no se edita' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM nomina_recibo_lineas l JOIN nomina_recibos r ON r.id = l.recibo_id JOIN nomina_periodos p ON p.id = r.periodo_id
              WHERE p.estatus = 'Pagado' AND l.id = CASE WHEN TG_OP = 'DELETE' THEN OLD.linea_id ELSE NEW.linea_id END) THEN
    RAISE EXCEPTION 'nomina_linea_ordenes: el periodo ya está pagado; su desglose es inmutable' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.nomina_linea_ordenes_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_nomina_linea_ordenes_guard ON public.nomina_linea_ordenes;
CREATE TRIGGER trg_nomina_linea_ordenes_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_linea_ordenes
  FOR EACH ROW EXECUTE FUNCTION public.nomina_linea_ordenes_guard();

-- ═══ 4. Internas (sin EXECUTE por API) ═══
-- Asistencia de una persona en una semana, según el reloj checador (116).
--   dias_programados: turnos de la semana que ya empezaron.
--   asistencias: marcas de entrada.  retardos: entradas clasificadas retardo.
--   faltas: turnos ya TERMINADOS sin marca de entrada.
CREATE OR REPLACE FUNCTION public.nomina_asistencia_semana(p_empleado_id BIGINT, p_inicio DATE, p_fin DATE, p_ahora TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (dias_programados INTEGER, asistencias INTEGER, retardos INTEGER, faltas INTEGER)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH prog AS (
    SELECT t.id AS turno_id, d.dia,
           ((d.dia + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada,
           ((d.dia + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida
      FROM turnos t
      CROSS JOIN LATERAL (SELECT p_inicio + k AS dia FROM generate_series(0, GREATEST(p_fin - p_inicio, 0)) k) d
     WHERE t.empleado_id = p_empleado_id AND t.activo
       AND t.vigente_desde <= d.dia AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= d.dia)
       AND EXTRACT(ISODOW FROM d.dia)::SMALLINT = ANY (t.dias)
  ), marcas AS (
    SELECT a.turno_id, a.fecha_laboral, a.entrada_estado FROM asistencias a
     WHERE a.empleado_id = p_empleado_id AND a.fecha_laboral BETWEEN p_inicio AND p_fin
  )
  SELECT (SELECT count(*) FROM prog WHERE entrada <= p_ahora)::INTEGER,
         (SELECT count(*) FROM marcas)::INTEGER,
         (SELECT count(*) FROM marcas WHERE entrada_estado = 'retardo')::INTEGER,
         (SELECT count(*) FROM prog g WHERE g.salida <= p_ahora
             AND NOT EXISTS (SELECT 1 FROM marcas m WHERE m.turno_id = g.turno_id AND m.fecha_laboral = g.dia))::INTEGER
$$;
REVOKE ALL ON FUNCTION public.nomina_asistencia_semana(BIGINT, DATE, DATE, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;

-- Conceptos que le tocan a una persona en una semana. `base` = monto ya
-- resuelto de un concepto fijo o % del salario diario (NULL si se calcula con
-- ventas); `tasa` = el número del catálogo o el propio de la persona.
-- (Cambia el tipo de retorno de 128: se recrea.)
DROP FUNCTION IF EXISTS public.nomina_conceptos_propuestos(BIGINT, DATE, DATE, NUMERIC, BIGINT);
CREATE FUNCTION public.nomina_conceptos_propuestos(
  p_empleado_id BIGINT, p_inicio DATE, p_fin DATE, p_salario_diario NUMERIC, p_excluir_recibo BIGINT
) RETURNS TABLE (concepto_id BIGINT, nombre TEXT, tipo TEXT, categoria TEXT, monto NUMERIC, calculo TEXT, tasa NUMERIC,
                 limite_total NUMERIC, regla_asistencia BOOLEAN, max_retardos INTEGER, max_faltas INTEGER, automatico BOOLEAN)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT x.concepto_id, x.nombre, x.tipo, x.categoria,
         CASE WHEN x.base IS NULL THEN NULL
              WHEN x.limite_total IS NULL THEN x.base
              ELSE LEAST(x.base, GREATEST(x.limite_total - nomina_acumulado_concepto(x.concepto_id, p_empleado_id, p_excluir_recibo), 0)) END AS monto,
         x.calculo, x.tasa, x.limite_total, x.regla_asistencia, x.max_retardos, x.max_faltas,
         (x.base IS NULL OR x.regla_asistencia) AS automatico
    FROM (SELECT c.id AS concepto_id, c.nombre, c.tipo, c.categoria, ce.limite_total, c.calculo, COALESCE(ce.monto, c.monto) AS tasa,
                 c.regla_asistencia, c.max_retardos, c.max_faltas,
                 CASE c.calculo WHEN 'porcentaje_sd' THEN round(p_salario_diario * COALESCE(ce.monto, c.monto) / 100, 2)
                                WHEN 'fijo' THEN COALESCE(ce.monto, c.monto) END AS base
            FROM nomina_conceptos c
            JOIN empleados e ON e.id = p_empleado_id
            LEFT JOIN nomina_concepto_empleados ce ON ce.concepto_id = c.id AND ce.empleado_id = e.id
           WHERE c.activo AND (c.vigente_desde IS NULL OR c.vigente_desde <= p_fin) AND (c.vigente_hasta IS NULL OR c.vigente_hasta >= p_inicio)
             AND NOT COALESCE(ce.excluido, false)
             AND (c.aplica_a = 'todos'
                  OR (c.aplica_a = 'departamento' AND e.depto = c.departamento)
                  OR (c.aplica_a = 'personas' AND ce.empleado_id IS NOT NULL))) x
$$;
REVOKE ALL ON FUNCTION public.nomina_conceptos_propuestos(BIGINT, DATE, DATE, NUMERIC, BIGINT) FROM PUBLIC, anon, authenticated;

-- Comisión de un renglón: reconstruye las órdenes que cubre y devuelve el
-- importe y su explicación. Ventana: desde la primera semana en que el concepto
-- entró a un recibo de la persona (o esta semana) hasta el viernes del periodo,
-- por día de negocio de la ENTREGA; lo ya cubierto por otro renglón no se repite.
-- El llamador tiene bloqueado el periodo.
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

-- Propone los conceptos de un recibo del borrador.
--   Sin p_recalcular: agrega las líneas de catálogo que faltan (como 128).
--   Con p_recalcular: además vuelve a calcular las AUTOMÁTICAS que ya existen;
--     si Admin no tocó el importe (monto = sugerido) sigue al cálculo nuevo, si
--     lo cambió se respeta y solo se actualiza el sugerido y la explicación.
-- Un descuento se recorta a lo disponible (128). Devuelve cuántas líneas
-- agregó o cambiaron de importe. El llamador tiene bloqueado el periodo.
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
BEGIN
  SELECT * INTO v_r FROM nomina_recibos WHERE id = p_recibo_id FOR UPDATE;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_r.periodo_id;
  -- Serializa los topes de esta persona (128).
  PERFORM 1 FROM nomina_concepto_empleados WHERE empleado_id = v_r.empleado_id AND limite_total IS NOT NULL ORDER BY concepto_id FOR UPDATE;

  FOR v_c IN
    SELECT x.*, l.id AS linea_id, l.monto AS l_monto, l.propuesto AS l_propuesto
      FROM nomina_conceptos_propuestos(v_r.empleado_id, v_per.fecha_inicio, v_per.fecha_fin, v_r.salario_diario, p_recibo_id) x
      LEFT JOIN nomina_recibo_lineas l ON l.recibo_id = p_recibo_id AND l.concepto_id = x.concepto_id
     WHERE l.id IS NULL OR (COALESCE(p_recalcular, false) AND x.automatico)
     ORDER BY (x.tipo = 'descuento'), x.concepto_id
  LOOP
    IF NOT v_c.automatico THEN
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

  PERFORM nomina_recalcular_recibo(p_recibo_id);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.nomina_proponer_recibo(BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- La entrada de 128 se conserva (la usa generar_recibos_nomina): solo agrega lo que falta.
CREATE OR REPLACE FUNCTION public.nomina_aplicar_conceptos_recibo(p_recibo_id BIGINT) RETURNS INTEGER
LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT nomina_proponer_recibo(p_recibo_id, false)
$$;
REVOKE ALL ON FUNCTION public.nomina_aplicar_conceptos_recibo(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 5. Contrato: alta y edición de un concepto (128 + cálculo con ventas y condición de asistencia) ═══
-- p_datos agrega: base_rol ('vendedor' | 'chofer' | 'ayudante'), skus [..],
--                 regla_asistencia, max_retardos, max_faltas.
CREATE OR REPLACE FUNCTION public.guardar_concepto_nomina(p_concepto_id BIGINT, p_datos JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_old     nomina_conceptos%ROWTYPE;
  v_id      BIGINT := p_concepto_id;
  v_nombre  TEXT := btrim(regexp_replace(COALESCE(p_datos ->> 'nombre', ''), '\s+', ' ', 'g'));
  v_tipo    TEXT := p_datos ->> 'tipo';
  v_cat     TEXT := p_datos ->> 'categoria';
  v_calc    TEXT := COALESCE(NULLIF(p_datos ->> 'calculo', ''), 'fijo');
  v_aplica  TEXT := p_datos ->> 'aplica_a';
  v_depto   TEXT := NULLIF(btrim(COALESCE(p_datos ->> 'departamento', '')), '');
  v_activo  BOOLEAN;
  v_notas   TEXT := NULLIF(btrim(COALESCE(p_datos ->> 'notas', '')), '');
  v_monto   NUMERIC;
  v_desde   DATE;
  v_hasta   DATE;
  v_pers    JSONB := COALESCE(p_datos -> 'personas', '[]'::jsonb);
  v_p       JSONB;
  v_emp     BIGINT;
  v_exc     BOOLEAN;
  v_pm      NUMERIC;
  v_pl      NUMERIC;
  v_antes   JSONB;
  v_despues JSONB;
  v_cambios TEXT[];
  v_base    TEXT := NULLIF(p_datos ->> 'base_rol', '');
  v_skus    TEXT[];
  v_regla   BOOLEAN;
  v_maxr    INTEGER;
  v_maxf    INTEGER;
  v_com     BOOLEAN;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_concepto_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'Datos del concepto inválidos' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_monto := round((p_datos ->> 'monto')::NUMERIC, 2);
    v_desde := NULLIF(p_datos ->> 'vigente_desde', '')::DATE;
    v_hasta := NULLIF(p_datos ->> 'vigente_hasta', '')::DATE;
    v_activo := COALESCE((p_datos ->> 'activo')::BOOLEAN, true);
    v_regla := COALESCE((p_datos ->> 'regla_asistencia')::BOOLEAN, false);
    v_maxr := COALESCE(NULLIF(p_datos ->> 'max_retardos', '')::INTEGER, 0);
    v_maxf := COALESCE(NULLIF(p_datos ->> 'max_faltas', '')::INTEGER, 0);
    IF jsonb_typeof(p_datos -> 'skus') = 'array' AND jsonb_array_length(p_datos -> 'skus') > 0 THEN
      SELECT array_agg(DISTINCT btrim(s) ORDER BY btrim(s)) INTO v_skus FROM jsonb_array_elements_text(p_datos -> 'skus') s WHERE btrim(s) <> '';
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Monto, fechas o condiciones del concepto inválidos' USING ERRCODE = '22023';
  END;

  IF v_nombre = '' OR char_length(v_nombre) > 60 THEN
    RAISE EXCEPTION 'Escribe el nombre del concepto (máximo 60 letras)' USING ERRCODE = '22023';
  END IF;
  IF v_tipo IS NULL OR v_tipo NOT IN ('percepcion', 'descuento') THEN
    RAISE EXCEPTION 'Indica si el concepto es percepción o descuento' USING ERRCODE = '22023';
  END IF;
  IF v_cat IS NULL OR NOT ((v_tipo = 'percepcion' AND v_cat IN ('comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad', 'otras_percepciones'))
                        OR (v_tipo = 'descuento' AND v_cat IN ('isr', 'imss', 'prestamo', 'otras_deducciones'))) THEN
    RAISE EXCEPTION 'La clase del concepto no corresponde a su tipo' USING ERRCODE = '22023';
  END IF;
  IF v_calc NOT IN ('fijo', 'porcentaje_sd', 'porcentaje_ventas', 'por_unidad', 'por_entrega') THEN
    RAISE EXCEPTION 'Forma de cálculo inválida' USING ERRCODE = '22023';
  END IF;
  v_com := v_calc IN ('porcentaje_ventas', 'por_unidad', 'por_entrega');
  IF v_com THEN
    IF v_tipo <> 'percepcion' THEN
      RAISE EXCEPTION 'Un cálculo sobre ventas o entregas solo aplica a una percepción' USING ERRCODE = '22023';
    END IF;
    IF v_base IS NULL OR v_base NOT IN ('vendedor', 'chofer', 'ayudante') THEN
      RAISE EXCEPTION 'Indica de quién son las ventas o entregas que cuentan (vendedor, chofer o ayudante)' USING ERRCODE = '22023';
    END IF;
    IF v_skus IS NOT NULL AND (cardinality(v_skus) > 50 OR EXISTS (SELECT 1 FROM unnest(v_skus) s WHERE NOT EXISTS (SELECT 1 FROM productos p WHERE p.sku = s))) THEN
      RAISE EXCEPTION 'Uno de los productos elegidos para la comisión no existe' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_base := NULL; v_skus := NULL;
  END IF;
  IF v_regla AND v_tipo <> 'percepcion' THEN
    RAISE EXCEPTION 'La condición de asistencia solo aplica a una percepción' USING ERRCODE = '22023';
  END IF;
  IF NOT v_regla THEN v_maxr := 0; v_maxf := 0; END IF;
  IF v_maxr NOT BETWEEN 0 AND 7 OR v_maxf NOT BETWEEN 0 AND 7 THEN
    RAISE EXCEPTION 'Los retardos y las faltas permitidos van de 0 a 7' USING ERRCODE = '22023';
  END IF;
  IF v_monto IS NULL OR v_monto < 0 OR v_monto > 1000000 THEN
    RAISE EXCEPTION 'El monto del concepto no puede ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_calc = 'porcentaje_sd' AND v_monto > 700 THEN
    RAISE EXCEPTION 'El porcentaje del salario diario no puede pasar de 700' USING ERRCODE = '22023';
  END IF;
  IF v_calc = 'porcentaje_ventas' AND v_monto > 100 THEN
    RAISE EXCEPTION 'El porcentaje sobre ventas no puede pasar de 100' USING ERRCODE = '22023';
  END IF;
  IF v_aplica IS NULL OR v_aplica NOT IN ('todos', 'departamento', 'personas') THEN
    RAISE EXCEPTION 'Indica a quién aplica el concepto' USING ERRCODE = '22023';
  END IF;
  IF v_aplica = 'departamento' AND v_depto IS NULL THEN
    RAISE EXCEPTION 'Elige el departamento al que aplica' USING ERRCODE = '22023';
  END IF;
  IF v_aplica <> 'departamento' THEN v_depto := NULL; END IF;
  IF v_desde IS NOT NULL AND v_hasta IS NOT NULL AND v_hasta < v_desde THEN
    RAISE EXCEPTION 'La fecha final no puede ser anterior a la inicial' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(v_pers) <> 'array' OR jsonb_array_length(v_pers) > 500 THEN
    RAISE EXCEPTION 'Lista de personas inválida' USING ERRCODE = '22023';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_old FROM nomina_conceptos WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Concepto no encontrado' USING ERRCODE = '22023'; END IF;
    IF (v_old.tipo, v_old.categoria) IS DISTINCT FROM (v_tipo, v_cat) THEN
      RAISE EXCEPTION 'El tipo y la clase de un concepto no se cambian: desactívalo y crea otro' USING ERRCODE = '22023';
    END IF;
    v_antes := nomina_concepto_json(v_id);
  END IF;
  IF v_activo AND EXISTS (SELECT 1 FROM nomina_conceptos WHERE activo AND lower(btrim(nombre)) = lower(v_nombre) AND id IS DISTINCT FROM v_id) THEN
    RAISE EXCEPTION 'Ya existe un concepto activo llamado "%"', v_nombre USING ERRCODE = '23505';
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO nomina_conceptos (nombre, tipo, categoria, calculo, monto, aplica_a, departamento, activo, vigente_desde, vigente_hasta, notas,
                                  base_rol, skus, regla_asistencia, max_retardos, max_faltas, creado_por, actualizado_por)
    VALUES (v_nombre, v_tipo, v_cat, v_calc, v_monto, v_aplica, v_depto, v_activo, v_desde, v_hasta, v_notas,
            v_base, v_skus, v_regla, v_maxr, v_maxf, erp_actor_etiqueta(), erp_actor_etiqueta())
    RETURNING id INTO v_id;
  ELSE
    UPDATE nomina_conceptos
       SET nombre = v_nombre, calculo = v_calc, monto = v_monto, aplica_a = v_aplica, departamento = v_depto, activo = v_activo,
           vigente_desde = v_desde, vigente_hasta = v_hasta, notas = v_notas,
           base_rol = v_base, skus = v_skus, regla_asistencia = v_regla, max_retardos = v_maxr, max_faltas = v_maxf, actualizado_por = erp_actor_etiqueta(), updated_at = now()
     WHERE id = v_id;
  END IF;

  DELETE FROM nomina_concepto_empleados WHERE concepto_id = v_id;
  FOR v_p IN SELECT * FROM jsonb_array_elements(v_pers) LOOP
    BEGIN
      v_emp := (v_p ->> 'empleado_id')::BIGINT;
      v_exc := COALESCE((v_p ->> 'excluido')::BOOLEAN, false);
      v_pm  := round(NULLIF(v_p ->> 'monto', '')::NUMERIC, 2);
      v_pl  := round(NULLIF(v_p ->> 'limite_total', '')::NUMERIC, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Datos de una persona del concepto inválidos' USING ERRCODE = '22023';
    END;
    IF v_emp IS NULL OR NOT EXISTS (SELECT 1 FROM empleados WHERE id = v_emp) THEN
      RAISE EXCEPTION 'Empleado del concepto no encontrado' USING ERRCODE = '22023';
    END IF;
    IF v_exc THEN v_pm := NULL; v_pl := NULL; END IF;
    IF v_pm < 0 OR v_pl <= 0 OR (v_calc = 'porcentaje_sd' AND v_pm > 700) OR (v_calc = 'porcentaje_ventas' AND v_pm > 100) THEN
      RAISE EXCEPTION 'Monto o tope de una persona inválido' USING ERRCODE = '22023';
    END IF;
    -- Una fila sin excepción solo significa algo cuando el concepto es por personas.
    CONTINUE WHEN v_aplica <> 'personas' AND NOT v_exc AND v_pm IS NULL AND v_pl IS NULL;
    INSERT INTO nomina_concepto_empleados (concepto_id, empleado_id, excluido, monto, limite_total)
    VALUES (v_id, v_emp, v_exc, v_pm, v_pl)
    ON CONFLICT (concepto_id, empleado_id) DO UPDATE SET excluido = EXCLUDED.excluido, monto = EXCLUDED.monto, limite_total = EXCLUDED.limite_total;
  END LOOP;

  v_despues := nomina_concepto_json(v_id);
  IF v_antes IS NOT NULL THEN
    SELECT array_agg(k ORDER BY k) INTO v_cambios FROM jsonb_object_keys(v_despues) k WHERE v_antes -> k IS DISTINCT FROM v_despues -> k;
  END IF;
  IF v_antes IS NULL OR v_cambios IS NOT NULL THEN
    INSERT INTO bitacora_cambios (tabla, registro_id, accion, detalle, antes, despues, cambios)
    VALUES ('nomina_conceptos', v_id::TEXT, 'CONTRATO', 'guardar_concepto_nomina', v_antes, v_despues, v_cambios);
    INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (erp_actor_etiqueta(), CASE WHEN v_antes IS NULL THEN 'Crear' ELSE 'Editar' END, 'Nómina',
            'Concepto ' || v_nombre || CASE WHEN v_antes IS NOT NULL THEN ' (' || array_to_string(v_cambios, ', ') || ')' ELSE '' END);
  END IF;

  RETURN jsonb_build_object('concepto_id', v_id, 'creado', v_antes IS NULL, 'sin_cambios', v_antes IS NOT NULL AND v_cambios IS NULL, 'concepto', v_despues);
END $$;
REVOKE ALL ON FUNCTION public.guardar_concepto_nomina(BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_concepto_nomina(BIGINT, JSONB) TO authenticated, service_role;

-- ═══ 6. Aplicar y RECALCULAR los conceptos del borrador ═══
-- Agrega lo que falta y vuelve a calcular lo automático (ventas entregadas y
-- asistencia cambian durante la semana). No toca importes que Admin cambió a
-- mano, líneas manuales ni conceptos fijos ya existentes.
CREATE OR REPLACE FUNCTION public.aplicar_conceptos_nomina(p_periodo_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_per nomina_periodos%ROWTYPE;
  v_rid BIGINT;
  v_k   INTEGER;
  v_lin INTEGER := 0;
  v_rec INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'aplicar_conceptos_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no encontrado' USING ERRCODE = '22023'; END IF;
  IF v_per.estatus <> 'Borrador' THEN
    RAISE EXCEPTION 'El periodo % ya está pagado: su desglose no cambia', v_per.periodo USING ERRCODE = '22023';
  END IF;

  FOR v_rid IN SELECT id FROM nomina_recibos WHERE periodo_id = p_periodo_id ORDER BY id LOOP
    v_k := nomina_proponer_recibo(v_rid, true);
    IF v_k > 0 THEN v_lin := v_lin + v_k; v_rec := v_rec + 1; END IF;
  END LOOP;
  PERFORM nomina_recalcular_periodo(p_periodo_id);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id;

  IF v_lin > 0 THEN
    INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (erp_actor_etiqueta(), 'Editar', 'Nómina', 'Conceptos aplicados a ' || v_per.periodo || ': ' || v_lin || ' en ' || v_rec || ' recibos');
  END IF;
  RETURN jsonb_build_object('periodo_id', p_periodo_id, 'lineas', v_lin, 'recibos', v_rec,
    'total_percepciones', v_per.total_percepciones, 'total_deducciones', v_per.total_deducciones, 'total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.aplicar_conceptos_nomina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.aplicar_conceptos_nomina(BIGINT) TO authenticated, service_role;
