-- 131_avisos_asistencia.sql — PD-01.1: avisos de asistencia al celular.
--
-- Aditiva e idempotente. No cambia el reloj checador (116): solo LEE turnos y
-- asistencias. Compatible con el frontend desplegado antes de esta migración.
--
-- Qué había: el recordatorio de asistencia solo se ve con la app abierta
-- (tarjeta en el inicio). Web Push (067) reparte las notificaciones del
-- negocio a TODOS los dispositivos suscritos, sin distinguir persona.
--
-- Qué agrega:
--   1. `asistencia_avisos_config` — una sola fila, configurable por Admin:
--        a la persona: antes de su entrada, al pasar su tolerancia sin marcar,
--        y al terminar su turno sin marcar salida;
--        a los jefes: quién no ha marcado, quién llegó con retardo y quién no
--        marcó salida. Jefes = Admins activos, o solo el Dueño.
--   2. `asistencia_avisos` — cada aviso generado (uno por tipo, persona, turno
--        y día: el índice único impide repetirlo).
--   3. `asistencia_generar_avisos(p_ahora)` — solo service_role (la llama la
--        función programada de Netlify cada 5 minutos). Crea los avisos que
--        tocan en este momento y los devuelve con su destinatario.
--   4. Contratos de Admin: `avisos_asistencia()` (configuración + últimos
--        avisos) y `guardar_avisos_asistencia(p_datos)` (con auditoría).
--
-- Decisiones (delegadas por el dueño el 2026-10-09: "lo más pro, modificable"):
--   - Nacen ENCENDIDOS con: 10 min antes de la entrada; al pasar la tolerancia;
--     5 min después de la salida; a los jefes 15 min después de la tolerancia,
--     en cada retardo y 60 min después de una salida sin marcar.
--   - Un aviso solo se genera si le toca en los últimos 30 minutos: encender la
--     función o una caída del programador no manda avisos viejos.
--   - El aviso a la persona va SOLO a sus dispositivos; nadie más lo recibe.
--   - Sin turno ese día, persona inactiva o centro inactivo: sin avisos.
--   - No crea asistencias ni faltas: informar no es registrar.
--
-- No incluye: SMS/WhatsApp, permisos o vacaciones (quien descansa un día con
-- turno recibe el aviso), avisos por correo.
--
-- Reversión: borrar las 3 funciones y las 2 tablas (sin efecto en 116).

