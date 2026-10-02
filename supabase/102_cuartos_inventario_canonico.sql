-- 102_cuartos_inventario_canonico.sql — parte 1 de 2 (aditiva). La parte 2
-- (103_contencion_cuartos.sql) se aplica DESPUÉS de desplegar el frontend
-- que usa estos contratos.
--
-- Inventario de producto terminado = cuartos_frios.stock por cuarto físico
-- (productos.stock NO es la fuente para producto terminado).
--   1. ajustar_existencia_cuarto (Admin): corrección por conteo físico de UN
--      SKU en UN cuarto. Objetivo absoluto; el servidor bloquea el cuarto,
--      calcula el delta, deja kardex estructurado (ajuste_cuarto/<op>) y
--      auditoría. Sin efecto financiero. Idempotente por operación.
--   2. registrar_merma_cuarto (Admin, Producción): pérdida física en UN cuarto
--      elegido (sin FIFO entre cuartos). Un evento de merma, un efecto exacto
--      en mermas_efectos, kardex con cuarto_id, valuación actual (sin cambio)
--      y auditoría. Idempotente por operación. Se revierte con revertir_merma.
--      La merma de ruta (087) no cambia.
--   3. cuartos_frios: un cuarto nuevo nace vacío; su id no cambia; no se
--      borra por API si tiene existencia o historia (kardex, producción,
--      mermas, devoluciones). El kardex ya no pierde el cuarto al borrar
--      (FK RESTRICT en lugar de SET NULL).
-- Idempotente. No modifica datos existentes.

-- ═══ 0. Tipos de operación ═══
ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta', 'recepcion_compra', 'salida_empaque',
                  'reverso_produccion', 'ajuste_existencia', 'ajuste_cuarto', 'merma_cuarto'));

