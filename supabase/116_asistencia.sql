-- 116_asistencia.sql — WF-0 (base de personal) + PD-01 (reloj checador geolocalizado).
--
-- Decisiones del dueño (cerradas):
--   1. Rol mínimo 'Empleado' (solo "Mi asistencia"; nunca el back office).
--      'Sin asignar' NO se usa para empleados.
--   2. ENTRADA solo dentro de la geocerca del centro de trabajo.
--   3. SALIDA puede ocurrir fuera (choferes): se registra con evidencia
--      explícita de "fuera de ubicación"; nunca se finge que fue dentro.
--   4. Corrección de Admin habilitada: motivo obligatorio, valor original
--      intacto, historial inmutable, actor y hora del servidor.
--   5. La asistencia NO toca nómina.
--   6. Sin rastreo continuo: ubicación solo en el momento de marcar.
--
-- Identidad: empleados = la persona; usuarios = el acceso y el rol;
-- empleados.usuario_id = el vínculo (ahora 1 a 1). El llamante SIEMPRE se
-- deriva en el servidor (erp_usuario_id()); el cliente solo manda latitud,
-- longitud y precisión. Hora y día laboral = servidor (fin_zona_negocio()).
--
-- Regla de ubicación (decisión del dueño): primero precisión <= precision_max_m
-- del centro; después distancia (haversine, servidor) <= radio_m para la
-- ENTRADA. La incertidumbre del GPS nunca convierte un punto fuera en dentro.
--
-- Privacidad: los intentos RECHAZADOS guardan solo motivo, precisión y
-- distancia (sin coordenadas). Las coordenadas se guardan solo en marcas
-- válidas y solo las ve Admin (y la propia persona en sus registros).
--
-- Seguridad: RLS en las 5 tablas; authenticated solo puede LEER (lo suyo o, si
-- es Admin, todo); toda escritura es por contrato SECURITY DEFINER con
-- search_path fijo; idempotencia por operacion_id; carreras resueltas por
-- llaves únicas y bloqueo de fila.
--
-- Reversión (sin registros de asistencia): DROP de las funciones y tablas de
-- este archivo, DROP INDEX empleados_usuario_id_key y restaurar el CHECK de rol
-- sin 'Empleado' (antes, cambiar de rol a quien tenga 'Empleado').

-- ═══ WF-0: rol Empleado y vínculo 1 a 1 persona ↔ acceso ═══
ALTER TABLE usuarios DROP CONSTRAINT IF EXISTS usuarios_rol_check;
ALTER TABLE usuarios ADD CONSTRAINT usuarios_rol_check
  CHECK (rol IN ('Admin', 'Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Sin asignar', 'Empleado'));
CREATE UNIQUE INDEX IF NOT EXISTS empleados_usuario_id_key ON empleados (usuario_id) WHERE usuario_id IS NOT NULL;

