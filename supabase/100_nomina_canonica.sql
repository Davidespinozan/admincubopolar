-- 100_nomina_canonica.sql — parte 1 de 2 (aditiva). La parte 2
-- (101_contencion_nomina.sql) se aplica DESPUÉS de desplegar el frontend que
-- usa estos contratos.
--
-- Modelo canónico de nómina (no había historia: 0 periodos, 0 recibos):
--   - Semana de nómina SÁBADO → VIERNES, pago el VIERNES (evidencia NOMINA08),
--     en días de negocio America/Mazatlan. Identidad = fecha_inicio (UNIQUE).
--     fecha_fin = fecha_inicio + 6 = fecha_pago. El número de semana no es
--     identidad.
--   - Estados: Borrador → Pagado. Pagado es histórico e inmutable.
--   - crear_periodo_nomina(fecha): el servidor normaliza al sábado de esa
--     semana (sin fecha: fin_hoy()). Idempotente por fecha_inicio.
--   - generar_recibos_nomina(periodo): un recibo por empleado elegible, con
--     snapshot del salario diario; repetir solo crea los faltantes.
--   - editar_recibo_nomina(recibo, …): valores reales del Borrador (días,
--     séptimo, comisiones, prima dominical, bonos, otras percepciones,
--     deducciones explícitas); el servidor recalcula. Sin IMSS/ISR automático.
--   - pagar_nomina: exige Borrador con recibos que concilian; monto del
--     servidor; un egreso + un costo (098), fecha fin_hoy().
--   - Guardas: por API no se escribe nómina directa; Pagado no cambia (ni con
--     service_role); el egreso de un pago de nómina no se edita por API.
-- Idempotente.

-- ═══ 0. Precondición: no hay historia de nómina que reinterpretar ═══
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'nomina_periodos' AND column_name = 'fecha_inicio')
     AND (EXISTS (SELECT 1 FROM nomina_periodos) OR EXISTS (SELECT 1 FROM nomina_recibos)) THEN
    RAISE EXCEPTION '100: hay periodos o recibos de nómina previos; no se aplica la convergencia sin revisión' USING ERRCODE = '55000';
  END IF;
END $$;

-- ═══ 1. Esquema: periodos ═══
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS fecha_inicio DATE;
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS fecha_fin DATE;
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS total_percepciones NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS total_deducciones NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS creado_por TEXT;
ALTER TABLE nomina_periodos ADD COLUMN IF NOT EXISTS pagado_por TEXT;
ALTER TABLE nomina_periodos ALTER COLUMN fecha_inicio SET NOT NULL;
ALTER TABLE nomina_periodos ALTER COLUMN fecha_fin SET NOT NULL;
UPDATE nomina_periodos SET total_neto = 0 WHERE total_neto IS NULL;  -- sin filas; por idempotencia
ALTER TABLE nomina_periodos ALTER COLUMN total_neto TYPE NUMERIC(12,2);
ALTER TABLE nomina_periodos ALTER COLUMN total_neto SET DEFAULT 0;
ALTER TABLE nomina_periodos ALTER COLUMN total_neto SET NOT NULL;

-- ═══ 2. Esquema: recibos ═══
ALTER TABLE nomina_recibos ADD COLUMN IF NOT EXISTS salario_diario NUMERIC(10,2);
ALTER TABLE nomina_recibos ADD COLUMN IF NOT EXISTS deducciones NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE nomina_recibos ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE nomina_recibos ALTER COLUMN salario_diario SET NOT NULL;
DO $$
DECLARE c TEXT;
BEGIN
  FOREACH c IN ARRAY ARRAY['dias_pagados', 'sueldo', 'septimo_dia', 'comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad',
                           'otras_percepciones', 'total_percepciones', 'neto_a_pagar', 'estatus'] LOOP
    EXECUTE format('ALTER TABLE nomina_recibos ALTER COLUMN %I SET NOT NULL', c);
  END LOOP;
END $$;

