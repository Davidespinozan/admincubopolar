-- 103_contencion_cuartos.sql — parte 2 de 2. Se aplica DESPUÉS de desplegar
-- el frontend que usa ajustar_existencia_cuarto y registrar_merma_cuarto (102).
-- Idempotente.
--   1. La API ya no cambia cuartos_frios.stock por REST (metadatos sí: nombre,
--      temperatura, capacidad, mínimos). Un navegador anterior que intente el
--      ajuste viejo (UPDATE del JSON completo) falla antes de tocar nada.
--   2. Sin INSERT REST en inventario_mov: el kardex lo escriben los contratos.
--   3. registrar_merma ya no descuenta FIFO entre cuartos desde la aplicación
--      (la merma de cuarto indica el cuarto). Ruta (087) y proceso, sin cambio.
--   4. registrar_mermas_ruta(bigint, jsonb) (sobrecarga legada sin
--      llamadores) sin EXECUTE de la API; el contrato vigente es el de UUID.
--   5. salida_cuarto_manual: motivos estructurados y auditoría.

-- ═══ 1. Existencia del cuarto: solo por contrato ═══
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
    IF NEW.stock IS DISTINCT FROM OLD.stock THEN
      RAISE EXCEPTION 'cuartos_frios: la existencia del cuarto solo cambia con movimientos de inventario (ajuste de conteo, merma, producción, carga, traspaso…)' USING ERRCODE = '42501';
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

-- ═══ 2. Kardex: sin INSERT REST ═══
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON inventario_mov FROM authenticated;
DO $$
DECLARE v_seq TEXT := pg_get_serial_sequence('public.inventario_mov', 'id');
BEGIN
  IF v_seq IS NOT NULL THEN
    EXECUTE format('REVOKE USAGE ON SEQUENCE %s FROM authenticated', v_seq);
  END IF;
END $$;

