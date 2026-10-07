-- 118_calendario_operativo.sql — PD-02: calendario operativo (diseño auditado).
--
-- Decisiones del dueño (cerradas): crear/editar solo Admin; el asignado puede
-- completar si la actividad lo permite; actividades de pago/administrativas
-- pueden ser solo de Admin (visibilidad = 'admin'); completar antes o después
-- de la ventana se permite y queda la evidencia (anticipada / en_ventana /
-- tardia); ventanas que cruzan al periodo siguiente (28 → 3) soportadas; sin
-- notificaciones; independiente de la asistencia (116).
--
-- Modelo: `actividades` = plantilla VERSIONADA (la definición nunca se
-- sobrescribe: un trigger lo impide; "editar las futuras" cierra la versión y
-- crea la sucesora). `actividad_ocurrencias` = fila SOLO cuando algo pasa
-- (completada o editada individualmente). Las ocurrencias de cualquier rango
-- se CALCULAN desde las versiones al leer: nunca se generan filas futuras.
--
-- Regla de periodo (determinista, servidor): una ocurrencia pertenece al
-- periodo (semana ISO, mes o año) en el que EMPIEZA su ventana; `periodo` es
-- el primer día de ese periodo (en 'unica', la fecha de inicio). Si el día de
-- fin es menor que el de inicio, la ventana termina en la semana / mes
-- siguiente (28 oct → 3 nov pertenece a octubre). Un día que no existe en el
-- mes (31, 29 feb) se ajusta al último día del mes. Una versión genera la
-- ocurrencia del periodo P si P está en [vigente_desde, vigente_hasta] (ambas
-- fechas son inicios de periodo). "Editar las futuras" y "desactivar" conservan
-- en la versión vieja todo periodo ya iniciado o completado (K); la sucesora
-- empieza en el periodo siguiente a K: nunca hay dos ocurrencias por periodo.
--
-- Estado (servidor, fin_hoy() en America/Mazatlan; el reloj del navegador no
-- decide): completada → 'completada'; hoy < inicio → 'proxima'; inicio ≤ hoy ≤
-- fin → 'pendiente'; hoy > fin → 'vencida'. Al completar se guarda la fecha de
-- negocio y la clasificación (inmutable). El color es solo de la interfaz.
--
-- Visibilidad: Admin ve todo. Los demás ven una actividad si visibilidad =
-- 'asignado' y son su responsable (usuario) o tienen su rol. Sin responsable o
-- visibilidad 'admin' → solo Admin. Completar: Admin, o el responsable si
-- asignado_puede_completar. Mismas reglas en RLS (lectura por API) y en los
-- contratos. Sin escritura directa. Completar NO crea pagos, movimientos ni
-- cambia máquinas o camiones: solo registra la obligación cumplida.
--
-- Reversión (sin actividades reales): DROP de funciones, triggers y tablas de
-- este archivo. Con actividades: no borrar historia.