-- ═══ 3. Invariantes ═══
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM (VALUES
    ('nomina_periodos', 'nomina_periodos_fecha_inicio_key', 'UNIQUE (fecha_inicio)'),
    ('nomina_periodos', 'nomina_periodos_movimiento_key', 'UNIQUE (movimiento_id)'),
    ('nomina_periodos', 'nomina_periodos_inicia_sabado', 'CHECK (extract(isodow FROM fecha_inicio) = 6)'),
    ('nomina_periodos', 'nomina_periodos_rango', 'CHECK (fecha_fin = fecha_inicio + 6)'),
    ('nomina_periodos', 'nomina_periodos_pago_viernes', 'CHECK (fecha_pago = fecha_fin)'),
    ('nomina_periodos', 'nomina_periodos_estatus', $c$CHECK (estatus IN ('Borrador', 'Pagado'))$c$),
    ('nomina_periodos', 'nomina_periodos_pago_coherente', $c$CHECK ((estatus = 'Borrador' AND movimiento_id IS NULL AND pagado_at IS NULL)
                                                            OR (estatus = 'Pagado' AND movimiento_id IS NOT NULL AND pagado_at IS NOT NULL))$c$),
    ('nomina_periodos', 'nomina_periodos_totales', 'CHECK (total_percepciones >= 0 AND total_deducciones >= 0 AND total_neto = total_percepciones - total_deducciones)'),
    ('nomina_recibos', 'nomina_recibos_periodo_empleado_key', 'UNIQUE (periodo_id, empleado_id)'),
    ('nomina_recibos', 'nomina_recibos_dias', 'CHECK (dias_pagados BETWEEN 0 AND 7)'),
    ('nomina_recibos', 'nomina_recibos_no_negativos', 'CHECK (salario_diario >= 0 AND comisiones >= 0 AND prima_dominical >= 0 AND bono_puntualidad >= 0
                                                       AND bono_productividad >= 0 AND otras_percepciones >= 0 AND deducciones >= 0)'),
    ('nomina_recibos', 'nomina_recibos_sueldo', 'CHECK (sueldo = round(salario_diario * dias_pagados, 2))'),
    ('nomina_recibos', 'nomina_recibos_septimo', 'CHECK (septimo_dia IN (0, salario_diario))'),
    ('nomina_recibos', 'nomina_recibos_totales', 'CHECK (total_percepciones = sueldo + septimo_dia + comisiones + prima_dominical + bono_puntualidad
                                                   + bono_productividad + otras_percepciones AND neto_a_pagar = total_percepciones - deducciones AND neto_a_pagar >= 0)'),
    ('nomina_recibos', 'nomina_recibos_estatus', $c$CHECK (estatus IN ('Pendiente', 'Pagado'))$c$)
  ) x(t, n, d) LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = r.n) THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I %s', r.t, r.n, r.d);
    END IF;
  END LOOP;
END $$;

