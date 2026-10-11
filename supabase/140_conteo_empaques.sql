-- 140_conteo_empaques.sql — T5-C: conteo físico de empaques desde la aplicación,
-- sin que un conteo viejo pise movimientos posteriores.
--
-- Problema: el procedimiento de apertura pide contar las bolsas y corregir la
-- existencia. El servidor ya tenía el ajuste (`ajustar_existencia`, 093/108: solo
-- Admin, idempotente, con kardex y auditoría; un empaque solo se ajusta A LA BAJA),
-- pero ninguna pantalla lo ofrecía para empaques: solo SQL. Además ese contrato
-- recibe la existencia NUEVA en absoluto: un conteo preparado antes de que
-- Producción consumiera bolsas escribiría el número viejo encima y "devolvería" al
-- inventario las bolsas ya usadas.
--
--   1. `empaques_para_conteo()` — lectura, solo Admin: empaques con existencia,
--      costo promedio, último movimiento y una REVISIÓN (el id del último
--      movimiento de kardex de ese empaque).
--   2. `registrar_conteo_empaque(operación, sku, existencia_vista, revisión_vista,
--      conteo, motivo)` — solo Admin. Con el producto bloqueado comprueba que la
--      existencia y la revisión sigan siendo las que la pantalla mostró; si algo
--      se movió, rechaza (`CONTEO_OBSOLETO`) y no aplica nada. Si el conteo es
--      mayor que lo registrado, rechaza (`CONTEO_MAYOR`): las bolsas entran por
--      recepción de compra (decisión cerrada de 107/108: la base de costo). Si
--      cuadra o es menor, DELEGA en `ajustar_existencia`, que es quien mueve el
--      inventario: mismo kardex, misma auditoría, misma idempotencia. No hay un
--      segundo ledger. Un conteo sin diferencia también queda registrado.
--   3. `historial_empaque(sku, límite)` — lectura, solo Admin: el kardex de ese
--      empaque y, para los ajustes, la existencia anterior y la resultante que
--      guarda la operación.
--
-- Lo que NO cambia: `ajustar_existencia` (md5 igual), la recepción de compra,
-- el consumo de Producción y de la preparación de barra, el costo promedio
-- (un ajuste a la baja no lo toca), el kardex anterior, ninguna existencia.
-- No ejecuta ningún conteo ni ajuste: las cantidades reales las captura el dueño.
--
-- Idempotente. Reversión: DROP de las tres funciones (los ajustes hechos son historia).

-- ═══ 1. Empaques para contar (solo Admin) ═══
CREATE OR REPLACE FUNCTION public.empaques_para_conteo() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'empaques_para_conteo: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
             'sku', p.sku, 'nombre', p.nombre, 'unidad', 'piezas',
             'existencia', COALESCE(p.stock, 0)::INTEGER,
             'costo_unitario', p.costo_unitario,
             'usado_por', (SELECT count(*) FROM productos q WHERE q.empaque_sku = p.sku),
             -- Revisión: cambia con cada movimiento de kardex de este empaque (0 = sin movimientos).
             'revision', COALESCE(u.id, 0),
             'ultimo_movimiento', CASE WHEN u.id IS NULL THEN NULL ELSE
               jsonb_build_object('id', u.id, 'fecha', u.fecha, 'tipo', u.tipo, 'cantidad', u.cantidad, 'origen', u.origen, 'usuario', u.usuario) END
           ) ORDER BY p.sku)
      FROM productos p
      LEFT JOIN LATERAL (SELECT i.id, i.fecha, i.tipo, i.cantidad, i.origen, i.usuario FROM inventario_mov i WHERE i.producto = p.sku ORDER BY i.id DESC LIMIT 1) u ON true
     WHERE p.tipo = 'Empaque'), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION public.empaques_para_conteo() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.empaques_para_conteo() TO authenticated, service_role;