-- ═══ Tablas ═══
CREATE TABLE IF NOT EXISTS actividades (
  id                       BIGSERIAL PRIMARY KEY,
  serie_id                 BIGINT NOT NULL,
  version                  INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  reemplaza_id             BIGINT REFERENCES actividades(id),
  titulo                   TEXT NOT NULL CHECK (btrim(titulo) <> ''),
  descripcion              TEXT NOT NULL DEFAULT '',
  categoria                TEXT NOT NULL CHECK (categoria IN ('mantenimiento', 'limpieza', 'pago', 'administrativa', 'operativa', 'otra')),
  responsable_usuario_id   BIGINT REFERENCES usuarios(id),
  responsable_rol          TEXT CHECK (responsable_rol IS NULL OR responsable_rol IN ('Admin', 'Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Empleado')),
  visibilidad              TEXT NOT NULL CHECK (visibilidad IN ('admin', 'asignado')),
  asignado_puede_completar BOOLEAN NOT NULL DEFAULT true,
  relacionado_tipo         TEXT CHECK (relacionado_tipo IS NULL OR relacionado_tipo IN ('camion', 'maquina', 'costo_fijo')),
  relacionado_ref          TEXT,
  recurrencia              TEXT NOT NULL CHECK (recurrencia IN ('unica', 'semanal', 'mensual', 'anual')),
  fecha_inicio             DATE,
  fecha_fin                DATE,
  dia_semana_inicio        SMALLINT CHECK (dia_semana_inicio BETWEEN 1 AND 7),
  dia_semana_fin           SMALLINT CHECK (dia_semana_fin BETWEEN 1 AND 7),
  mes                      SMALLINT CHECK (mes BETWEEN 1 AND 12),
  dia_inicio               SMALLINT CHECK (dia_inicio BETWEEN 1 AND 31),
  dia_fin                  SMALLINT CHECK (dia_fin BETWEEN 1 AND 31),
  vigente_desde            DATE NOT NULL,
  vigente_hasta            DATE,
  activo                   BOOLEAN NOT NULL DEFAULT true,
  creada_por_id            BIGINT,
  creada_por               TEXT NOT NULL,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  cerrada_at               TIMESTAMPTZ,
  cerrada_por              TEXT,
  motivo_cierre            TEXT,
  operacion_id             UUID NOT NULL UNIQUE,
  UNIQUE (serie_id, version),
  CHECK (NOT (responsable_usuario_id IS NOT NULL AND responsable_rol IS NOT NULL)),
  CHECK ((relacionado_tipo IS NULL) = (relacionado_ref IS NULL)),
  -- Una versión puede quedar vacía (reemplazada antes de empezar): hasta = desde - 1.
  CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde - 1),
  CHECK (CASE recurrencia
    WHEN 'unica' THEN fecha_inicio IS NOT NULL AND fecha_fin IS NOT NULL AND fecha_fin >= fecha_inicio AND fecha_fin - fecha_inicio <= 366
                      AND dia_semana_inicio IS NULL AND dia_semana_fin IS NULL AND mes IS NULL AND dia_inicio IS NULL AND dia_fin IS NULL
    WHEN 'semanal' THEN dia_semana_inicio IS NOT NULL AND dia_semana_fin IS NOT NULL
                      AND fecha_inicio IS NULL AND fecha_fin IS NULL AND mes IS NULL AND dia_inicio IS NULL AND dia_fin IS NULL
    WHEN 'mensual' THEN dia_inicio IS NOT NULL AND dia_fin IS NOT NULL
                      AND fecha_inicio IS NULL AND fecha_fin IS NULL AND mes IS NULL AND dia_semana_inicio IS NULL AND dia_semana_fin IS NULL
    ELSE mes IS NOT NULL AND dia_inicio IS NOT NULL AND dia_fin IS NOT NULL
                      AND fecha_inicio IS NULL AND fecha_fin IS NULL AND dia_semana_inicio IS NULL AND dia_semana_fin IS NULL END)
);
CREATE INDEX IF NOT EXISTS idx_actividades_serie ON actividades (serie_id);
CREATE INDEX IF NOT EXISTS idx_actividades_responsable ON actividades (responsable_usuario_id) WHERE responsable_usuario_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS actividad_ocurrencias (
  id                        BIGSERIAL PRIMARY KEY,
  actividad_id              BIGINT NOT NULL REFERENCES actividades(id),
  periodo                   DATE NOT NULL,
  ventana_inicio_original   DATE NOT NULL,
  ventana_fin_original      DATE NOT NULL,
  ventana_inicio            DATE NOT NULL,
  ventana_fin               DATE NOT NULL,
  editada_at                TIMESTAMPTZ,
  editada_por               TEXT,
  motivo_edicion            TEXT,
  operacion_edicion         UUID UNIQUE,
  completada_at             TIMESTAMPTZ,
  completada_fecha          DATE,
  completada_por_id         BIGINT,
  completada_por            TEXT,
  completada_clasificacion  TEXT CHECK (completada_clasificacion IS NULL OR completada_clasificacion IN ('anticipada', 'en_ventana', 'tardia')),
  notas                     TEXT,
  operacion_completar       UUID UNIQUE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (actividad_id, periodo),
  CHECK (ventana_fin >= ventana_inicio AND ventana_fin_original >= ventana_inicio_original),
  CHECK ((completada_at IS NULL) = (operacion_completar IS NULL)),
  CHECK ((completada_at IS NULL) = (completada_fecha IS NULL)),
  CHECK ((completada_at IS NULL) = (completada_clasificacion IS NULL)),
  CHECK ((completada_at IS NULL) = (completada_por IS NULL))
);