-- ═══ 1. Configuración (una fila) ═══
CREATE TABLE IF NOT EXISTS public.asistencia_avisos_config (
  id                   SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  activo               BOOLEAN NOT NULL DEFAULT true,
  empleado_antes_min   INTEGER DEFAULT 10 CHECK (empleado_antes_min IS NULL OR empleado_antes_min BETWEEN 5 AND 60),
  empleado_tarde       BOOLEAN NOT NULL DEFAULT true,
  empleado_salida_min  INTEGER DEFAULT 5 CHECK (empleado_salida_min IS NULL OR empleado_salida_min BETWEEN 0 AND 120),
  jefes_sin_marcar_min INTEGER DEFAULT 15 CHECK (jefes_sin_marcar_min IS NULL OR jefes_sin_marcar_min BETWEEN 0 AND 120),
  jefes_retardo        BOOLEAN NOT NULL DEFAULT true,
  jefes_sin_salida_min INTEGER DEFAULT 60 CHECK (jefes_sin_salida_min IS NULL OR jefes_sin_salida_min BETWEEN 10 AND 240),
  jefes                TEXT NOT NULL DEFAULT 'admins' CHECK (jefes IN ('admins', 'dueno')),
  actualizado_por      TEXT,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO public.asistencia_avisos_config (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- ═══ 2. Avisos generados ═══
CREATE TABLE IF NOT EXISTS public.asistencia_avisos (
  id            BIGSERIAL PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('entrada_proxima', 'entrada_tarde', 'salida', 'jefes_sin_marcar', 'jefes_retardo', 'jefes_sin_salida')),
  destino       TEXT NOT NULL CHECK (destino IN ('empleado', 'jefes')),
  -- Es una bitácora de envíos, no historia de negocio: se va con la persona o el turno.
  empleado_id   BIGINT NOT NULL REFERENCES public.empleados(id) ON DELETE CASCADE,
  turno_id      BIGINT NOT NULL REFERENCES public.turnos(id) ON DELETE CASCADE,
  fecha_laboral DATE NOT NULL,
  titulo        TEXT NOT NULL,
  mensaje       TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT asistencia_avisos_destino CHECK ((destino = 'jefes') = (tipo LIKE 'jefes_%')),
  -- Un aviso de cada tipo por persona, turno y día.
  CONSTRAINT asistencia_avisos_uno UNIQUE (tipo, empleado_id, turno_id, fecha_laboral)
);
CREATE INDEX IF NOT EXISTS idx_asistencia_avisos_created ON public.asistencia_avisos (created_at DESC);

-- Acceso: lectura solo de Admin activo; sin escritura por API.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['asistencia_avisos_config', 'asistencia_avisos'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
    EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
    EXECUTE format('GRANT ALL ON public.%I TO service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS admin_read ON public.%I', t);
    EXECUTE format($p$CREATE POLICY admin_read ON public.%I FOR SELECT TO authenticated USING (erp_rol_activo() = 'Admin')$p$, t);
  END LOOP;
END $$;
REVOKE ALL ON SEQUENCE public.asistencia_avisos_id_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SEQUENCE public.asistencia_avisos_id_seq TO service_role;

-- ═══ 3. Generar los avisos que tocan ahora (solo service_role) ═══
-- Devuelve { activo, avisos: [{ id, tipo, destino, usuario_id, titulo, mensaje }], jefes: [usuario_id…] }.
-- `usuario_id` solo en los avisos a la persona. Ventana: lo que tocó en los
-- últimos 30 minutos. Repetir la llamada no devuelve ni crea nada dos veces.
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
    SELECT e.id AS empleado_id, e.nombre, e.usuario_id, t.id AS turno_id, d.dia AS fecha_laboral, t.tolerancia_min,
           ((d.dia + t.hora_entrada)::timestamp AT TIME ZONE fin_zona_negocio()) AS entrada,
           ((d.dia + CASE WHEN t.hora_salida <= t.hora_entrada THEN 1 ELSE 0 END + t.hora_salida)::timestamp AT TIME ZONE fin_zona_negocio()) AS salida,
           to_char(t.hora_entrada, 'HH24:MI') AS hora_txt
      FROM turnos t
      JOIN empleados e ON e.id = t.empleado_id AND e.estatus = 'Activo'
      JOIN centros_trabajo c ON c.id = t.centro_id AND c.activo
      CROSS JOIN LATERAL (SELECT (p_ahora AT TIME ZONE fin_zona_negocio())::date - k AS dia FROM generate_series(0, 1) k) d
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

-- ═══ 4. Contratos de Admin ═══
CREATE OR REPLACE FUNCTION public.avisos_asistencia() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'avisos_asistencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'config', (SELECT to_jsonb(c) - 'id' FROM asistencia_avisos_config c WHERE c.id = 1),
    'recientes', (SELECT COALESCE(jsonb_agg(x ORDER BY x.created_at DESC), '[]'::jsonb)
                    FROM (SELECT a.id, a.tipo, a.destino, a.titulo, a.mensaje, a.created_at, e.nombre AS empleado
                            FROM asistencia_avisos a JOIN empleados e ON e.id = a.empleado_id
                           ORDER BY a.created_at DESC LIMIT 30) x));
END $$;
REVOKE ALL ON FUNCTION public.avisos_asistencia() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.avisos_asistencia() TO authenticated, service_role;

-- p_datos: { activo, empleado_antes_min, empleado_tarde, empleado_salida_min,
--            jefes_sin_marcar_min, jefes_retardo, jefes_sin_salida_min, jefes }
-- Un número vacío o null apaga ese aviso.
CREATE OR REPLACE FUNCTION public.guardar_avisos_asistencia(p_datos JSONB) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_antes  JSONB;
  v_desp   JSONB;
  v_activo BOOLEAN;
  v_ea     INTEGER;
  v_et     BOOLEAN;
  v_es     INTEGER;
  v_js     INTEGER;
  v_jr     BOOLEAN;
  v_jo     INTEGER;
  v_jefes  TEXT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'guardar_avisos_asistencia: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_datos IS NULL OR jsonb_typeof(p_datos) <> 'object' THEN
    RAISE EXCEPTION 'Configuración de avisos inválida' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_activo := COALESCE((p_datos ->> 'activo')::BOOLEAN, true);
    v_ea := NULLIF(p_datos ->> 'empleado_antes_min', '')::INTEGER;
    v_et := COALESCE((p_datos ->> 'empleado_tarde')::BOOLEAN, false);
    v_es := NULLIF(p_datos ->> 'empleado_salida_min', '')::INTEGER;
    v_js := NULLIF(p_datos ->> 'jefes_sin_marcar_min', '')::INTEGER;
    v_jr := COALESCE((p_datos ->> 'jefes_retardo')::BOOLEAN, false);
    v_jo := NULLIF(p_datos ->> 'jefes_sin_salida_min', '')::INTEGER;
    v_jefes := COALESCE(NULLIF(p_datos ->> 'jefes', ''), 'admins');
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Configuración de avisos inválida' USING ERRCODE = '22023';
  END;
  IF v_ea NOT BETWEEN 5 AND 60 THEN RAISE EXCEPTION 'El aviso antes de la entrada va de 5 a 60 minutos' USING ERRCODE = '22023'; END IF;
  IF v_es NOT BETWEEN 0 AND 120 THEN RAISE EXCEPTION 'El aviso de salida va de 0 a 120 minutos después del turno' USING ERRCODE = '22023'; END IF;
  IF v_js NOT BETWEEN 0 AND 120 THEN RAISE EXCEPTION 'El aviso a los jefes de quien no ha marcado va de 0 a 120 minutos' USING ERRCODE = '22023'; END IF;
  IF v_jo NOT BETWEEN 10 AND 240 THEN RAISE EXCEPTION 'El aviso a los jefes de salida sin marcar va de 10 a 240 minutos' USING ERRCODE = '22023'; END IF;
  IF v_jefes NOT IN ('admins', 'dueno') THEN RAISE EXCEPTION 'Indica quién recibe los avisos de jefes' USING ERRCODE = '22023'; END IF;

  SELECT to_jsonb(c) - 'id' - 'updated_at' - 'actualizado_por' INTO v_antes FROM asistencia_avisos_config c WHERE c.id = 1 FOR UPDATE;
  UPDATE asistencia_avisos_config
     SET activo = v_activo, empleado_antes_min = v_ea, empleado_tarde = v_et, empleado_salida_min = v_es,
         jefes_sin_marcar_min = v_js, jefes_retardo = v_jr, jefes_sin_salida_min = v_jo, jefes = v_jefes,
         actualizado_por = erp_actor_etiqueta(), updated_at = now()
   WHERE id = 1;
  SELECT to_jsonb(c) - 'id' - 'updated_at' - 'actualizado_por' INTO v_desp FROM asistencia_avisos_config c WHERE c.id = 1;
  IF v_antes IS DISTINCT FROM v_desp THEN
    INSERT INTO auditoria (usuario, accion, modulo, detalle)
    VALUES (erp_actor_etiqueta(), 'Editar', 'Asistencia',
            'Avisos de asistencia: ' || (SELECT string_agg(k || ' ' || COALESCE(v_antes ->> k, 'apagado') || ' → ' || COALESCE(v_desp ->> k, 'apagado'), ', ' ORDER BY k)
                                           FROM jsonb_object_keys(v_desp) k WHERE v_antes -> k IS DISTINCT FROM v_desp -> k));
  END IF;
  RETURN jsonb_build_object('config', (SELECT to_jsonb(c) - 'id' FROM asistencia_avisos_config c WHERE c.id = 1), 'sin_cambios', v_antes IS NOT DISTINCT FROM v_desp);
END $$;
REVOKE ALL ON FUNCTION public.guardar_avisos_asistencia(JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guardar_avisos_asistencia(JSONB) TO authenticated, service_role;