-- ═══ 3. registrar_merma: sin FIFO de cuartos desde la aplicación ═══
CREATE OR REPLACE FUNCTION public.registrar_merma(p_sku text, p_cantidad integer, p_causa text DEFAULT NULL::text, p_origen text DEFAULT NULL::text, p_foto text DEFAULT NULL::text, p_ruta_id bigint DEFAULT NULL::bigint, p_afecta_stock boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_rol        TEXT;
  v_usuario_id BIGINT;
  v_etiqueta   TEXT;
  v_uid        UUID := auth.uid();
  v_prod       RECORD;
  v_ruta       RECORD;
  v_prodfolio  RECORD;
  v_sku        TEXT := btrim(COALESCE(p_sku, ''));
  v_causa      TEXT := COALESCE(NULLIF(btrim(COALESCE(p_causa, '')), ''), 'Sin causa');
  v_origen     TEXT;
  v_foto       TEXT := NULLIF(btrim(COALESCE(p_foto, '')), '');
  v_folio      TEXT;
  v_merma_id   BIGINT;
  v_restante   INTEGER;
  v_cf         RECORD;
  v_disp       INTEGER;
  v_toma       INTEGER;
  v_inv_id     BIGINT;
  v_mov_id     BIGINT;
  v_costo      NUMERIC;
  v_efectos    JSONB := '[]'::jsonb;
  v_origen_inv TEXT;
  v_chofer     TEXT;   -- nombre para origen/concepto de ruta (NULL fuera de ruta)
  v_disp_ruta  INTEGER;  -- 087: inventario canónico del camión para el SKU
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_merma: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  -- 103: la merma física de cuarto se registra con registrar_merma_cuarto
  -- (cuarto elegido, sin FIFO entre cuartos). Desde la aplicación este
  -- contrato queda para merma de ruta (087) y merma de proceso.
  IF p_ruta_id IS NULL AND COALESCE(p_afecta_stock, true) AND COALESCE(fin_jwt_role(), '') NOT IN ('', 'service_role') THEN
    RAISE EXCEPTION 'registrar_merma: la merma de cuarto se registra con registrar_merma_cuarto (indica el cuarto)' USING ERRCODE = '42501';
  END IF;
  v_rol        := erp_rol_activo();      -- NULL para service_role / SQL
  v_usuario_id := erp_usuario_id();
  v_etiqueta   := erp_actor_etiqueta();

  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_merma: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF p_afecta_stock IS NULL THEN
    RAISE EXCEPTION 'registrar_merma: afecta_stock es obligatorio' USING ERRCODE = '22023';
  END IF;

  SELECT id, sku, nombre, costo_unitario INTO v_prod FROM productos WHERE sku = v_sku ORDER BY id LIMIT 1;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_merma: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;

  -- Ruta: existe y, para Chofer, es suya. Producción no registra mermas de ruta.
  IF p_ruta_id IS NOT NULL THEN
    SELECT id, folio, chofer_id, chofer_nombre, estatus INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_merma: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
    END IF;
    IF v_rol = 'Producción' THEN
      RAISE EXCEPTION 'registrar_merma: Producción no registra mermas de ruta' USING ERRCODE = '42501';
    END IF;
    IF v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_usuario_id THEN
      RAISE EXCEPTION 'registrar_merma: la ruta no pertenece al chofer' USING ERRCODE = '42501';
    END IF;
    v_chofer := COALESCE(NULLIF(btrim(COALESCE(v_ruta.chofer_nombre, '')), ''), v_etiqueta);
    -- 087: la merma de ruta es pérdida del inventario del camión: solo con la
    -- ruta cargada o en progreso (el lock de la ruta serializa mermas y cierre).
    IF v_ruta.estatus NOT IN ('Cargada', 'En progreso') THEN
      RAISE EXCEPTION 'registrar_merma: la ruta % está % (merma de ruta solo en Cargada o En progreso)', v_ruta.folio, v_ruta.estatus USING ERRCODE = '22023';
    END IF;
  ELSIF v_rol = 'Chofer' THEN
    RAISE EXCEPTION 'registrar_merma: el chofer solo registra mermas de su ruta' USING ERRCODE = '42501';
  END IF;

  -- Merma de proceso (transformación): sin efecto de stock propio.
  IF NOT p_afecta_stock THEN
    IF v_rol IS NOT NULL AND v_rol NOT IN ('Admin', 'Producción') THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso solo Admin/Producción' USING ERRCODE = '42501';
    END IF;
    IF p_ruta_id IS NOT NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso no lleva ruta' USING ERRCODE = '22023';
    END IF;
    v_folio := substring(COALESCE(p_origen, '') FROM '^Transformación (TR-[0-9]+)$');
    IF v_folio IS NULL THEN
      RAISE EXCEPTION 'registrar_merma: merma de proceso requiere origen "Transformación TR-###"' USING ERRCODE = '22023';
    END IF;
    SELECT folio, input_sku, merma_kg INTO v_prodfolio FROM produccion
     WHERE folio = v_folio AND tipo = 'Transformacion' ORDER BY id LIMIT 1;
    IF NOT FOUND OR v_prodfolio.input_sku IS DISTINCT FROM v_prod.sku THEN
      RAISE EXCEPTION 'registrar_merma: transformación % no encontrada para %', v_folio, v_prod.sku USING ERRCODE = '22023';
    END IF;
    IF p_cantidad > ceil(COALESCE(v_prodfolio.merma_kg, 0)) THEN
      RAISE EXCEPTION 'registrar_merma: cantidad mayor a la merma de la transformación' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM mermas WHERE origen = 'Transformación ' || v_folio AND NOT afecta_stock) THEN
      RAISE EXCEPTION 'registrar_merma: la transformación % ya tiene merma registrada', v_folio USING ERRCODE = '23505';
    END IF;
  END IF;

  -- Foto: data URL (flujo de ruta) o llave de objeto propia en el bucket
  -- `mermas`, existente y no ligada a otra merma. Nunca una URL externa.
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

  -- 087: tope de la merma de ruta = balance canónico del camión (nunca el
  -- stock de cuartos). El helper falla cerrado si las fuentes son ambiguas.
  IF p_ruta_id IS NOT NULL AND p_afecta_stock THEN
    SELECT b.restante INTO v_disp_ruta FROM balance_ruta_interno(p_ruta_id) b WHERE b.sku = v_prod.sku;
    IF COALESCE(v_disp_ruta, 0) < p_cantidad THEN
      RAISE EXCEPTION 'registrar_merma: la merma de %×% supera el inventario del camión (disponible=%)', p_cantidad, v_prod.sku, COALESCE(v_disp_ruta, 0)
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_origen := CASE
    WHEN p_ruta_id IS NOT NULL THEN 'Ruta ' || v_chofer
    ELSE COALESCE(NULLIF(btrim(COALESCE(p_origen, '')), ''), v_etiqueta)
  END;

  INSERT INTO mermas (fecha, sku, cantidad, causa, origen, foto_url, usuario_id, ruta_id, afecta_stock, estatus)
  VALUES (fin_hoy(), v_prod.sku, p_cantidad, v_causa, v_origen, COALESCE(v_foto, ''), v_usuario_id, p_ruta_id, p_afecta_stock, 'Activa')
  RETURNING id INTO v_merma_id;

  IF p_afecta_stock THEN
    -- Descuento FIFO por id de cuarto (mismo orden que el cliente legacy).
    -- FOR UPDATE: dos mermas concurrentes del mismo stock se serializan y la
    -- segunda relee el stock ya descontado.
    v_origen_inv := CASE WHEN p_ruta_id IS NOT NULL THEN 'Merma ruta ' || v_chofer ELSE v_causa END;
    IF p_ruta_id IS NULL THEN
    v_restante := p_cantidad;
    FOR v_cf IN SELECT id, stock FROM cuartos_frios ORDER BY id FOR UPDATE LOOP
      EXIT WHEN v_restante <= 0;
      v_disp := COALESCE((v_cf.stock ->> v_prod.sku)::INTEGER, 0);
      CONTINUE WHEN v_disp <= 0;
      v_toma := LEAST(v_disp, v_restante);
      UPDATE cuartos_frios
         SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_prod.sku], to_jsonb(v_disp - v_toma)),
             updated_at = now()
       WHERE id = v_cf.id;
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
      VALUES ('Merma', v_prod.sku, v_toma, v_origen_inv, v_etiqueta, 'MERMA-' || v_merma_id)
      RETURNING id INTO v_inv_id;
      INSERT INTO mermas_efectos (merma_id, cuarto_id, cantidad, inv_mov_id)
      VALUES (v_merma_id, v_cf.id, v_toma, v_inv_id);
      v_efectos := v_efectos || jsonb_build_object('cuarto_id', v_cf.id, 'cantidad', v_toma, 'inv_mov_id', v_inv_id);
      v_restante := v_restante - v_toma;
    END LOOP;
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Stock insuficiente para registrar merma de %×%: disponible=%', p_cantidad, v_prod.sku, p_cantidad - v_restante
        USING ERRCODE = 'P0001';
    END IF;
    ELSE
      -- 087: merma de ruta = pérdida del inventario del camión. Sin cuartos
      -- ni mermas_efectos; kardex estructurado (cuarto_id NULL, ruta_id).
      INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, ruta_id)
      VALUES ('Merma', v_prod.sku, p_cantidad, v_origen_inv, v_etiqueta, 'MERMA-' || v_merma_id, p_ruta_id)
      RETURNING id INTO v_inv_id;
    END IF;

    -- Egreso contable por el costo (si el producto tiene costo).
    v_costo := COALESCE(v_prod.costo_unitario, 0);
    IF v_costo > 0 THEN
      INSERT INTO movimientos_contables (fecha, tipo, categoria, concepto, monto, referencia, usuario_id)
      VALUES (
        fin_hoy(), 'Egreso', 'Mermas',
        CASE WHEN p_ruta_id IS NOT NULL
          THEN 'Merma ruta ' || v_chofer || ': ' || p_cantidad || '× ' || v_prod.sku
          ELSE 'Merma ' || p_cantidad || '× ' || v_prod.sku
        END || COALESCE(' (' || NULLIF(v_prod.nombre, '') || ')', '') || ' — ' || v_causa,
        round(p_cantidad * v_costo, 2),
        'MERMA-' || v_merma_id,
        v_usuario_id)
      RETURNING id INTO v_mov_id;
      UPDATE mermas SET mov_contable_id = v_mov_id WHERE id = v_merma_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'id', v_merma_id, 'sku', v_prod.sku, 'cantidad', p_cantidad, 'estatus', 'Activa',
    'afecta_stock', p_afecta_stock, 'efectos', v_efectos, 'mov_contable_id', v_mov_id,
    'ruta_id', p_ruta_id, 'inventario', CASE WHEN p_ruta_id IS NULL THEN 'cuarto' ELSE 'camion' END, 'actor', v_etiqueta);
