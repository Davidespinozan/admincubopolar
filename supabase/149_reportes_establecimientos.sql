-- 149_reportes_establecimientos.sql — Tiendas propias, E8: reportes por establecimiento y
-- consolidados. SOLO LECTURA: cuatro funciones STABLE que no escriben nada. No activa nada.
--
-- Qué separan: CEDIS (las ventas centrales de siempre: mostrador central, rutas, venta rápida),
-- tienda de fábrica y tiendas remotas; y el consolidado, que es exactamente la suma de las partes.
--
-- REGLAS DE CONTEO (las mismas en los cuatro reportes)
--   · Venta = una orden Entregada o Facturada. Cuenta UNA vez, en el día de negocio en que se
--     entregó (delivered_at en la zona del negocio). Sin delivered_at no cuenta.
--   · De qué establecimiento es: ordenes.establecimiento_id; sin él es central = CEDIS. Una venta
--     de la tienda de fábrica con producto del CEDIS es de la TIENDA (y se cuenta una sola vez).
--   · Vendido (devengado) ≠ cobrado: "bruto" es el total de las ventas entregadas en el periodo;
--     "cobrado por forma de pago" son los pagos con fecha en el periodo. Se reportan aparte.
--   · Devolución: el total devuelto, en el día en que se registró. Neto = bruto − devoluciones.
--   · Un TRASPASO no es una venta: no genera orden ni pago y no aparece en ventas ni en cobros.
--   · Dañados y faltantes de un traspaso son cantidades FÍSICAS registradas en el traspaso. No son
--     merma contable (148 no la registra) y aquí no se les pone valor: se reportan aparte y así se dice.
--   · Reembolso REGISTRADO (se debe) ≠ ENTREGADO (el dinero ya salió) ≠ pendiente.
--
-- QUIÉN: solo Administración (o una sesión de confianza). El personal de tienda y los cajeros no
-- tienen ningún reporte de esta migración: su información sigue siendo la de "Mi turno", que no
-- muestra el efectivo esperado de un turno abierto. Los roles centrales no cambian: sus reportes
-- históricos (reporte_financiero y demás) quedan intactos, con el mismo contrato y la misma huella.
--
-- Idempotente. Reversión: DROP de las 4 funciones de reporte y de reporte_tiendas_alcance.

-- ═══ 0. Precondiciones ═══
DO $$
BEGIN
  IF to_regclass('public.traspasos') IS NULL OR to_regclass('public.ventas_tienda') IS NULL OR to_regprocedure('public.pos_es_admin()') IS NULL THEN
    RAISE EXCEPTION '149: faltan las migraciones 146 a 148. No se aplicó nada.';
  END IF;
END $$;

-- ═══ 1. Alcance (interna): quién consulta y qué rango ═══
-- Solo Administración. Valida el rango (días de negocio, máximo 400) y el establecimiento.
CREATE OR REPLACE FUNCTION public.reporte_tiendas_alcance(p_fn TEXT, p_desde DATE, p_hasta DATE, p_establecimiento_id BIGINT, p_con_rango BOOLEAN DEFAULT true) RETURNS VOID
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT pos_es_admin() THEN
    RAISE EXCEPTION '%: no autorizado', p_fn USING ERRCODE = '42501';
  END IF;
  IF p_con_rango AND (p_desde IS NULL OR p_hasta IS NULL OR p_desde > p_hasta OR p_hasta - p_desde > 400) THEN
    RAISE EXCEPTION '%: indica el periodo (desde y hasta, máximo 400 días)', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'RANGO_INVALIDO')::text;
  END IF;
  IF p_establecimiento_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM establecimientos e WHERE e.id = p_establecimiento_id) THEN
    RAISE EXCEPTION '%: ese establecimiento no existe', p_fn USING ERRCODE = '22023', DETAIL = jsonb_build_object('codigo', 'ESTABLECIMIENTO_NO_VALIDO')::text;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.reporte_tiendas_alcance(TEXT, DATE, DATE, BIGINT, BOOLEAN) FROM PUBLIC, anon, authenticated;