-- ═══ Historia inmutable (también contra los contratos) ═══
CREATE OR REPLACE FUNCTION public.actividades_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actividades: la historia no se borra (desactiva la actividad)' USING ERRCODE = '42501';
  END IF;
  -- Solo se cierra una versión: vigencia final, activo y datos del cierre.
  IF (to_jsonb(NEW) - ARRAY['vigente_hasta', 'activo', 'cerrada_at', 'cerrada_por', 'motivo_cierre'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['vigente_hasta', 'activo', 'cerrada_at', 'cerrada_por', 'motivo_cierre']) THEN
    RAISE EXCEPTION 'actividades: la definición de una versión no se modifica (se crea una versión nueva)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.actividad_ocurrencias_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'actividad_ocurrencias: la historia no se borra' USING ERRCODE = '42501';
  END IF;
  IF OLD.completada_at IS NOT NULL THEN
    RAISE EXCEPTION 'actividad_ocurrencias: una ocurrencia completada es inmutable' USING ERRCODE = '42501';
  END IF;
  IF NEW.actividad_id <> OLD.actividad_id OR NEW.periodo <> OLD.periodo
     OR NEW.ventana_inicio_original <> OLD.ventana_inicio_original OR NEW.ventana_fin_original <> OLD.ventana_fin_original THEN
    RAISE EXCEPTION 'actividad_ocurrencias: la identidad de la ocurrencia no cambia' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.actividades_guard(), public.actividad_ocurrencias_guard() FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS trg_actividades_guard ON actividades;
CREATE TRIGGER trg_actividades_guard BEFORE UPDATE OR DELETE ON actividades FOR EACH ROW EXECUTE FUNCTION actividades_guard();
DROP TRIGGER IF EXISTS trg_actividad_ocurrencias_guard ON actividad_ocurrencias;
CREATE TRIGGER trg_actividad_ocurrencias_guard BEFORE UPDATE OR DELETE ON actividad_ocurrencias FOR EACH ROW EXECUTE FUNCTION actividad_ocurrencias_guard();

-- ═══ Utilidades ═══
-- Día p_dia del mes que empieza en p_mes; si no existe, el último día del mes.
CREATE OR REPLACE FUNCTION public.actividad_dia_en_mes(p_mes DATE, p_dia INTEGER)
RETURNS DATE LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT p_mes + (LEAST(p_dia, EXTRACT(DAY FROM (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int) - 1)
$$;

-- Inicio del periodo que contiene p_d, y el periodo siguiente.
CREATE OR REPLACE FUNCTION public.actividad_periodo_de(p_rec TEXT, p_d DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_rec WHEN 'semanal' THEN date_trunc('week', p_d::timestamp)::date
                    WHEN 'mensual' THEN date_trunc('month', p_d::timestamp)::date
                    WHEN 'anual' THEN date_trunc('year', p_d::timestamp)::date ELSE p_d END
$$;
CREATE OR REPLACE FUNCTION public.actividad_periodo_siguiente(p_rec TEXT, p_periodo DATE)
RETURNS DATE LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE p_rec WHEN 'semanal' THEN p_periodo + 7
                    WHEN 'mensual' THEN (p_periodo + interval '1 month')::date
                    WHEN 'anual' THEN (p_periodo + interval '1 year')::date ELSE p_periodo + 1 END
$$;

-- Ventanas base de una versión cuyo intervalo toca [p_desde, p_hasta]. Puro: no escribe.
CREATE OR REPLACE FUNCTION public.actividad_ventanas(p_a actividades, p_desde DATE, p_hasta DATE)
RETURNS TABLE (periodo DATE, ventana_inicio DATE, ventana_fin DATE)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH base AS (
    SELECT p_a.fecha_inicio AS periodo, p_a.fecha_inicio AS vi, p_a.fecha_fin AS vf
     WHERE p_a.recurrencia = 'unica'
    UNION ALL
    SELECT g::date, g::date + (p_a.dia_semana_inicio - 1),
           g::date + (p_a.dia_semana_fin - 1) + CASE WHEN p_a.dia_semana_fin < p_a.dia_semana_inicio THEN 7 ELSE 0 END
      FROM generate_series(date_trunc('week', (p_desde - 14)::timestamp), p_hasta::timestamp, interval '1 week') g
     WHERE p_a.recurrencia = 'semanal'
    UNION ALL
    SELECT g::date, actividad_dia_en_mes(g::date, p_a.dia_inicio),
           CASE WHEN p_a.dia_fin >= p_a.dia_inicio THEN actividad_dia_en_mes(g::date, p_a.dia_fin)
                ELSE actividad_dia_en_mes((g + interval '1 month')::date, p_a.dia_fin) END
      FROM generate_series(date_trunc('month', (p_desde - 62)::timestamp), p_hasta::timestamp, interval '1 month') g
     WHERE p_a.recurrencia = 'mensual'
    UNION ALL
    SELECT g::date, actividad_dia_en_mes((g + make_interval(months => p_a.mes - 1))::date, p_a.dia_inicio),
           CASE WHEN p_a.dia_fin >= p_a.dia_inicio THEN actividad_dia_en_mes((g + make_interval(months => p_a.mes - 1))::date, p_a.dia_fin)
                ELSE actividad_dia_en_mes((g + make_interval(months => p_a.mes))::date, p_a.dia_fin) END
      FROM generate_series(date_trunc('year', (p_desde - 62)::timestamp), p_hasta::timestamp, interval '1 year') g
     WHERE p_a.recurrencia = 'anual'
  )
  SELECT periodo, vi, vf FROM base
   WHERE periodo >= p_a.vigente_desde AND (p_a.vigente_hasta IS NULL OR periodo <= p_a.vigente_hasta)
     AND vf >= p_desde AND vi <= p_hasta
$$;

-- Estado semántico (el color lo pone la interfaz).
CREATE OR REPLACE FUNCTION public.actividad_estado(p_inicio DATE, p_fin DATE, p_completada BOOLEAN, p_hoy DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_completada THEN 'completada' WHEN p_hoy < p_inicio THEN 'proxima'
              WHEN p_hoy <= p_fin THEN 'pendiente' ELSE 'vencida' END
$$;

-- Clasificación de la terminación (fecha de negocio vs ventana efectiva).
CREATE OR REPLACE FUNCTION public.actividad_clasificacion(p_inicio DATE, p_fin DATE, p_fecha DATE)
RETURNS TEXT LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_fecha < p_inicio THEN 'anticipada' WHEN p_fecha <= p_fin THEN 'en_ventana' ELSE 'tardia' END
$$;

-- ¿La sesión ve esta actividad? (misma regla que la RLS)
CREATE OR REPLACE FUNCTION public.actividad_visible(p_a actividades)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT COALESCE(erp_rol_activo() = 'Admin'
      OR (p_a.visibilidad = 'asignado' AND erp_rol_activo() IS NOT NULL
          AND (p_a.responsable_usuario_id = erp_usuario_id() OR p_a.responsable_rol = erp_rol_activo())), false)
$$;

-- K: último periodo de la versión ya iniciado (ventana base empezó) o completado; NULL si ninguno.
CREATE OR REPLACE FUNCTION public.actividad_ultimo_periodo_iniciado(p_a actividades, p_hoy DATE)
RETURNS DATE LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT GREATEST((SELECT max(w.periodo) FROM actividad_ventanas(p_a, p_hoy - 800, p_hoy) w WHERE w.ventana_inicio <= p_hoy),
                  (SELECT max(o.periodo) FROM actividad_ocurrencias o WHERE o.actividad_id = p_a.id AND o.completada_at IS NOT NULL))
$$;

-- ═══ Privilegios y RLS (lectura según visibilidad; sin escritura directa) ═══
REVOKE ALL ON actividades, actividad_ocurrencias FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON actividades, actividad_ocurrencias TO authenticated;
REVOKE ALL ON SEQUENCE actividades_id_seq, actividad_ocurrencias_id_seq FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE actividades ENABLE ROW LEVEL SECURITY;
ALTER TABLE actividad_ocurrencias ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS actividades_lectura ON actividades;
CREATE POLICY actividades_lectura ON actividades FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin'
         OR (visibilidad = 'asignado' AND (responsable_usuario_id = erp_usuario_id() OR responsable_rol = erp_rol_activo())));
DROP POLICY IF EXISTS actividad_ocurrencias_lectura ON actividad_ocurrencias;
CREATE POLICY actividad_ocurrencias_lectura ON actividad_ocurrencias FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin' OR actividad_id IN (SELECT a.id FROM actividades a));

-- Fila de calendario (actividad + ventana + ocurrencia materializada, si hay).
CREATE OR REPLACE FUNCTION public.actividad_ocurrencia_json(p_a actividades, p_periodo DATE, p_vi DATE, p_vf DATE, p_o actividad_ocurrencias, p_hoy DATE)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'actividad_id', p_a.id, 'serie_id', p_a.serie_id, 'version', p_a.version, 'titulo', p_a.titulo, 'descripcion', p_a.descripcion,
    'categoria', p_a.categoria, 'recurrencia', p_a.recurrencia, 'fecha_inicio', p_a.fecha_inicio, 'fecha_fin', p_a.fecha_fin,
    'dia_semana_inicio', p_a.dia_semana_inicio, 'dia_semana_fin', p_a.dia_semana_fin, 'mes', p_a.mes,
    'dia_inicio', p_a.dia_inicio, 'dia_fin', p_a.dia_fin, 'vigente_desde', p_a.vigente_desde, 'vigente_hasta', p_a.vigente_hasta,
    'actividad_activa', p_a.activo, 'visibilidad', p_a.visibilidad, 'asignado_puede_completar', p_a.asignado_puede_completar,
    'responsable_usuario_id', p_a.responsable_usuario_id, 'responsable_rol', p_a.responsable_rol,
    'responsable_nombre', (SELECT u.nombre FROM usuarios u WHERE u.id = p_a.responsable_usuario_id),
    'responsable_activo', CASE WHEN p_a.responsable_usuario_id IS NULL THEN p_a.responsable_rol IS NOT NULL
                               ELSE EXISTS (SELECT 1 FROM usuarios u WHERE u.id = p_a.responsable_usuario_id AND u.estatus = 'Activo') END,
    'relacionado_tipo', p_a.relacionado_tipo, 'relacionado_ref', p_a.relacionado_ref,
    'relacionado_etiqueta', CASE p_a.relacionado_tipo
        WHEN 'camion' THEN (SELECT c.nombre FROM camiones c WHERE c.id::text = p_a.relacionado_ref)
        WHEN 'costo_fijo' THEN (SELECT f.nombre FROM costos_fijos f WHERE f.id::text = p_a.relacionado_ref)
        ELSE p_a.relacionado_ref END,
    'periodo', p_periodo,
    'ventana_inicio', COALESCE(p_o.ventana_inicio, p_vi), 'ventana_fin', COALESCE(p_o.ventana_fin, p_vf),
    'ventana_inicio_original', p_vi, 'ventana_fin_original', p_vf,
    'editada', p_o.editada_at IS NOT NULL, 'motivo_edicion', p_o.motivo_edicion, 'editada_por', p_o.editada_por,
    'estado', actividad_estado(COALESCE(p_o.ventana_inicio, p_vi), COALESCE(p_o.ventana_fin, p_vf), p_o.completada_at IS NOT NULL, p_hoy),
    'completada_at', p_o.completada_at, 'completada_fecha', p_o.completada_fecha, 'completada_por', p_o.completada_por,
    'clasificacion', p_o.completada_clasificacion, 'notas', p_o.notas,
    'puede_completar', p_o.completada_at IS NULL AND (erp_rol_activo() = 'Admin' OR (actividad_visible(p_a) AND p_a.asignado_puede_completar)),
    'puede_editar', erp_rol_activo() = 'Admin')
$$;

-- ═══ Lectura: calendario(desde, hasta) — ocurrencias calculadas, sin escribir ═══
CREATE OR REPLACE FUNCTION public.calendario(p_desde DATE, p_hasta DATE, p_solo_mias BOOLEAN DEFAULT false, p_solo_abiertas BOOLEAN DEFAULT false)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol TEXT := erp_rol_activo();
  v_uid BIGINT := erp_usuario_id();
  v_hoy DATE := fin_hoy();
  v_res JSONB;
BEGIN
  IF v_rol IS NULL AND fin_jwt_role() IS NOT NULL THEN
    RAISE EXCEPTION 'calendario: se requiere una sesión activa' USING ERRCODE = '42501';
  END IF;
  IF p_desde IS NULL OR p_hasta IS NULL OR p_hasta < p_desde OR p_hasta - p_desde > 1100 THEN
    RAISE EXCEPTION 'calendario: rango inválido (máximo 1,100 días)' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(jsonb_agg(x.j ORDER BY x.vf, x.titulo, x.id), '[]'::jsonb) INTO v_res
    FROM (
      SELECT actividad_ocurrencia_json(a, w.periodo, w.ventana_inicio, w.ventana_fin, o, v_hoy) AS j,
             COALESCE(o.ventana_fin, w.ventana_fin) AS vf, a.titulo, a.id, o.completada_at
        FROM actividades a
        CROSS JOIN LATERAL actividad_ventanas(a, p_desde, p_hasta) w
        LEFT JOIN actividad_ocurrencias o ON o.actividad_id = a.id AND o.periodo = w.periodo
       WHERE (v_rol IS NULL OR actividad_visible(a))
         AND (NOT p_solo_mias OR a.responsable_usuario_id = v_uid OR a.responsable_rol = v_rol)
         AND (NOT p_solo_abiertas OR o.completada_at IS NULL)
    ) x;
  RETURN jsonb_build_object('hoy', v_hoy, 'desde', p_desde, 'hasta', p_hasta, 'es_admin', COALESCE(v_rol = 'Admin', v_rol IS NULL), 'ocurrencias', v_res);
END $$;

-- Ventana base de una ocurrencia válida de la versión (NULL si el periodo no le corresponde).
CREATE OR REPLACE FUNCTION public.actividad_ventana_de(p_a actividades, p_periodo DATE)
RETURNS TABLE (ventana_inicio DATE, ventana_fin DATE)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  SELECT w.ventana_inicio, w.ventana_fin FROM actividad_ventanas(p_a, p_periodo, p_periodo + 400) w WHERE w.periodo = p_periodo
$$;

-- ═══ Completar (Admin, o el responsable si la actividad lo permite) ═══
CREATE OR REPLACE FUNCTION public.completar_ocurrencia(p_operacion_id UUID, p_actividad_id BIGINT, p_periodo DATE, p_notas TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol  TEXT := erp_rol_activo();
  v_hoy  DATE := fin_hoy();
  v_a    actividades%ROWTYPE;
  v_o    actividad_ocurrencias%ROWTYPE;
  v_w    RECORD;
BEGIN
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'completar_ocurrencia: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  -- Replay de la misma petición: el resultado original.
  SELECT * INTO v_o FROM actividad_ocurrencias WHERE operacion_completar = p_operacion_id;
  IF FOUND THEN
    IF v_o.actividad_id <> p_actividad_id OR v_o.periodo <> p_periodo OR v_o.completada_por_id IS DISTINCT FROM erp_usuario_id() THEN
      RAISE EXCEPTION 'completar_ocurrencia: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_a FROM actividades WHERE id = v_o.actividad_id;
    RETURN jsonb_build_object('ok', true, 'codigo', 'completada', 'replay', true,
      'ocurrencia', actividad_ocurrencia_json(v_a, v_o.periodo, v_o.ventana_inicio_original, v_o.ventana_fin_original, v_o, v_hoy));
  END IF;

  SELECT * INTO v_a FROM actividades WHERE id = p_actividad_id;
  -- Sin sesión de usuario no se completa; una actividad que no ves = no autorizado (sin revelar si existe).
  IF v_rol IS NULL OR NOT FOUND OR NOT actividad_visible(v_a) THEN
    RAISE EXCEPTION 'completar_ocurrencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_rol <> 'Admin' AND NOT v_a.asignado_puede_completar THEN
    RAISE EXCEPTION 'completar_ocurrencia: esta actividad solo la completa Admin' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_w FROM actividad_ventana_de(v_a, p_periodo);
  IF v_w.ventana_inicio IS NULL THEN
    RAISE EXCEPTION 'completar_ocurrencia: el periodo % no corresponde a esta actividad', p_periodo USING ERRCODE = '22023';
  END IF;
  IF v_w.ventana_inicio > v_hoy + 366 THEN
    RAISE EXCEPTION 'completar_ocurrencia: no se completa con más de un año de anticipación' USING ERRCODE = '22023';
  END IF;

  INSERT INTO actividad_ocurrencias (actividad_id, periodo, ventana_inicio_original, ventana_fin_original, ventana_inicio, ventana_fin)
  VALUES (v_a.id, p_periodo, v_w.ventana_inicio, v_w.ventana_fin, v_w.ventana_inicio, v_w.ventana_fin)
  ON CONFLICT (actividad_id, periodo) DO NOTHING;

  UPDATE actividad_ocurrencias o
     SET completada_at = now(), completada_fecha = v_hoy, completada_por_id = erp_usuario_id(), completada_por = erp_actor_etiqueta(),
         completada_clasificacion = actividad_clasificacion(o.ventana_inicio, o.ventana_fin, v_hoy),
         notas = NULLIF(btrim(COALESCE(p_notas, '')), ''), operacion_completar = p_operacion_id
   WHERE o.actividad_id = v_a.id AND o.periodo = p_periodo AND o.completada_at IS NULL
  RETURNING * INTO v_o;
  IF v_o.id IS NULL THEN
    SELECT * INTO v_o FROM actividad_ocurrencias WHERE actividad_id = v_a.id AND periodo = p_periodo;
    IF v_o.operacion_completar = p_operacion_id THEN
      RETURN jsonb_build_object('ok', true, 'codigo', 'completada', 'replay', true,
        'ocurrencia', actividad_ocurrencia_json(v_a, v_o.periodo, v_o.ventana_inicio_original, v_o.ventana_fin_original, v_o, v_hoy));
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', 'ya_completada',
      'ocurrencia', actividad_ocurrencia_json(v_a, v_o.periodo, v_o.ventana_inicio_original, v_o.ventana_fin_original, v_o, v_hoy));
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Completar', 'Calendario',
          v_a.titulo || ' · periodo ' || p_periodo || ' · ' || v_o.completada_clasificacion);
  RETURN jsonb_build_object('ok', true, 'codigo', 'completada', 'replay', false,
    'ocurrencia', actividad_ocurrencia_json(v_a, v_o.periodo, v_o.ventana_inicio_original, v_o.ventana_fin_original, v_o, v_hoy));
END $$;

-- ═══ Crear o "editar las futuras" (Admin): nunca sobrescribe; versiona ═══
CREATE OR REPLACE FUNCTION public.guardar_actividad(p_operacion_id UUID, p_id BIGINT, p_datos JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_hoy    DATE := fin_hoy();
  v_old    actividades%ROWTYPE;
  v_new    actividades%ROWTYPE;
  v_id     BIGINT;
  v_corte  DATE;
  v_k      DATE;
  v_desde  DATE;
  v_rec    TEXT := p_datos ->> 'recurrencia';
  v_rtipo  TEXT := NULLIF(p_datos ->> 'relacionado_tipo', '');
  v_rref   TEXT := NULLIF(btrim(COALESCE(p_datos ->> 'relacionado_ref', '')), '');
  v_resp   BIGINT := NULLIF(p_datos ->> 'responsable_usuario_id', '')::bigint;
  v_rrol   TEXT := NULLIF(p_datos ->> 'responsable_rol', '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_actividad: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'guardar_actividad: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_new FROM actividades WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN jsonb_build_object('ok', true, 'id', v_new.id, 'version', v_new.version, 'replay', true);
  END IF;
  -- Relacionado: entidades existentes (sin acoplar su lógica: no se crean pagos ni se tocan máquinas).
  IF v_rtipo = 'camion' AND NOT EXISTS (SELECT 1 FROM camiones WHERE id::text = v_rref) THEN
    RAISE EXCEPTION 'guardar_actividad: el camión % no existe', v_rref USING ERRCODE = '22023';
  ELSIF v_rtipo = 'costo_fijo' AND NOT EXISTS (SELECT 1 FROM costos_fijos WHERE id::text = v_rref) THEN
    RAISE EXCEPTION 'guardar_actividad: el costo fijo % no existe', v_rref USING ERRCODE = '22023';
  ELSIF v_rtipo = 'maquina' AND v_rref NOT IN ('Máquina 30', 'Máquina 20', 'Máquina 15', 'Máquina Barra') THEN
    RAISE EXCEPTION 'guardar_actividad: máquina desconocida %', v_rref USING ERRCODE = '22023';
  END IF;
  IF v_resp IS NOT NULL AND NOT EXISTS (SELECT 1 FROM usuarios WHERE id = v_resp AND estatus = 'Activo') THEN
    RAISE EXCEPTION 'guardar_actividad: el responsable debe ser un usuario activo' USING ERRCODE = '22023';
  END IF;

  IF p_id IS NOT NULL THEN
    SELECT * INTO v_old FROM actividades WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'guardar_actividad: actividad % no existe', p_id USING ERRCODE = '22023';
    END IF;
    IF NOT v_old.activo THEN
      RAISE EXCEPTION 'guardar_actividad: esa versión ya no está vigente (edita la versión actual)' USING ERRCODE = '22023';
    END IF;
    IF v_old.recurrencia = 'unica' THEN
      IF EXISTS (SELECT 1 FROM actividad_ocurrencias WHERE actividad_id = v_old.id AND completada_at IS NOT NULL) THEN
        RAISE EXCEPTION 'guardar_actividad: la actividad única ya se completó; crea una nueva' USING ERRCODE = '22023';
      END IF;
      v_corte := v_old.vigente_desde - 1;           -- se reemplaza completa
    ELSE
      -- Los periodos ya iniciados (o completados) quedan con la versión vieja.
      v_k := actividad_ultimo_periodo_iniciado(v_old, v_hoy);
      v_corte := COALESCE(v_k, v_old.vigente_desde - 1);
    END IF;
    IF v_rec IS DISTINCT FROM v_old.recurrencia THEN
      RAISE EXCEPTION 'guardar_actividad: el tipo de recurrencia no cambia en una versión (desactiva y crea otra)' USING ERRCODE = '22023';
    END IF;
  END IF;

  IF v_rec = 'unica' THEN
    v_desde := (p_datos ->> 'fecha_inicio')::date;
  ELSE
    v_desde := actividad_periodo_de(v_rec, COALESCE(NULLIF(p_datos ->> 'vigente_desde', '')::date, v_hoy));
    IF v_old.id IS NOT NULL THEN
      v_desde := GREATEST(v_desde, CASE WHEN v_k IS NULL THEN v_old.vigente_desde ELSE actividad_periodo_siguiente(v_rec, v_k) END);
    END IF;
  END IF;

  v_id := pg_catalog.nextval('public.actividades_id_seq'::regclass);
  INSERT INTO actividades (id, serie_id, version, reemplaza_id, titulo, descripcion, categoria, responsable_usuario_id, responsable_rol,
                           visibilidad, asignado_puede_completar, relacionado_tipo, relacionado_ref, recurrencia, fecha_inicio, fecha_fin,
                           dia_semana_inicio, dia_semana_fin, mes, dia_inicio, dia_fin, vigente_desde, vigente_hasta, creada_por_id,
                           creada_por, operacion_id)
  VALUES (v_id, COALESCE(v_old.serie_id, v_id), COALESCE(v_old.version + 1, 1), v_old.id,
          btrim(COALESCE(p_datos ->> 'titulo', '')), COALESCE(p_datos ->> 'descripcion', ''), p_datos ->> 'categoria', v_resp, v_rrol,
          COALESCE(p_datos ->> 'visibilidad', 'asignado'), COALESCE((p_datos ->> 'asignado_puede_completar')::boolean, true), v_rtipo, v_rref, v_rec,
          (p_datos ->> 'fecha_inicio')::date, (p_datos ->> 'fecha_fin')::date,
          (p_datos ->> 'dia_semana_inicio')::smallint, (p_datos ->> 'dia_semana_fin')::smallint, (p_datos ->> 'mes')::smallint,
          (p_datos ->> 'dia_inicio')::smallint, (p_datos ->> 'dia_fin')::smallint,
          v_desde, actividad_periodo_de(v_rec, NULLIF(p_datos ->> 'vigente_hasta', '')::date), erp_usuario_id(), erp_actor_etiqueta(), p_operacion_id)
  RETURNING * INTO v_new;

  IF v_old.id IS NOT NULL THEN
    UPDATE actividades SET vigente_hasta = v_corte, activo = false, cerrada_at = now(), cerrada_por = erp_actor_etiqueta(),
           motivo_cierre = 'reemplazada por la versión ' || v_new.version
     WHERE id = v_old.id;
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), CASE WHEN v_old.id IS NULL THEN 'Crear' ELSE 'Editar' END, 'Calendario',
          v_new.titulo || ' v' || v_new.version || ' (' || v_new.recurrencia || ', desde ' || v_new.vigente_desde || ')');
  RETURN jsonb_build_object('ok', true, 'id', v_new.id, 'serie_id', v_new.serie_id, 'version', v_new.version,
                            'vigente_desde', v_new.vigente_desde, 'replay', false);
END $$;

-- ═══ Editar SOLO esta ocurrencia (Admin; nunca una completada) ═══
CREATE OR REPLACE FUNCTION public.editar_ocurrencia(p_operacion_id UUID, p_actividad_id BIGINT, p_periodo DATE,
                                                   p_ventana_inicio DATE, p_ventana_fin DATE, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_a      actividades%ROWTYPE;
  v_o      actividad_ocurrencias%ROWTYPE;
  v_w      RECORD;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'editar_ocurrencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'editar_ocurrencia: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_o FROM actividad_ocurrencias WHERE operacion_edicion = p_operacion_id;
  IF FOUND THEN
    IF v_o.actividad_id <> p_actividad_id OR v_o.periodo <> p_periodo THEN
      RAISE EXCEPTION 'editar_ocurrencia: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'ventana_inicio', v_o.ventana_inicio, 'ventana_fin', v_o.ventana_fin);
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'editar_ocurrencia: el motivo es obligatorio (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF p_ventana_inicio IS NULL OR p_ventana_fin IS NULL OR p_ventana_fin < p_ventana_inicio OR p_ventana_fin - p_ventana_inicio > 366 THEN
    RAISE EXCEPTION 'editar_ocurrencia: ventana inválida' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM actividades WHERE id = p_actividad_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'editar_ocurrencia: actividad % no existe', p_actividad_id USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_w FROM actividad_ventana_de(v_a, p_periodo);
  IF v_w.ventana_inicio IS NULL THEN
    RAISE EXCEPTION 'editar_ocurrencia: el periodo % no corresponde a esta actividad', p_periodo USING ERRCODE = '22023';
  END IF;
  INSERT INTO actividad_ocurrencias (actividad_id, periodo, ventana_inicio_original, ventana_fin_original, ventana_inicio, ventana_fin)
  VALUES (v_a.id, p_periodo, v_w.ventana_inicio, v_w.ventana_fin, v_w.ventana_inicio, v_w.ventana_fin)
  ON CONFLICT (actividad_id, periodo) DO NOTHING;
  UPDATE actividad_ocurrencias SET ventana_inicio = p_ventana_inicio, ventana_fin = p_ventana_fin, editada_at = now(),
         editada_por = erp_actor_etiqueta(), motivo_edicion = v_motivo, operacion_edicion = p_operacion_id
   WHERE actividad_id = v_a.id AND periodo = p_periodo AND completada_at IS NULL
  RETURNING * INTO v_o;
  IF v_o.id IS NULL THEN
    RAISE EXCEPTION 'editar_ocurrencia: la ocurrencia ya está completada (es historia inmutable)' USING ERRCODE = '22023';
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Editar ocurrencia', 'Calendario',
          v_a.titulo || ' · periodo ' || p_periodo || ': ' || v_w.ventana_inicio || '–' || v_w.ventana_fin || ' → '
          || p_ventana_inicio || '–' || p_ventana_fin || '. Motivo: ' || v_motivo);
  RETURN jsonb_build_object('ok', true, 'replay', false, 'ventana_inicio', v_o.ventana_inicio, 'ventana_fin', v_o.ventana_fin);
END $$;

-- ═══ Desactivar (Admin): cierra la vigencia; lo ya empezado o completado queda ═══
CREATE OR REPLACE FUNCTION public.desactivar_actividad(p_actividad_id BIGINT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_motivo TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_hoy    DATE := fin_hoy();
  v_a      actividades%ROWTYPE;
  v_corte  DATE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'desactivar_actividad: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'desactivar_actividad: el motivo es obligatorio (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM actividades WHERE id = p_actividad_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'desactivar_actividad: actividad % no existe', p_actividad_id USING ERRCODE = '22023';
  END IF;
  IF NOT v_a.activo THEN
    RETURN jsonb_build_object('ok', true, 'replay', true, 'vigente_hasta', v_a.vigente_hasta);
  END IF;
  -- Lo ya iniciado o completado (incluidas las vencidas) se conserva; lo futuro deja de generarse.
  v_corte := COALESCE(actividad_ultimo_periodo_iniciado(v_a, v_hoy), v_a.vigente_desde - 1);
  IF v_a.vigente_hasta IS NOT NULL AND v_a.vigente_hasta < v_corte THEN
    v_corte := v_a.vigente_hasta;
  END IF;
  UPDATE actividades SET vigente_hasta = v_corte, activo = false, cerrada_at = now(), cerrada_por = erp_actor_etiqueta(),
         motivo_cierre = 'desactivada: ' || v_motivo
   WHERE id = v_a.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Desactivar', 'Calendario', v_a.titulo || ' (hasta ' || v_corte || '). Motivo: ' || v_motivo);
  RETURN jsonb_build_object('ok', true, 'replay', false, 'vigente_hasta', v_corte);
END $$;

-- ═══ Permisos de funciones ═══
REVOKE ALL ON FUNCTION public.actividad_dia_en_mes(DATE, INTEGER), public.actividad_ventanas(actividades, DATE, DATE),
  public.actividad_periodo_de(TEXT, DATE), public.actividad_periodo_siguiente(TEXT, DATE), public.actividad_ultimo_periodo_iniciado(actividades, DATE),
  public.actividad_estado(DATE, DATE, BOOLEAN, DATE), public.actividad_clasificacion(DATE, DATE, DATE),
  public.actividad_visible(actividades), public.actividad_ocurrencia_json(actividades, DATE, DATE, DATE, actividad_ocurrencias, DATE),
  public.actividad_ventana_de(actividades, DATE) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.calendario(DATE, DATE, BOOLEAN, BOOLEAN), public.completar_ocurrencia(UUID, BIGINT, DATE, TEXT),
  public.guardar_actividad(UUID, BIGINT, JSONB), public.editar_ocurrencia(UUID, BIGINT, DATE, DATE, DATE, TEXT),
  public.desactivar_actividad(BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.calendario(DATE, DATE, BOOLEAN, BOOLEAN), public.completar_ocurrencia(UUID, BIGINT, DATE, TEXT),
  public.guardar_actividad(UUID, BIGINT, JSONB), public.editar_ocurrencia(UUID, BIGINT, DATE, DATE, DATE, TEXT),
  public.desactivar_actividad(BIGINT, TEXT) TO authenticated;
