-- 136_correcciones_tanda3.sql — correcciones de la revisión profunda del 2026-10-10
-- (tanda 3): reloj checador, avisos, asistencia para nómina y cierre de ruta.
-- Idempotente. Mismas firmas y permisos; una función nueva (captura manual).
--
--   1. `mi_asistencia` (116): (a) al terminar el turno la pantalla ya no borra la
--      entrada y la salida del día; (b) una salida olvidada de un turno anterior ya
--      no impide marcar la entrada de hoy ni se cierra con la hora de hoy.
--   2. `registrar_asistencia_manual` (NUEVA, Admin): captura la asistencia de un
--      día en que la persona trabajó pero no pudo marcar (sin señal, GPS impreciso,
--      teléfono apagado). Antes no había forma: quedaba como falta y, desde 130,
--      perdía el bono. Queda marcada como corregida, con motivo obligatorio y su
--      fila en el historial inmutable y en auditoría.
--   3. `asistencia_generar_avisos` (131): el aviso "antes de tu entrada" también
--      para turnos que empiezan a medianoche; el aviso a la persona solo si su
--      usuario está activo.
--   4. `nomina_asistencia_semana` (130): no cuenta faltas de turnos que la persona
--      no podía marcar (sin usuario ligado o centro inactivo).
--   5. `cerrar_ruta_financiero` (112): una orden de otra ruta no se cierra en esta.
--
-- Reversión: volver a aplicar las definiciones de 116, 131, 130 y 112 y borrar
-- `registrar_asistencia_manual` (las asistencias capturadas son historia).

-- ═══ 1. Mi asistencia ═══
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
  -- 136: una entrada de OTRO turno ya terminado que quedó sin salida no secuestra el día:
  -- si ahora toca marcar un turno distinto, se trata como salida olvidada (la cierra
  -- Administración) y la persona puede marcar su entrada de hoy. Antes, quien olvidaba la
  -- salida y llegaba al día siguiente antes de 24 h solo veía "Marcar salida", y al tocarlo
  -- cerraba el día anterior con la hora de hoy.
  IF v_abierta.id IS NOT NULL AND v_t.turno_id IS NOT NULL AND v_abierta.salida_programada <= v_ahora
     AND (v_abierta.fecha_laboral, v_abierta.turno_id) IS DISTINCT FROM (v_t.fecha_laboral, v_t.turno_id) THEN
    v_olvido := v_abierta;
    v_abierta := NULL;
  END IF;
  IF v_t.turno_id IS NOT NULL THEN
    SELECT * INTO v_actual FROM asistencias WHERE empleado_id = v_emp.id AND fecha_laboral = v_t.fecha_laboral AND turno_id = v_t.turno_id;
  ELSE
    -- 136: fuera del horario de marcar se sigue mostrando la asistencia de HOY. Antes, al
    -- terminar el turno la pantalla decía "Fuera de horario" con entrada y salida en blanco.
    SELECT * INTO v_actual FROM asistencias WHERE empleado_id = v_emp.id AND fecha_laboral = v_hoy ORDER BY entrada_at DESC LIMIT 1;
  END IF;
  IF v_olvido.id IS NULL THEN
    SELECT * INTO v_olvido FROM asistencias
     WHERE empleado_id = v_emp.id AND salida_at IS NULL AND salida_corregida_at IS NULL AND entrada_at <= v_ahora - interval '24 hours'
     ORDER BY entrada_at DESC LIMIT 1;
  END IF;

  IF v_abierta.id IS NOT NULL THEN
    v_accion := 'salida'; v_estado := 'en_turno';
  ELSIF v_actual.id IS NOT NULL AND (v_olvido.id IS NULL OR v_actual.id <> v_olvido.id) THEN
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
                       WHEN v_actual.id IS NOT NULL AND (v_olvido.id IS NULL OR v_actual.id <> v_olvido.id) THEN asistencia_json(v_actual) ELSE NULL END,
    'salida_olvidada', CASE WHEN v_olvido.id IS NULL THEN NULL ELSE asistencia_json(v_olvido) END);
END $$;