-- ═══ 2. Registrar un conteo físico (solo Admin) ═══
CREATE OR REPLACE FUNCTION public.registrar_conteo_empaque(
  p_operacion_id UUID, p_sku TEXT, p_existencia_vista INTEGER, p_revision_vista BIGINT, p_conteo NUMERIC, p_motivo TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sku     TEXT := btrim(COALESCE(p_sku, ''));
  v_motivo  TEXT := btrim(COALESCE(p_motivo, ''));
  v_texto   TEXT;
  v_conteo  INTEGER;
  v_prev    JSONB;
  v_prod    RECORD;
  v_rev     BIGINT;
  v_res     JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'registrar_conteo_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR v_sku = '' THEN
    RAISE EXCEPTION 'registrar_conteo_empaque: operación y empaque son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'Escribe el motivo del conteo (por ejemplo: conteo de apertura)' USING ERRCODE = '22023';
  END IF;
  IF p_conteo IS NULL OR p_conteo < 0 THEN
    RAISE EXCEPTION 'La cantidad contada debe ser 0 o mayor' USING ERRCODE = '22023';
  END IF;
  IF p_conteo <> trunc(p_conteo) OR p_conteo > 2000000000 THEN
    RAISE EXCEPTION 'La cantidad contada debe ser un número entero de piezas' USING ERRCODE = '22023';
  END IF;
  IF p_existencia_vista IS NULL THEN
    RAISE EXCEPTION 'registrar_conteo_empaque: falta la existencia que mostraba la pantalla al contar' USING ERRCODE = '22023';
  END IF;
  v_conteo := p_conteo::INTEGER;
  v_texto := 'Conteo físico: ' || v_motivo;

  -- Reintento de la MISMA operación (doble clic, respuesta perdida): misma respuesta, sin
  -- volver a comparar contra la existencia (que ya cambió por esta misma operación).
  v_prev := stock_op_replay(p_operacion_id, 'ajuste_existencia', 'ajuste|' || v_sku || '|' || v_conteo || '|' || v_texto);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev || jsonb_build_object('conteo', v_conteo);
  END IF;

  -- Candado del producto: el mismo que toman la producción, la preparación de barra, la
  -- recepción de compra y el ajuste. Lo que se compara es la existencia vigente.
  SELECT sku, nombre, tipo, COALESCE(stock, 0)::INTEGER AS stock INTO v_prod FROM productos WHERE sku = v_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Empaque no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF v_prod.tipo <> 'Empaque' THEN
    RAISE EXCEPTION '% no es un empaque: el producto terminado se cuenta por cuarto frío, en Congeladores', v_sku USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(max(id), 0) INTO v_rev FROM inventario_mov WHERE producto = v_sku;

  -- ¿Se movió el inventario desde que se abrió el conteo? Entonces la diferencia ya no vale.
  IF v_prod.stock <> p_existencia_vista OR v_rev <> COALESCE(p_revision_vista, 0) THEN
    RAISE EXCEPTION 'El inventario de % cambió desde que abriste el conteo (ahora hay % registradas; tú viste %). No se aplicó nada: actualiza y vuelve a capturar el conteo.',
      v_prod.nombre, v_prod.stock, p_existencia_vista
      USING ERRCODE = '22023',
            DETAIL = jsonb_build_object('codigo', 'CONTEO_OBSOLETO', 'sku', v_sku, 'existencia', v_prod.stock, 'revision', v_rev)::text;
  END IF;
  -- Sobrante: un empaque no sube por ajuste (107/108). Entra por recepción de compra.
  IF v_conteo > v_prod.stock THEN
    RAISE EXCEPTION 'Contaste % y el sistema tiene %: sobran %. Las bolsas no se suben con un conteo; registra esa entrada como compra recibida (Insumos → Llegaron). No se aplicó nada.',
      v_conteo, v_prod.stock, v_conteo - v_prod.stock
      USING ERRCODE = '22023',
            DETAIL = jsonb_build_object('codigo', 'CONTEO_MAYOR', 'sku', v_sku, 'existencia', v_prod.stock, 'sobrante', v_conteo - v_prod.stock)::text;
  END IF;

  -- Quien mueve el inventario es el contrato de siempre: kardex, auditoría e idempotencia.
  -- Sin diferencia no hay movimiento de kardex, pero el conteo sí queda registrado.
  v_res := ajustar_existencia(p_operacion_id, v_sku, v_conteo, v_texto);
  RETURN v_res || jsonb_build_object('conteo', v_conteo, 'existencia_vista', p_existencia_vista, 'diferencia', v_conteo - v_prod.stock);
END $$;
REVOKE ALL ON FUNCTION public.registrar_conteo_empaque(UUID, TEXT, INTEGER, BIGINT, NUMERIC, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_conteo_empaque(UUID, TEXT, INTEGER, BIGINT, NUMERIC, TEXT) TO authenticated, service_role;

-- ═══ 3. Historial de un empaque (solo Admin) ═══
CREATE OR REPLACE FUNCTION public.historial_empaque(p_sku TEXT, p_limite INTEGER DEFAULT 100) RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_sku TEXT := btrim(COALESCE(p_sku, ''));
  v_lim INTEGER := LEAST(GREATEST(COALESCE(p_limite, 100), 1), 500);
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'historial_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku AND tipo = 'Empaque') THEN
    RAISE EXCEPTION 'Empaque no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  RETURN jsonb_build_object(
    'sku', v_sku,
    -- Kardex tal como existe (no se inventan campos que el ledger no guarda).
    'movimientos', COALESCE((
      SELECT jsonb_agg(to_jsonb(m) ORDER BY m.id DESC)
        FROM (SELECT i.id, i.fecha, i.tipo, i.cantidad, i.origen, i.usuario, i.referencia,
                     -- Solo los ajustes conservan la existencia anterior y la resultante (en su operación).
                     CASE WHEN so.tipo = 'ajuste_existencia' THEN (so.resultado ->> 'anterior')::INTEGER END AS existencia_anterior,
                     CASE WHEN so.tipo = 'ajuste_existencia' THEN (so.resultado ->> 'nueva')::INTEGER END AS existencia_resultante
                FROM inventario_mov i
                LEFT JOIN stock_operaciones so ON so.operacion_id = i.operacion_id
               WHERE i.producto = v_sku ORDER BY i.id DESC LIMIT v_lim) m), '[]'::jsonb),
    -- Conteos y ajustes, incluidos los que NO movieron kardex (conteo sin diferencia).
    'conteos', COALESCE((
      SELECT jsonb_agg(to_jsonb(c) ORDER BY c.created_at DESC)
        FROM (SELECT so.created_at, so.actor, (so.resultado ->> 'anterior')::INTEGER AS existencia_anterior, (so.resultado ->> 'nueva')::INTEGER AS existencia_resultante,
                     (so.resultado ->> 'delta')::INTEGER AS diferencia, regexp_replace(so.clave, '^ajuste\|[^|]*\|[^|]*\|', '') AS motivo
                FROM stock_operaciones so
               WHERE so.tipo = 'ajuste_existencia' AND so.resultado ->> 'sku' = v_sku ORDER BY so.created_at DESC LIMIT v_lim) c), '[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION public.historial_empaque(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.historial_empaque(TEXT, INTEGER) TO authenticated, service_role;