-- ═══ 2. Ventas ═══
CREATE OR REPLACE FUNCTION public.reporte_ventas_establecimientos(p_desde DATE, p_hasta DATE, p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM reporte_tiendas_alcance('reporte_ventas_establecimientos', p_desde, p_hasta, p_establecimiento_id);
  RETURN (
    WITH est AS (
      SELECT e.id, e.clave, e.nombre, e.tipo, e.activo FROM establecimientos e WHERE p_establecimiento_id IS NULL OR e.id = p_establecimiento_id
    ), v AS (          -- cada venta UNA vez, en su establecimiento y en el día de negocio de su entrega
      SELECT o.id, COALESCE(o.establecimiento_id, 1) AS est, fin_dia_negocio(o.delivered_at) AS dia, COALESCE(o.total, 0) AS total
        FROM ordenes o
       WHERE o.estatus IN ('Entregada', 'Facturada') AND o.delivered_at IS NOT NULL
         AND fin_dia_negocio(o.delivered_at) BETWEEN p_desde AND p_hasta
         AND (p_establecimiento_id IS NULL OR COALESCE(o.establecimiento_id, 1) = p_establecimiento_id)
    ), u AS (          -- unidades y subtotal por venta y producto
      SELECT v.id, v.est, l.sku, sum(l.cantidad) AS unidades, sum(COALESCE(l.subtotal, l.cantidad * l.precio_unit)) AS importe
        FROM v JOIN orden_lineas l ON l.orden_id = v.id GROUP BY v.id, v.est, l.sku
    ), dev AS (        -- devoluciones registradas en el periodo
      SELECT COALESCE(o.establecimiento_id, 1) AS est, d.total
        FROM devoluciones d JOIN ordenes o ON o.id = d.orden_id
       WHERE fin_dia_negocio(COALESCE(d.fecha, d.created_at)) BETWEEN p_desde AND p_hasta
         AND (p_establecimiento_id IS NULL OR COALESCE(o.establecimiento_id, 1) = p_establecimiento_id)
    ), cob AS (        -- cobros con fecha en el periodo
      SELECT COALESCE(o.establecimiento_id, 1) AS est, COALESCE(p.metodo_pago, 'Sin forma de pago') AS metodo, p.monto
        FROM pagos p JOIN ordenes o ON o.id = p.orden_id
       WHERE p.fecha BETWEEN p_desde AND p_hasta AND (p_establecimiento_id IS NULL OR COALESCE(o.establecimiento_id, 1) = p_establecimiento_id)
    ), fila AS (
      SELECT e.id, e.clave, e.nombre, e.tipo, e.activo,
             (SELECT count(*) FROM v WHERE v.est = e.id) AS ventas,
             (SELECT COALESCE(sum(u.unidades), 0) FROM u WHERE u.est = e.id) AS unidades,
             (SELECT COALESCE(round(sum(v.total), 2), 0) FROM v WHERE v.est = e.id) AS bruto,
             (SELECT COALESCE(round(sum(dev.total), 2), 0) FROM dev WHERE dev.est = e.id) AS devoluciones,
             (SELECT COALESCE(round(sum(cob.monto), 2), 0) FROM cob WHERE cob.est = e.id) AS cobrado,
             COALESCE((SELECT jsonb_object_agg(m.metodo, m.monto) FROM (SELECT cob.metodo, round(sum(cob.monto), 2) AS monto FROM cob WHERE cob.est = e.id GROUP BY cob.metodo) m), '{}'::jsonb) AS por_metodo
        FROM est e
    )
    SELECT jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta, 'establecimiento_id', p_establecimiento_id,
      'por_establecimiento', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', f.id, 'clave', f.clave, 'nombre', f.nombre, 'tipo', f.tipo, 'activo', f.activo,
                                         'ventas', f.ventas, 'unidades', f.unidades, 'bruto', f.bruto, 'devoluciones', f.devoluciones, 'neto', f.bruto - f.devoluciones,
                                         'cobrado', f.cobrado, 'cobrado_por_metodo', f.por_metodo) ORDER BY f.id) FROM fila f), '[]'::jsonb),
      -- CEDIS / tienda de fábrica / tiendas remotas
      'por_tipo', COALESCE((SELECT jsonb_object_agg(t.tipo, jsonb_build_object('ventas', t.ventas, 'unidades', t.unidades, 'bruto', t.bruto, 'devoluciones', t.devoluciones, 'neto', t.bruto - t.devoluciones, 'cobrado', t.cobrado))
                              FROM (SELECT f.tipo, sum(f.ventas) AS ventas, sum(f.unidades) AS unidades, sum(f.bruto) AS bruto, sum(f.devoluciones) AS devoluciones, sum(f.cobrado) AS cobrado FROM fila f GROUP BY f.tipo) t), '{}'::jsonb),
      'consolidado', (SELECT jsonb_build_object('ventas', COALESCE(sum(f.ventas), 0), 'unidades', COALESCE(sum(f.unidades), 0), 'bruto', COALESCE(sum(f.bruto), 0),
                                                'devoluciones', COALESCE(sum(f.devoluciones), 0), 'neto', COALESCE(sum(f.bruto - f.devoluciones), 0), 'cobrado', COALESCE(sum(f.cobrado), 0)) FROM fila f),
      'cobrado_por_metodo', COALESCE((SELECT jsonb_object_agg(m.metodo, m.monto) FROM (SELECT cob.metodo, round(sum(cob.monto), 2) AS monto FROM cob GROUP BY cob.metodo) m), '{}'::jsonb),
      'por_dia', COALESCE((SELECT jsonb_agg(jsonb_build_object('fecha', d.dia, 'establecimiento_id', d.est, 'ventas', d.ventas, 'bruto', d.bruto) ORDER BY d.dia, d.est)
                             FROM (SELECT v.dia, v.est, count(*) AS ventas, round(sum(v.total), 2) AS bruto FROM v GROUP BY v.dia, v.est) d), '[]'::jsonb),
      'por_producto', COALESCE((SELECT jsonb_agg(jsonb_build_object('sku', x.sku, 'nombre', x.nombre, 'unidades', x.unidades, 'importe', x.importe) ORDER BY x.importe DESC, x.sku)
                                  FROM (SELECT u.sku, max(p.nombre) AS nombre, sum(u.unidades) AS unidades, round(sum(u.importe), 2) AS importe FROM u LEFT JOIN productos p ON p.sku = u.sku GROUP BY u.sku) x), '[]'::jsonb),
      -- Solo ventas de tienda (las centrales no tienen caja ni cajero de tienda).
      'por_caja', COALESCE((SELECT jsonb_agg(jsonb_build_object('caja_id', x.caja_id, 'caja', x.caja, 'establecimiento_id', x.est, 'ventas', x.ventas, 'bruto', x.bruto) ORDER BY x.est, x.caja, x.caja_id)
                              FROM (SELECT vt.caja_id, max(c.nombre) AS caja, v.est, count(*) AS ventas, round(sum(v.total), 2) AS bruto
                                      FROM v JOIN ventas_tienda vt ON vt.orden_id = v.id LEFT JOIN cajas c ON c.id = vt.caja_id GROUP BY vt.caja_id, v.est) x), '[]'::jsonb),
      'por_cajero', COALESCE((SELECT jsonb_agg(jsonb_build_object('cajero_id', x.cajero_id, 'cajero', x.cajero, 'establecimiento_id', x.est, 'ventas', x.ventas, 'bruto', x.bruto) ORDER BY x.est, x.cajero, x.cajero_id)
                                FROM (SELECT vt.cajero_id, max(us.nombre) AS cajero, v.est, count(*) AS ventas, round(sum(v.total), 2) AS bruto
                                        FROM v JOIN ventas_tienda vt ON vt.orden_id = v.id LEFT JOIN usuarios us ON us.id = vt.cajero_id GROUP BY vt.cajero_id, v.est) x), '[]'::jsonb),
      'notas', jsonb_build_array('Cada venta cuenta una vez, en el día de negocio de su entrega y en su establecimiento.',
                                 'Bruto es lo vendido (entregado) en el periodo; cobrado son los pagos con fecha en el periodo.',
                                 'Los traspasos entre el CEDIS y las tiendas no son ventas y no aparecen aquí.'))
  );
