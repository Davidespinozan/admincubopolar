-- ════════════════════════════════════════════════════════════════════════════
-- 150 — TIENDAS PROPIAS, E9: cierre integral.
--   (1) Una tienda ACTIVA no se queda sin cajero habilitado, por NINGÚN camino.
--   (2) Conciliación de reembolsos: el hecho contable (egreso de la devolución) aparte del
--       dinero que de verdad salió (reembolso ejecutado), cada uno en su fecha.
--
-- (1) ÚLTIMO CAJERO. 148 lo protege en `retirar_usuario_tienda`, pero la misma persona se podía
--     dar de baja, desactivar o cambiar de rol con `guardar_usuario` (120) y la tienda quedaba
--     activa sin nadie que pueda abrir caja. `guardar_usuario` NO se toca (huella comprobada
--     abajo): la regla vive en dos disparadores, sin exención de rol ni de sesión.
--       · `usuarios` (BEFORE UPDATE OF rol, estatus / DELETE): si la persona ERA cajero habilitado
--         (rol Ventas, Activo) y deja de serlo, se bloquean sus tiendas (FOR UPDATE, por id) y se
--         rechaza si alguna tienda activa se quedaría sin otro cajero habilitado.
--       · `usuario_establecimientos` (BEFORE DELETE / UPDATE de sus llaves): mismo criterio para un
--         retiro que no pase por el contrato (SQL de mantenimiento, borrado en cascada).
--     El candado es la fila del establecimiento, el mismo que toman `activar_tienda`,
--     `asignar_usuario_tienda` y `retirar_usuario_tienda` (`tienda_cargar`): dos bajas simultáneas
--     de los dos últimos cajeros, o una baja contra una activación, se resuelven una tras otra.
--     Rechazo: 22023 con DETAIL {"codigo":"ULTIMO_CAJERO"}. Salida legítima: asignar antes a otro
--     cajero o desactivar la tienda con su motivo (las dos cosas quedan registradas).
--     NO bloquea dar de baja a un cajero con turno abierto: una baja urgente no debe esperar a un
--     conteo; el turno lo cierra Administración.
--
-- (2) REEMBOLSOS. `registrar_devolucion` (104, sin cambio) registra el egreso contable el día de
--     la devolución, aunque el dinero se entregue después (efectivo de Administración) o por fuera
--     del sistema (tarjeta, transferencia). `reporte_reembolsos_tiendas` (solo lectura, solo Admin)
--     pone lado a lado: día de la venta, día de la devolución, egreso contable y su fecha, medio y
--     estado del reembolso, día en que se entregó y de qué caja salió; y totales por CADA fecha.
--     No corrige ni mueve nada.
--
-- (3) ROL DE SERVICIO. Las Netlify Functions resuelven el perfil de tienda con
--     `erp_usuario_de_tienda` (145) usando el rol de servicio, y fallan cerrado (503) si no pueden
--     ejecutarla. 145 se la quitó a PUBLIC, anon y authenticated; aquí se le otorga de forma
--     EXPLÍCITA a service_role, para no depender de los privilegios por omisión de cada base.
--
-- Aditiva e idempotente. Sin datos, tablas, policies ni cambios a contratos anteriores.
-- Reversión: DROP de los dos disparadores, sus dos funciones y `reporte_reembolsos_tiendas`
-- (reabre el hueco del último cajero).
-- ════════════════════════════════════════════════════════════════════════════

-- Precondición: los contratos sobre los que se apoya son los que se validaron.
DO $$
DECLARE v TEXT;
BEGIN
  IF to_regprocedure('public.reporte_tiendas_alcance(text,date,date,bigint,boolean)') IS NULL
     OR to_regprocedure('public.retirar_usuario_tienda(bigint,bigint,boolean)') IS NULL
     OR to_regclass('public.correcciones_venta_tienda') IS NULL THEN
    RAISE EXCEPTION '150: faltan las migraciones 143–149 de Tiendas';
  END IF;
  v := md5(pg_get_functiondef('public.guardar_usuario(bigint,text,text,text,text[])'::regprocedure));
  IF v <> '2b32868497e95e5deaf91af26619ec97' THEN
    RAISE EXCEPTION '150: guardar_usuario no es la definición esperada (md5 %); 150 no la modifica y se validó contra esa', v;
  END IF;
END $$;