-- ═══ Tablas ═══
CREATE TABLE IF NOT EXISTS centros_trabajo (
  id              BIGSERIAL PRIMARY KEY,
  nombre          TEXT NOT NULL CHECK (btrim(nombre) <> ''),
  latitud         DOUBLE PRECISION NOT NULL CHECK (latitud BETWEEN -90 AND 90),
  longitud        DOUBLE PRECISION NOT NULL CHECK (longitud BETWEEN -180 AND 180),
  radio_m         INTEGER NOT NULL CHECK (radio_m BETWEEN 10 AND 2000),
  precision_max_m INTEGER NOT NULL DEFAULT 100 CHECK (precision_max_m BETWEEN 5 AND 500),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS turnos (
  id             BIGSERIAL PRIMARY KEY,
  empleado_id    BIGINT NOT NULL REFERENCES empleados(id),
  centro_id      BIGINT NOT NULL REFERENCES centros_trabajo(id),
  dias           SMALLINT[] NOT NULL CHECK (cardinality(dias) BETWEEN 1 AND 7 AND dias <@ ARRAY[1,2,3,4,5,6,7]::SMALLINT[]),
  hora_entrada   TIME NOT NULL,
  hora_salida    TIME NOT NULL CHECK (hora_salida <> hora_entrada),
  tolerancia_min INTEGER NOT NULL DEFAULT 0 CHECK (tolerancia_min BETWEEN 0 AND 120),
  vigente_desde  DATE NOT NULL,
  vigente_hasta  DATE CHECK (vigente_hasta IS NULL OR vigente_hasta >= vigente_desde),
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_turnos_empleado ON turnos (empleado_id) WHERE activo;

CREATE TABLE IF NOT EXISTS asistencias (
  id                   BIGSERIAL PRIMARY KEY,
  empleado_id          BIGINT NOT NULL REFERENCES empleados(id),
  usuario_id           BIGINT NOT NULL REFERENCES usuarios(id),
  turno_id             BIGINT NOT NULL REFERENCES turnos(id),
  centro_id            BIGINT NOT NULL REFERENCES centros_trabajo(id),
  fecha_laboral        DATE NOT NULL,
  entrada_programada   TIMESTAMPTZ NOT NULL,
  salida_programada    TIMESTAMPTZ NOT NULL,
  tolerancia_min       INTEGER NOT NULL,
  radio_m              INTEGER NOT NULL,
  precision_max_m      INTEGER NOT NULL,
  entrada_at           TIMESTAMPTZ NOT NULL,
  entrada_lat          DOUBLE PRECISION NOT NULL,
  entrada_lng          DOUBLE PRECISION NOT NULL,
  entrada_precision_m  NUMERIC NOT NULL,
  entrada_distancia_m  NUMERIC NOT NULL,
  entrada_estado       TEXT NOT NULL CHECK (entrada_estado IN ('a_tiempo', 'retardo')),
  minutos_retardo      INTEGER NOT NULL DEFAULT 0 CHECK (minutos_retardo >= 0),
  operacion_entrada    UUID NOT NULL UNIQUE,
  salida_at            TIMESTAMPTZ,
  salida_lat           DOUBLE PRECISION,
  salida_lng           DOUBLE PRECISION,
  salida_precision_m   NUMERIC,
  salida_distancia_m   NUMERIC,
  salida_dentro        BOOLEAN,
  operacion_salida     UUID UNIQUE,
  entrada_corregida_at TIMESTAMPTZ,
  salida_corregida_at  TIMESTAMPTZ,
  minutos_trabajados   INTEGER,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (empleado_id, fecha_laboral, turno_id),
  CHECK ((salida_at IS NULL) = (operacion_salida IS NULL)),
  CHECK ((salida_at IS NULL) = (salida_dentro IS NULL)),
  CHECK (salida_at IS NULL OR salida_at >= entrada_at)
);
CREATE INDEX IF NOT EXISTS idx_asistencias_fecha ON asistencias (fecha_laboral);

CREATE TABLE IF NOT EXISTS asistencia_intentos (
  id            BIGSERIAL PRIMARY KEY,
  empleado_id   BIGINT NOT NULL REFERENCES empleados(id),
  usuario_id    BIGINT NOT NULL REFERENCES usuarios(id),
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada', 'salida')),
  motivo        TEXT NOT NULL CHECK (motivo IN ('fuera_de_rango', 'precision_insuficiente')),
  fecha_laboral DATE NOT NULL,
  precision_m   NUMERIC NOT NULL,
  distancia_m   INTEGER NOT NULL,
  operacion_id  UUID NOT NULL UNIQUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_asistencia_intentos_fecha ON asistencia_intentos (fecha_laboral);

CREATE TABLE IF NOT EXISTS asistencia_correcciones (
  id             BIGSERIAL PRIMARY KEY,
  asistencia_id  BIGINT NOT NULL REFERENCES asistencias(id),
  campo          TEXT NOT NULL CHECK (campo IN ('entrada', 'salida')),
  valor_anterior TIMESTAMPTZ,
  valor_nuevo    TIMESTAMPTZ NOT NULL,
  motivo         TEXT NOT NULL CHECK (length(btrim(motivo)) >= 5),
  actor_id       BIGINT,
  actor          TEXT NOT NULL,
  operacion_id   UUID NOT NULL UNIQUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Empleado activo ligado al usuario de la sesión (NULL si no hay vínculo).
CREATE OR REPLACE FUNCTION public.asistencia_empleado_actual()
RETURNS BIGINT LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT e.id FROM empleados e
   WHERE e.usuario_id = erp_usuario_id() AND erp_usuario_id() IS NOT NULL AND COALESCE(e.estatus, 'Activo') = 'Activo'
$$;

-- Privilegios: solo lectura (filtrada por RLS) para authenticated; nada para anon.
REVOKE ALL ON centros_trabajo, turnos, asistencias, asistencia_intentos, asistencia_correcciones FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON centros_trabajo, turnos, asistencias, asistencia_intentos, asistencia_correcciones TO authenticated;
REVOKE ALL ON SEQUENCE centros_trabajo_id_seq, turnos_id_seq, asistencias_id_seq, asistencia_intentos_id_seq, asistencia_correcciones_id_seq FROM PUBLIC, anon, authenticated, service_role;

ALTER TABLE centros_trabajo ENABLE ROW LEVEL SECURITY;
ALTER TABLE turnos ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia_intentos ENABLE ROW LEVEL SECURITY;
ALTER TABLE asistencia_correcciones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS centros_trabajo_admin_read ON centros_trabajo;
CREATE POLICY centros_trabajo_admin_read ON centros_trabajo FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin');
DROP POLICY IF EXISTS turnos_admin_o_propio_read ON turnos;
CREATE POLICY turnos_admin_o_propio_read ON turnos FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin' OR empleado_id = asistencia_empleado_actual());
DROP POLICY IF EXISTS asistencias_admin_o_propio_read ON asistencias;
CREATE POLICY asistencias_admin_o_propio_read ON asistencias FOR SELECT TO authenticated
  USING (erp_rol_activo() = 'Admin' OR empleado_id = asistencia_empleado_actual());
DROP POLICY IF EXISTS asistencia_intentos_admin_read ON asistencia_intentos;
CREATE POLICY asistencia_intentos_admin_read ON asistencia_intentos FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin');
DROP POLICY IF EXISTS asistencia_correcciones_admin_read ON asistencia_correcciones;
CREATE POLICY asistencia_correcciones_admin_read ON asistencia_correcciones FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin');

-- ═══ Utilidades ═══
-- Distancia en metros (haversine; radio terrestre medio 6,371,000 m).
CREATE OR REPLACE FUNCTION public.asistencia_distancia_m(p_lat1 DOUBLE PRECISION, p_lng1 DOUBLE PRECISION, p_lat2 DOUBLE PRECISION, p_lng2 DOUBLE PRECISION)
RETURNS NUMERIC LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT round((2 * 6371000 * asin(sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2))))::numeric, 1)
$$;

-- Clasificación de la entrada: a tiempo hasta entrada programada + tolerancia
-- (inclusive); después, retardo con los minutos desde la entrada programada.
CREATE OR REPLACE FUNCTION public.asistencia_clasificar_entrada(p_programada TIMESTAMPTZ, p_tolerancia_min INTEGER, p_entrada TIMESTAMPTZ)
RETURNS TABLE (estado TEXT, minutos_retardo INTEGER) LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN p_entrada <= p_programada + make_interval(mins => p_tolerancia_min) THEN 'a_tiempo' ELSE 'retardo' END,
         CASE WHEN p_entrada <= p_programada + make_interval(mins => p_tolerancia_min) THEN 0
              ELSE ceil(EXTRACT(EPOCH FROM (p_entrada - p_programada)) / 60)::int END
$$;

-- Turno aplicable a un instante: el día laboral es el de la entrada programada
-- (hoy o ayer si el turno cruza la medianoche); se puede marcar desde 60 min
-- antes de la entrada y hasta la salida programada. Interna (sin EXECUTE de API).
CREATE OR REPLACE FUNCTION public.asistencia_turno_aplicable(p_empleado_id BIGINT, p_ahora TIMESTAMPTZ)
RETURNS TABLE (turno_id BIGINT, centro_id BIGINT, fecha_laboral DATE, entrada_programada TIMESTAMPTZ,
               salida_programada TIMESTAMPTZ, tolerancia_min INTEGER)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH cand AS (
    SELECT t.id AS turno_id, t.centro_id, d.dia AS fecha_laboral, t.tolerancia_min,
           ((d.dia + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada_programada,
           ((d.dia + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida_programada
      FROM turnos t
      JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
      CROSS JOIN LATERAL (SELECT (p_ahora AT TIME ZONE fin_zona_negocio())::date - k AS dia FROM generate_series(0, 1) k) d
     WHERE t.empleado_id = p_empleado_id AND t.activo
       AND t.vigente_desde <= d.dia AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= d.dia)
       AND EXTRACT(ISODOW FROM d.dia)::SMALLINT = ANY (t.dias)
  )
  SELECT turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min
    FROM cand
   WHERE p_ahora >= entrada_programada - interval '60 minutes' AND p_ahora < salida_programada
   ORDER BY entrada_programada
   LIMIT 1
$$;

-- Fila de asistencia como JSON (valores efectivos = corregido o, si no, original).
CREATE OR REPLACE FUNCTION public.asistencia_json(p_a asistencias)
RETURNS JSONB LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT jsonb_build_object(
    'id', p_a.id, 'empleado_id', p_a.empleado_id, 'turno_id', p_a.turno_id, 'fecha_laboral', p_a.fecha_laboral,
    'entrada_programada', p_a.entrada_programada, 'salida_programada', p_a.salida_programada, 'tolerancia_min', p_a.tolerancia_min,
    'entrada_at', COALESCE(p_a.entrada_corregida_at, p_a.entrada_at), 'entrada_original_at', p_a.entrada_at,
    'entrada_estado', p_a.entrada_estado, 'minutos_retardo', p_a.minutos_retardo,
    'entrada_distancia_m', p_a.entrada_distancia_m, 'entrada_precision_m', p_a.entrada_precision_m,
    'salida_at', COALESCE(p_a.salida_corregida_at, p_a.salida_at), 'salida_original_at', p_a.salida_at,
    'salida_dentro', p_a.salida_dentro, 'salida_distancia_m', p_a.salida_distancia_m, 'salida_precision_m', p_a.salida_precision_m,
    'minutos_trabajados', p_a.minutos_trabajados,
    'corregida', (p_a.entrada_corregida_at IS NOT NULL OR p_a.salida_corregida_at IS NOT NULL))
$$;

-- ═══ WF-0: vínculo empleado ↔ usuario (Admin) ═══
CREATE OR REPLACE FUNCTION public.vincular_empleado_usuario(p_empleado_id BIGINT, p_usuario_id BIGINT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_emp  RECORD;
  v_usr  TEXT := 'sin usuario';
  v_otro BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'vincular_empleado_usuario: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT id, nombre, usuario_id INTO v_emp FROM empleados WHERE id = p_empleado_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'vincular_empleado_usuario: empleado % no existe', p_empleado_id USING ERRCODE = '22023';
  END IF;
  IF p_usuario_id IS NOT NULL THEN
    SELECT nombre || ' (' || rol || ')' INTO v_usr FROM usuarios WHERE id = p_usuario_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'vincular_empleado_usuario: usuario % no existe', p_usuario_id USING ERRCODE = '22023';
    END IF;
    SELECT id INTO v_otro FROM empleados WHERE usuario_id = p_usuario_id AND id <> p_empleado_id;
    IF FOUND THEN
      RAISE EXCEPTION 'vincular_empleado_usuario: ese usuario ya está ligado a otro empleado' USING ERRCODE = '23505';
    END IF;
  END IF;
  UPDATE empleados SET usuario_id = p_usuario_id WHERE id = p_empleado_id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Vincular', 'Empleados',
          v_emp.nombre || ' → ' || v_usr);
  RETURN jsonb_build_object('empleado_id', p_empleado_id, 'usuario_id', p_usuario_id);
END $$;

-- ═══ Configuración (Admin): centro de trabajo y turnos ═══
CREATE OR REPLACE FUNCTION public.guardar_centro_trabajo(p_id BIGINT, p_nombre TEXT, p_latitud DOUBLE PRECISION, p_longitud DOUBLE PRECISION,
                                                        p_radio_m INTEGER, p_precision_max_m INTEGER, p_activo BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_id BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_centro_trabajo: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO centros_trabajo (nombre, latitud, longitud, radio_m, precision_max_m, activo)
    VALUES (btrim(p_nombre), p_latitud, p_longitud, p_radio_m, COALESCE(p_precision_max_m, 100), COALESCE(p_activo, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE centros_trabajo SET nombre = btrim(p_nombre), latitud = p_latitud, longitud = p_longitud, radio_m = p_radio_m,
           precision_max_m = COALESCE(p_precision_max_m, precision_max_m), activo = COALESCE(p_activo, activo), updated_at = now()
     WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'guardar_centro_trabajo: centro % no existe', p_id USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), CASE WHEN p_id IS NULL THEN 'Crear' ELSE 'Editar' END, 'Asistencia',
          'Centro de trabajo ' || btrim(p_nombre) || ' (radio ' || p_radio_m || ' m, precisión máx ' || COALESCE(p_precision_max_m, 100) || ' m)');
  RETURN jsonb_build_object('id', v_id);
END $$;

CREATE OR REPLACE FUNCTION public.guardar_turno(p_id BIGINT, p_empleado_id BIGINT, p_centro_id BIGINT, p_dias SMALLINT[], p_hora_entrada TIME,
                                               p_hora_salida TIME, p_tolerancia_min INTEGER, p_vigente_desde DATE, p_vigente_hasta DATE, p_activo BOOLEAN)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_id    BIGINT;
  v_desde DATE := COALESCE(p_vigente_desde, fin_hoy());
  v_dias  SMALLINT[];
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_turno: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM empleados WHERE id = p_empleado_id) THEN
    RAISE EXCEPTION 'guardar_turno: empleado % no existe', p_empleado_id USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM centros_trabajo WHERE id = p_centro_id) THEN
    RAISE EXCEPTION 'guardar_turno: centro de trabajo % no existe', p_centro_id USING ERRCODE = '22023';
  END IF;
  SELECT array_agg(DISTINCT x ORDER BY x) INTO v_dias FROM unnest(p_dias) x;
  -- Un solo turno activo por empleado y día de la semana en vigencias que se cruzan.
  IF COALESCE(p_activo, true) AND EXISTS (
       SELECT 1 FROM turnos t
        WHERE t.empleado_id = p_empleado_id AND t.activo AND t.id IS DISTINCT FROM p_id
          AND t.dias && v_dias
          AND t.vigente_desde <= COALESCE(p_vigente_hasta, 'infinity'::date)
          AND COALESCE(t.vigente_hasta, 'infinity'::date) >= v_desde) THEN
    RAISE EXCEPTION 'guardar_turno: el empleado ya tiene un turno activo en alguno de esos días' USING ERRCODE = '23505';
  END IF;
  IF p_id IS NULL THEN
    INSERT INTO turnos (empleado_id, centro_id, dias, hora_entrada, hora_salida, tolerancia_min, vigente_desde, vigente_hasta, activo)
    VALUES (p_empleado_id, p_centro_id, v_dias, p_hora_entrada, p_hora_salida, COALESCE(p_tolerancia_min, 0), v_desde, p_vigente_hasta, COALESCE(p_activo, true))
    RETURNING id INTO v_id;
  ELSE
    UPDATE turnos SET empleado_id = p_empleado_id, centro_id = p_centro_id, dias = v_dias, hora_entrada = p_hora_entrada,
           hora_salida = p_hora_salida, tolerancia_min = COALESCE(p_tolerancia_min, 0), vigente_desde = v_desde,
           vigente_hasta = p_vigente_hasta, activo = COALESCE(p_activo, true), updated_at = now()
     WHERE id = p_id RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'guardar_turno: turno % no existe', p_id USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), CASE WHEN p_id IS NULL THEN 'Crear' ELSE 'Editar' END, 'Asistencia',
          'Turno ' || v_id || ' empleado ' || p_empleado_id || ': ' || p_hora_entrada || '–' || p_hora_salida || ' días ' || array_to_string(v_dias, ','));
  RETURN jsonb_build_object('id', v_id);
END $$;

-- ═══ Marcar ENTRADA (dentro de la geocerca) ═══
CREATE OR REPLACE FUNCTION public.registrar_entrada(p_operacion_id UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_precision_m NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    BIGINT := erp_usuario_id();
  v_emp    BIGINT;
  v_ahora  TIMESTAMPTZ := now();
  v_a      asistencias%ROWTYPE;
  v_int    asistencia_intentos%ROWTYPE;
  v_t      RECORD;
  v_c      centros_trabajo%ROWTYPE;
  v_dist   NUMERIC;
  v_estado TEXT;
  v_min    INTEGER := 0;
  v_id     BIGINT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'registrar_entrada: se requiere una sesión activa' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_entrada: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  -- Replay (misma petición): mismo resultado, sin efectos nuevos.
  SELECT * INTO v_a FROM asistencias WHERE operacion_entrada = p_operacion_id;
  IF FOUND THEN
    IF v_a.usuario_id <> v_uid THEN
      RAISE EXCEPTION 'registrar_entrada: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', true, 'asistencia', asistencia_json(v_a));
  END IF;
  SELECT * INTO v_int FROM asistencia_intentos WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_int.usuario_id <> v_uid THEN
      RAISE EXCEPTION 'registrar_entrada: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', v_int.motivo, 'replay', true, 'distancia_m', v_int.distancia_m, 'precision_m', v_int.precision_m);
  END IF;

  v_emp := asistencia_empleado_actual();
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'sin_empleado');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_precision_m IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_precision_m <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'ubicacion_invalida');
  END IF;
  SELECT * INTO v_t FROM asistencia_turno_aplicable(v_emp, v_ahora);
  IF NOT FOUND THEN
    -- Tiene turno hoy pero aún no abre (más de 60 min antes) o ya terminó: fuera de horario.
    IF EXISTS (SELECT 1 FROM turnos t JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
                WHERE t.empleado_id = v_emp AND t.activo AND t.vigente_desde <= fin_hoy()
                  AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= fin_hoy())
                  AND EXTRACT(ISODOW FROM fin_hoy())::SMALLINT = ANY (t.dias)) THEN
      RETURN jsonb_build_object('ok', false, 'codigo', 'fuera_de_horario');
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', 'sin_turno');
  END IF;
  SELECT * INTO v_c FROM centros_trabajo WHERE id = v_t.centro_id;
  v_dist := asistencia_distancia_m(p_lat, p_lng, v_c.latitud, v_c.longitud);

  -- 1) Precisión; 2) distancia dentro del radio. Rechazos: sin coordenadas.
  IF p_precision_m > v_c.precision_max_m THEN
    INSERT INTO asistencia_intentos (empleado_id, usuario_id, tipo, motivo, fecha_laboral, precision_m, distancia_m, operacion_id)
    VALUES (v_emp, v_uid, 'entrada', 'precision_insuficiente', v_t.fecha_laboral, round(p_precision_m, 1), round(v_dist)::int, p_operacion_id)
    ON CONFLICT (operacion_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'codigo', 'precision_insuficiente', 'precision_m', round(p_precision_m), 'precision_max_m', v_c.precision_max_m);
  END IF;
  IF v_dist > v_c.radio_m THEN
    INSERT INTO asistencia_intentos (empleado_id, usuario_id, tipo, motivo, fecha_laboral, precision_m, distancia_m, operacion_id)
    VALUES (v_emp, v_uid, 'entrada', 'fuera_de_rango', v_t.fecha_laboral, round(p_precision_m, 1), round(v_dist)::int, p_operacion_id)
    ON CONFLICT (operacion_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'codigo', 'fuera_de_rango', 'distancia_m', round(v_dist), 'radio_m', v_c.radio_m, 'centro', v_c.nombre);
  END IF;

  SELECT k.estado, k.minutos_retardo INTO v_estado, v_min FROM asistencia_clasificar_entrada(v_t.entrada_programada, v_t.tolerancia_min, v_ahora) k;

  INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada,
                           tolerancia_min, radio_m, precision_max_m, entrada_at, entrada_lat, entrada_lng, entrada_precision_m,
                           entrada_distancia_m, entrada_estado, minutos_retardo, operacion_entrada)
  VALUES (v_emp, v_uid, v_t.turno_id, v_t.centro_id, v_t.fecha_laboral, v_t.entrada_programada, v_t.salida_programada,
          v_t.tolerancia_min, v_c.radio_m, v_c.precision_max_m, v_ahora, p_lat, p_lng, round(p_precision_m, 1),
          v_dist, v_estado, v_min, p_operacion_id)
  ON CONFLICT (empleado_id, fecha_laboral, turno_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- Otra marca (otra petición o el mismo doble toque) ya registró esta entrada.
    SELECT * INTO v_a FROM asistencias WHERE empleado_id = v_emp AND fecha_laboral = v_t.fecha_laboral AND turno_id = v_t.turno_id;
    IF v_a.operacion_entrada = p_operacion_id THEN
      RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', true, 'asistencia', asistencia_json(v_a));
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', 'ya_registrada', 'asistencia', asistencia_json(v_a));
  END IF;
  SELECT * INTO v_a FROM asistencias WHERE id = v_id;
  RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', false, 'asistencia', asistencia_json(v_a));
END $$;

-- ═══ Marcar SALIDA (puede ser fuera de la geocerca; queda la evidencia) ═══
CREATE OR REPLACE FUNCTION public.registrar_salida(p_operacion_id UUID, p_lat DOUBLE PRECISION, p_lng DOUBLE PRECISION, p_precision_m NUMERIC)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    BIGINT := erp_usuario_id();
  v_emp    BIGINT;
  v_ahora  TIMESTAMPTZ := now();
  v_a      asistencias%ROWTYPE;
  v_int    asistencia_intentos%ROWTYPE;
  v_c      centros_trabajo%ROWTYPE;
  v_dist   NUMERIC;
  v_dentro BOOLEAN;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'registrar_salida: se requiere una sesión activa' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_salida: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM asistencias WHERE operacion_salida = p_operacion_id;
  IF FOUND THEN
    IF v_a.usuario_id <> v_uid THEN
      RAISE EXCEPTION 'registrar_salida: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', true, 'fuera_de_ubicacion', NOT v_a.salida_dentro, 'asistencia', asistencia_json(v_a));
  END IF;
  SELECT * INTO v_int FROM asistencia_intentos WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_int.usuario_id <> v_uid THEN
      RAISE EXCEPTION 'registrar_salida: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', v_int.motivo, 'replay', true, 'precision_m', v_int.precision_m);
  END IF;

  v_emp := asistencia_empleado_actual();
  IF v_emp IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'sin_empleado');
  END IF;
  IF p_lat IS NULL OR p_lng IS NULL OR p_precision_m IS NULL OR p_lat NOT BETWEEN -90 AND 90 OR p_lng NOT BETWEEN -180 AND 180 OR p_precision_m <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'codigo', 'ubicacion_invalida');
  END IF;

  -- Entrada abierta de las últimas 24 h (la más reciente), bloqueada.
  SELECT * INTO v_a FROM asistencias
   WHERE empleado_id = v_emp AND salida_at IS NULL AND salida_corregida_at IS NULL AND entrada_at > v_ahora - interval '24 hours'
   ORDER BY entrada_at DESC LIMIT 1 FOR UPDATE;
  IF NOT FOUND THEN
    SELECT * INTO v_a FROM asistencias
     WHERE empleado_id = v_emp AND (salida_at IS NOT NULL OR salida_corregida_at IS NOT NULL) AND entrada_at > v_ahora - interval '24 hours'
     ORDER BY entrada_at DESC LIMIT 1;
    IF FOUND THEN
      IF v_a.operacion_salida = p_operacion_id THEN
        -- La misma petición ganó en otra conexión mientras esperábamos el bloqueo.
        RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', true, 'fuera_de_ubicacion', NOT v_a.salida_dentro, 'asistencia', asistencia_json(v_a));
      END IF;
      RETURN jsonb_build_object('ok', false, 'codigo', 'ya_registrada', 'asistencia', asistencia_json(v_a));
    END IF;
    RETURN jsonb_build_object('ok', false, 'codigo', 'sin_entrada');
  END IF;

  SELECT * INTO v_c FROM centros_trabajo WHERE id = v_a.centro_id;
  v_dist := asistencia_distancia_m(p_lat, p_lng, v_c.latitud, v_c.longitud);
  IF p_precision_m > v_c.precision_max_m THEN
    INSERT INTO asistencia_intentos (empleado_id, usuario_id, tipo, motivo, fecha_laboral, precision_m, distancia_m, operacion_id)
    VALUES (v_emp, v_uid, 'salida', 'precision_insuficiente', v_a.fecha_laboral, round(p_precision_m, 1), round(v_dist)::int, p_operacion_id)
    ON CONFLICT (operacion_id) DO NOTHING;
    RETURN jsonb_build_object('ok', false, 'codigo', 'precision_insuficiente', 'precision_m', round(p_precision_m), 'precision_max_m', v_c.precision_max_m);
  END IF;
  v_dentro := v_dist <= v_c.radio_m;

  UPDATE asistencias
     SET salida_at = v_ahora, salida_lat = p_lat, salida_lng = p_lng, salida_precision_m = round(p_precision_m, 1),
         salida_distancia_m = v_dist, salida_dentro = v_dentro, operacion_salida = p_operacion_id,
         minutos_trabajados = floor(EXTRACT(EPOCH FROM (v_ahora - COALESCE(entrada_corregida_at, entrada_at))) / 60)::int,
         updated_at = now()
   WHERE id = v_a.id
  RETURNING * INTO v_a;
  RETURN jsonb_build_object('ok', true, 'codigo', 'registrada', 'replay', false, 'fuera_de_ubicacion', NOT v_dentro,
                            'distancia_m', round(v_dist), 'asistencia', asistencia_json(v_a));