END $function$;

-- ═══ 4. Sobrecarga legada de mermas de ruta ═══
REVOKE EXECUTE ON FUNCTION public.registrar_mermas_ruta(BIGINT, JSONB) FROM PUBLIC, anon, authenticated;

-- ═══ 5. Salida manual: motivos estructurados + auditoría ═══
CREATE OR REPLACE FUNCTION public.salida_cuarto_manual(p_operacion_id uuid, p_cuarto_id text, p_sku text, p_cantidad integer, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_prev     JSONB;
  v_clave    TEXT;
  v_nuevo    INTEGER;
  v_res      JSONB;
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'salida_cuarto_manual: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_cuarto_id IS NULL OR p_sku IS NULL THEN
    RAISE EXCEPTION 'salida_cuarto_manual: cuarto y sku son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'salida_cuarto_manual: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'salida_cuarto_manual: motivo requerido' USING ERRCODE = '22023';
  END IF;
  IF v_motivo ~* 'ruta' THEN
    RAISE EXCEPTION 'salida_cuarto_manual: la carga a ruta se registra al firmar la carga (confirmar_carga_ruta), no como salida manual' USING ERRCODE = '22023';
  END IF;
  -- 103: motivos estructurados. La merma física va por registrar_merma_cuarto,
  -- la corrección de conteo por ajustar_existencia_cuarto, la carga por
  -- confirmar_carga_ruta y el traspaso por traspaso_cuartos.
  IF NOT (v_motivo IN ('Venta directa', 'Consumo interno') OR (v_motivo LIKE 'Otro: %' AND length(btrim(substr(v_motivo, 7))) >= 5)) THEN
    RAISE EXCEPTION 'salida_cuarto_manual: motivo no permitido (Venta directa, Consumo interno u "Otro: detalle"); mermas y ajustes de conteo tienen su propio registro' USING ERRCODE = '22023';
  END IF;
  v_clave := 'salida|' || p_cuarto_id || '|' || p_sku || '|' || p_cantidad || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'salida_manual', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'salida_manual', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  v_nuevo := stock_mov_cuarto(p_cuarto_id, p_sku, -p_cantidad, 'Salida', v_motivo, NULL, 'salida_manual/' || p_cuarto_id, v_etiqueta, NULL, p_operacion_id);
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Salida manual', 'Cuartos Fríos', p_cuarto_id || ' — ' || p_cantidad || '×' || p_sku || '. Motivo: ' || v_motivo);
  v_res := jsonb_build_object('cuarto_id', p_cuarto_id, 'sku', p_sku, 'cantidad', p_cantidad, 'motivo', v_motivo, 'stock', v_nuevo, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $function$;
