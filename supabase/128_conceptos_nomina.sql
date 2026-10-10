-- 128_conceptos_nomina.sql — NOM-1: conceptos de nómina (bonos, comisiones,
-- primas y descuentos) configurables por Admin, con desglose por recibo.
--
-- Aditiva e idempotente. Compatible con el frontend desplegado antes de esta
-- migración: `editar_recibo_nomina` conserva firma, validaciones y respuesta.
--
-- Qué había (100/101): el recibo tiene casillas fijas (comisiones, prima
-- dominical, bono de puntualidad, bono de productividad, otras percepciones y
-- un solo monto de deducciones) que Admin llena a mano, persona por persona,
-- cada semana. Sin catálogo, sin memoria entre semanas y sin desglose.
--
-- Qué agrega:
--   1. `nomina_conceptos` — catálogo: nombre, tipo (percepción / descuento),
--      categoría, cálculo (monto fijo semanal o % del salario diario), a quién
--      aplica (todos / un departamento / personas elegidas), vigencia opcional
--      (sin fechas = siempre; así también entra a la semana que se paga hoy) y activo.
--   2. `nomina_concepto_empleados` — por persona: excluida, monto propio (ISR e
--      IMSS cambian por persona) y tope acumulado (préstamos: al llegar al
--      total, el sistema deja de proponerlo y nunca descuenta de más).
--   3. `nomina_recibo_lineas` — el desglose del recibo. Cada línea guarda la
--      FOTO del nombre, tipo, categoría y monto: cambiar el catálogo después no
--      cambia un recibo ya generado. Línea de catálogo en 0 = "esta semana no
--      aplicó" (se conserva para que no se vuelva a proponer sola).
--   4. Las casillas del recibo (100) pasan a ser la SUMA de sus líneas por
--      categoría. Todos los CHECK de 100, `pagar_nomina`, los totales del
--      periodo y las guardas quedan EXACTAMENTE igual: el pago sigue sumando
--      recibos y un periodo Pagado sigue siendo inmutable (también sus líneas).
--   5. Contratos (Admin): `guardar_concepto_nomina`, `guardar_recibo_nomina`,
--      `aplicar_conceptos_nomina`, `nomina_acumulados`. `generar_recibos_nomina`
--      propone los conceptos al crear cada recibo (nunca reescribe uno existente).
--
-- Decisiones (delegadas por el dueño el 2026-10-09):
--   - Los conceptos los crea y cambia Admin; cada cambio queda en la bitácora
--     que solo lee el Dueño (`bitacora_cambios`, acción CONTRATO) y en auditoría.
--   - El bono se propone completo (no proporcional a los días); Admin lo quita o
--     ajusta en el recibo de la semana.
--   - Préstamo = descuento semanal con tope acumulado opcional. El acumulado se
--     DERIVA de las líneas (no hay saldo mutable que se pueda desfasar).
--   - ISR e IMSS = descuentos con monto por persona. El sistema NO calcula
--     impuestos (decisión cerrada de 100: sin IMSS/ISR automático).
--   - Un descuento propuesto nunca deja un neto negativo: se recorta al disponible.
--
-- No incluye: comisiones calculadas con ventas o entregas, puntualidad
-- automática con el reloj checador, reverso de un periodo pagado.
--
-- Reversión (sin periodos generados después de aplicar): restaurar
-- `generar_recibos_nomina` y `editar_recibo_nomina` de 100 y borrar las 3
-- tablas y las funciones nuevas. Con recibos que tengan líneas: no borrar
-- historia (las casillas del recibo ya contienen las sumas y siguen cuadrando).

-- ═══ 1. Catálogo ═══
CREATE TABLE IF NOT EXISTS public.nomina_conceptos (
  id              BIGSERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL,
  tipo            TEXT NOT NULL,
  categoria       TEXT NOT NULL,
  calculo         TEXT NOT NULL DEFAULT 'fijo',
  monto           NUMERIC(12,2) NOT NULL,
  aplica_a        TEXT NOT NULL,
  departamento    TEXT,
  activo          BOOLEAN NOT NULL DEFAULT true,
  vigente_desde   DATE,
  vigente_hasta   DATE,
  notas           TEXT,
  creado_por      TEXT,
  actualizado_por TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nomina_conceptos_nombre CHECK (btrim(nombre) <> '' AND char_length(nombre) <= 60),
  CONSTRAINT nomina_conceptos_tipo CHECK (tipo IN ('percepcion', 'descuento')),
  CONSTRAINT nomina_conceptos_categoria CHECK (
    (tipo = 'percepcion' AND categoria IN ('comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad', 'otras_percepciones'))
    OR (tipo = 'descuento' AND categoria IN ('isr', 'imss', 'prestamo', 'otras_deducciones'))),
  CONSTRAINT nomina_conceptos_calculo CHECK (calculo IN ('fijo', 'porcentaje_sd')),
  CONSTRAINT nomina_conceptos_monto CHECK (monto >= 0 AND (calculo = 'fijo' OR monto <= 700)),
  CONSTRAINT nomina_conceptos_aplica CHECK (aplica_a IN ('todos', 'departamento', 'personas')),
  CONSTRAINT nomina_conceptos_departamento CHECK ((aplica_a = 'departamento') = (departamento IS NOT NULL AND btrim(departamento) <> '')),
  CONSTRAINT nomina_conceptos_vigencia CHECK (vigente_desde IS NULL OR vigente_hasta IS NULL OR vigente_hasta >= vigente_desde)
);
-- Un nombre activo a la vez (un reintento de alta no duplica el concepto).
CREATE UNIQUE INDEX IF NOT EXISTS nomina_conceptos_nombre_activo ON public.nomina_conceptos (lower(btrim(nombre))) WHERE activo;