END $$;

-- ═══ Lectura: mi asistencia (persona de la sesión) ═══
CREATE OR REPLACE FUNCTION public.mi_asistencia()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid    BIGINT := erp_usuario_id();
  v_emp    RECORD;
  v_ahora  TIMESTAMPTZ := now();
  v_hoy    DATE := (now() AT TIME ZONE fin_zona_negocio())::date;
  v_t      RECORD;
  v_hoyt   RECORD;
  v_abierta asistencias%ROWTYPE;
  v_actual  asistencias%ROWTYPE;
  v_olvido  asistencias%ROWTYPE;
  v_accion TEXT;
  v_estado TEXT;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'mi_asistencia: se requiere una sesión activa' USING ERRCODE = '42501';
  END IF;
  SELECT id, nombre, puesto INTO v_emp FROM empleados WHERE id = asistencia_empleado_actual();
  IF NOT FOUND THEN
    RETURN jsonb_build_object('estado', 'sin_empleado', 'hoy', v_hoy, 'ahora', v_ahora);
  END IF;
  SELECT * INTO v_t FROM asistencia_turno_aplicable(v_emp.id, v_ahora);
  -- Turno de hoy (aunque todavía no se pueda marcar), para mostrar el horario.
  SELECT t.id, t.hora_entrada, t.hora_salida, t.tolerancia_min, c.nombre AS centro INTO v_hoyt
    FROM turnos t JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
   WHERE t.empleado_id = v_emp.id AND t.activo AND t.vigente_desde <= v_hoy AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_hoy)
     AND EXTRACT(ISODOW FROM v_hoy)::SMALLINT = ANY (t.dias)
   ORDER BY t.hora_entrada LIMIT 1;
  SELECT * INTO v_abierta FROM asistencias
   WHERE empleado_id = v_emp.id AND salida_at IS NULL AND salida_corregida_at IS NULL AND entrada_at > v_ahora - interval '24 hours'
   ORDER BY entrada_at DESC LIMIT 1;
  IF v_t.turno_id IS NOT NULL THEN
    SELECT * INTO v_actual FROM asistencias WHERE empleado_id = v_emp.id AND fecha_laboral = v_t.fecha_laboral AND turno_id = v_t.turno_id;
  END IF;
  SELECT * INTO v_olvido FROM asistencias
   WHERE empleado_id = v_emp.id AND salida_at IS NULL AND salida_corregida_at IS NULL AND entrada_at <= v_ahora - interval '24 hours'
   ORDER BY entrada_at DESC LIMIT 1;

  IF v_abierta.id IS NOT NULL THEN
    v_accion := 'salida'; v_estado := 'en_turno';
  ELSIF v_actual.id IS NOT NULL THEN
    v_accion := NULL; v_estado := 'completa';
  ELSIF v_t.turno_id IS NOT NULL THEN
    v_accion := 'entrada'; v_estado := 'pendiente';
  ELSIF v_hoyt.id IS NOT NULL THEN
    v_accion := NULL; v_estado := 'fuera_de_horario';
  ELSE
    v_accion := NULL; v_estado := 'sin_turno';
  END IF;

  RETURN jsonb_build_object(
    'estado', v_estado, 'accion', v_accion, 'hoy', v_hoy, 'ahora', v_ahora,
    'empleado', jsonb_build_object('id', v_emp.id, 'nombre', v_emp.nombre, 'puesto', v_emp.puesto),
    'turno_hoy', CASE WHEN v_hoyt.id IS NULL THEN NULL ELSE jsonb_build_object('id', v_hoyt.id, 'hora_entrada', v_hoyt.hora_entrada,
                   'hora_salida', v_hoyt.hora_salida, 'tolerancia_min', v_hoyt.tolerancia_min, 'centro', v_hoyt.centro) END,
    'turno_aplicable', CASE WHEN v_t.turno_id IS NULL THEN NULL ELSE jsonb_build_object('turno_id', v_t.turno_id, 'fecha_laboral', v_t.fecha_laboral,
                   'entrada_programada', v_t.entrada_programada, 'salida_programada', v_t.salida_programada, 'tolerancia_min', v_t.tolerancia_min) END,
    'asistencia', CASE WHEN v_abierta.id IS NOT NULL THEN asistencia_json(v_abierta)
                       WHEN v_actual.id IS NOT NULL THEN asistencia_json(v_actual) ELSE NULL END,
    'salida_olvidada', CASE WHEN v_olvido.id IS NULL THEN NULL ELSE asistencia_json(v_olvido) END);