-- ═══ 1. Último cajero de una tienda activa ═══
-- ¿La tienda se quedaría sin cajero habilitado si `p_usuario_id` deja de contar? Bloquea la tienda.
CREATE OR REPLACE FUNCTION public.tienda_exigir_otro_cajero(p_establecimiento_id BIGINT, p_usuario_id BIGINT, p_nombre TEXT) RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_e establecimientos%ROWTYPE;
BEGIN
  SELECT * INTO v_e FROM establecimientos WHERE id = p_establecimiento_id FOR UPDATE;
  IF NOT FOUND OR NOT v_e.activo OR v_e.tipo = 'cedis' THEN
    RETURN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM usuario_establecimientos ue JOIN usuarios u ON u.id = ue.usuario_id
                  WHERE ue.establecimiento_id = v_e.id AND ue.usuario_id <> p_usuario_id AND u.rol = 'Ventas' AND u.estatus = 'Activo') THEN
    RAISE EXCEPTION '% es el último cajero de la tienda activa "%": asigna antes a otro cajero o desactiva la tienda', COALESCE(p_nombre, 'Esa persona'), v_e.nombre
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ULTIMO_CAJERO', 'establecimiento_id', v_e.id)::text;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.usuarios_guard_ultimo_cajero() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_est BIGINT;
BEGIN
  -- Solo importa quien ERA cajero habilitado y deja de serlo (baja, desactivación o cambio de rol).
  IF OLD.rol IS DISTINCT FROM 'Ventas' OR OLD.estatus IS DISTINCT FROM 'Activo' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.rol = 'Ventas' AND NEW.estatus = 'Activo' THEN
    RETURN NEW;
  END IF;
  FOR v_est IN SELECT ue.establecimiento_id FROM usuario_establecimientos ue WHERE ue.usuario_id = OLD.id ORDER BY ue.establecimiento_id LOOP
    PERFORM tienda_exigir_otro_cajero(v_est, OLD.id, OLD.nombre);
  END LOOP;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE OR REPLACE FUNCTION public.usuario_establecimientos_guard_ultimo_cajero() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_u usuarios%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.usuario_id = OLD.usuario_id AND NEW.establecimiento_id = OLD.establecimiento_id THEN
    RETURN NEW;                                   -- cambio de permisos, no de pertenencia
  END IF;
  SELECT * INTO v_u FROM usuarios WHERE id = OLD.usuario_id;
  IF FOUND AND v_u.rol = 'Ventas' AND v_u.estatus = 'Activo' THEN
    PERFORM tienda_exigir_otro_cajero(OLD.establecimiento_id, OLD.usuario_id, v_u.nombre);
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

REVOKE ALL ON FUNCTION public.tienda_exigir_otro_cajero(BIGINT, BIGINT, TEXT), public.usuarios_guard_ultimo_cajero(), public.usuario_establecimientos_guard_ultimo_cajero()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_usuarios_guard_ultimo_cajero ON public.usuarios;
CREATE TRIGGER trg_usuarios_guard_ultimo_cajero BEFORE UPDATE OF rol, estatus OR DELETE ON public.usuarios
  FOR EACH ROW EXECUTE FUNCTION public.usuarios_guard_ultimo_cajero();
DROP TRIGGER IF EXISTS trg_usuario_establecimientos_guard_ultimo_cajero ON public.usuario_establecimientos;
CREATE TRIGGER trg_usuario_establecimientos_guard_ultimo_cajero BEFORE UPDATE OF usuario_id, establecimiento_id OR DELETE ON public.usuario_establecimientos
  FOR EACH ROW EXECUTE FUNCTION public.usuario_establecimientos_guard_ultimo_cajero();