END $$;

-- ═══ 3. Cajas y turnos ═══
CREATE OR REPLACE FUNCTION public.reporte_cajas_tiendas(p_desde DATE, p_hasta DATE, p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM reporte_tiendas_alcance('reporte_cajas_tiendas', p_desde, p_hasta, p_establecimiento_id);
  RETURN (
    WITH t AS (        -- turnos por el día de negocio de su apertura
      SELECT tc.*, turno_caja_totales(tc.id) AS tot FROM turnos_caja tc
       WHERE tc.fecha_negocio BETWEEN p_desde AND p_hasta AND (p_establecimiento_id IS NULL OR tc.establecimiento_id = p_establecimiento_id)
    ), r AS (          -- reembolsos de las ventas de cada turno, por estado
      SELECT c.turno_venta_id AS turno_id,
             COALESCE(sum(c.reembolso_monto), 0) AS registrados,
             COALESCE(sum(c.reembolso_monto) FILTER (WHERE c.reembolso_estado = 'ejecutado'), 0) AS entregados,
             COALESCE(sum(c.reembolso_monto) FILTER (WHERE c.reembolso_estado = 'registrado'), 0) AS pendientes,
             count(*) AS correcciones
        FROM correcciones_venta_tienda c WHERE c.turno_venta_id IN (SELECT id FROM t) GROUP BY c.turno_venta_id
    ), f AS (
      SELECT t.id, t.establecimiento_id, t.caja_id, c.nombre AS caja, e.nombre AS tienda, t.cajero_id, t.cajero_nombre, t.estado, t.fecha_negocio, t.abierto_at, t.cerrado_at, t.reaperturas,
             t.fondo_inicial, (t.tot ->> 'ventas')::INTEGER AS ventas, (t.tot ->> 'total_vendido')::NUMERIC AS vendido, t.tot -> 'cobrado_por_metodo' AS por_metodo,
             (t.tot ->> 'cobrado_efectivo')::NUMERIC AS cobrado_efectivo, (t.tot ->> 'reembolsos_efectivo_caja')::NUMERIC AS reembolsos_desde_caja,
             -- Turno cerrado: lo que quedó en el cierre. Turno abierto: el esperado al momento (solo Administración llega aquí).
             CASE WHEN t.estado = 'cerrado' THEN t.efectivo_esperado
                  ELSE round(t.fondo_inicial + (t.tot ->> 'cobrado_efectivo')::NUMERIC - (t.tot ->> 'reembolsos_efectivo_caja')::NUMERIC, 2) END AS esperado,
             t.efectivo_contado AS contado, t.diferencia, t.motivo_diferencia,
             COALESCE(r.registrados, 0) AS reemb_registrados, COALESCE(r.entregados, 0) AS reemb_entregados, COALESCE(r.pendientes, 0) AS reemb_pendientes, COALESCE(r.correcciones, 0) AS correcciones
        FROM t JOIN cajas c ON c.id = t.caja_id JOIN establecimientos e ON e.id = t.establecimiento_id LEFT JOIN r ON r.turno_id = t.id
    )
    SELECT jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta, 'establecimiento_id', p_establecimiento_id,
      'turnos', COALESCE((SELECT jsonb_agg(jsonb_build_object('turno_id', f.id, 'establecimiento_id', f.establecimiento_id, 'tienda', f.tienda, 'caja_id', f.caja_id, 'caja', f.caja,
                            'cajero_id', f.cajero_id, 'cajero', f.cajero_nombre, 'estado', f.estado, 'fecha', f.fecha_negocio, 'abierto_at', f.abierto_at, 'cerrado_at', f.cerrado_at, 'reaperturas', f.reaperturas,
                            'fondo_inicial', f.fondo_inicial, 'ventas', f.ventas, 'vendido', f.vendido, 'cobrado_por_metodo', f.por_metodo, 'cobrado_efectivo', f.cobrado_efectivo,
                            'reembolsos_desde_caja', f.reembolsos_desde_caja, 'efectivo_esperado', f.esperado, 'efectivo_contado', f.contado, 'diferencia', f.diferencia, 'motivo_diferencia', f.motivo_diferencia,
                            'reembolsos_registrados', f.reemb_registrados, 'reembolsos_entregados', f.reemb_entregados, 'reembolsos_pendientes', f.reemb_pendientes, 'correcciones', f.correcciones)
                            ORDER BY f.fecha_negocio DESC, f.id DESC) FROM f), '[]'::jsonb),
      'por_caja', COALESCE((SELECT jsonb_agg(jsonb_build_object('establecimiento_id', x.establecimiento_id, 'tienda', x.tienda, 'caja_id', x.caja_id, 'caja', x.caja, 'turnos', x.turnos, 'ventas', x.ventas,
                              'vendido', x.vendido, 'cobrado_efectivo', x.efectivo, 'diferencia', x.diferencia, 'turnos_con_diferencia', x.con_diferencia) ORDER BY x.establecimiento_id, x.caja, x.caja_id)
                              FROM (SELECT f.establecimiento_id, max(f.tienda) AS tienda, f.caja_id, max(f.caja) AS caja, count(*) AS turnos, sum(f.ventas) AS ventas, sum(f.vendido) AS vendido,
                                           sum(f.cobrado_efectivo) AS efectivo, COALESCE(sum(f.diferencia), 0) AS diferencia, count(*) FILTER (WHERE COALESCE(f.diferencia, 0) <> 0) AS con_diferencia
                                      FROM f GROUP BY f.establecimiento_id, f.caja_id) x), '[]'::jsonb),
      'resumen', (SELECT jsonb_build_object('turnos', count(*), 'abiertos', count(*) FILTER (WHERE f.estado = 'abierto'), 'cerrados', count(*) FILTER (WHERE f.estado = 'cerrado'),
                    'fondo_inicial', COALESCE(sum(f.fondo_inicial), 0), 'vendido', COALESCE(sum(f.vendido), 0), 'cobrado_efectivo', COALESCE(sum(f.cobrado_efectivo), 0),
                    'efectivo_esperado_cerrados', COALESCE(sum(f.esperado) FILTER (WHERE f.estado = 'cerrado'), 0), 'efectivo_contado', COALESCE(sum(f.contado), 0),
                    'sobrantes', COALESCE(sum(f.diferencia) FILTER (WHERE f.diferencia > 0), 0), 'faltantes', COALESCE(sum(f.diferencia) FILTER (WHERE f.diferencia < 0), 0),
                    'turnos_con_diferencia', count(*) FILTER (WHERE COALESCE(f.diferencia, 0) <> 0),
                    'reembolsos_registrados', COALESCE(sum(f.reemb_registrados), 0), 'reembolsos_entregados', COALESCE(sum(f.reemb_entregados), 0), 'reembolsos_pendientes', COALESCE(sum(f.reemb_pendientes), 0)) FROM f),
      'notas', jsonb_build_array('Un turno aparece en el día de negocio en que se abrió.',
                                 'Reembolso registrado = se le debe al cliente; entregado = el dinero ya salió; pendiente = registrado y todavía no entregado.',
                                 'El efectivo esperado de un turno abierto es el del momento de la consulta y solo lo ve Administración.'))
  );