END $$;

-- ═══ Lectura Admin: asistencia de un día ═══
CREATE OR REPLACE FUNCTION public.asistencia_dia(p_fecha DATE)
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_fecha DATE := COALESCE(p_fecha, fin_hoy());
  v_res   JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'asistencia_dia: no autorizado' USING ERRCODE = '42501';
  END IF;
  WITH emp AS (
    SELECT e.id, e.nombre, e.puesto, e.usuario_id FROM empleados e WHERE COALESCE(e.estatus, 'Activo') = 'Activo'
  ), tur AS (
    SELECT DISTINCT ON (t.empleado_id) t.empleado_id, t.id, t.hora_entrada, t.hora_salida, t.tolerancia_min,
           ((v_fecha + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada_prog,
           ((v_fecha + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida_prog
      FROM turnos t
     WHERE t.activo AND t.vigente_desde <= v_fecha AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= v_fecha)
       AND EXTRACT(ISODOW FROM v_fecha)::SMALLINT = ANY (t.dias)
     ORDER BY t.empleado_id, t.hora_entrada
  ), asi AS (
    SELECT DISTINCT ON (a.empleado_id) a.* FROM asistencias a WHERE a.fecha_laboral = v_fecha ORDER BY a.empleado_id, a.entrada_at
  ), intn AS (
    SELECT i.empleado_id, count(*)::int AS n,
           (array_agg(i.motivo ORDER BY i.created_at DESC))[1] AS ultimo_motivo,
           (array_agg(i.distancia_m ORDER BY i.created_at DESC))[1] AS ultima_distancia
      FROM asistencia_intentos i WHERE i.fecha_laboral = v_fecha AND i.tipo = 'entrada' GROUP BY i.empleado_id
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'empleado_id', emp.id, 'nombre', emp.nombre, 'puesto', emp.puesto, 'con_usuario', emp.usuario_id IS NOT NULL,
           'turno', CASE WHEN tur.id IS NULL THEN NULL ELSE jsonb_build_object('id', tur.id, 'hora_entrada', tur.hora_entrada,
                      'hora_salida', tur.hora_salida, 'tolerancia_min', tur.tolerancia_min) END,
           'asistencia', CASE WHEN asi.id IS NULL THEN NULL ELSE asistencia_json(asi) || jsonb_build_object(
                      'entrada_lat', asi.entrada_lat, 'entrada_lng', asi.entrada_lng, 'salida_lat', asi.salida_lat, 'salida_lng', asi.salida_lng,
                      'correcciones', (SELECT COALESCE(jsonb_agg(jsonb_build_object('campo', c.campo, 'valor_anterior', c.valor_anterior,
                          'valor_nuevo', c.valor_nuevo, 'motivo', c.motivo, 'actor', c.actor, 'created_at', c.created_at) ORDER BY c.id), '[]'::jsonb)
                        FROM asistencia_correcciones c WHERE c.asistencia_id = asi.id)) END,
           'intentos', COALESCE(intn.n, 0), 'ultimo_intento', intn.ultimo_motivo, 'ultima_distancia_m', intn.ultima_distancia,
           'estado', CASE
             WHEN asi.id IS NOT NULL AND COALESCE(asi.salida_corregida_at, asi.salida_at) IS NOT NULL THEN 'completo'
             WHEN asi.id IS NOT NULL AND now() >= asi.salida_programada THEN 'sin_salida'
             WHEN asi.id IS NOT NULL THEN asi.entrada_estado
             WHEN tur.id IS NULL THEN 'sin_turno'
             WHEN COALESCE(intn.n, 0) > 0 THEN 'fuera_de_ubicacion'
             WHEN now() < tur.salida_prog THEN 'pendiente'
             ELSE 'falta' END
         ) ORDER BY emp.nombre), '[]'::jsonb)
    INTO v_res
    FROM emp LEFT JOIN tur ON tur.empleado_id = emp.id LEFT JOIN asi ON asi.empleado_id = emp.id LEFT JOIN intn ON intn.empleado_id = emp.id;
  RETURN jsonb_build_object('fecha', v_fecha, 'ahora', now(), 'empleados', v_res);
END $$;

-- ═══ Lectura Admin: configuración (centros y turnos) ═══
CREATE OR REPLACE FUNCTION public.config_asistencia()
RETURNS JSONB LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'config_asistencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'centros', (SELECT COALESCE(jsonb_agg(to_jsonb(c) ORDER BY c.id), '[]'::jsonb) FROM centros_trabajo c),
    'turnos', (SELECT COALESCE(jsonb_agg(to_jsonb(t) || jsonb_build_object('empleado', e.nombre) ORDER BY e.nombre, t.hora_entrada), '[]'::jsonb)
                 FROM turnos t JOIN empleados e ON e.id = t.empleado_id));
