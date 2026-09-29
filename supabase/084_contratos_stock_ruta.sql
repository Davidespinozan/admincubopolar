-- 084_contratos_stock_ruta.sql — R2 fase 1: cimiento ADITIVO de los
-- contratos de stock de cuartos fríos.
--
-- Nada de lo existente cambia: update_stocks_atomic, 078, 069/072/076 y el
-- frontend siguen igual; ningún llamador se conmuta; el kardex histórico no
-- se toca. Se agrega:
--
-- 1. stock_operaciones — una fila por operación de negocio (UUID del cliente).
--    Modelo de idempotencia: una operación puede escribir VARIAS filas de
--    kardex (carga = SKUs × cuartos), así que la unicidad va en la operación,
--    no en inventario_mov. Mismo UUID + misma clave → replay del resultado
--    guardado; mismo UUID + clave distinta → 23505. Además cada contrato
--    ancla en la fila de negocio (rutas.carga_confirmada_at, ordenes.estatus)
--    para que un UUID DISTINTO tampoco repita el efecto. Serialización: lock
--    consultivo por UUID + FOR UPDATE de la fila de negocio y de los cuartos.
-- 2. inventario_mov: cuarto_id, ruta_id, operacion_id (FK, ON DELETE SET
--    NULL) y referencia estructurada 'tipo/ref'. Nullables; sin backfill:
--    las filas históricas quedan LEGACY / no estructuradas.
-- 3. Contratos SECURITY DEFINER (search_path fijo, actor canónico, sin
--    fin_ctx, sin llamada anidada a update_stocks_atomic; escriben stock y
--    kardex ellos mismos):
--    confirmar_carga_ruta   firma + descuento + kardex + Cargada en UNA
--                           transacción. Cantidades = rutas.carga_real del
--                           servidor (≤ carga_autorizada + extra_autorizado);
--                           asignación de cuartos determinista (FIFO por id
--                           de cuarto, igual que calcularChangesInventario).
--    registrar_no_entrega   devuelve las líneas de la orden al primer cuarto
--                           (igual que hoy) + orden 'No entregada' en UNA
--                           transacción.
--    salida_cuarto_manual   salida manual de Producción/Admin: SKU válido,
--                           cantidad > 0, stock suficiente, motivo no
--                           relacionado con carga de ruta (la carga la firma
--                           confirmar_carga_ruta: evita el doble descuento).
--    traspaso_cuartos       origen − / destino + con dos filas de kardex bajo
--                           la misma operación.
--    registrar_devolucion_ruta NO se crea (gate 0.D: ventas exprés y mermas
--                           de ruta se materializan al cierre y las mermas de
--                           ruta descuentan cuartos en 072; el remanente del
--                           camión no es derivable sin ambigüedad).
-- Ningún contrato acepta SKU, cuarto, cantidad ni actor arbitrarios donde el
-- servidor puede derivarlos. Idempotente.