END $$;

-- ═══ 4. Inventario ═══
CREATE OR REPLACE FUNCTION public.reporte_inventario_establecimientos(p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM reporte_tiendas_alcance('reporte_inventario_establecimientos', NULL, NULL, p_establecimiento_id, false);
  RETURN (
    WITH ex AS (       -- existencia física por cuarto y producto (solo cantidades positivas)
      SELECT c.establecimiento_id AS est, c.id AS cuarto_id, c.nombre AS cuarto, s.key AS sku, GREATEST(COALESCE(NULLIF(s.value, '')::INTEGER, 0), 0) AS piezas
        FROM cuartos_frios c, jsonb_each_text(COALESCE(c.stock, '{}'::jsonb)) s
       WHERE p_establecimiento_id IS NULL OR c.establecimiento_id = p_establecimiento_id
    ), tr AS (         -- producto que ya salió de un cuarto y todavía no entra a otro
      SELECT t.id, t.folio, t.origen_establecimiento_id AS origen, t.destino_establecimiento_id AS destino, l.sku, l.cantidad_despachada AS piezas
        FROM traspasos t JOIN traspaso_lineas l ON l.traspaso_id = t.id
       WHERE t.estado = 'en_transito' AND (p_establecimiento_id IS NULL OR p_establecimiento_id IN (t.origen_establecimiento_id, t.destino_establecimiento_id))
    )
    SELECT jsonb_build_object(
      'establecimiento_id', p_establecimiento_id,
      'por_establecimiento', COALESCE((SELECT jsonb_agg(jsonb_build_object('id', e.id, 'clave', e.clave, 'nombre', e.nombre, 'tipo', e.tipo, 'activo', e.activo,
                                         'piezas', (SELECT COALESCE(sum(ex.piezas), 0) FROM ex WHERE ex.est = e.id),
                                         'existencia', COALESCE((SELECT jsonb_object_agg(x.sku, x.piezas) FROM (SELECT ex.sku, sum(ex.piezas) AS piezas FROM ex WHERE ex.est = e.id GROUP BY ex.sku HAVING sum(ex.piezas) > 0) x), '{}'::jsonb),
                                         'en_camino_hacia', COALESCE((SELECT jsonb_object_agg(x.sku, x.piezas) FROM (SELECT tr.sku, sum(tr.piezas) AS piezas FROM tr WHERE tr.destino = e.id GROUP BY tr.sku) x), '{}'::jsonb)) ORDER BY e.id)
                                         FROM establecimientos e WHERE p_establecimiento_id IS NULL OR e.id = p_establecimiento_id), '[]'::jsonb),
      'por_cuarto', COALESCE((SELECT jsonb_agg(jsonb_build_object('establecimiento_id', q.est, 'cuarto_id', q.cuarto_id, 'cuarto', q.cuarto, 'piezas', q.piezas, 'existencia', q.existencia) ORDER BY q.est, q.cuarto_id)
                                FROM (SELECT c.establecimiento_id AS est, c.id AS cuarto_id, c.nombre AS cuarto,
                                             (SELECT COALESCE(sum(ex.piezas), 0) FROM ex WHERE ex.cuarto_id = c.id) AS piezas,
                                             COALESCE((SELECT jsonb_object_agg(ex.sku, ex.piezas) FROM ex WHERE ex.cuarto_id = c.id AND ex.piezas > 0), '{}'::jsonb) AS existencia
                                        FROM cuartos_frios c WHERE p_establecimiento_id IS NULL OR c.establecimiento_id = p_establecimiento_id) q), '[]'::jsonb),
      'en_transito', jsonb_build_object(
        'piezas', (SELECT COALESCE(sum(tr.piezas), 0) FROM tr),
        'por_producto', COALESCE((SELECT jsonb_object_agg(x.sku, x.piezas) FROM (SELECT tr.sku, sum(tr.piezas) AS piezas FROM tr GROUP BY tr.sku) x), '{}'::jsonb),
        'traspasos', COALESCE((SELECT jsonb_agg(jsonb_build_object('traspaso_id', x.id, 'folio', x.folio, 'origen', x.origen, 'destino', x.destino, 'piezas', x.piezas) ORDER BY x.id)
                                 FROM (SELECT tr.id, tr.folio, tr.origen, tr.destino, sum(tr.piezas) AS piezas FROM tr GROUP BY tr.id, tr.folio, tr.origen, tr.destino) x), '[]'::jsonb)),
      -- Total de la empresa = lo que hay en cuartos + lo que va en camino (no está en ningún cuarto). Solo con sentido en el consolidado.
      'total_piezas', (SELECT COALESCE(sum(ex.piezas), 0) FROM ex) + (SELECT COALESCE(sum(tr.piezas), 0) FROM tr WHERE p_establecimiento_id IS NULL),
      'notas', jsonb_build_array('La existencia es física, por cuarto. El producto en tránsito ya salió de su origen y todavía no entra a su destino: no está en ningún cuarto.'))
  );
END $$;

-- ═══ 5. Abastecimiento (traspasos) ═══
CREATE OR REPLACE FUNCTION public.reporte_abastecimiento_tiendas(p_desde DATE, p_hasta DATE, p_establecimiento_id BIGINT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM reporte_tiendas_alcance('reporte_abastecimiento_tiendas', p_desde, p_hasta, p_establecimiento_id);
  RETURN (
    WITH t AS (        -- traspasos DESPACHADOS en el periodo (día de negocio del despacho), con su tienda
      SELECT x.*, CASE WHEN x.origen_establecimiento_id = 1 THEN x.destino_establecimiento_id ELSE x.origen_establecimiento_id END AS tienda_id,
             CASE WHEN x.origen_establecimiento_id = 1 THEN 'abasto' ELSE 'devolucion' END AS direccion
        FROM traspasos x
       WHERE x.despachado_at IS NOT NULL AND fin_dia_negocio(x.despachado_at) BETWEEN p_desde AND p_hasta
         AND (p_establecimiento_id IS NULL OR p_establecimiento_id IN (x.origen_establecimiento_id, x.destino_establecimiento_id))
    ), l AS (
      SELECT t.id, t.tienda_id, t.direccion, t.estado, t.incidencia, t.incidencia_cerrada_at, li.sku,
             li.cantidad_despachada AS despachadas,
             CASE WHEN t.estado = 'recibido'  THEN li.cantidad_recibida ELSE 0 END AS recibidas,
             CASE WHEN t.estado = 'retornado' THEN li.cantidad_recibida ELSE 0 END AS retornadas,
             CASE WHEN t.estado IN ('recibido', 'retornado') THEN li.cantidad_danada ELSE 0 END AS danadas,
             CASE WHEN t.estado IN ('recibido', 'retornado') THEN li.cantidad_faltante ELSE 0 END AS faltantes,
             CASE WHEN t.estado = 'en_transito' THEN li.cantidad_despachada ELSE 0 END AS en_transito
        FROM t JOIN traspaso_lineas li ON li.traspaso_id = t.id
    )
    SELECT jsonb_build_object(
      'desde', p_desde, 'hasta', p_hasta, 'establecimiento_id', p_establecimiento_id,
      'traspasos', (SELECT jsonb_build_object('despachados', count(*), 'recibidos', count(*) FILTER (WHERE t.estado = 'recibido'), 'retornados', count(*) FILTER (WHERE t.estado = 'retornado'),
                      'en_transito', count(*) FILTER (WHERE t.estado = 'en_transito'), 'abasto', count(*) FILTER (WHERE t.direccion = 'abasto'), 'devolucion', count(*) FILTER (WHERE t.direccion = 'devolucion'),
                      'incidencias_abiertas', count(*) FILTER (WHERE t.incidencia AND t.incidencia_cerrada_at IS NULL), 'incidencias_cerradas', count(*) FILTER (WHERE t.incidencia AND t.incidencia_cerrada_at IS NOT NULL)) FROM t),
      -- Cantidades FÍSICAS. despachadas = recibidas + retornadas + dañadas + faltantes + en tránsito.
      'unidades', (SELECT jsonb_build_object('despachadas', COALESCE(sum(l.despachadas), 0), 'recibidas_correctamente', COALESCE(sum(l.recibidas), 0), 'retornadas', COALESCE(sum(l.retornadas), 0),
                     'danadas', COALESCE(sum(l.danadas), 0), 'faltantes', COALESCE(sum(l.faltantes), 0), 'en_transito', COALESCE(sum(l.en_transito), 0)) FROM l),
      'por_tienda', COALESCE((SELECT jsonb_agg(jsonb_build_object('establecimiento_id', x.tienda_id, 'tienda', x.tienda, 'tipo', x.tipo, 'traspasos', x.traspasos, 'despachadas', x.despachadas, 'recibidas_correctamente', x.recibidas,
                                'retornadas', x.retornadas, 'danadas', x.danadas, 'faltantes', x.faltantes, 'en_transito', x.en_transito, 'incidencias_abiertas', x.inc_abiertas) ORDER BY x.tienda_id)
                                FROM (SELECT l.tienda_id, max(e.nombre) AS tienda, max(e.tipo) AS tipo, count(DISTINCT l.id) AS traspasos, sum(l.despachadas) AS despachadas, sum(l.recibidas) AS recibidas,
                                             sum(l.retornadas) AS retornadas, sum(l.danadas) AS danadas, sum(l.faltantes) AS faltantes, sum(l.en_transito) AS en_transito,
                                             count(DISTINCT l.id) FILTER (WHERE l.incidencia AND l.incidencia_cerrada_at IS NULL) AS inc_abiertas
                                        FROM l JOIN establecimientos e ON e.id = l.tienda_id GROUP BY l.tienda_id) x), '[]'::jsonb),
      'por_producto', COALESCE((SELECT jsonb_agg(jsonb_build_object('sku', x.sku, 'nombre', x.nombre, 'despachadas', x.despachadas, 'recibidas_correctamente', x.recibidas, 'retornadas', x.retornadas,
                                  'danadas', x.danadas, 'faltantes', x.faltantes, 'en_transito', x.en_transito) ORDER BY x.sku)
                                  FROM (SELECT l.sku, max(p.nombre) AS nombre, sum(l.despachadas) AS despachadas, sum(l.recibidas) AS recibidas, sum(l.retornadas) AS retornadas, sum(l.danadas) AS danadas,
                                               sum(l.faltantes) AS faltantes, sum(l.en_transito) AS en_transito FROM l LEFT JOIN productos p ON p.sku = l.sku GROUP BY l.sku) x), '[]'::jsonb),
      'incidencias', COALESCE((SELECT jsonb_agg(jsonb_build_object('traspaso_id', t.id, 'folio', t.folio, 'establecimiento_id', t.tienda_id, 'estado', t.estado, 'abierta', t.incidencia_cerrada_at IS NULL,
                                 'nota', t.notas_recepcion, 'resolucion', t.incidencia_resolucion, 'fecha', t.recibido_at,
                                 'danadas', (SELECT COALESCE(sum(l.danadas), 0) FROM l WHERE l.id = t.id), 'faltantes', (SELECT COALESCE(sum(l.faltantes), 0) FROM l WHERE l.id = t.id)) ORDER BY t.id DESC)
                                 FROM t WHERE t.incidencia), '[]'::jsonb),
      -- Físico ≠ contable: aquí NO hay pesos. Dañados y faltantes no se registraron como merma ni como egreso.
      'contable', jsonb_build_object('merma_registrada', false, 'valor', NULL, 'ingreso_comercial', 0,
                                     'explicacion', 'Los traspasos mueven producto de la empresa entre sus propios establecimientos: no generan venta, cobro ni ingreso. Las piezas dañadas o faltantes quedan registradas en su traspaso como incidencia; no se registran en automático como merma contable ni tienen valor asignado.'))
  );
END $$;

REVOKE ALL ON FUNCTION public.reporte_ventas_establecimientos(DATE, DATE, BIGINT), public.reporte_cajas_tiendas(DATE, DATE, BIGINT),
  public.reporte_inventario_establecimientos(BIGINT), public.reporte_abastecimiento_tiendas(DATE, DATE, BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reporte_ventas_establecimientos(DATE, DATE, BIGINT), public.reporte_cajas_tiendas(DATE, DATE, BIGINT),
  public.reporte_inventario_establecimientos(BIGINT), public.reporte_abastecimiento_tiendas(DATE, DATE, BIGINT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