END $$;

-- ═══ Corrección de Admin (motivo obligatorio; original intacto; historial) ═══
CREATE OR REPLACE FUNCTION public.corregir_asistencia(p_operacion_id UUID, p_asistencia_id BIGINT, p_campo TEXT, p_valor TIMESTAMPTZ, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_a        asistencias%ROWTYPE;
  v_prev     asistencia_correcciones%ROWTYPE;
  v_entrada  TIMESTAMPTZ;
  v_salida   TIMESTAMPTZ;
  v_anterior TIMESTAMPTZ;
  v_estado   TEXT;
  v_min      INTEGER := 0;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'corregir_asistencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'corregir_asistencia: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_prev FROM asistencia_correcciones WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.asistencia_id <> p_asistencia_id OR v_prev.campo <> p_campo OR v_prev.valor_nuevo <> p_valor THEN
      RAISE EXCEPTION 'corregir_asistencia: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    SELECT * INTO v_a FROM asistencias WHERE id = p_asistencia_id;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'asistencia', asistencia_json(v_a));
  END IF;
  IF p_campo NOT IN ('entrada', 'salida') OR p_valor IS NULL THEN
    RAISE EXCEPTION 'corregir_asistencia: campo o valor inválido' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'corregir_asistencia: el motivo es obligatorio (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF p_valor > now() THEN
    RAISE EXCEPTION 'corregir_asistencia: no se registran horas futuras' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_a FROM asistencias WHERE id = p_asistencia_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'corregir_asistencia: asistencia % no existe', p_asistencia_id USING ERRCODE = '22023';
  END IF;
  v_entrada := COALESCE(v_a.entrada_corregida_at, v_a.entrada_at);
  v_salida  := COALESCE(v_a.salida_corregida_at, v_a.salida_at);
  IF p_campo = 'entrada' THEN
    IF v_salida IS NOT NULL AND p_valor >= v_salida THEN
      RAISE EXCEPTION 'corregir_asistencia: la entrada debe ser anterior a la salida' USING ERRCODE = '22023';
    END IF;
    v_anterior := v_entrada; v_entrada := p_valor;
    SELECT k.estado, k.minutos_retardo INTO v_estado, v_min FROM asistencia_clasificar_entrada(v_a.entrada_programada, v_a.tolerancia_min, v_entrada) k;
    UPDATE asistencias SET entrada_corregida_at = p_valor, entrada_estado = v_estado, minutos_retardo = v_min,
           minutos_trabajados = CASE WHEN v_salida IS NULL THEN NULL ELSE floor(EXTRACT(EPOCH FROM (v_salida - p_valor)) / 60)::int END,
           updated_at = now()
     WHERE id = v_a.id RETURNING * INTO v_a;
  ELSE
    IF p_valor <= v_entrada THEN
      RAISE EXCEPTION 'corregir_asistencia: la salida debe ser posterior a la entrada' USING ERRCODE = '22023';
    END IF;
    v_anterior := v_salida;
    UPDATE asistencias SET salida_corregida_at = p_valor,
           minutos_trabajados = floor(EXTRACT(EPOCH FROM (p_valor - v_entrada)) / 60)::int, updated_at = now()
     WHERE id = v_a.id RETURNING * INTO v_a;
  END IF;
  INSERT INTO asistencia_correcciones (asistencia_id, campo, valor_anterior, valor_nuevo, motivo, actor_id, actor, operacion_id)
  VALUES (v_a.id, p_campo, v_anterior, p_valor, v_motivo, erp_usuario_id(), erp_actor_etiqueta(), p_operacion_id);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Corregir', 'Asistencia',
          'Asistencia ' || v_a.id || ' (' || v_a.fecha_laboral || ') ' || p_campo || ': ' || COALESCE(v_anterior::text, 'sin registro') || ' → ' || p_valor || '. Motivo: ' || v_motivo);
  RETURN jsonb_build_object('ok', true, 'replay', false, 'asistencia', asistencia_json(v_a));