-- ═══ 2. Conciliación de reembolsos de tienda (solo lectura, solo Admin) ═══
CREATE OR REPLACE FUNCTION public.reporte_reembolsos_tiendas(p_desde DATE, p_hasta DATE, p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM reporte_tiendas_alcance('reporte_reembolsos_tiendas', p_desde, p_hasta, p_establecimiento_id);
  RETURN (
    WITH c AS (
      SELECT k.id, k.establecimiento_id, e.nombre AS tienda, k.orden_id, o.folio, vt.metodo AS cobro_metodo, k.turno_venta_id,
             fin_dia_negocio(o.delivered_at) AS dia_venta,
             fin_dia_negocio(k.created_at) AS dia_devolucion,
             k.total_devuelto, k.reembolso_monto, k.reembolso_medio, k.reembolso_estado, k.reembolso_turno_id,
             fin_dia_negocio(k.reembolso_ejecutado_at) AS dia_ejecucion,
             (k.reembolso_referencia IS NOT NULL) AS con_referencia,
             d.id AS devolucion_id, d.disposicion, m.id AS egreso_id, m.fecha AS egreso_fecha, m.monto AS egreso_monto
        FROM correcciones_venta_tienda k
        JOIN establecimientos e ON e.id = k.establecimiento_id
        JOIN ordenes o ON o.id = k.orden_id
        JOIN ventas_tienda vt ON vt.orden_id = k.orden_id
        JOIN devoluciones d ON d.id = k.devolucion_id
        LEFT JOIN movimientos_contables m ON m.id = d.egreso_id
       WHERE p_establecimiento_id IS NULL OR k.establecimiento_id = p_establecimiento_id
    ), f AS (
      SELECT c.*,
             (c.dia_devolucion BETWEEN p_desde AND p_hasta) AS dev_en_periodo,
             (c.egreso_fecha BETWEEN p_desde AND p_hasta) AS egreso_en_periodo,
             (c.reembolso_estado = 'ejecutado' AND c.dia_ejecucion BETWEEN p_desde AND p_hasta) AS entregado_en_periodo,
             -- Al corte (p_hasta): ya se debía y todavía no se había entregado.
             (c.reembolso_monto > 0 AND c.dia_devolucion <= p_hasta AND (c.reembolso_estado = 'registrado' OR c.dia_ejecucion > p_hasta)) AS pendiente_al_corte
        FROM c
    ), s AS (
      SELECT f.* FROM f WHERE f.dev_en_periodo OR f.egreso_en_periodo OR f.entregado_en_periodo OR f.pendiente_al_corte
    )
    SELECT jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta, 'establecimiento_id', p_establecimiento_id,
      'reembolsos', COALESCE((SELECT jsonb_agg(jsonb_build_object(
          'correccion_id', s.id, 'establecimiento_id', s.establecimiento_id, 'tienda', s.tienda, 'orden_id', s.orden_id, 'folio', s.folio,
          'cobro_metodo', s.cobro_metodo, 'dia_venta', s.dia_venta, 'dia_devolucion', s.dia_devolucion, 'disposicion', s.disposicion, 'total_devuelto', s.total_devuelto,
          'egreso_contable', CASE WHEN s.egreso_id IS NULL THEN NULL ELSE jsonb_build_object('id', s.egreso_id, 'fecha', s.egreso_fecha, 'monto', s.egreso_monto) END,
          'monto', s.reembolso_monto, 'medio', s.reembolso_medio, 'estado', s.reembolso_estado, 'dia_ejecucion', s.dia_ejecucion, 'turno_salida_id', s.reembolso_turno_id,
          'con_referencia', s.con_referencia, 'pendiente_al_corte', s.pendiente_al_corte,
          'dias_pendiente', CASE WHEN s.reembolso_estado = 'registrado' THEN fin_hoy() - s.dia_devolucion END) ORDER BY s.dia_devolucion DESC, s.id DESC) FROM s), '[]'::jsonb),
      'resumen', (SELECT jsonb_build_object(
          'devoluciones_en_periodo', count(*) FILTER (WHERE s.dev_en_periodo),
          'devuelto_en_periodo', COALESCE(sum(s.total_devuelto) FILTER (WHERE s.dev_en_periodo), 0),
          'reembolsos_registrados_en_periodo', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.dev_en_periodo), 0),
          'egreso_contable_en_periodo', COALESCE(sum(s.egreso_monto) FILTER (WHERE s.egreso_en_periodo), 0),
          'dinero_entregado_en_periodo', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.entregado_en_periodo), 0),
          'entregado_desde_caja', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.entregado_en_periodo AND s.reembolso_medio = 'efectivo_caja'), 0),
          'entregado_por_administracion', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.entregado_en_periodo AND s.reembolso_medio = 'efectivo_administracion'), 0),
          'entregado_electronico', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.entregado_en_periodo AND s.reembolso_medio = 'electronico'), 0),
          'pendientes_al_corte', count(*) FILTER (WHERE s.pendiente_al_corte),
          'pendiente_al_corte', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.pendiente_al_corte), 0),
          'pendiente_electronico_al_corte', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.pendiente_al_corte AND s.reembolso_medio = 'electronico'), 0),
          'pendiente_efectivo_al_corte', COALESCE(sum(s.reembolso_monto) FILTER (WHERE s.pendiente_al_corte AND s.reembolso_medio <> 'electronico'), 0)) FROM s),
      -- Lo que nunca debería pasar (si aparece algo aquí, no se concilia a ciegas).
      'inconsistencias', COALESCE((SELECT jsonb_agg(jsonb_build_object('correccion_id', s.id, 'folio', s.folio, 'problema',
            CASE WHEN s.reembolso_monto > 0 AND s.egreso_id IS NULL THEN 'reembolso sin egreso contable'
                 WHEN s.reembolso_monto = 0 AND s.egreso_id IS NOT NULL THEN 'egreso contable sin reembolso'
                 ELSE 'el egreso contable y el reembolso no son por el mismo importe' END) ORDER BY s.id)
          FROM s WHERE (s.reembolso_monto > 0 AND s.egreso_id IS NULL) OR (s.reembolso_monto = 0 AND s.egreso_id IS NOT NULL)
                    OR (s.egreso_id IS NOT NULL AND s.egreso_monto IS DISTINCT FROM s.reembolso_monto)), '[]'::jsonb),
      'notas', jsonb_build_array(
        'El egreso contable se registra el día de la devolución; el dinero puede entregarse después. Son dos fechas distintas.',
        'Dinero entregado cuenta en el día de negocio en que se confirmó la entrega. Solo el efectivo que salió de una caja baja el efectivo esperado de ese turno.',
        'Un reembolso electrónico (tarjeta o transferencia) se hace fuera del sistema y queda pendiente hasta confirmarlo con su referencia.'))
  );
END $$;
REVOKE ALL ON FUNCTION public.reporte_reembolsos_tiendas(DATE, DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporte_reembolsos_tiendas(DATE, DATE, BIGINT) TO authenticated, service_role;

-- ═══ 3. El rol de servicio puede resolver el perfil de tienda (Netlify) ═══
GRANT EXECUTE ON FUNCTION public.erp_usuario_de_tienda(BIGINT) TO service_role;

NOTIFY pgrst, 'reload schema';