-- ═══ 1. Ajuste de existencia por cuarto ═══
CREATE OR REPLACE FUNCTION public.ajustar_existencia_cuarto(
  p_operacion_id UUID, p_cuarto_id TEXT, p_sku TEXT, p_existencia INTEGER, p_motivo TEXT
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_cf       RECORD;
  v_actual   INTEGER;
  v_delta    INTEGER;
  v_nuevo    INTEGER;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'ajustar_existencia_cuarto: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'ajustar_existencia_cuarto: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_existencia IS NULL OR p_existencia < 0 THEN
    RAISE EXCEPTION 'La existencia contada debe ser 0 o mayor' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL OR length(v_motivo) < 5 THEN
    RAISE EXCEPTION 'El motivo del ajuste es obligatorio (mínimo 5 caracteres)' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku AND tipo = 'Producto Terminado') THEN
    RAISE EXCEPTION 'ajustar_existencia_cuarto: % no es un producto terminado del catálogo', v_sku USING ERRCODE = '22023';
  END IF;

  -- El cuarto serializa ajustes, producción, cargas, traspasos y mermas sobre él.
  SELECT id, nombre, COALESCE((stock ->> v_sku)::INTEGER, 0) AS q INTO v_cf FROM cuartos_frios WHERE id = v_cuarto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ajustar_existencia_cuarto: cuarto frío no encontrado: %', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_clave := 'ajuste_cuarto|' || v_cuarto || '|' || v_sku || '|' || p_existencia || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'ajuste_cuarto', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'ajuste_cuarto', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  v_actual := v_cf.q;
  v_delta  := p_existencia - v_actual;
  v_nuevo  := v_actual;
  IF v_delta <> 0 THEN
    v_nuevo := stock_mov_cuarto(v_cuarto, v_sku, v_delta, CASE WHEN v_delta > 0 THEN 'Entrada' ELSE 'Salida' END,
                                'Ajuste de conteo ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ': ' || v_motivo, NULL,
                                'ajuste_cuarto/' || p_operacion_id, v_etiqueta, NULL, p_operacion_id);
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Ajustar', 'Cuartos Fríos', COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_sku || ': ' || v_actual || ' → ' || p_existencia
          || ' (' || CASE WHEN v_delta > 0 THEN '+' ELSE '' END || v_delta || '). Motivo: ' || v_motivo);

  v_res := jsonb_build_object('cuarto_id', v_cuarto, 'sku', v_sku, 'anterior', v_actual, 'existencia', v_nuevo, 'delta', v_delta,
                              'motivo', v_motivo, 'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.ajustar_existencia_cuarto(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ajustar_existencia_cuarto(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- ═══ 2. Merma física en un cuarto ═══
CREATE OR REPLACE FUNCTION public.registrar_merma_cuarto(
  p_operacion_id UUID, p_cuarto_id TEXT, p_sku TEXT, p_cantidad INTEGER, p_causa TEXT DEFAULT NULL, p_foto TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id   BIGINT := erp_usuario_id();
  v_etiqueta   TEXT := erp_actor_etiqueta();
  v_uid        UUID := auth.uid();
  v_cuarto     TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_sku        TEXT := btrim(COALESCE(p_sku, ''));
  v_causa      TEXT := COALESCE(NULLIF(btrim(COALESCE(p_causa, '')), ''), 'Sin causa');
  v_foto       TEXT := NULLIF(btrim(COALESCE(p_foto, '')), '');
  v_clave      TEXT;
  v_prev       JSONB;
  v_prod       RECORD;
  v_cf         RECORD;
  v_merma_id   BIGINT;
  v_inv_id     BIGINT;
  v_mov_id     BIGINT;
  v_costo      NUMERIC;
  v_res        JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_merma: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  SELECT id, sku, nombre, tipo, costo_unitario INTO v_prod FROM productos WHERE sku = v_sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;

  -- El cuarto elegido es la autoridad y serializa todo movimiento sobre él.
  SELECT id, nombre, COALESCE((stock ->> v_prod.sku)::INTEGER, 0) AS q INTO v_cf FROM cuartos_frios WHERE id = v_cuarto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma_cuarto: cuarto frío no encontrado: %', v_cuarto USING ERRCODE = '22023';
  END IF;

  v_clave := 'merma_cuarto|' || v_cuarto || '|' || v_prod.sku || '|' || p_cantidad || '|' || v_causa || '|' || COALESCE(v_foto, '');
  v_prev := stock_op_replay(p_operacion_id, 'merma_cuarto', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- Foto: misma regla que registrar_merma (072): llave propia en el bucket
  -- `mermas`, existente y no ligada a otra merma; o data URL acotada.
  IF v_foto IS NOT NULL THEN
    IF v_foto LIKE 'data:image/%' THEN
      IF length(v_foto) > 3000000 THEN
        RAISE EXCEPTION 'registrar_merma: foto demasiado grande' USING ERRCODE = '22023';
      END IF;
    ELSE
      IF length(v_foto) > 512 OR v_foto !~ '^[^/\\]+(/[^/\\]+)+$' OR v_foto ~ '(^|/)\.\.?(/|$)' THEN
        RAISE EXCEPTION 'registrar_merma: ruta de foto inválida' USING ERRCODE = '22023';
      END IF;
      IF v_uid IS NOT NULL AND split_part(v_foto, '/', 1) <> v_uid::text THEN
        RAISE EXCEPTION 'registrar_merma: la foto no pertenece al actor' USING ERRCODE = '42501';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'mermas' AND o.name = v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto no existe en Storage' USING ERRCODE = '22023';
      END IF;
      IF erp_foto_merma_en_uso(v_foto) THEN
        RAISE EXCEPTION 'registrar_merma: la foto ya está ligada a otra merma' USING ERRCODE = '23505';
      END IF;
    END IF;
  END IF;

  IF v_cf.q < p_cantidad THEN
    RAISE EXCEPTION 'Stock insuficiente para registrar merma de %×% en %: disponible=%', p_cantidad, v_prod.sku, v_cuarto, v_cf.q USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'merma_cuarto', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id, ruta_id, afecta_stock, estatus)
  VALUES (fin_hoy(), v_prod.sku, p_cantidad, v_causa, COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto), COALESCE(v_foto, ''), v_actor_id, NULL, true, 'Activa')
  RETURNING id INTO v_merma_id;

  -- Solo el cuarto elegido; kardex con cuarto_id y operación.
  PERFORM stock_mov_cuarto(v_cuarto, v_prod.sku, -p_cantidad, 'Merma', v_causa, NULL, 'MERMA-' || v_merma_id, v_etiqueta, NULL, p_operacion_id);
  SELECT id INTO v_inv_id FROM inventario_mov WHERE operacion_id = p_operacion_id AND referencia = 'MERMA-' || v_merma_id ORDER BY id DESC LIMIT 1;
  INSERT INTO mermas_efectos (merma_id, cuarto_id, cantidad, inv_mov_id) VALUES (v_merma_id, v_cuarto, p_cantidad, v_inv_id);

  -- Valuación vigente (072/093): costo_unitario × cantidad, egreso no-efectivo.
  v_costo := COALESCE(v_prod.costo_unitario, 0);
  IF v_costo > 0 THEN
    INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
    VALUES (fin_hoy(), 'Egreso', 'Mermas',
            'Merma ' || p_cantidad || '× ' || v_prod.sku || COALESCE(' (' || NULLIF(v_prod.nombre, '') || ')', '') || ' — ' || v_causa,
            round(p_cantidad * v_costo, 2), 'MERMA-' || v_merma_id, v_actor_id)
    RETURNING id INTO v_mov_id;
    UPDATE mermas SET mov_contable_id = v_mov_id WHERE id = v_merma_id;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Registrar', 'Mermas', 'Merma #' || v_merma_id || ' — ' || p_cantidad || '×' || v_prod.sku || ' en ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_causa);

  v_res := jsonb_build_object('id', v_merma_id, 'sku', v_prod.sku, 'cantidad', p_cantidad, 'estatus', 'Activa', 'afecta_stock', true,
    'efectos', jsonb_build_array(jsonb_build_object('cuarto_id', v_cuarto, 'cantidad', p_cantidad, 'inv_mov_id', v_inv_id)),
    'mov_contable_id', v_mov_id, 'ruta_id', NULL, 'inventario', 'cuarto', 'cuarto_id', v_cuarto, 'actor', v_etiqueta,
    'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.registrar_merma_cuarto(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_merma_cuarto(UUID, TEXT, TEXT, INTEGER, TEXT, TEXT) TO authenticated, service_role;

-- ═══ 3. Integridad del cuarto (alta vacía, id fijo, borrado protegido) ═══
CREATE OR REPLACE FUNCTION public.cuarto_tiene_historia(p_cuarto_id TEXT) RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (SELECT 1 FROM inventario_mov WHERE cuarto_id = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM produccion WHERE cuarto_id = p_cuarto_id OR destino = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM mermas_efectos WHERE cuarto_id = p_cuarto_id)
      OR EXISTS (SELECT 1 FROM devoluciones WHERE cuarto_destino = p_cuarto_id)
$$;
REVOKE ALL ON FUNCTION public.cuarto_tiene_historia(TEXT) FROM PUBLIC, anon;
-- La guarda (invocador) la usa al borrar por API; solo responde sí/no.
GRANT EXECUTE ON FUNCTION public.cuarto_tiene_historia(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.cuartos_frios_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.stock, '{}'::jsonb) <> '{}'::jsonb THEN
      RAISE EXCEPTION 'cuartos_frios: un cuarto nuevo nace vacío; la existencia entra con un movimiento de inventario' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'cuartos_frios: el identificador del cuarto no cambia' USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;
  -- DELETE
  IF EXISTS (SELECT 1 FROM jsonb_each_text(COALESCE(OLD.stock, '{}'::jsonb)) k WHERE COALESCE(k.value, '0') NOT IN ('0', '0.0')) THEN
    RAISE EXCEPTION 'cuartos_frios: el cuarto % tiene existencia; vacíalo o trasládala antes de eliminarlo', OLD.id USING ERRCODE = '42501';
  END IF;
  IF cuarto_tiene_historia(OLD.id) THEN
    RAISE EXCEPTION 'cuartos_frios: el cuarto % tiene historia de inventario; no se elimina', OLD.id USING ERRCODE = '42501';
  END IF;
  RETURN OLD;
END $$;
REVOKE ALL ON FUNCTION public.cuartos_frios_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_cuartos_frios_guard ON cuartos_frios;
CREATE TRIGGER trg_cuartos_frios_guard BEFORE INSERT OR UPDATE OR DELETE ON cuartos_frios
  FOR EACH ROW EXECUTE FUNCTION public.cuartos_frios_guard();

-- El kardex nunca pierde su cuarto por un borrado (antes: ON DELETE SET NULL).
ALTER TABLE inventario_mov DROP CONSTRAINT IF EXISTS inventario_mov_cuarto_id_fkey;
ALTER TABLE inventario_mov ADD CONSTRAINT inventario_mov_cuarto_id_fkey FOREIGN KEY (cuarto_id) REFERENCES cuartos_frios(id) ON DELETE RESTRICT;