-- ═══════════════════════════════════════════════════════════════
-- 1. Operaciones de stock (idempotencia)
-- ═══════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS stock_operaciones (
  operacion_id UUID PRIMARY KEY,
  tipo         TEXT NOT NULL CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso')),
  clave        TEXT NOT NULL,
  actor_id     BIGINT,
  actor        TEXT NOT NULL,
  ruta_id      BIGINT,
  orden_id     BIGINT,
  resultado    JSONB NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE stock_operaciones ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_all ON stock_operaciones;
CREATE POLICY admin_all ON stock_operaciones FOR ALL TO authenticated
  USING (erp_rol_activo() = 'Admin') WITH CHECK (erp_rol_activo() = 'Admin');
DROP POLICY IF EXISTS read_all ON stock_operaciones;
CREATE POLICY read_all ON stock_operaciones FOR SELECT TO authenticated
  USING (erp_es_activo());
-- Solo los contratos (owner postgres) escriben; la API lee bajo RLS.
REVOKE ALL ON stock_operaciones FROM PUBLIC, anon, authenticated;
GRANT SELECT ON stock_operaciones TO authenticated;
GRANT ALL ON stock_operaciones TO service_role;
CREATE INDEX IF NOT EXISTS idx_stock_operaciones_ruta  ON stock_operaciones (ruta_id)  WHERE ruta_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stock_operaciones_orden ON stock_operaciones (orden_id) WHERE orden_id IS NOT NULL;

-- ═══════════════════════════════════════════════════════════════
-- 2. Kardex estructurado (aditivo, nullable, sin backfill)
-- ═══════════════════════════════════════════════════════════════
ALTER TABLE inventario_mov ADD COLUMN IF NOT EXISTS cuarto_id    TEXT;
ALTER TABLE inventario_mov ADD COLUMN IF NOT EXISTS ruta_id      BIGINT;
ALTER TABLE inventario_mov ADD COLUMN IF NOT EXISTS operacion_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_mov_cuarto_id_fkey') THEN
    ALTER TABLE inventario_mov ADD CONSTRAINT inventario_mov_cuarto_id_fkey
      FOREIGN KEY (cuarto_id) REFERENCES cuartos_frios(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_mov_ruta_id_fkey') THEN
    ALTER TABLE inventario_mov ADD CONSTRAINT inventario_mov_ruta_id_fkey
      FOREIGN KEY (ruta_id) REFERENCES rutas(id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'inventario_mov_operacion_id_fkey') THEN
    ALTER TABLE inventario_mov ADD CONSTRAINT inventario_mov_operacion_id_fkey
      FOREIGN KEY (operacion_id) REFERENCES stock_operaciones(operacion_id) ON DELETE SET NULL;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_inventario_mov_operacion ON inventario_mov (operacion_id) WHERE operacion_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inventario_mov_ruta      ON inventario_mov (ruta_id)      WHERE ruta_id IS NOT NULL;
COMMENT ON COLUMN inventario_mov.operacion_id IS '084: operación de negocio (stock_operaciones). NULL = fila histórica sin estructura (legacy).';

-- ═══════════════════════════════════════════════════════════════
-- 3. Helpers internos (no ejecutables por roles de API)
-- ═══════════════════════════════════════════════════════════════
-- Replay/mismatch por UUID. Devuelve el resultado guardado si la operación
-- ya existe con la misma clave; 23505 si existe con otra clave; NULL si es nueva.
CREATE OR REPLACE FUNCTION stock_op_replay(p_operacion_id UUID, p_tipo TEXT, p_clave TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_op stock_operaciones%ROWTYPE;
BEGIN
  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'stock: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtext('stock_op:' || p_operacion_id::text));
  SELECT * INTO v_op FROM stock_operaciones WHERE operacion_id = p_operacion_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_op.tipo <> p_tipo OR v_op.clave <> p_clave THEN
    RAISE EXCEPTION 'stock: operacion_id ya usado con otros datos (%: %)', v_op.tipo, v_op.clave USING ERRCODE = '23505';
  END IF;
  RETURN v_op.resultado || jsonb_build_object('replay', true);
END $$;
REVOKE ALL ON FUNCTION stock_op_replay(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- Movimiento de un SKU en un cuarto (ya bloqueado por el llamador) + kardex estructurado.
CREATE OR REPLACE FUNCTION stock_mov_cuarto(p_cuarto_id TEXT, p_sku TEXT, p_delta INTEGER, p_tipo TEXT, p_origen TEXT, p_destino TEXT,
                                            p_referencia TEXT, p_usuario TEXT, p_ruta_id BIGINT, p_operacion_id UUID) RETURNS INTEGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_actual INTEGER; v_nuevo INTEGER;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = p_sku) THEN
    RAISE EXCEPTION 'stock: SKU no encontrado: %', p_sku USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE((stock ->> p_sku)::INTEGER, 0) INTO v_actual FROM cuartos_frios WHERE id = p_cuarto_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'stock: cuarto frío no encontrado: %', p_cuarto_id USING ERRCODE = '22023';
  END IF;
  v_nuevo := v_actual + p_delta;
  IF v_nuevo < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente para % en cuarto %: disponible=%, requerido=%', p_sku, p_cuarto_id, v_actual, ABS(p_delta);
  END IF;
  UPDATE cuartos_frios
     SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[p_sku], to_jsonb(v_nuevo)), updated_at = now()
   WHERE id = p_cuarto_id;
  INSERT INTO inventario_mov (tipo, producto, cantidad, origen, destino, usuario, referencia, cuarto_id, ruta_id, operacion_id)
  VALUES (p_tipo, p_sku, ABS(p_delta), p_origen, p_destino, p_usuario, p_referencia, p_cuarto_id, p_ruta_id, p_operacion_id);
  RETURN v_nuevo;
END $$;
REVOKE ALL ON FUNCTION stock_mov_cuarto(TEXT, TEXT, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, BIGINT, UUID) FROM PUBLIC, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════
-- 4. confirmar_carga_ruta — firma + descuento + kardex + Cargada
-- ═══════════════════════════════════════════════════════════════
-- Quién: actor activo Chofer dueño de la ruta (firma en su celular), o
-- Producción / Admin en su propio dispositivo (BotonFirmasPendientes).
-- Firmante registrado = el actor (carga_confirmada_por), nunca un parámetro.
-- Cantidades = rutas.carga_real (lo que el chofer solicitó en 078), techo =
-- carga_autorizada + extra_autorizado. Cuartos: FIFO por id de cuarto.
CREATE OR REPLACE FUNCTION confirmar_carga_ruta(p_operacion_id UUID, p_ruta_id BIGINT, p_firma TEXT DEFAULT NULL,
                                                p_excepcion BOOLEAN DEFAULT false, p_motivo TEXT DEFAULT NULL) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol       TEXT := fin_mi_rol_activo();
  v_actor_id  BIGINT := erp_usuario_id();
  v_etiqueta  TEXT := erp_actor_etiqueta();
  v_ruta      rutas%ROWTYPE;
  v_prev      JSONB;
  v_clave     TEXT;
  v_sku       TEXT;
  v_qty       TEXT;
  v_restante  INTEGER;
  v_max       NUMERIC;
  v_cf        RECORD;
  v_disp      INTEGER;
  v_tomar     INTEGER;
  v_asig      JSONB := '[]'::jsonb;
  v_res       JSONB;
  v_excepcion BOOLEAN := COALESCE(p_excepcion, false);
  v_motivo    TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_firma     TEXT := NULLIF(btrim(COALESCE(p_firma, '')), '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción', 'Chofer']) THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF v_excepcion AND v_motivo IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la excepción requiere motivo' USING ERRCODE = '22023';
  END IF;
  IF NOT v_excepcion AND v_firma IS NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: firma requerida' USING ERRCODE = '22023';
  END IF;

  v_clave := 'carga|' || p_ruta_id || '|' || CASE WHEN v_excepcion THEN 'exc' ELSE 'firma' END;
  v_prev := stock_op_replay(p_operacion_id, 'carga_ruta', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF fin_jwt_role() = 'authenticated' AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;
  IF v_ruta.carga_confirmada_at IS NOT NULL THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % ya tiene carga confirmada', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  IF v_ruta.estatus <> 'Pendiente firma' THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % está en % (se requiere Pendiente firma)', v_ruta.folio, v_ruta.estatus USING ERRCODE = '22023';
  END IF;
  IF v_ruta.carga_real IS NULL OR jsonb_typeof(v_ruta.carga_real) <> 'object'
     OR NOT EXISTS (SELECT 1 FROM jsonb_each_text(v_ruta.carga_real) WHERE COALESCE(value, '0') ~ '^[0-9]+$' AND value::INTEGER > 0) THEN
    RAISE EXCEPTION 'confirmar_carga_ruta: la ruta % no tiene carga real registrada', v_ruta.folio USING ERRCODE = '22023';
  END IF;

  -- La fila de operación va antes del kardex (FK inventario_mov.operacion_id); el
  -- resultado se completa al final. Si algo falla, todo se revierte junto.
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, resultado)
  VALUES (p_operacion_id, 'carga_ruta', v_clave, v_actor_id, v_etiqueta, p_ruta_id, '{}'::jsonb);

  -- Bloquear TODOS los cuartos en orden de id antes de asignar (determinista, sin deadlock).
  PERFORM 1 FROM cuartos_frios ORDER BY id FOR UPDATE;

  FOR v_sku, v_qty IN SELECT key, value FROM jsonb_each_text(v_ruta.carga_real) ORDER BY key LOOP
    IF v_qty IS NULL OR v_qty !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: cantidad inválida para %', v_sku USING ERRCODE = '22023';
    END IF;
    v_restante := v_qty::INTEGER;
    IF v_restante = 0 THEN CONTINUE; END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = v_sku) THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
    END IF;
    v_max := COALESCE((v_ruta.carga_autorizada ->> v_sku)::NUMERIC, 0) + COALESCE((v_ruta.extra_autorizado ->> v_sku)::NUMERIC, 0);
    IF v_restante > v_max THEN
      RAISE EXCEPTION 'confirmar_carga_ruta: % (%) supera lo autorizado (%)', v_sku, v_restante, v_max USING ERRCODE = '22023';
    END IF;
    FOR v_cf IN SELECT id, COALESCE((stock ->> v_sku)::INTEGER, 0) AS disp FROM cuartos_frios ORDER BY id LOOP
      EXIT WHEN v_restante <= 0;
      v_disp := v_cf.disp;
      IF v_disp <= 0 THEN CONTINUE; END IF;
      v_tomar := LEAST(v_disp, v_restante);
      PERFORM stock_mov_cuarto(v_cf.id, v_sku, -v_tomar, 'Salida', 'Carga ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text) || CASE WHEN v_excepcion THEN ' (sin firma)' ELSE '' END,
                               'Ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text), 'carga_ruta/' || COALESCE(v_ruta.folio, p_ruta_id::text), v_etiqueta, p_ruta_id, p_operacion_id);
      v_asig := v_asig || jsonb_build_object('cuarto_id', v_cf.id, 'sku', v_sku, 'cantidad', v_tomar);
      v_restante := v_restante - v_tomar;
    END LOOP;
    IF v_restante > 0 THEN
      RAISE EXCEPTION 'Inventario insuficiente para cargar % de % (faltan %)', v_qty, v_sku, v_restante;
    END IF;
  END LOOP;

  UPDATE rutas
     SET carga_confirmada_at    = now(),
         carga_confirmada_por   = v_actor_id,
         estatus                = 'Cargada',
         firma_carga            = CASE WHEN v_excepcion THEN NULL ELSE v_firma END,
         firma_excepcion        = v_excepcion,
         firma_excepcion_motivo = CASE WHEN v_excepcion THEN v_motivo ELSE NULL END
   WHERE id = p_ruta_id;

  v_res := jsonb_build_object('ruta_id', p_ruta_id, 'folio', v_ruta.folio, 'estatus', 'Cargada', 'excepcion', v_excepcion,
                              'carga', v_ruta.carga_real, 'asignacion', v_asig, 'actor', v_etiqueta, 'actor_id', v_actor_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION confirmar_carga_ruta(UUID, BIGINT, TEXT, BOOLEAN, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION confirmar_carga_ruta(UUID, BIGINT, TEXT, BOOLEAN, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 5. registrar_no_entrega — devolución de la orden + 'No entregada'
-- ═══════════════════════════════════════════════════════════════
-- Quién: Chofer activo dueño de la ruta de la orden, o Admin. Cantidades =
-- orden_lineas completas (no existe entrega parcial en el modelo: las líneas
-- son inmutables desde que la orden deja Creada). Destino = primer cuarto por
-- id (igual que hoy). Ancla: ordenes.estatus.
CREATE OR REPLACE FUNCTION registrar_no_entrega(p_operacion_id UUID, p_orden_id BIGINT, p_motivo TEXT, p_reagendar BOOLEAN DEFAULT false) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol      TEXT := fin_mi_rol_activo();
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_ord      ordenes%ROWTYPE;
  v_ruta     rutas%ROWTYPE;
  v_prev     JSONB;
  v_clave    TEXT;
  v_cuarto   TEXT;
  v_l        RECORD;
  v_dev      JSONB := '[]'::jsonb;
  v_res      JSONB;
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_no_entrega: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_orden_id IS NULL THEN
    RAISE EXCEPTION 'registrar_no_entrega: orden requerida' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'registrar_no_entrega: motivo requerido' USING ERRCODE = '22023';
  END IF;

  v_clave := 'noentrega|' || p_orden_id;
  v_prev := stock_op_replay(p_operacion_id, 'no_entrega', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_ord FROM ordenes WHERE id = p_orden_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_no_entrega: orden no encontrada: %', p_orden_id USING ERRCODE = '22023';
  END IF;
  IF v_ord.estatus = 'No entregada' THEN
    RAISE EXCEPTION 'registrar_no_entrega: la orden % ya está No entregada', v_ord.folio USING ERRCODE = '22023';
  END IF;
  IF v_ord.estatus NOT IN ('Asignada', 'En ruta') THEN
    RAISE EXCEPTION 'registrar_no_entrega: no se puede marcar desde %', v_ord.estatus USING ERRCODE = '22023';
  END IF;
  IF v_ord.ruta_id IS NULL THEN
    RAISE EXCEPTION 'registrar_no_entrega: la orden % no está en una ruta', v_ord.folio USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_ruta FROM rutas WHERE id = v_ord.ruta_id;
  IF fin_jwt_role() = 'authenticated' AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'registrar_no_entrega: la ruta de la orden no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  SELECT id INTO v_cuarto FROM cuartos_frios ORDER BY id LIMIT 1;
  IF v_cuarto IS NULL THEN
    RAISE EXCEPTION 'registrar_no_entrega: no hay cuartos fríos' USING ERRCODE = '22023';
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, orden_id, resultado)
  VALUES (p_operacion_id, 'no_entrega', v_clave, v_actor_id, v_etiqueta, v_ord.ruta_id, p_orden_id, '{}'::jsonb);
  FOR v_l IN SELECT sku, SUM(cantidad)::INTEGER AS cantidad FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku ORDER BY sku LOOP
    IF v_l.cantidad IS NULL OR v_l.cantidad <= 0 THEN CONTINUE; END IF;
    PERFORM stock_mov_cuarto(v_cuarto, v_l.sku, v_l.cantidad, 'Devolución no entregada', 'No entregada ' || COALESCE(v_ord.folio, p_orden_id::text), NULL,
                             'no_entrega/' || COALESCE(v_ord.folio, p_orden_id::text), v_etiqueta, v_ord.ruta_id, p_operacion_id);
    v_dev := v_dev || jsonb_build_object('cuarto_id', v_cuarto, 'sku', v_l.sku, 'cantidad', v_l.cantidad);
  END LOOP;

  UPDATE ordenes
     SET estatus = 'No entregada', motivo_no_entrega = v_motivo, fecha_no_entrega = now(), reagendada = COALESCE(p_reagendar, false)
   WHERE id = p_orden_id;

  v_res := jsonb_build_object('orden_id', p_orden_id, 'folio', v_ord.folio, 'ruta_id', v_ord.ruta_id, 'estatus', 'No entregada',
                              'reagendada', COALESCE(p_reagendar, false), 'devuelto', v_dev, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION registrar_no_entrega(UUID, BIGINT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_no_entrega(UUID, BIGINT, TEXT, BOOLEAN) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 6. salida_cuarto_manual — salida manual de Producción / Admin
-- ═══════════════════════════════════════════════════════════════
-- La operación ES una salida (cantidad > 0). El motivo es obligatorio y no
-- puede ser una carga de ruta: eso lo registra confirmar_carga_ruta.
CREATE OR REPLACE FUNCTION salida_cuarto_manual(p_operacion_id UUID, p_cuarto_id TEXT, p_sku TEXT, p_cantidad INTEGER, p_motivo TEXT) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
  v_clave := 'salida|' || p_cuarto_id || '|' || p_sku || '|' || p_cantidad || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'salida_manual', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'salida_manual', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  v_nuevo := stock_mov_cuarto(p_cuarto_id, p_sku, -p_cantidad, 'Salida', v_motivo, NULL, 'salida_manual/' || p_cuarto_id, v_etiqueta, NULL, p_operacion_id);
  v_res := jsonb_build_object('cuarto_id', p_cuarto_id, 'sku', p_sku, 'cantidad', p_cantidad, 'motivo', v_motivo, 'stock', v_nuevo, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION salida_cuarto_manual(UUID, TEXT, TEXT, INTEGER, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION salida_cuarto_manual(UUID, TEXT, TEXT, INTEGER, TEXT) TO authenticated, service_role;

-- ═══════════════════════════════════════════════════════════════
-- 7. traspaso_cuartos — origen − / destino + bajo una sola operación
-- ═══════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION traspaso_cuartos(p_operacion_id UUID, p_origen TEXT, p_destino TEXT, p_sku TEXT, p_cantidad INTEGER) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_prev     JSONB;
  v_clave    TEXT;
  v_so       INTEGER;
  v_sd       INTEGER;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'traspaso_cuartos: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_origen IS NULL OR p_destino IS NULL OR p_sku IS NULL THEN
    RAISE EXCEPTION 'traspaso_cuartos: origen, destino y sku son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_origen = p_destino THEN
    RAISE EXCEPTION 'traspaso_cuartos: origen y destino deben ser distintos' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'traspaso_cuartos: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = p_origen) OR NOT EXISTS (SELECT 1 FROM cuartos_frios WHERE id = p_destino) THEN
    RAISE EXCEPTION 'traspaso_cuartos: cuarto frío no encontrado' USING ERRCODE = '22023';
  END IF;
  v_clave := 'traspaso|' || p_origen || '|' || p_destino || '|' || p_sku || '|' || p_cantidad;
  v_prev := stock_op_replay(p_operacion_id, 'traspaso', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'traspaso', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);
  -- Bloquear ambos cuartos en orden de id (sin deadlock entre traspasos cruzados).
  PERFORM 1 FROM cuartos_frios WHERE id IN (p_origen, p_destino) ORDER BY id FOR UPDATE;
  v_so := stock_mov_cuarto(p_origen,  p_sku, -p_cantidad, 'Traspaso salida',  p_origen || ' → ' || p_destino, p_destino, 'traspaso/' || p_origen || '>' || p_destino, v_etiqueta, NULL, p_operacion_id);
  v_sd := stock_mov_cuarto(p_destino, p_sku,  p_cantidad, 'Traspaso entrada', p_origen || ' → ' || p_destino, p_destino, 'traspaso/' || p_origen || '>' || p_destino, v_etiqueta, NULL, p_operacion_id);
  v_res := jsonb_build_object('origen', p_origen, 'destino', p_destino, 'sku', p_sku, 'cantidad', p_cantidad, 'stock_origen', v_so, 'stock_destino', v_sd, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION traspaso_cuartos(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION traspaso_cuartos(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;