END $$;

-- ═══ Permisos de funciones ═══
REVOKE ALL ON FUNCTION public.asistencia_turno_aplicable(BIGINT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.asistencia_empleado_actual() FROM PUBLIC, anon, service_role;
-- authenticated la necesita para evaluar las policies de lectura (solo revela su propio id).
GRANT EXECUTE ON FUNCTION public.asistencia_empleado_actual() TO authenticated;
REVOKE ALL ON FUNCTION public.asistencia_json(asistencias) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.asistencia_clasificar_entrada(TIMESTAMPTZ, INTEGER, TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asistencia_clasificar_entrada(TIMESTAMPTZ, INTEGER, TIMESTAMPTZ) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.asistencia_distancia_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.vincular_empleado_usuario(BIGINT, BIGINT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_centro_trabajo(BIGINT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guardar_turno(BIGINT, BIGINT, BIGINT, SMALLINT[], TIME, TIME, INTEGER, DATE, DATE, BOOLEAN) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_entrada(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.registrar_salida(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.mi_asistencia() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.asistencia_dia(DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.config_asistencia() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.corregir_asistencia(UUID, BIGINT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.asistencia_distancia_m(DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION, DOUBLE PRECISION) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.vincular_empleado_usuario(BIGINT, BIGINT), public.mi_asistencia(), public.asistencia_dia(DATE), public.config_asistencia(),
  public.guardar_centro_trabajo(BIGINT, TEXT, DOUBLE PRECISION, DOUBLE PRECISION, INTEGER, INTEGER, BOOLEAN),
  public.guardar_turno(BIGINT, BIGINT, BIGINT, SMALLINT[], TIME, TIME, INTEGER, DATE, DATE, BOOLEAN),
  public.registrar_entrada(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC), public.registrar_salida(UUID, DOUBLE PRECISION, DOUBLE PRECISION, NUMERIC),
  public.corregir_asistencia(UUID, BIGINT, TEXT, TIMESTAMPTZ, TEXT) TO authenticated;