CREATE TABLE IF NOT EXISTS public.nomina_concepto_empleados (
  concepto_id  BIGINT NOT NULL REFERENCES public.nomina_conceptos(id),
  empleado_id  BIGINT NOT NULL REFERENCES public.empleados(id),
  excluido     BOOLEAN NOT NULL DEFAULT false,
  monto        NUMERIC(12,2),
  limite_total NUMERIC(12,2),
  PRIMARY KEY (concepto_id, empleado_id),
  CONSTRAINT nomina_concepto_empleados_monto CHECK (monto IS NULL OR monto >= 0),
  CONSTRAINT nomina_concepto_empleados_limite CHECK (limite_total IS NULL OR limite_total > 0),
  CONSTRAINT nomina_concepto_empleados_excluido CHECK (NOT (excluido AND (monto IS NOT NULL OR limite_total IS NOT NULL)))
);
CREATE INDEX IF NOT EXISTS nomina_concepto_empleados_empleado ON public.nomina_concepto_empleados (empleado_id);

-- ═══ 2. Desglose del recibo ═══
CREATE TABLE IF NOT EXISTS public.nomina_recibo_lineas (
  id          BIGSERIAL PRIMARY KEY,
  recibo_id   BIGINT NOT NULL REFERENCES public.nomina_recibos(id) ON DELETE CASCADE,
  concepto_id BIGINT REFERENCES public.nomina_conceptos(id),
  nombre      TEXT NOT NULL,
  tipo        TEXT NOT NULL,
  categoria   TEXT NOT NULL,
  monto       NUMERIC(12,2) NOT NULL,
  propuesto   NUMERIC(12,2),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT nomina_recibo_lineas_nombre CHECK (btrim(nombre) <> '' AND char_length(nombre) <= 60),
  CONSTRAINT nomina_recibo_lineas_categoria CHECK (
    (tipo = 'percepcion' AND categoria IN ('comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad', 'otras_percepciones'))
    OR (tipo = 'descuento' AND categoria IN ('isr', 'imss', 'prestamo', 'otras_deducciones'))),
  CONSTRAINT nomina_recibo_lineas_monto CHECK (monto >= 0 AND (propuesto IS NULL OR propuesto >= 0)),
  -- Una línea manual en 0 no dice nada; una de catálogo en 0 = "no aplicó esta semana".
  CONSTRAINT nomina_recibo_lineas_manual CHECK (concepto_id IS NOT NULL OR monto > 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS nomina_recibo_lineas_concepto ON public.nomina_recibo_lineas (recibo_id, concepto_id) WHERE concepto_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS nomina_recibo_lineas_recibo ON public.nomina_recibo_lineas (recibo_id);
CREATE INDEX IF NOT EXISTS nomina_recibo_lineas_por_concepto ON public.nomina_recibo_lineas (concepto_id) WHERE concepto_id IS NOT NULL;

-- ═══ 3. Acceso: lectura solo de Admin activo (erp_rol_activo, como 116); sin escritura por API ═══
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['nomina_conceptos', 'nomina_concepto_empleados', 'nomina_recibo_lineas'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_read ON public.%I', t);
    EXECUTE format($p$CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin')$p$, t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.nomina_conceptos_id_seq, public.nomina_recibo_lineas_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.nomina_conceptos_id_seq, public.nomina_recibo_lineas_id_seq TO service_role;

-- ═══ 4. Guardas ═══
-- Catálogo y asignaciones: por API solo con sus contratos.
CREATE OR REPLACE FUNCTION public.nomina_conceptos_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION '%: los conceptos de nómina solo se modifican con su contrato', TG_TABLE_NAME USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.nomina_conceptos_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_nomina_conceptos_guard ON public.nomina_conceptos;
CREATE TRIGGER trg_nomina_conceptos_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_conceptos
  FOR EACH ROW EXECUTE FUNCTION public.nomina_conceptos_guard();
DROP TRIGGER IF EXISTS trg_nomina_concepto_empleados_guard ON public.nomina_concepto_empleados;
CREATE TRIGGER trg_nomina_concepto_empleados_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_concepto_empleados
  FOR EACH ROW EXECUTE FUNCTION public.nomina_conceptos_guard();

-- Líneas: por API solo con sus contratos; las de un periodo Pagado no se
-- crean, editan ni borran (tampoco con service_role), igual que su recibo.
CREATE OR REPLACE FUNCTION public.nomina_recibo_lineas_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() THEN
    RAISE EXCEPTION 'nomina_recibo_lineas: el desglose del recibo solo se modifica con sus contratos' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.recibo_id, NEW.concepto_id) IS DISTINCT FROM (OLD.recibo_id, OLD.concepto_id) THEN
    RAISE EXCEPTION 'nomina_recibo_lineas: recibo y concepto de la línea no cambian' USING ERRCODE = '42501';
  END IF;
  IF EXISTS (SELECT 1 FROM nomina_recibos r JOIN nomina_periodos p ON p.id = r.periodo_id
              WHERE p.estatus = 'Pagado'
                AND r.id IN (CASE WHEN TG_OP = 'DELETE' THEN OLD.recibo_id ELSE NEW.recibo_id END,
                             CASE WHEN TG_OP = 'INSERT' THEN NEW.recibo_id ELSE OLD.recibo_id END)) THEN
    RAISE EXCEPTION 'nomina_recibo_lineas: el periodo ya está pagado; su desglose es inmutable' USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
REVOKE ALL ON FUNCTION public.nomina_recibo_lineas_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_nomina_recibo_lineas_guard ON public.nomina_recibo_lineas;
CREATE TRIGGER trg_nomina_recibo_lineas_guard BEFORE INSERT OR UPDATE OR DELETE ON public.nomina_recibo_lineas
  FOR EACH ROW EXECUTE FUNCTION public.nomina_recibo_lineas_guard();

-- ═══ 5. Internas (sin EXECUTE por API) ═══
-- Las casillas del recibo (100) = suma de sus líneas por categoría. Los CHECK
-- de 100 siguen siendo la última defensa de que el recibo cuadra.
-- Con p_dias_pagados / p_con_septimo también fija días, sueldo y séptimo en el
-- MISMO UPDATE (los CHECK nunca ven un estado intermedio).
CREATE OR REPLACE FUNCTION public.nomina_recalcular_recibo(p_recibo_id BIGINT, p_dias_pagados INTEGER DEFAULT NULL, p_con_septimo BOOLEAN DEFAULT NULL) RETURNS VOID
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE nomina_recibos r
     SET dias_pagados = x.dias, sueldo = x.sueldo, septimo_dia = x.sept,
         comisiones = x.com, prima_dominical = x.prima, bono_puntualidad = x.bpun, bono_productividad = x.bpro,
         otras_percepciones = x.otras, deducciones = x.ded,
         total_percepciones = x.sueldo + x.sept + x.com + x.prima + x.bpun + x.bpro + x.otras,
         neto_a_pagar = x.sueldo + x.sept + x.com + x.prima + x.bpun + x.bpro + x.otras - x.ded,
         updated_at = now()
    FROM (SELECT COALESCE(p_dias_pagados, r0.dias_pagados) AS dias,
                 CASE WHEN p_dias_pagados IS NULL THEN r0.sueldo ELSE round(r0.salario_diario * p_dias_pagados, 2) END AS sueldo,
                 CASE WHEN p_con_septimo IS NULL THEN r0.septimo_dia WHEN p_con_septimo THEN r0.salario_diario ELSE 0 END AS sept,
                 l.* FROM nomina_recibos r0, LATERAL (SELECT COALESCE(sum(monto) FILTER (WHERE categoria = 'comisiones'), 0) AS com,
                 COALESCE(sum(monto) FILTER (WHERE categoria = 'prima_dominical'), 0) AS prima,
                 COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_puntualidad'), 0) AS bpun,
                 COALESCE(sum(monto) FILTER (WHERE categoria = 'bono_productividad'), 0) AS bpro,
                 COALESCE(sum(monto) FILTER (WHERE categoria = 'otras_percepciones'), 0) AS otras,
                 COALESCE(sum(monto) FILTER (WHERE tipo = 'descuento'), 0) AS ded
            FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id) l
           WHERE r0.id = p_recibo_id) x
   WHERE r.id = p_recibo_id;
END $$;
REVOKE ALL ON FUNCTION public.nomina_recalcular_recibo(BIGINT, INTEGER, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- Lo ya descontado o pagado de un concepto a una persona en OTROS recibos
-- (pagados o en borrador): base del tope de un préstamo.
CREATE OR REPLACE FUNCTION public.nomina_acumulado_concepto(p_concepto_id BIGINT, p_empleado_id BIGINT, p_excluir_recibo BIGINT) RETURNS NUMERIC
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT COALESCE(sum(l.monto), 0)
    FROM nomina_recibo_lineas l JOIN nomina_recibos r ON r.id = l.recibo_id
   WHERE l.concepto_id = p_concepto_id AND r.empleado_id = p_empleado_id
     AND (p_excluir_recibo IS NULL OR r.id <> p_excluir_recibo)
$$;
REVOKE ALL ON FUNCTION public.nomina_acumulado_concepto(BIGINT, BIGINT, BIGINT) FROM PUBLIC, anon, authenticated;

-- Conceptos que le tocan a una persona en una semana, con su monto ya resuelto
-- (monto propio, % del salario diario del recibo y tope acumulado).
CREATE OR REPLACE FUNCTION public.nomina_conceptos_propuestos(
  p_empleado_id BIGINT, p_inicio DATE, p_fin DATE, p_salario_diario NUMERIC, p_excluir_recibo BIGINT
) RETURNS TABLE (concepto_id BIGINT, nombre TEXT, tipo TEXT, categoria TEXT, monto NUMERIC)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT x.concepto_id, x.nombre, x.tipo, x.categoria,
         CASE WHEN x.limite_total IS NULL THEN x.base
              ELSE LEAST(x.base, GREATEST(x.limite_total - nomina_acumulado_concepto(x.concepto_id, p_empleado_id, p_excluir_recibo), 0)) END AS monto
    FROM (SELECT c.id AS concepto_id, c.nombre, c.tipo, c.categoria, ce.limite_total,
                 CASE c.calculo WHEN 'porcentaje_sd' THEN round(p_salario_diario * COALESCE(ce.monto, c.monto) / 100, 2)
                                ELSE COALESCE(ce.monto, c.monto) END AS base
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

-- Agrega al recibo las líneas de catálogo que le faltan. No toca las que ya
-- existen (ni las que Admin dejó en 0) ni las manuales. Un descuento se recorta
-- a lo disponible: nunca deja el neto en negativo. Devuelve cuántas agregó.
-- El llamador ya tiene bloqueado el periodo (FOR UPDATE).
CREATE OR REPLACE FUNCTION public.nomina_aplicar_conceptos_recibo(p_recibo_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_r    nomina_recibos%ROWTYPE;
  v_per  nomina_periodos%ROWTYPE;
  v_c    RECORD;
  v_m    NUMERIC;
  v_disp NUMERIC;
  v_n    INTEGER := 0;
BEGIN
  SELECT * INTO v_r FROM nomina_recibos WHERE id = p_recibo_id FOR UPDATE;
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_r.periodo_id;
  -- Serializa los topes de esta persona (dos semanas generadas a la vez no
  -- descuentan dos veces el resto de un préstamo).
  PERFORM 1 FROM nomina_concepto_empleados WHERE empleado_id = v_r.empleado_id AND limite_total IS NOT NULL ORDER BY concepto_id FOR UPDATE;

  FOR v_c IN
    SELECT x.* FROM nomina_conceptos_propuestos(v_r.empleado_id, v_per.fecha_inicio, v_per.fecha_fin, v_r.salario_diario, p_recibo_id) x
     WHERE NOT EXISTS (SELECT 1 FROM nomina_recibo_lineas l WHERE l.recibo_id = p_recibo_id AND l.concepto_id = x.concepto_id)
     ORDER BY (x.tipo = 'descuento'), x.concepto_id
  LOOP
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
  END LOOP;

  PERFORM nomina_recalcular_recibo(p_recibo_id);
  RETURN v_n;
END $$;
REVOKE ALL ON FUNCTION public.nomina_aplicar_conceptos_recibo(BIGINT) FROM PUBLIC, anon, authenticated;

-- Foto del catálogo para la bitácora.
CREATE OR REPLACE FUNCTION public.nomina_concepto_json(p_concepto_id BIGINT) RETURNS JSONB
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT to_jsonb(c) - 'created_at' - 'updated_at' - 'creado_por' - 'actualizado_por'
         || jsonb_build_object('personas', COALESCE((
              SELECT jsonb_agg(jsonb_build_object('empleado_id', ce.empleado_id, 'nombre', e.nombre, 'excluido', ce.excluido,
                                                  'monto', ce.monto, 'limite_total', ce.limite_total) ORDER BY ce.empleado_id)
                FROM nomina_concepto_empleados ce JOIN empleados e ON e.id = ce.empleado_id WHERE ce.concepto_id = c.id), '[]'::jsonb))
    FROM nomina_conceptos c WHERE c.id = p_concepto_id
$$;
REVOKE ALL ON FUNCTION public.nomina_concepto_json(BIGINT) FROM PUBLIC, anon, authenticated;

-- ═══ 6. Contrato: alta y edición de un concepto ═══
-- p_datos: { nombre, tipo, categoria, calculo, monto, aplica_a, departamento,
--            vigente_desde, vigente_hasta, activo, notas,
--            personas: [{ empleado_id, excluido, monto, limite_total }] }
-- `personas` reemplaza la lista completa. Tipo y categoría no cambian después
-- del alta (los recibos guardan su propia foto, pero un concepto no cambia de
-- naturaleza: se desactiva y se crea otro).
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
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Monto o fechas del concepto inválidos' USING ERRCODE = '22023';
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
  IF v_calc NOT IN ('fijo', 'porcentaje_sd') THEN
    RAISE EXCEPTION 'Forma de cálculo inválida' USING ERRCODE = '22023';
  END IF;
  IF v_monto IS NULL OR v_monto < 0 OR v_monto > 1000000 THEN
    RAISE EXCEPTION 'El monto del concepto no puede ser negativo' USING ERRCODE = '22023';
  END IF;
  IF v_calc = 'porcentaje_sd' AND v_monto > 700 THEN
    RAISE EXCEPTION 'El porcentaje del salario diario no puede pasar de 700' USING ERRCODE = '22023';
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
    INSERT INTO nomina_conceptos (nombre, tipo, categoria, calculo, monto, aplica_a, departamento, activo, vigente_desde, vigente_hasta, notas, creado_por, actualizado_por)
    VALUES (v_nombre, v_tipo, v_cat, v_calc, v_monto, v_aplica, v_depto, v_activo, v_desde, v_hasta, v_notas, erp_actor_etiqueta(), erp_actor_etiqueta())
    RETURNING id INTO v_id;
  ELSE
    UPDATE nomina_conceptos
       SET nombre = v_nombre, calculo = v_calc, monto = v_monto, aplica_a = v_aplica, departamento = v_depto, activo = v_activo,
           vigente_desde = v_desde, vigente_hasta = v_hasta, notas = v_notas, actualizado_por = erp_actor_etiqueta(), updated_at = now()
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
    IF v_pm < 0 OR v_pl <= 0 OR (v_calc = 'porcentaje_sd' AND v_pm > 700) THEN
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

-- ═══ 7. Generar recibos: igual que 100 + propone los conceptos al crear ═══
CREATE OR REPLACE FUNCTION public.generar_recibos_nomina(p_periodo_id BIGINT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_per    nomina_periodos%ROWTYPE;
  v_nuevos BIGINT[];
  v_rid    BIGINT;
  v_n      INTEGER;
  v_lin    INTEGER := 0;
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
  WITH ins AS (
    INSERT INTO nomina_recibos (periodo_id, empleado_id, salario_diario, dias_pagados, sueldo, septimo_dia, total_percepciones, deducciones, neto_a_pagar, estatus)
    SELECT p_periodo_id, e.id, e.salario_diario, 6, round(e.salario_diario * 6, 2), e.salario_diario,
           round(e.salario_diario * 6, 2) + e.salario_diario, 0, round(e.salario_diario * 6, 2) + e.salario_diario, 'Pendiente'
      FROM empleados e
     WHERE e.estatus = 'Activo' AND e.fecha_ingreso <= v_per.fecha_fin AND e.salario_diario > 0
    ON CONFLICT (periodo_id, empleado_id) DO NOTHING
    RETURNING id)
  SELECT COALESCE(array_agg(id ORDER BY id), '{}') INTO v_nuevos FROM ins;
  v_n := COALESCE(array_length(v_nuevos, 1), 0);

  -- Solo los recibos recién creados reciben la propuesta del catálogo: uno
  -- existente nunca se reescribe (para eso está aplicar_conceptos_nomina).
  FOREACH v_rid IN ARRAY v_nuevos LOOP
    v_lin := v_lin + nomina_aplicar_conceptos_recibo(v_rid);
  END LOOP;

  PERFORM nomina_recalcular_periodo(p_periodo_id);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = p_periodo_id;
  RETURN jsonb_build_object('periodo_id', p_periodo_id, 'creados', v_n, 'lineas', v_lin,
    'recibos', (SELECT count(*) FROM nomina_recibos WHERE periodo_id = p_periodo_id),
    'total_percepciones', v_per.total_percepciones, 'total_deducciones', v_per.total_deducciones, 'total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.generar_recibos_nomina(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generar_recibos_nomina(BIGINT) TO authenticated, service_role;

-- ═══ 8. Aplicar al borrador los conceptos que le falten ═══
-- Para cuando el catálogo se creó o cambió DESPUÉS de generar los recibos.
-- Solo agrega lo que falta: no cambia montos ya capturados ni revive una
-- línea que Admin dejó en 0.
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
    v_k := nomina_aplicar_conceptos_recibo(v_rid);
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

-- ═══ 9. Guardar un recibo del borrador con su desglose ═══
-- p_lineas = el desglose COMPLETO que debe quedar:
--   de catálogo: { concepto_id, monto }           (nombre/tipo/clase: foto del servidor)
--   manual:      { nombre, tipo, categoria, monto }
-- Una línea de catálogo que ya existía y no viene queda en 0 ("no aplicó");
-- las manuales que no vienen se borran. El cliente nunca manda totales.
CREATE OR REPLACE FUNCTION public.guardar_recibo_nomina(
  p_recibo_id BIGINT, p_dias_pagados INTEGER, p_con_septimo BOOLEAN, p_lineas JSONB
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pid    BIGINT;
  v_per    nomina_periodos%ROWTYPE;
  v_r      nomina_recibos%ROWTYPE;
  v_l      JSONB;
  v_cid    BIGINT;
  v_m      NUMERIC;
  v_nom    TEXT;
  v_tipo   TEXT;
  v_cat    TEXT;
  v_c      nomina_conceptos%ROWTYPE;
  v_lim    NUMERIC;
  v_rest   NUMERIC;
  v_vistos BIGINT[] := '{}';
  v_sueldo NUMERIC;
  v_sept   NUMERIC;
  v_perc   NUMERIC;
  v_ded    NUMERIC;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_recibo_nomina: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT periodo_id INTO v_pid FROM nomina_recibos WHERE id = p_recibo_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Recibo no encontrado' USING ERRCODE = '22023'; END IF;
  -- El periodo serializa edición, generación y pago.
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_pid FOR UPDATE;
  IF v_per.estatus <> 'Borrador' THEN
    RAISE EXCEPTION 'El periodo % ya está pagado: sus recibos no se editan', v_per.periodo USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_r FROM nomina_recibos WHERE id = p_recibo_id FOR UPDATE;

  IF p_dias_pagados IS NULL OR p_dias_pagados < 0 OR p_dias_pagados > 7 THEN
    RAISE EXCEPTION 'Días pagados inválidos (0 a 7)' USING ERRCODE = '22023';
  END IF;
  IF p_con_septimo IS NULL THEN RAISE EXCEPTION 'Indica si aplica el séptimo día' USING ERRCODE = '22023'; END IF;
  IF p_lineas IS NULL OR jsonb_typeof(p_lineas) <> 'array' OR jsonb_array_length(p_lineas) > 40 THEN
    RAISE EXCEPTION 'Desglose del recibo inválido' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM nomina_concepto_empleados WHERE empleado_id = v_r.empleado_id AND limite_total IS NOT NULL ORDER BY concepto_id FOR UPDATE;

  -- Las manuales se reemplazan completas.
  DELETE FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id AND concepto_id IS NULL;

  FOR v_l IN SELECT * FROM jsonb_array_elements(p_lineas) LOOP
    BEGIN
      v_cid := NULLIF(v_l ->> 'concepto_id', '')::BIGINT;
      v_m   := round((v_l ->> 'monto')::NUMERIC, 2);
    EXCEPTION WHEN OTHERS THEN
      RAISE EXCEPTION 'Importe inválido en el desglose' USING ERRCODE = '22023';
    END;
    IF v_m IS NULL THEN RAISE EXCEPTION 'Importe inválido en el desglose' USING ERRCODE = '22023'; END IF;
    IF v_m < 0 THEN RAISE EXCEPTION 'Los importes del recibo no pueden ser negativos' USING ERRCODE = '22023'; END IF;

    IF v_cid IS NOT NULL THEN
      IF v_cid = ANY (v_vistos) THEN RAISE EXCEPTION 'Un concepto aparece dos veces en el recibo' USING ERRCODE = '22023'; END IF;
      v_vistos := v_vistos || v_cid;
      SELECT * INTO v_c FROM nomina_conceptos WHERE id = v_cid;
      IF NOT FOUND THEN RAISE EXCEPTION 'Concepto no encontrado' USING ERRCODE = '22023'; END IF;
      -- Tope acumulado (préstamo): nunca se descuenta más de lo que falta.
      SELECT limite_total INTO v_lim FROM nomina_concepto_empleados WHERE concepto_id = v_cid AND empleado_id = v_r.empleado_id;
      IF v_lim IS NOT NULL THEN
        v_rest := GREATEST(v_lim - nomina_acumulado_concepto(v_cid, v_r.empleado_id, p_recibo_id), 0);
        IF v_m > v_rest THEN
          RAISE EXCEPTION '"%": solo faltan $% para llegar al total de $%', v_c.nombre, v_rest, v_lim USING ERRCODE = '22023';
        END IF;
      END IF;
      UPDATE nomina_recibo_lineas SET monto = v_m, updated_at = now()
       WHERE recibo_id = p_recibo_id AND concepto_id = v_cid AND monto IS DISTINCT FROM v_m;
      IF NOT EXISTS (SELECT 1 FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id AND concepto_id = v_cid) THEN
        -- Agregar al recibo un concepto que no tenía: debe estar activo.
        IF NOT v_c.activo THEN RAISE EXCEPTION 'El concepto "%" está desactivado', v_c.nombre USING ERRCODE = '22023'; END IF;
        INSERT INTO nomina_recibo_lineas (recibo_id, concepto_id, nombre, tipo, categoria, monto)
        VALUES (p_recibo_id, v_cid, v_c.nombre, v_c.tipo, v_c.categoria, v_m);
      END IF;
    ELSE
      v_nom  := btrim(regexp_replace(COALESCE(v_l ->> 'nombre', ''), '\s+', ' ', 'g'));
      v_tipo := v_l ->> 'tipo';
      v_cat  := v_l ->> 'categoria';
      IF v_nom = '' OR char_length(v_nom) > 60 THEN
        RAISE EXCEPTION 'Escribe el nombre de cada renglón del recibo (máximo 60 letras)' USING ERRCODE = '22023';
      END IF;
      IF v_tipo IS NULL OR v_cat IS NULL
         OR NOT ((v_tipo = 'percepcion' AND v_cat IN ('comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad', 'otras_percepciones'))
              OR (v_tipo = 'descuento' AND v_cat IN ('isr', 'imss', 'prestamo', 'otras_deducciones'))) THEN
        RAISE EXCEPTION 'Tipo o clase inválidos en el renglón "%"', v_nom USING ERRCODE = '22023';
      END IF;
      CONTINUE WHEN v_m = 0;
      INSERT INTO nomina_recibo_lineas (recibo_id, concepto_id, nombre, tipo, categoria, monto)
      VALUES (p_recibo_id, NULL, v_nom, v_tipo, v_cat, v_m);
    END IF;
  END LOOP;

  -- Las de catálogo que ya estaban y no vinieron: "esta semana no aplicó".
  UPDATE nomina_recibo_lineas SET monto = 0, updated_at = now()
   WHERE recibo_id = p_recibo_id AND concepto_id IS NOT NULL AND NOT (concepto_id = ANY (v_vistos)) AND monto <> 0;

  -- El salario es el del snapshot del recibo.
  v_sueldo := round(v_r.salario_diario * p_dias_pagados, 2);
  v_sept   := CASE WHEN p_con_septimo THEN v_r.salario_diario ELSE 0 END;
  SELECT v_sueldo + v_sept + COALESCE(sum(monto) FILTER (WHERE tipo = 'percepcion'), 0), COALESCE(sum(monto) FILTER (WHERE tipo = 'descuento'), 0)
    INTO v_perc, v_ded FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id;
  IF v_perc - v_ded < 0 THEN
    RAISE EXCEPTION 'Las deducciones (%) exceden las percepciones (%)', v_ded, v_perc USING ERRCODE = '22023';
  END IF;

  -- Días, sueldo, séptimo y casillas en un solo UPDATE.
  PERFORM nomina_recalcular_recibo(p_recibo_id, p_dias_pagados, p_con_septimo);
  PERFORM nomina_recalcular_periodo(v_pid);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_pid;

  RETURN jsonb_build_object('recibo_id', p_recibo_id, 'periodo_id', v_pid, 'salario_diario', v_r.salario_diario, 'sueldo', v_sueldo,
    'septimo_dia', v_sept, 'total_percepciones', v_perc, 'deducciones', v_ded, 'neto_a_pagar', v_perc - v_ded,
    'lineas', (SELECT count(*) FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id),
    'periodo_total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.guardar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, JSONB) TO authenticated, service_role;

-- ═══ 10. Contrato anterior (100): misma firma, validaciones y respuesta ═══
-- El cliente anterior manda el TOTAL de cada casilla. Lo que el catálogo ya
-- puso en esa casilla se respeta y la diferencia queda como un renglón manual.
-- Sin conceptos en el recibo el resultado es idéntico al de 100.
CREATE OR REPLACE FUNCTION public.editar_recibo_nomina(
  p_recibo_id BIGINT, p_dias_pagados INTEGER, p_con_septimo BOOLEAN,
  p_comisiones NUMERIC DEFAULT 0, p_prima_dominical NUMERIC DEFAULT 0, p_bono_puntualidad NUMERIC DEFAULT 0,
  p_bono_productividad NUMERIC DEFAULT 0, p_otras_percepciones NUMERIC DEFAULT 0, p_deducciones NUMERIC DEFAULT 0
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_pid    BIGINT;
  v_per    nomina_periodos%ROWTYPE;
  v_r      nomina_recibos%ROWTYPE;
  v_com    NUMERIC := round(COALESCE(p_comisiones, 0), 2);
  v_prima  NUMERIC := round(COALESCE(p_prima_dominical, 0), 2);
  v_bpun   NUMERIC := round(COALESCE(p_bono_puntualidad, 0), 2);
  v_bpro   NUMERIC := round(COALESCE(p_bono_productividad, 0), 2);
  v_otras  NUMERIC := round(COALESCE(p_otras_percepciones, 0), 2);
  v_ded    NUMERIC := round(COALESCE(p_deducciones, 0), 2);
  v_sueldo NUMERIC;
  v_sept   NUMERIC;
  v_perc   NUMERIC;
  v_cat    NUMERIC;
  v_i      INTEGER;
  v_cats   TEXT[] := ARRAY['comisiones', 'prima_dominical', 'bono_puntualidad', 'bono_productividad', 'otras_percepciones', 'otras_deducciones'];
  v_noms   TEXT[] := ARRAY['Comisiones', 'Prima dominical', 'Bono de puntualidad', 'Bono de productividad', 'Otras percepciones', 'Deducciones'];
  v_tot    NUMERIC[];
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

  v_tot := ARRAY[v_com, v_prima, v_bpun, v_bpro, v_otras, v_ded];
  DELETE FROM nomina_recibo_lineas WHERE recibo_id = p_recibo_id AND concepto_id IS NULL;
  FOR v_i IN 1..6 LOOP
    -- Lo que el catálogo ya aporta a esa casilla (todos los descuentos van a "deducciones").
    SELECT COALESCE(sum(monto), 0) INTO v_cat FROM nomina_recibo_lineas
     WHERE recibo_id = p_recibo_id AND concepto_id IS NOT NULL
       AND CASE WHEN v_i = 6 THEN tipo = 'descuento' ELSE categoria = v_cats[v_i] END;
    IF v_tot[v_i] < v_cat THEN
      RAISE EXCEPTION 'El recibo tiene conceptos del catálogo en "%" por $%: actualiza la aplicación para editar su desglose', v_noms[v_i], v_cat USING ERRCODE = '22023';
    END IF;
    IF v_tot[v_i] > v_cat THEN
      INSERT INTO nomina_recibo_lineas (recibo_id, concepto_id, nombre, tipo, categoria, monto)
      VALUES (p_recibo_id, NULL, v_noms[v_i], CASE WHEN v_i = 6 THEN 'descuento' ELSE 'percepcion' END, v_cats[v_i], v_tot[v_i] - v_cat);
    END IF;
  END LOOP;

  UPDATE nomina_recibos
     SET dias_pagados = p_dias_pagados, sueldo = v_sueldo, septimo_dia = v_sept, comisiones = v_com, prima_dominical = v_prima,
         bono_puntualidad = v_bpun, bono_productividad = v_bpro, otras_percepciones = v_otras,
         total_percepciones = v_perc, deducciones = v_ded, neto_a_pagar = v_perc - v_ded, updated_at = now()
   WHERE id = p_recibo_id;
  -- Las casillas ya coinciden con las líneas; el recálculo lo comprueba.
  PERFORM nomina_recalcular_recibo(p_recibo_id);
  PERFORM nomina_recalcular_periodo(v_pid);
  SELECT * INTO v_per FROM nomina_periodos WHERE id = v_pid;

  RETURN jsonb_build_object('recibo_id', p_recibo_id, 'periodo_id', v_pid, 'salario_diario', v_r.salario_diario, 'sueldo', v_sueldo,
    'septimo_dia', v_sept, 'total_percepciones', v_perc, 'deducciones', v_ded, 'neto_a_pagar', v_perc - v_ded,
    'periodo_total_neto', v_per.total_neto);
END $$;
REVOKE ALL ON FUNCTION public.editar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.editar_recibo_nomina(BIGINT, INTEGER, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC, NUMERIC) TO authenticated, service_role;

-- ═══ 11. Avance de los topes (préstamos) para la pantalla ═══
-- Por cada persona con tope: cuánto lleva en periodos pagados, cuánto hay en
-- borradores y cuánto falta.
CREATE OR REPLACE FUNCTION public.nomina_acumulados() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'nomina_acumulados: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object('concepto_id', ce.concepto_id, 'empleado_id', ce.empleado_id, 'limite_total', ce.limite_total,
             'pagado', x.pagado, 'en_borrador', x.borrador, 'restante', GREATEST(ce.limite_total - x.pagado - x.borrador, 0))
           ORDER BY ce.concepto_id, ce.empleado_id)
      FROM nomina_concepto_empleados ce
      CROSS JOIN LATERAL (
        SELECT COALESCE(sum(l.monto) FILTER (WHERE p.estatus = 'Pagado'), 0) AS pagado,
               COALESCE(sum(l.monto) FILTER (WHERE p.estatus <> 'Pagado'), 0) AS borrador
          FROM nomina_recibo_lineas l
          JOIN nomina_recibos r ON r.id = l.recibo_id
          JOIN nomina_periodos p ON p.id = r.periodo_id
         WHERE l.concepto_id = ce.concepto_id AND r.empleado_id = ce.empleado_id) x
     WHERE ce.limite_total IS NOT NULL), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.nomina_acumulados() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.nomina_acumulados() TO authenticated, service_role;