-- ═══ 4. Semana canónica ═══
-- Sábado de la semana de nómina (sábado → viernes) que contiene la fecha.
CREATE OR REPLACE FUNCTION public.nomina_inicio_semana(p_fecha DATE) RETURNS DATE
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_fecha - ((extract(dow FROM p_fecha)::int + 1) % 7)
$$;
REVOKE ALL ON FUNCTION public.nomina_inicio_semana(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomina_inicio_semana(DATE) TO authenticated, service_role;

-- Totales del periodo derivados de sus recibos (uso interno de los contratos).
CREATE OR REPLACE FUNCTION public.nomina_recalcular_periodo(p_periodo_id BIGINT) RETURNS VOID
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE nomina_periodos p
     SET total_percepciones = x.perc, total_deducciones = x.ded, total_neto = x.perc - x.ded
    FROM (SELECT COALESCE(sum(total_percepciones), 0) AS perc, COALESCE(sum(deducciones), 0) AS ded
            FROM nomina_recibos WHERE periodo_id = p_periodo_id) x
   WHERE p.id = p_periodo_id;
END $$;
REVOKE ALL ON FUNCTION public.nomina_recalcular_periodo(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 5. Crear periodo ═══
CREATE OR REPLACE FUNCTION public.crear_periodo_nomina(p_fecha DATE DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoy  DATE := fin_hoy();
  v_ref  DATE := COALESCE(p_fecha, fin_hoy());
  v_ini  DATE;
  v_id   BIGINT;
  v_per  nomina_periodos%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'crear_periodo_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_ref < v_hoy - 366 OR v_ref > v_hoy + 7 THEN
    RAISE EXCEPTION 'La semana de nómina debe estar entre el último año y la próxima semana' USING ERRCODE = '22023';
  END IF;
  v_ini := nomina_inicio_semana(v_ref);

  INSERT INTO nomina_periodos (fecha_inicio, fecha_fin, fecha_pago, periodo, estatus, creado_por)
  VALUES (v_ini, v_ini + 6, v_ini + 6, 'Sáb ' || to_char(v_ini, 'DD/MM/YYYY') || ' – Vie ' || to_char(v_ini + 6, 'DD/MM/YYYY'), 'Borrador', erp_actor_etiqueta())
  ON CONFLICT (fecha_inicio) DO NOTHING
  RETURNING id INTO v_id;

  SELECT * INTO v_per FROM nomina_periodos WHERE fecha_inicio = v_ini;
  IF v_id IS NOT NULL THEN
    INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (erp_actor_etiqueta(), 'Crear', 'Nómina', 'Periodo ' || v_per.periodo);
  END IF;
  RETURN jsonb_build_object('periodo_id', v_per.id, 'fecha_inicio', v_per.fecha_inicio, 'fecha_fin', v_per.fecha_fin, 'fecha_pago', v_per.fecha_pago,
    'periodo', v_per.periodo, 'estatus', v_per.estatus, 'replay', v_id IS NULL);
END $$;
REVOKE ALL ON FUNCTION public.crear_periodo_nomina(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crear_periodo_nomina(DATE) TO authenticated, service_role;

-- ═══ 6. Generar recibos (snapshot del salario) ═══
CREATE OR REPLACE FUNCTION public.generar_recibos_nomina(p_periodo_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_per nomina_periodos%ROWTYPE;
  v_n   INTEGER;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'generar_recibos_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no encontrado' USING ERRCODE = '22023'; END IF;
  IF v_per.estatus <> 'Borrador' THEN
    RAISE EXCEPTION 'El periodo % ya está pagado: no se generan recibos', v_per.periodo USING ERRCODE = '22023';
  END IF;

  -- Elegibles: empleados activos dados de alta a más tardar el viernes del
  -- periodo. Semana completa por omisión: 6 días + séptimo (NOMINA08).
  INSERT INTO nomina_recibos (periodo_id, empleado_id, salario_diario, dias_pagados, sueldo, septimo_dia, total_percepciones, deducciones, neto_a_pagar, estatus)
  SELECT p_periodo_id, e.id, e.salario_diario, 6, round(e.salario_diario * 6, 2), e.salario_diario,
         round(e.salario_diario * 6, 2) + e.salario_diario, 0, round(e.salario_diario * 6, 2) + e.salario_diario, 'Pendiente'
    FROM empleados e
   WHERE e.estatus = 'Activo' AND e.fecha_ingreso <= v_per.fecha_fin AND e.salario_diario > 0
  ON CONFLICT (periodo_id, empleado_id) DO NOTHING;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  PERFORM nomina_recalcular_periodo(p_periodo_id);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id;
  RETURN jsonb_build_object('periodo_id', p_periodo_id, 'creados', v_n,
    'recibos', (SELECT count(*) FROM nomina_recibos WHERE periodo_id = p_periodo_id),
    'total_percepciones', v_per.total_percepciones, 'total_deducciones', v_per.total_deducciones, 'total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.generar_recibos_nomina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_recibos_nomina(BIGINT) TO authenticated, service_role;

-- ═══ 7. Editar recibo de un Borrador ═══
CREATE OR REPLACE FUNCTION public.editar_recibo_nomina(
  p_recibo_id BIGINT, p_dias_pagados INTEGER, p_con_septimo BOOLEAN,
  p_comisiones NUMERIC DEFAULT 0, p_prima_dominical NUMERIC DEFAULT 0, p_bono_puntualidad NUMERIC DEFAULT 0,
  p_bono_productividad NUMERIC DEFAULT 0, p_otras_percepciones NUMERIC DEFAULT 0, p_deducciones NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pid   BIGINT;
  v_per   nomina_periodos%ROWTYPE;
  v_r     nomina_recibos%ROWTYPE;
  v_com   NUMERIC := round(COALESCE(p_comisiones, 0), 2);
  v_prima NUMERIC := round(COALESCE(p_prima_dominical, 0), 2);
  v_bpun  NUMERIC := round(COALESCE(p_bono_puntualidad, 0), 2);
  v_bpro  NUMERIC := round(COALESCE(p_bono_productividad, 0), 2);
  v_otras NUMERIC := round(COALESCE(p_otras_percepciones, 0), 2);
  v_ded   NUMERIC := round(COALESCE(p_deducciones, 0), 2);
  v_sueldo NUMERIC;
  v_sept   NUMERIC;
  v_perc   NUMERIC;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'editar_recibo_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT periodo_id INTO v_pid FROM nomina_recibos WHERE id = p_recibo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recibo no encontrado' USING ERRCODE = '22023'; END IF;
  -- El periodo serializa edición y pago.
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_pid FOR UPDATE;
  IF v_per.estatus <> 'Borrador' THEN
    RAISE EXCEPTION 'El periodo % ya está pagado: sus recibos no se editan', v_per.periodo USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM nomina_recibos WHERE id = p_recibo_id FOR UPDATE;

  IF p_dias_pagados IS NULL OR p_dias_pagados < 0 OR p_dias_pagados > 7 THEN
    RAISE EXCEPTION 'Días pagados inválidos (0 a 7)' USING ERRCODE = '22023';
  END IF;
  IF p_con_septimo IS NULL THEN RAISE EXCEPTION 'Indica si aplica el séptimo día' USING ERRCODE = '22023'; END IF;
  IF v_com < 0 OR v_prima < 0 OR v_bpun < 0 OR v_bpro < 0 OR v_otras < 0 OR v_ded < 0 THEN
    RAISE EXCEPTION 'Los importes del recibo no pueden ser negativos' USING ERRCODE = '22023';
  END IF;

  -- El salario es el del snapshot del recibo; el cliente no manda totales.
  v_sueldo := round(v_r.salario_diario * p_dias_pagados, 2);
  v_sept   := CASE WHEN p_con_septimo THEN v_r.salario_diario ELSE 0 END;
  v_perc   := v_sueldo + v_sept + v_com + v_prima + v_bpun + v_bpro + v_otras;
  IF v_perc - v_ded < 0 THEN
    RAISE EXCEPTION 'Las deducciones (%) exceden las percepciones (%)', v_ded, v_perc USING ERRCODE = '22023';
  END IF;

  UPDATE nomina_recibos
     SET dias_pagados = p_dias_pagados, sueldo = v_sueldo, septimo_dia = v_sept, comisiones = v_com, prima_dominical = v_prima,
         bono_puntualidad = v_bpun, bono_productividad = v_bpro, otras_percepciones = v_otras,
         total_percepciones = v_perc, deducciones = v_ded, neto_a_pagar = v_perc - v_ded, updated_at = now()
   WHERE id = p_recibo_id;
  PERFORM nomina_recalcular_periodo(v_pid);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_pid;

  RETURN jsonb_build_object('recibo_id', p_recibo_id, 'periodo_id', v_pid, 'salario_diario', v_r.salario_diario, 'sueldo', v_sueldo,
    'septimo_dia', v_sept, 'total_percepciones', v_perc, 'deducciones', v_ded, 'neto_a_pagar', v_perc - v_ded,
    'periodo_total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.editar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;

-- ═══ 8. Pagar nómina (098 + prerequisitos del modelo canónico) ═══
CREATE OR REPLACE FUNCTION public.pagar_nomina(p_periodo_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_per      nomina_periodos%ROWTYPE;
  v_n        INTEGER;
  v_perc     NUMERIC;
  v_ded      NUMERIC;
  v_neto     NUMERIC;
  v_fecha    DATE := fin_hoy();
  v_concepto TEXT;
  v_mov      BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'pagar_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_periodo_id IS NULL THEN
    RAISE EXCEPTION 'pagar_nomina: periodo obligatorio' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Período no encontrado' USING ERRCODE = '22023'; END IF;

  -- Un periodo se paga una sola vez (un costo y una salida de efectivo).
  IF v_per.movimiento_id IS NOT NULL THEN
    RETURN jsonb_build_object('periodo_id', p_periodo_id, 'movimiento_id', v_per.movimiento_id,
      'fecha', (SELECT fecha FROM movimientos_contables WHERE id = v_per.movimiento_id), 'total_neto', v_per.total_neto, 'replay', true);
  END IF;
  IF v_per.estatus <> 'Borrador' THEN
    RAISE EXCEPTION 'pagar_nomina: el periodo % no está en Borrador', v_per.periodo USING ERRCODE = '22023';
  END IF;

  PERFORM 1 FROM nomina_recibos WHERE periodo_id = p_periodo_id FOR UPDATE;
  SELECT count(*), COALESCE(sum(total_percepciones), 0), COALESCE(sum(deducciones), 0), COALESCE(sum(neto_a_pagar), 0)
    INTO v_n, v_perc, v_ded, v_neto FROM nomina_recibos WHERE periodo_id = p_periodo_id;
  IF v_n = 0 THEN RAISE EXCEPTION 'No hay neto a pagar: el periodo no tiene recibos' USING ERRCODE = '22023'; END IF;
  IF v_neto <= 0 THEN RAISE EXCEPTION 'No hay neto a pagar' USING ERRCODE = '22023'; END IF;
  IF (v_per.total_percepciones, v_per.total_deducciones, v_per.total_neto) IS DISTINCT FROM (v_perc, v_ded, v_neto) THEN
    RAISE EXCEPTION 'pagar_nomina: los totales del periodo no concilian con sus recibos' USING ERRCODE = '22023';
  END IF;

  v_concepto := 'Pago nómina ' || COALESCE(NULLIF(v_per.periodo, ''), p_periodo_id::text);
  INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto)
  VALUES (v_fecha, 'Egreso', 'Nómina', v_concepto, v_neto)
  RETURNING id INTO v_mov;

  UPDATE nomina_recibos SET estatus = 'Pagado', updated_at = now() WHERE periodo_id = p_periodo_id;
  UPDATE nomina_periodos SET estatus = 'Pagado', pagado_at = now(), movimiento_id = v_mov, pagado_por = erp_actor_etiqueta()
   WHERE id = p_periodo_id;

  INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, movimiento_id)
  VALUES ('Nómina', 'Nómina', v_concepto, v_neto, to_char(v_fecha, 'YYYY-MM'), v_fecha, v_mov);

  INSERT INTO auditoria (usuario, accion, modulo, detalle) VALUES (erp_actor_etiqueta(), 'Pagar', 'Nómina', v_concepto || ' — $' || v_neto);

  RETURN jsonb_build_object('periodo_id', p_periodo_id, 'movimiento_id', v_mov, 'fecha', v_fecha, 'total_neto', v_neto, 'recibos', v_n, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.pagar_nomina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagar_nomina(BIGINT) TO authenticated, service_role;

-- ═══ 9. Guardas ═══
-- Periodos: por API solo los contratos; un Pagado no cambia ni se borra
-- (tampoco con service_role).
CREATE OR REPLACE FUNCTION public.nomina_periodos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'nomina_periodos: los periodos de nómina solo se modifican con sus contratos' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD.estatus = 'Pagado' THEN
    RAISE EXCEPTION 'nomina_periodos: el periodo % ya está pagado; es histórico e inmutable', OLD.periodo USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.nomina_periodos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_nomina_periodos_guard ON nomina_periodos;
CREATE TRIGGER trg_nomina_periodos_guard BEFORE INSERT OR UPDATE OR DELETE ON nomina_periodos
  FOR EACH ROW EXECUTE FUNCTION public.nomina_periodos_guard();

-- Recibos: por API solo los contratos; los de un periodo Pagado no se crean,
-- editan ni borran; empleado, periodo y salario snapshot no cambian.
CREATE OR REPLACE FUNCTION public.nomina_recibos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'nomina_recibos: los recibos de nómina solo se modifican con sus contratos' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.periodo_id, NEW.empleado_id, NEW.salario_diario) IS DISTINCT FROM (OLD.periodo_id, OLD.empleado_id, OLD.salario_diario) THEN
    RAISE EXCEPTION 'nomina_recibos: periodo, empleado y salario del recibo no cambian' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM nomina_periodos p WHERE p.estatus = 'Pagado'
              AND p.id IN (CASE WHEN TG_OP = 'DELETE' THEN OLD.periodo_id ELSE NEW.periodo_id END,
                           CASE WHEN TG_OP = 'INSERT' THEN NEW.periodo_id ELSE OLD.periodo_id END)) THEN
    RAISE EXCEPTION 'nomina_recibos: el periodo ya está pagado; sus recibos son inmutables' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.nomina_recibos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_nomina_recibos_guard ON nomina_recibos;
CREATE TRIGGER trg_nomina_recibos_guard BEFORE INSERT OR UPDATE OR DELETE ON nomina_recibos
  FOR EACH ROW EXECUTE FUNCTION public.nomina_recibos_guard();

-- Egreso del pago de nómina: lo genera pagar_nomina; por API no se crea con
-- su concepto reservado (cliente anterior a 098) ni se edita/borra el ligado.
CREATE OR REPLACE FUNCTION public.movimientos_contables_nomina_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') AND NEW.tipo = 'Egreso' AND NEW.categoria = 'Nómina' AND COALESCE(NEW.concepto, '') LIKE 'Pago nómina %' THEN
    RAISE EXCEPTION 'movimientos_contables: el pago de nómina lo registra pagar_nomina' USING ERRCODE = '42501';
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND EXISTS (SELECT 1 FROM nomina_periodos WHERE movimiento_id = OLD.id) THEN
    RAISE EXCEPTION 'movimientos_contables: el egreso % es el pago de un periodo de nómina; no se edita ni se borra', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.movimientos_contables_nomina_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_movimientos_contables_nomina_guard ON movimientos_contables;
CREATE TRIGGER trg_movimientos_contables_nomina_guard BEFORE INSERT OR UPDATE OR DELETE ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION public.movimientos_contables_nomina_guard();

-- costos_historial: el costo de nómina solo lo registra pagar_nomina.
CREATE OR REPLACE FUNCTION public.costos_historial_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP <> 'INSERT' THEN
    RAISE EXCEPTION 'costos_historial: el historial de costos no se modifica ni se borra' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(NEW.referencia, '') LIKE 'PROD-%' OR NEW.tipo IN ('Producción', 'Reverso producción') THEN
    RAISE EXCEPTION 'costos_historial: el costo de producción lo registra el contrato de producción' USING ERRCODE = '42501';
  END IF;
  IF NEW.tipo = 'Nómina' THEN
    RAISE EXCEPTION 'costos_historial: el costo de nómina lo registra pagar_nomina' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