-- ═══ 2. Captura manual de una asistencia que no se pudo marcar (Admin) ═══
-- Un solo registro por persona, día y turno (el mismo índice único de 116). Las horas
-- quedan como CORREGIDAS por Administración (no como marca del teléfono): ubicación del
-- centro de trabajo, precisión y distancia 0. p_salida es opcional.
CREATE OR REPLACE FUNCTION public.registrar_asistencia_manual(
  p_operacion_id UUID, p_empleado_id BIGINT, p_fecha DATE, p_entrada TIMESTAMPTZ, p_salida TIMESTAMPTZ, p_motivo TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_motivo  TEXT := btrim(COALESCE(p_motivo, ''));
  v_emp     RECORD;
  v_t       RECORD;
  v_c       centros_trabajo%ROWTYPE;
  v_prog_e  TIMESTAMPTZ;
  v_prog_s  TIMESTAMPTZ;
  v_estado  TEXT;
  v_min     INTEGER;
  v_a       asistencias%ROWTYPE;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'registrar_asistencia_manual: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_empleado_id IS NULL OR p_fecha IS NULL OR p_entrada IS NULL THEN
    RAISE EXCEPTION 'registrar_asistencia_manual: operación, persona, día y hora de entrada son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribe el motivo de la captura (por qué no se pudo marcar)' USING ERRCODE = '22023';
  END IF;

  -- Reintento con la misma operación: misma respuesta.
  SELECT * INTO v_a FROM asistencias WHERE operacion_entrada = p_operacion_id;
  IF FOUND THEN
    IF v_a.empleado_id <> p_empleado_id OR v_a.fecha_laboral <> p_fecha THEN
      RAISE EXCEPTION 'registrar_asistencia_manual: operacion_id ya usado' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok', true, 'replay', true, 'asistencia', asistencia_json(v_a));
  END IF;

  IF p_fecha > fin_hoy() THEN
    RAISE EXCEPTION 'No se captura asistencia de un día que aún no llega' USING ERRCODE = '22023';
  END IF;
  SELECT e.id, e.nombre, e.usuario_id INTO v_emp FROM empleados e WHERE e.id = p_empleado_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Empleado no encontrado' USING ERRCODE = '22023'; END IF;

  SELECT t.id, t.centro_id, t.hora_entrada, t.hora_salida, t.tolerancia_min INTO v_t
    FROM turnos t
   WHERE t.empleado_id = p_empleado_id AND t.activo AND t.vigente_desde <= p_fecha AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= p_fecha)
     AND EXTRACT(ISODOW FROM p_fecha)::SMALLINT = ANY (t.dias)
   ORDER BY t.hora_entrada LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION '% no tiene turno ese día: primero captura su turno', v_emp.nombre USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_c FROM centros_trabajo WHERE id = v_t.centro_id;
  v_prog_e := ((p_fecha + v_t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio());
  v_prog_s := ((p_fecha + CASE WHEN v_t.hora_salida <= v_t.hora_entrada THEN 1 ELSE 0 END + v_t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio());

  IF p_entrada > now() OR (p_salida IS NOT NULL AND p_salida > now()) THEN
    RAISE EXCEPTION 'La hora capturada no puede ser futura' USING ERRCODE = '22023';
  END IF;
  IF p_entrada < v_prog_e - interval '6 hours' OR p_entrada >= v_prog_s THEN
    RAISE EXCEPTION 'La hora de entrada no corresponde al turno de ese día' USING ERRCODE = '22023';
  END IF;
  IF p_salida IS NOT NULL AND (p_salida <= p_entrada OR p_salida > v_prog_s + interval '12 hours') THEN
    RAISE EXCEPTION 'La hora de salida debe ser posterior a la entrada y del mismo turno' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM asistencias WHERE empleado_id = p_empleado_id AND fecha_laboral = p_fecha AND turno_id = v_t.id) THEN
    RAISE EXCEPTION '% ya tiene asistencia ese día: corrígela en vez de capturar otra', v_emp.nombre USING ERRCODE = '22023';
  END IF;

  SELECT k.estado, k.minutos_retardo INTO v_estado, v_min FROM asistencia_clasificar_entrada(v_prog_e, v_t.tolerancia_min, p_entrada) k;
  INSERT INTO asistencias (empleado_id, usuario_id, turno_id, centro_id, fecha_laboral, entrada_programada, salida_programada, tolerancia_min,
                           radio_m, precision_max_m, entrada_at, entrada_lat, entrada_lng, entrada_precision_m, entrada_distancia_m,
                           entrada_estado, minutos_retardo, operacion_entrada, entrada_corregida_at, salida_corregida_at, minutos_trabajados)
  VALUES (p_empleado_id, COALESCE(v_emp.usuario_id, erp_usuario_id()), v_t.id, v_t.centro_id, p_fecha, v_prog_e, v_prog_s, v_t.tolerancia_min,
          v_c.radio_m, v_c.precision_max_m, p_entrada, v_c.latitud, v_c.longitud, 0, 0,
          v_estado, v_min, p_operacion_id, p_entrada, p_salida,
          CASE WHEN p_salida IS NULL THEN NULL ELSE floor(EXTRACT(EPOCH FROM (p_salida - p_entrada)) / 60)::int END)
  RETURNING * INTO v_a;

  INSERT INTO asistencia_correcciones (asistencia_id, campo, valor_anterior, valor_nuevo, motivo, actor_id, actor, operacion_id)
  VALUES (v_a.id, 'entrada', NULL, p_entrada, 'Captura manual: ' || v_motivo, erp_usuario_id(), erp_actor_etiqueta(), p_operacion_id);
  IF p_salida IS NOT NULL THEN
    INSERT INTO asistencia_correcciones (asistencia_id, campo, valor_anterior, valor_nuevo, motivo, actor_id, actor, operacion_id)
    VALUES (v_a.id, 'salida', NULL, p_salida, 'Captura manual: ' || v_motivo, erp_usuario_id(), erp_actor_etiqueta(),
            md5(p_operacion_id::TEXT || '|salida')::UUID);
  END IF;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (erp_actor_etiqueta(), 'Capturar', 'Asistencia', v_emp.nombre || ' — ' || to_char(p_fecha, 'DD/MM/YYYY') || ' (captura manual): ' || v_motivo);

  RETURN jsonb_build_object('ok', true, 'replay', false, 'asistencia', asistencia_json(v_a));
END $$;
REVOKE ALL ON FUNCTION public.registrar_asistencia_manual(UUID, BIGINT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_asistencia_manual(UUID, BIGINT, DATE, TIMESTAMPTZ, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- ═══ 3. Avisos de asistencia ═══
CREATE OR REPLACE FUNCTION public.asistencia_generar_avisos(p_ahora TIMESTAMPTZ DEFAULT now()) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_cfg    asistencia_avisos_config%ROWTYPE;
  v_avisos JSONB;
  v_jefes  JSONB;
  v_vent   CONSTANT INTERVAL := interval '30 minutes';
BEGIN
  SELECT * INTO v_cfg FROM asistencia_avisos_config WHERE id = 1;
  IF NOT FOUND OR NOT v_cfg.activo THEN
    RETURN jsonb_build_object('activo', false, 'avisos', '[]'::jsonb, 'jefes', '[]'::jsonb);
  END IF;

  WITH prog AS (
    -- Turnos de hoy y de ayer (un turno nocturno termina al día siguiente), como en 116.
    SELECT e.id AS empleado_id, e.nombre,
           -- 136: el aviso a la persona solo va a un usuario ACTIVO.
           (SELECT u.id FROM usuarios u WHERE u.id = e.usuario_id AND u.estatus = 'Activo') AS usuario_id,
           t.id AS turno_id, d.dia AS fecha_laboral, t.tolerancia_min,
           ((d.dia + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada,
           ((d.dia + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida,
           to_char(t.hora_entrada, 'HH24:MI') AS hora_txt
      FROM turnos t
      JOIN empleados e ON e.id = t.empleado_id AND e.estatus = 'Activo'
      JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
      CROSS JOIN LATERAL (SELECT (p_ahora AT TIME ZONE fin_zona_negocio())::date - k AS dia FROM generate_series(-1, 1) k) d  -- 136: también mañana (turnos que empiezan a medianoche)
     WHERE t.activo AND t.vigente_desde <= d.dia AND (t.vigente_hasta IS NULL OR t.vigente_hasta >= d.dia)
       AND EXTRACT(ISODOW FROM d.dia)::SMALLINT = ANY (t.dias)
  ), est AS (
    SELECT g.*, a.id AS asistencia_id, a.entrada_estado, a.minutos_retardo, a.created_at AS marcada_at,
           COALESCE(a.salida_corregida_at, a.salida_at) AS salida_at
      FROM prog g
      LEFT JOIN asistencias a ON a.empleado_id = g.empleado_id AND a.turno_id = g.turno_id AND a.fecha_laboral = g.fecha_laboral
  ), due AS (
    SELECT 'entrada_proxima' AS tipo, 'empleado' AS destino, empleado_id, turno_id, fecha_laboral, usuario_id,
           'Tu turno empieza a las ' || hora_txt AS titulo, 'Marca tu entrada al llegar.' AS mensaje
      FROM est
     WHERE v_cfg.empleado_antes_min IS NOT NULL AND asistencia_id IS NULL AND usuario_id IS NOT NULL
       AND p_ahora >= entrada - make_interval(mins => v_cfg.empleado_antes_min) AND p_ahora < entrada
    UNION ALL
    SELECT 'entrada_tarde', 'empleado', empleado_id, turno_id, fecha_laboral, usuario_id,
           'No has marcado tu entrada', 'Tu turno empezó a las ' || hora_txt || '. Márcala ahora.'
      FROM est
     WHERE v_cfg.empleado_tarde AND asistencia_id IS NULL AND usuario_id IS NOT NULL
       AND p_ahora > entrada + make_interval(mins => tolerancia_min) AND p_ahora <= entrada + make_interval(mins => tolerancia_min) + v_vent
       AND p_ahora < salida
    UNION ALL
    SELECT 'salida', 'empleado', empleado_id, turno_id, fecha_laboral, usuario_id,
           'Terminó tu turno', 'No olvides marcar tu salida.'
      FROM est
     WHERE v_cfg.empleado_salida_min IS NOT NULL AND asistencia_id IS NOT NULL AND salida_at IS NULL AND usuario_id IS NOT NULL
       AND p_ahora >= salida + make_interval(mins => v_cfg.empleado_salida_min) AND p_ahora < salida + make_interval(mins => v_cfg.empleado_salida_min) + v_vent
    UNION ALL
    SELECT 'jefes_sin_marcar', 'jefes', empleado_id, turno_id, fecha_laboral, NULL,
           nombre || ' no ha marcado entrada', 'Su turno empezó a las ' || hora_txt || '.'
      FROM est
     WHERE v_cfg.jefes_sin_marcar_min IS NOT NULL AND asistencia_id IS NULL
       AND p_ahora > entrada + make_interval(mins => tolerancia_min + v_cfg.jefes_sin_marcar_min)
       AND p_ahora <= entrada + make_interval(mins => tolerancia_min + v_cfg.jefes_sin_marcar_min) + v_vent
       AND p_ahora < salida
    UNION ALL
    SELECT 'jefes_retardo', 'jefes', empleado_id, turno_id, fecha_laboral, NULL,
           nombre || ' llegó con retardo', minutos_retardo || ' min tarde (turno de las ' || hora_txt || ').'
      FROM est
     WHERE v_cfg.jefes_retardo AND asistencia_id IS NOT NULL AND entrada_estado = 'retardo'
       AND p_ahora >= marcada_at AND p_ahora < marcada_at + v_vent
    UNION ALL
    SELECT 'jefes_sin_salida', 'jefes', empleado_id, turno_id, fecha_laboral, NULL,
           nombre || ' no marcó salida', 'Su turno terminó hace ' || v_cfg.jefes_sin_salida_min || ' min.'
      FROM est
     WHERE v_cfg.jefes_sin_salida_min IS NOT NULL AND asistencia_id IS NOT NULL AND salida_at IS NULL
       AND p_ahora >= salida + make_interval(mins => v_cfg.jefes_sin_salida_min) AND p_ahora < salida + make_interval(mins => v_cfg.jefes_sin_salida_min) + v_vent
  ), ins AS (
    INSERT INTO asistencia_avisos (tipo, destino, empleado_id, turno_id, fecha_laboral, titulo, mensaje)
    SELECT tipo, destino, empleado_id, turno_id, fecha_laboral, left(titulo, 120), left(mensaje, 200) FROM due
    ON CONFLICT ON CONSTRAINT asistencia_avisos_uno DO NOTHING
    RETURNING id, tipo, destino, empleado_id, titulo, mensaje
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('id', i.id, 'tipo', i.tipo, 'destino', i.destino, 'titulo', i.titulo, 'mensaje', i.mensaje,
                                               'usuario_id', CASE WHEN i.destino = 'empleado' THEN e.usuario_id END) ORDER BY i.id), '[]'::jsonb)
    INTO v_avisos
    FROM ins i JOIN empleados e ON e.id = i.empleado_id;

  SELECT COALESCE(jsonb_agg(u.id ORDER BY u.id), '[]'::jsonb) INTO v_jefes
    FROM usuarios u
   WHERE u.estatus = 'Activo' AND u.rol = 'Admin' AND NOT COALESCE(u.is_test_account, false)
     AND (v_cfg.jefes = 'admins' OR COALESCE(u.es_dueno, false));

  RETURN jsonb_build_object('activo', true, 'avisos', v_avisos, 'jefes', v_jefes);
END $$;
REVOKE ALL ON FUNCTION public.asistencia_generar_avisos(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.asistencia_generar_avisos(TIMESTAMPTZ) TO service_role;

-- ═══ 4. Asistencia de la semana para la nómina ═══
CREATE OR REPLACE FUNCTION public.nomina_asistencia_semana(p_empleado_id BIGINT, p_inicio DATE, p_fin DATE, p_ahora TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (dias_programados INTEGER, asistencias INTEGER, retardos INTEGER, faltas INTEGER)
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH prog AS (
    SELECT t.id AS turno_id, d.dia,
           ((d.dia + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada,
           ((d.dia + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida
      FROM turnos t
      -- 136: solo cuentan los turnos que la persona SÍ podía marcar (mismas reglas del reloj
      -- checador, 116): centro de trabajo activo y usuario ligado. Antes se contaban faltas a
      -- quien no tenía forma de marcar, y perdía el bono.
      JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
      JOIN empleados e ON e.id = t.empleado_id AND e.usuario_id IS NOT NULL
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

-- ═══ 5. Cierre financiero de ruta: una orden de otra ruta no se cierra aquí ═══
CREATE OR REPLACE FUNCTION public.cerrar_ruta_financiero(
  p_operacion_id UUID, p_ruta_id BIGINT, p_entregas JSONB, p_usuario_id BIGINT DEFAULT NULL, p_usuario_nombre TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_ruta    rutas%ROWTYPE;
  v_rol     TEXT;
  v_prev    cierres_financieros_ruta%ROWTYPE;
  v_otra    BIGINT;
  v_huella  TEXT;
  v_actor_id BIGINT;
  v_etiqueta TEXT;
  e         JSONB;
  it        JSONB;
  v_ord     ordenes%ROWTYPE;
  v_metodo  TEXT;
  v_total   NUMERIC;
  v_folio   TEXT;
  v_nuevo_id BIGINT;
  v_cliente_id BIGINT;
  v_factura BOOLEAN;
  v_res     JSONB;
  v_items_str TEXT;
  n_upd INT := 0; n_exp INT := 0; n_pagos INT := 0; n_cxc INT := 0;
  v_saltadas JSONB := '[]'::jsonb;
  v_express  JSONB := '[]'::jsonb;
  v_lin      JSONB;   -- 088: líneas canónicas de la venta exprés
  v_attr     BIGINT := fin_actor_id(p_usuario_id);  -- 088: atribución del servidor
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: ruta requerida' USING ERRCODE = '22023';
  END IF;

  -- Lock de la ruta: serializa cierres concurrentes (misma u otra operación).
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Ruta % no existe', p_ruta_id; END IF;

  v_rol := fin_mi_rol_activo();
  IF fin_jwt_role() = 'authenticated' AND NOT fin_ctx_activo() AND v_rol = 'Chofer'
     AND v_ruta.chofer_id IS DISTINCT FROM get_my_user_id() THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  IF p_entregas IS NULL OR jsonb_typeof(p_entregas) <> 'array' THEN
    p_entregas := '[]'::jsonb;
  END IF;
  v_huella := fin_huella_cierre(p_ruta_id, p_entregas);

  -- Replay / conflicto: se evalúa ANTES del estado de la ruta, para que un
  -- reintento después de que el JS ya la cerró siga devolviendo el resultado.
  SELECT * INTO v_prev FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id;
  IF FOUND THEN
    IF v_prev.huella = v_huella THEN
      RETURN v_prev.resultado || jsonb_build_object('replay', true, 'operacion_original', v_prev.operacion_id);
    END IF;
    IF v_prev.operacion_id = p_operacion_id THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado con otros datos (ruta %)', v_ruta.folio USING ERRCODE = '23505';
    END IF;
    RAISE EXCEPTION 'cerrar_ruta_financiero: la ruta % ya tiene cierre financiero registrado con otros datos', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  SELECT ruta_id INTO v_otra FROM cierres_financieros_ruta WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RAISE EXCEPTION 'cerrar_ruta_financiero: operacion_id ya usado en la ruta %', v_otra USING ERRCODE = '23505';
  END IF;

  IF v_ruta.estatus IN ('Cerrada', 'Cancelada') THEN
    RAISE EXCEPTION 'Ruta % ya está %', p_ruta_id, v_ruta.estatus;
  END IF;

  -- 088: validación completa de TODAS las entradas ANTES de cualquier efecto
  -- financiero. Precio canónico (el enviado es solo una aserción), cantidades
  -- enteras positivas, cliente, factura, método de pago y crédito.
  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    v_metodo := NULLIF(btrim(COALESCE(e->>'pago', '')), '');
    IF v_metodo IS NOT NULL AND v_metodo <> ALL (ARRAY['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago', 'Crédito']) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: método de pago inválido: %', v_metodo USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      CONTINUE;
    END IF;
    v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
    IF v_cliente_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM clientes WHERE id = v_cliente_id) THEN
      RAISE EXCEPTION 'cerrar_ruta_financiero: cliente no encontrado: %', v_cliente_id USING ERRCODE = '22023';
    END IF;
    IF COALESCE((e->>'factura')::boolean, false) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado' USING ERRCODE = '22023';
      END IF;
      IF (SELECT upper(btrim(COALESCE(rfc, ''))) FROM clientes WHERE id = v_cliente_id) IN ('', 'XAXX010101000', 'XEXX010101000') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el cliente de la venta exprés no tiene RFC nominativo para facturar' USING ERRCODE = '22023';
      END IF;
    END IF;
    v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                               FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
    FOR it IN SELECT * FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) LOOP
      IF NULLIF(it->>'precio', '') IS NOT NULL
         AND round((it->>'precio')::numeric, 2) IS DISTINCT FROM precio_canonico(v_cliente_id, it->>'sku') THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: el precio de % (%) no coincide con el precio vigente (%)', it->>'sku', it->>'precio', precio_canonico(v_cliente_id, it->>'sku')
          USING ERRCODE = '22023';
      END IF;
    END LOOP;
    IF fin_es_credito(COALESCE(v_metodo, 'Efectivo')) THEN
      IF v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'cerrar_ruta_financiero: la venta exprés a crédito requiere un cliente registrado' USING ERRCODE = '22023';
      END IF;
      PERFORM fin_validar_credito(v_cliente_id, (v_lin->>'total')::numeric);
    END IF;
  END LOOP;

  v_actor_id := erp_usuario_id();
  v_etiqueta := erp_actor_etiqueta();
  PERFORM fin_marcar_ctx();

  FOR e IN SELECT * FROM jsonb_array_elements(p_entregas) LOOP
    IF COALESCE((e->>'express')::boolean, false) = false AND NULLIF(e->>'ordenId', '') IS NOT NULL THEN
      -- ── Entrega de una orden existente ──
      SELECT * INTO v_ord FROM ordenes WHERE id = (e->>'ordenId')::bigint FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Orden % de la entrega no existe', e->>'ordenId'; END IF;
      -- 136: una orden que ya es de OTRA ruta no se cierra en esta. Antes bastaba su id.
      IF v_ord.ruta_id IS NOT NULL AND v_ord.ruta_id <> p_ruta_id THEN
        RAISE EXCEPTION 'La orden % es de otra ruta y no puede cerrarse en esta', v_ord.folio USING ERRCODE = '22023';
      END IF;
      IF v_ord.estatus IN ('Cancelada', 'No entregada') THEN
        RAISE EXCEPTION 'Orden % está % y no puede cerrarse como entregada', v_ord.folio, v_ord.estatus;
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), v_ord.metodo_pago, 'Efectivo');

      -- 112 (OL-03B): una orden ya Facturada CONSERVA Facturada (y su CFDI);
      -- el resto del cierre (método, ruta, pago o CxC) no cambia.
      UPDATE ordenes
         SET estatus = 'Entregada', metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id AND estatus <> 'Facturada';
      UPDATE ordenes
         SET metodo_pago = v_metodo, ruta_id = COALESCE(ruta_id, p_ruta_id)
       WHERE id = v_ord.id AND estatus = 'Facturada';
      n_upd := n_upd + 1;

      v_total := round(COALESCE(v_ord.total, 0), 2);
      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_ord.cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_ord.id, 15);
          IF (v_res->>'creada')::boolean THEN n_cxc := n_cxc + 1; END IF;
        ELSE
          v_res := registrar_pago_orden(v_ord.id, v_metodo, e->>'referencia', v_attr);
          IF (v_res->>'aplicado')::boolean THEN
            n_pagos := n_pagos + 1;
          ELSE
            v_saltadas := v_saltadas || jsonb_build_object('orden_id', v_ord.id, 'folio', v_ord.folio, 'motivo', v_res->>'motivo');
          END IF;
        END IF;
      END IF;
    ELSE
      -- ── Venta exprés ──
      v_cliente_id := NULLIF(e->>'clienteId', '')::bigint;
      v_factura := COALESCE((e->>'factura')::boolean, false);
      IF v_factura AND v_cliente_id IS NULL THEN
        RAISE EXCEPTION 'Venta exprés marcada con factura sin cliente registrado';
      END IF;
      v_metodo := COALESCE(NULLIF(e->>'pago', ''), 'Efectivo');

      -- 088: líneas, precios y total del servidor (validados arriba).
      v_lin := lineas_canonicas(v_cliente_id, (SELECT jsonb_agg(jsonb_build_object('sku', i->>'sku', 'cantidad', COALESCE(i->'cant', i->'qty')))
                                                 FROM jsonb_array_elements(COALESCE(e->'items', '[]'::jsonb)) i));
      v_total := (v_lin->>'total')::numeric;
      v_items_str := v_lin->>'productos';

      v_folio := (SELECT 'OV-' || lpad(q.s, greatest(4, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_ov_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

      INSERT INTO ordenes (folio, cliente_id, cliente_nombre, productos, fecha, total, estatus, metodo_pago, ruta_id, requiere_factura, vendedor_id, tipo_cobro)
      VALUES (v_folio, v_cliente_id, COALESCE(NULLIF(e->>'cliente', ''), 'Público en general'),
              COALESCE(v_items_str, 'Varios'), fin_hoy(), v_total, 'Entregada', v_metodo, p_ruta_id, v_factura, v_attr,
              CASE WHEN fin_es_credito(v_metodo) THEN 'Credito' ELSE 'Contado' END)
      RETURNING id INTO v_nuevo_id;
      n_exp := n_exp + 1;
      v_express := v_express || jsonb_build_object('id', v_nuevo_id, 'folio', v_folio, 'total', v_total);

      INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal)
      SELECT v_nuevo_id, l->>'sku', (l->>'cantidad')::int, (l->>'precio_unit')::numeric, (l->>'subtotal')::numeric
        FROM jsonb_array_elements(v_lin->'lineas') l;

      IF v_total > 0 THEN
        IF fin_es_credito(v_metodo) AND v_cliente_id IS NOT NULL THEN
          v_res := crear_cxc_orden(v_nuevo_id, 15);
          n_cxc := n_cxc + 1;
        ELSE
          v_res := registrar_pago_orden(v_nuevo_id, v_metodo, e->>'referencia', v_attr);
          n_pagos := n_pagos + 1;
        END IF;
      END IF;
    END IF;
  END LOOP;

  v_res := jsonb_build_object(
    'success', true, 'ruta_id', p_ruta_id, 'folio', v_ruta.folio,
    'ordenes_entregadas', n_upd, 'ventas_express', n_exp, 'ordenes_express', v_express,
    'pagos', n_pagos, 'cxc', n_cxc, 'saltadas', v_saltadas,
    'operacion_id', p_operacion_id, 'huella', v_huella, 'actor', v_etiqueta, 'cerrado_at', now(), 'replay', false
  );
  -- La marca de idempotencia vive en la MISMA transacción que los efectos:
  -- si algo falló arriba, no existe.
  INSERT INTO cierres_financieros_ruta (ruta_id, operacion_id, huella, actor_id, actor, resultado)
  VALUES (p_ruta_id, p_operacion_id, v_huella, v_actor_id, v_etiqueta, v_res);

  RETURN v_res;
END $$;
