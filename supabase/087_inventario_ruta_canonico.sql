-- 087_inventario_ruta_canonico.sql — inventario canónico de ruta.
--
-- Invariante: lo que sale de un cuarto frío por confirmar_carga_ruta es
-- inventario del CAMIÓN hasta que se ENTREGA, se declara MERMA de ruta o se
-- DEVUELVE a un cuarto. Por ruta y SKU:
--   CARGADO  = kardex estructurado Salida 'carga_ruta/…' (operación carga_ruta)
--   ENTREGADO = orden_lineas de órdenes de la ruta Entregada/Facturada
--   MERMA    = mermas Activas de la ruta
--   DEVUELTO = kardex estructurado Entrada 'devolucion_ruta/…' (operación cierre_ruta)
--   RESTANTE = CARGADO − ENTREGADO − MERMA − DEVUELTO ≥ 0; = 0 en ruta Cerrada.
--
-- Cambios (con 0 rutas no terminales en producción: sin reconciliación
-- histórica; las rutas terminales no se tocan):
--   1. balance_ruta_interno / calcular_balance_ruta: balance canónico solo de
--      fuentes durables; falla cerrado ante SKU inexistente, SKU no cargado,
--      sobreconsumo, carga confirmada sin carga estructurada, kardex ambiguo o
--      efectos de la semántica anterior (devolución de no-entrega a cuarto,
--      merma de ruta con efectos de cuarto, devolución sin operación).
--   2. registrar_merma (ruta): sin cuartos ni mermas_efectos; kardex 'Merma'
--      con cuarto_id NULL y ruta_id; tope = balance del camión; solo con la
--      ruta Cargada / En progreso. Merma de cuarto/producción: igual que 072.
--   3. registrar_mermas_ruta(p_operacion_id, …): lote atómico e idempotente
--      por operación (stock_operaciones 'merma_ruta'); permite un segundo lote
--      (faltante del conteo). La versión de 2 parámetros queda como legacy.
--   4. revertir_merma (ruta): cero efectos es válido; no suma a cuartos; kardex
--      de reverso con ruta_id; rechazado si la ruta ya cerró.
--   5. registrar_no_entrega: ya no toca cuartos; el producto sigue en el camión.
--   6. finalizar_inventario_ruta(p_operacion_id, p_ruta_id, p_conteo): exige
--      el cierre financiero (086) y ninguna orden pendiente, valida el conteo
--      físico contra el balance (faltante/sobrante → rechazo con detalle),
--      devuelve a los cuartos de origen de la carga, escribe rutas.devolucion,
--      cierra la ruta y verifica balance = 0. Idempotente (stock_operaciones
--      'cierre_ruta').
--   7. app.cierre_ctx: el guard 078 exige la marca para En progreso → Cerrada
--      del Chofer; rutas_guard_inventario (todos los roles con JWT): una ruta
--      cargada no se cierra ni se cancela por UPDATE, rutas.devolucion y
--      carga_confirmada_at no se reescriben por REST.
--   8. Se retira cerrar_ruta_atomic (devolución arbitraria de Admin).
--
-- No cambia: 085 (carga por contrato, RPC genérico solo Admin), 086 (cierre
-- financiero), merma de cuarto/producción (072), salida manual y traspaso.

-- ═══ 1. Tipos de operación ═══
ALTER TABLE stock_operaciones DROP CONSTRAINT IF EXISTS stock_operaciones_tipo_check;
ALTER TABLE stock_operaciones ADD CONSTRAINT stock_operaciones_tipo_check
  CHECK (tipo IN ('carga_ruta', 'no_entrega', 'salida_manual', 'traspaso', 'merma_ruta', 'cierre_ruta'));

-- ═══ 2. Balance canónico ═══
CREATE OR REPLACE FUNCTION balance_ruta_interno(p_ruta_id BIGINT)
RETURNS TABLE (sku TEXT, cargado INTEGER, entregado INTEGER, merma INTEGER, devuelto INTEGER, restante INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_ruta   rutas%ROWTYPE;
  v_n      INTEGER;
  v_op     stock_operaciones%ROWTYPE;
  v_bad    TEXT;
  r        RECORD;
BEGIN
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'balance_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;

  -- Carga estructurada: exactamente una operación carga_ruta si la ruta tiene
  -- carga confirmada, y su kardex coincide con la asignación registrada.
  SELECT count(*) INTO v_n FROM stock_operaciones so WHERE so.ruta_id = p_ruta_id AND so.tipo = 'carga_ruta';
  IF v_n > 1 THEN
    RAISE EXCEPTION 'balance_ruta: la ruta % tiene % cargas registradas (ambiguo)', v_ruta.folio, v_n;
  END IF;
  IF v_ruta.carga_confirmada_at IS NOT NULL AND v_n = 0 THEN
    RAISE EXCEPTION 'balance_ruta: la ruta % tiene carga confirmada sin carga estructurada (legacy): no se calcula balance', v_ruta.folio;
  END IF;
  IF v_n = 1 THEN
    SELECT * INTO v_op FROM stock_operaciones so WHERE so.ruta_id = p_ruta_id AND so.tipo = 'carga_ruta';
    IF EXISTS (SELECT 1 FROM inventario_mov i WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'carga_ruta/%'
                AND (i.operacion_id IS DISTINCT FROM v_op.operacion_id OR i.cuarto_id IS NULL OR i.tipo <> 'Salida' OR i.cantidad IS NULL OR i.cantidad <= 0)) THEN
      RAISE EXCEPTION 'balance_ruta: kardex de carga ambiguo o malformado en la ruta %', v_ruta.folio;
    END IF;
    IF EXISTS (
         (SELECT a ->> 'cuarto_id', a ->> 'sku', sum((a ->> 'cantidad')::INTEGER)::INTEGER
            FROM jsonb_array_elements(COALESCE(v_op.resultado -> 'asignacion', '[]'::jsonb)) a GROUP BY 1, 2)
         EXCEPT
         (SELECT i.cuarto_id, i.producto, sum(i.cantidad)::INTEGER FROM inventario_mov i WHERE i.operacion_id = v_op.operacion_id GROUP BY 1, 2))
       OR EXISTS (
         (SELECT i.cuarto_id, i.producto, sum(i.cantidad)::INTEGER FROM inventario_mov i WHERE i.operacion_id = v_op.operacion_id GROUP BY 1, 2)
         EXCEPT
         (SELECT a ->> 'cuarto_id', a ->> 'sku', sum((a ->> 'cantidad')::INTEGER)::INTEGER
            FROM jsonb_array_elements(COALESCE(v_op.resultado -> 'asignacion', '[]'::jsonb)) a GROUP BY 1, 2)) THEN
      RAISE EXCEPTION 'balance_ruta: el kardex de carga de la ruta % no coincide con su asignación registrada', v_ruta.folio;
    END IF;
  ELSIF EXISTS (SELECT 1 FROM inventario_mov i WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'carga_ruta/%') THEN
    RAISE EXCEPTION 'balance_ruta: kardex de carga sin operación en la ruta %', v_ruta.folio;
  END IF;

  -- Efectos de la semántica anterior a 087: ambiguos para el camión.
  IF EXISTS (SELECT 1 FROM inventario_mov i WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'no_entrega/%') THEN
    RAISE EXCEPTION 'balance_ruta: la ruta % tiene devoluciones de no-entrega a cuarto (anterior a 087)', v_ruta.folio;
  END IF;
  IF EXISTS (SELECT 1 FROM mermas m JOIN mermas_efectos e ON e.merma_id = m.id WHERE m.ruta_id = p_ruta_id) THEN
    RAISE EXCEPTION 'balance_ruta: la ruta % tiene mermas con efectos de cuarto (anterior a 087)', v_ruta.folio;
  END IF;
  IF EXISTS (SELECT 1 FROM inventario_mov i WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'devolucion_ruta/%'
              AND (i.tipo <> 'Entrada' OR i.cuarto_id IS NULL OR i.operacion_id IS NULL OR i.cantidad IS NULL OR i.cantidad <= 0)) THEN
    RAISE EXCEPTION 'balance_ruta: devolución de ruta sin operación o malformada en la ruta %', v_ruta.folio;
  END IF;
  IF EXISTS (SELECT 1 FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id
              WHERE o.ruta_id = p_ruta_id AND o.estatus IN ('Entregada', 'Facturada') AND (l.cantidad IS NULL OR l.cantidad < 0)) THEN
    RAISE EXCEPTION 'balance_ruta: línea entregada con cantidad inválida en la ruta %', v_ruta.folio;
  END IF;

  FOR r IN
    WITH c AS (SELECT i.producto AS s, sum(i.cantidad)::INTEGER AS q FROM inventario_mov i
                WHERE i.ruta_id = p_ruta_id AND i.referencia LIKE 'carga_ruta/%' GROUP BY 1),
         e AS (SELECT l.sku AS s, sum(l.cantidad)::INTEGER AS q FROM orden_lineas l JOIN ordenes o ON o.id = l.orden_id
                WHERE o.ruta_id = p_ruta_id AND o.estatus IN ('Entregada', 'Facturada') GROUP BY 1),
         m AS (SELECT mm.sku AS s, sum(mm.cantidad)::INTEGER AS q FROM mermas mm
                WHERE mm.ruta_id = p_ruta_id AND mm.estatus = 'Activa' GROUP BY 1),
         d AS (SELECT i.producto AS s, sum(i.cantidad)::INTEGER AS q FROM inventario_mov i
                WHERE i.ruta_id = p_ruta_id AND i.tipo = 'Entrada' AND i.referencia LIKE 'devolucion_ruta/%' GROUP BY 1),
         u AS (SELECT s FROM c UNION SELECT s FROM e UNION SELECT s FROM m UNION SELECT s FROM d)
    SELECT u.s, COALESCE(c.q, 0) AS qc, COALESCE(e.q, 0) AS qe, COALESCE(m.q, 0) AS qm, COALESCE(d.q, 0) AS qd,
           EXISTS (SELECT 1 FROM productos p WHERE p.sku = u.s) AS existe
      FROM u LEFT JOIN c ON c.s = u.s LEFT JOIN e ON e.s = u.s LEFT JOIN m ON m.s = u.s LEFT JOIN d ON d.s = u.s
     ORDER BY u.s
  LOOP
    IF NOT r.existe THEN
      RAISE EXCEPTION 'balance_ruta: SKU % de la ruta % no existe en el catálogo', r.s, v_ruta.folio;
    END IF;
    IF r.qc = 0 AND (r.qe + r.qm + r.qd) > 0 THEN
      RAISE EXCEPTION 'balance_ruta: SKU % aparece entregado/merma/devuelto en la ruta % pero no fue cargado', r.s, v_ruta.folio;
    END IF;
    IF r.qe + r.qm + r.qd > r.qc THEN
      RAISE EXCEPTION 'balance_ruta: SKU % en la ruta %: entregado % + merma % + devuelto % supera lo cargado %', r.s, v_ruta.folio, r.qe, r.qm, r.qd, r.qc;
    END IF;
    sku := r.s; cargado := r.qc; entregado := r.qe; merma := r.qm; devuelto := r.qd; restante := r.qc - r.qe - r.qm - r.qd;
    RETURN NEXT;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION balance_ruta_interno(BIGINT) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION calcular_balance_ruta(p_ruta_id BIGINT)
RETURNS TABLE (sku TEXT, cargado INTEGER, entregado INTEGER, merma INTEGER, devuelto INTEGER, restante INTEGER)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_chofer BIGINT;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'calcular_balance_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  SELECT chofer_id INTO v_chofer FROM rutas WHERE id = p_ruta_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'calcular_balance_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF fin_jwt_role() = 'authenticated' AND fin_mi_rol_activo() = 'Chofer' AND v_chofer IS DISTINCT FROM erp_usuario_id() THEN
    RAISE EXCEPTION 'calcular_balance_ruta: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY SELECT b.sku, b.cargado, b.entregado, b.merma, b.devuelto, b.restante FROM balance_ruta_interno(p_ruta_id) b;
END $$;
REVOKE ALL ON FUNCTION calcular_balance_ruta(BIGINT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION calcular_balance_ruta(BIGINT) TO authenticated, service_role;

-- ═══ 3. Merma: rama de ruta sobre el inventario del camión ═══
CREATE OR REPLACE FUNCTION registrar_merma(
  p_sku          TEXT,
  p_cantidad     INTEGER,
  p_causa        TEXT    DEFAULT NULL,
  p_origen       TEXT    DEFAULT NULL,
  p_foto         TEXT    DEFAULT NULL,
  p_ruta_id      BIGINT  DEFAULT NULL,
  p_afecta_stock BOOLEAN DEFAULT true
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
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
END $$;

-- ═══ 4. Lote de mermas de ruta con operación ═══
CREATE OR REPLACE FUNCTION registrar_mermas_ruta(p_operacion_id UUID, p_ruta_id BIGINT, p_mermas JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol      TEXT := fin_mi_rol_activo();
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_ruta     rutas%ROWTYPE;
  v_norm     JSONB;
  v_clave    TEXT;
  v_prev     JSONB;
  v_ant      stock_operaciones%ROWTYPE;
  v_m        JSONB;
  v_cant     NUMERIC;
  v_out      JSONB := '[]'::jsonb;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF p_mermas IS NULL OR jsonb_typeof(p_mermas) <> 'array' OR jsonb_array_length(p_mermas) = 0 THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: p_mermas debe ser un array no vacío' USING ERRCODE = '22023';
  END IF;

  -- Clave lógica del lote: SKU, cantidad, causa y huella de la foto, sin orden.
  SELECT jsonb_agg(x ORDER BY x::text) INTO v_norm FROM (
    SELECT jsonb_build_object('sku', btrim(COALESCE(m ->> 'sku', '')), 'cant', m ->> 'cant',
                              'causa', btrim(COALESCE(m ->> 'causa', '')), 'foto', md5(COALESCE(m ->> 'foto', ''))) AS x
      FROM jsonb_array_elements(p_mermas) m) s;
  v_clave := 'mermas|' || p_ruta_id || '|' || md5(v_norm::text);
  v_prev := stock_op_replay(p_operacion_id, 'merma_ruta', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  -- Serializa lotes, mermas sueltas y el cierre de la misma ruta.
  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF fin_jwt_role() = 'authenticated' AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'registrar_mermas_ruta: la ruta no pertenece al chofer' USING ERRCODE = '42501';
  END IF;

  -- Ancla de negocio: el mismo lote ya registrado en esta ruta con otra
  -- operación (UUID perdido en el cliente) → resultado almacenado.
  SELECT * INTO v_ant FROM stock_operaciones WHERE ruta_id = p_ruta_id AND tipo = 'merma_ruta' AND clave = v_clave ORDER BY created_at LIMIT 1;
  IF FOUND THEN
    RETURN v_ant.resultado || jsonb_build_object('replay', true, 'operacion_original', v_ant.operacion_id);
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, resultado)
  VALUES (p_operacion_id, 'merma_ruta', v_clave, v_actor_id, v_etiqueta, p_ruta_id, '{}'::jsonb);

  FOR v_m IN SELECT * FROM jsonb_array_elements(p_mermas) LOOP
    v_cant := NULLIF(v_m ->> 'cant', '')::NUMERIC;
    IF v_cant IS NULL OR v_cant <> trunc(v_cant) THEN
      RAISE EXCEPTION 'registrar_mermas_ruta: cantidad inválida para %', v_m ->> 'sku' USING ERRCODE = '22023';
    END IF;
    -- registrar_merma aplica el tope del balance del camión, en orden: cada
    -- merma del lote ve las anteriores (misma transacción).
    v_res := registrar_merma(v_m ->> 'sku', v_cant::INTEGER, v_m ->> 'causa', NULL, v_m ->> 'foto', p_ruta_id, true);
    v_out := v_out || jsonb_build_array(v_res);
  END LOOP;

  v_res := jsonb_build_object('ruta_id', p_ruta_id, 'folio', v_ruta.folio, 'skipped', false, 'registradas', v_out,
                              'operacion_id', p_operacion_id, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION registrar_mermas_ruta(UUID, BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION registrar_mermas_ruta(UUID, BIGINT, JSONB) TO authenticated, service_role;

-- ═══ 5. Reverso de merma: rama de ruta ═══
CREATE OR REPLACE FUNCTION revertir_merma(p_merma_id BIGINT, p_motivo TEXT DEFAULT NULL)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_m        RECORD;
  v_e        RECORD;
  v_n        INTEGER;
  v_cur      INTEGER;
  v_inv_id   BIGINT;
  v_del      INTEGER := 0;
  v_etiqueta TEXT;
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_ruta_est TEXT;  -- 087
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_merma: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_etiqueta := erp_actor_etiqueta();

  -- El lock de la fila serializa reversos concurrentes: el segundo espera y
  -- después ve estatus = 'Revertida'.
  SELECT * INTO v_m FROM mermas WHERE id = p_merma_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_merma: merma no encontrada: %', p_merma_id USING ERRCODE = 'P0002';
  END IF;
  IF v_m.estatus = 'Revertida' THEN
    RAISE EXCEPTION 'revertir_merma: la merma % ya fue revertida', p_merma_id USING ERRCODE = '55000';
  END IF;

  SELECT count(*) INTO v_n FROM mermas_efectos WHERE merma_id = p_merma_id;
  IF v_m.ruta_id IS NOT NULL THEN
    -- 087: merma de ruta (inventario del camión): cero efectos de cuarto es lo
    -- correcto. Solo con la ruta abierta; lo revertido vuelve al balance del
    -- camión, nunca a un cuarto automáticamente.
    SELECT estatus INTO v_ruta_est FROM rutas WHERE id = v_m.ruta_id FOR UPDATE;
    IF v_ruta_est IS NULL OR v_ruta_est IN ('Cerrada', 'Cancelada', 'Completada') THEN
      RAISE EXCEPTION 'revertir_merma: la ruta de la merma % ya está % (inventario del camión cerrado)', p_merma_id, COALESCE(v_ruta_est, 'eliminada')
        USING ERRCODE = '55000';
    END IF;
    IF v_n > 0 THEN
      RAISE EXCEPTION 'revertir_merma: la merma de ruta % tiene efectos de cuarto (anterior a 087); no se revierte automáticamente', p_merma_id
        USING ERRCODE = '55000';
    END IF;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, ruta_id)
    VALUES ('Reverso merma', v_m.sku, v_m.cantidad, 'Reverso merma #' || p_merma_id, v_etiqueta, 'MERMA-' || p_merma_id, v_m.ruta_id);
  ELSIF v_m.afecta_stock AND v_n = 0 THEN
    RAISE EXCEPTION 'revertir_merma: la merma % es legacy (sin efectos registrados); no se revierte automáticamente', p_merma_id
      USING ERRCODE = '55000';
  END IF;

  FOR v_e IN SELECT * FROM mermas_efectos WHERE merma_id = p_merma_id ORDER BY cuarto_id, id LOOP
    SELECT COALESCE((stock ->> v_m.sku)::INTEGER, 0) INTO v_cur FROM cuartos_frios WHERE id = v_e.cuarto_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'revertir_merma: el cuarto % ya no existe', v_e.cuarto_id USING ERRCODE = '55000';
    END IF;
    UPDATE cuartos_frios
       SET stock = jsonb_set(COALESCE(stock, '{}'::jsonb), ARRAY[v_m.sku], to_jsonb(v_cur + v_e.cantidad)),
           updated_at = now()
     WHERE id = v_e.cuarto_id;
    INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia)
    VALUES ('Reverso merma', v_m.sku, v_e.cantidad, 'Reverso merma #' || p_merma_id, v_etiqueta, 'MERMA-' || p_merma_id)
    RETURNING id INTO v_inv_id;
    UPDATE mermas_efectos SET reverso_inv_mov_id = v_inv_id WHERE id = v_e.id;
  END LOOP;

  -- Egreso contable: exactamente el ligado por id. Nunca por texto.
  IF v_m.mov_contable_id IS NOT NULL THEN
    DELETE FROM movimientos_contables
     WHERE id = v_m.mov_contable_id AND categoria = 'Mermas' AND tipo = 'Egreso';
    GET DIAGNOSTICS v_del = ROW_COUNT;
  END IF;

  UPDATE mermas
     SET estatus = 'Revertida', revertida_at = now(), revertida_por = erp_usuario_id(), motivo_reverso = v_motivo
   WHERE id = p_merma_id;

  INSERT INTO auditoria (accion, modulo, detalle, usuario, created_at)
  VALUES ('Revertir', 'Mermas',
    format('Merma #%s — %s×%s | efectos=%s | egreso_id=%s borrado=%s | motivo: %s',
      p_merma_id, v_m.cantidad, v_m.sku, v_n, COALESCE(v_m.mov_contable_id::text, '—'), (v_del > 0), COALESCE(v_motivo, '—')),
    v_etiqueta, now());

  -- La foto se conserva como evidencia (no se borra de Storage).
  RETURN jsonb_build_object(
    'id', p_merma_id, 'estatus', 'Revertida', 'sku', v_m.sku, 'cantidad', v_m.cantidad,
    'efectos_revertidos', v_n, 'mov_contable_id', v_m.mov_contable_id, 'egreso_borrado', (v_del > 0),
    'actor', v_etiqueta);
END $$;

-- ═══ 6. No-entrega sin cuarto frío ═══
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
  v_camion   JSONB := '[]'::jsonb;  -- 087: líneas que siguen en el camión
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

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, orden_id, resultado)
  VALUES (p_operacion_id, 'no_entrega', v_clave, v_actor_id, v_etiqueta, v_ord.ruta_id, p_orden_id, '{}'::jsonb);
  -- 087: el producto de una orden no entregada se queda en el camión: sigue
  -- en el balance de la ruta hasta finalizar_inventario_ruta. Sin cuarto frío,
  -- sin kardex de cuarto. La operación sigue siendo idempotente (stock_operaciones).
  FOR v_l IN SELECT sku, SUM(cantidad)::INTEGER AS cantidad FROM orden_lineas WHERE orden_id = p_orden_id GROUP BY sku ORDER BY sku LOOP
    IF v_l.cantidad IS NULL OR v_l.cantidad <= 0 THEN CONTINUE; END IF;
    v_camion := v_camion || jsonb_build_object('sku', v_l.sku, 'cantidad', v_l.cantidad);
  END LOOP;

  UPDATE ordenes
     SET estatus = 'No entregada', motivo_no_entrega = v_motivo, fecha_no_entrega = now(), reagendada = COALESCE(p_reagendar, false)
   WHERE id = p_orden_id;

  v_res := jsonb_build_object('orden_id', p_orden_id, 'folio', v_ord.folio, 'ruta_id', v_ord.ruta_id, 'estatus', 'No entregada',
                              'reagendada', COALESCE(p_reagendar, false), 'devuelto', '[]'::jsonb, 'en_camion', v_camion, 'movimiento_cuarto', false, 'actor', v_etiqueta, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;

-- ═══ 7. Guard 078: cierre del Chofer solo por contrato ═══
CREATE OR REPLACE FUNCTION rutas_guard_chofer() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol        TEXT := erp_rol_activo();
  v_yo         BIGINT := erp_usuario_id();   -- carga_confirmada_por se compara como texto: bigint en prod, text en esquemas locales (041)
  v_cambios    TEXT[];
  v_permitidas TEXT[];
  v_firma      TEXT[] := ARRAY['estatus', 'carga_confirmada_at', 'carga_confirmada_por',
                               'firma_carga', 'firma_excepcion', 'firma_excepcion_motivo'];
  v_sku        TEXT;
  v_qty        TEXT;
  v_max        NUMERIC;
BEGIN
  -- Solo restringe al actor Chofer activo. Admin (admin_all), service_role y
  -- SQL sin JWT siguen igual; Ventas/Producción no tienen policy de UPDATE.
  IF v_rol IS DISTINCT FROM 'Chofer' THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(n.key ORDER BY n.key) INTO v_cambios
    FROM jsonb_each(to_jsonb(NEW)) n
    JOIN jsonb_each(to_jsonb(OLD)) o ON o.key = n.key
   WHERE n.value IS DISTINCT FROM o.value
     AND n.key <> 'updated_at';            -- la pone trg_rutas_upd
  IF v_cambios IS NULL THEN
    RETURN NEW;                            -- sin cambios: inofensivo
  END IF;

  IF OLD.estatus = 'Programada' AND NEW.estatus = 'Pendiente firma' THEN
    v_permitidas := ARRAY['estatus', 'carga_real', 'carga_solicitada_at'];
    IF OLD.carga_confirmada_at IS NOT NULL THEN
      RAISE EXCEPTION 'rutas: la ruta % ya tiene carga confirmada', OLD.id USING ERRCODE = '42501';
    END IF;
  ELSIF OLD.estatus = 'Pendiente firma' AND NEW.estatus = 'Cargada' THEN
    -- 085: la confirmación de carga SOLO ocurre dentro de confirmar_carga_ruta
    -- (firma + descuento + kardex en una transacción). Un UPDATE directo del
    -- Chofer por REST no lleva la marca app.carga_ctx y se rechaza: no se puede
    -- fingir una carga confirmada sin descontar stock.
    v_permitidas := v_firma;
    IF COALESCE(current_setting('app.carga_ctx', true), '') IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'rutas: la carga se confirma con confirmar_carga_ruta, no por UPDATE directo' USING ERRCODE = '42501';
    END IF;
    IF OLD.carga_confirmada_at IS NOT NULL OR NEW.carga_confirmada_at IS NULL
       OR NEW.carga_confirmada_por::TEXT IS DISTINCT FROM v_yo::TEXT THEN
      RAISE EXCEPTION 'rutas: firma de carga inválida para la ruta %', OLD.id USING ERRCODE = '42501';
    END IF;
  -- 085: la transición de compensación Cargada → Pendiente firma desaparece:
  -- el contrato es atómico y ningún flujo desplegado la necesita.
  ELSIF OLD.estatus = 'Cargada' AND NEW.estatus = 'En progreso' THEN
    v_permitidas := ARRAY['estatus'];
  ELSIF OLD.estatus = 'En progreso' AND NEW.estatus = 'Cerrada' THEN
    -- 087: el cierre de ruta SOLO ocurre dentro de finalizar_inventario_ruta
    -- (balance canónico + devolución + cierre en una transacción). Un UPDATE
    -- directo del Chofer por REST no lleva la marca app.cierre_ctx: 42501.
    IF COALESCE(current_setting('app.cierre_ctx', true), '') IS DISTINCT FROM OLD.id::text THEN
      RAISE EXCEPTION 'rutas: la ruta se cierra con finalizar_inventario_ruta, no por UPDATE directo' USING ERRCODE = '42501';
    END IF;
    v_permitidas := ARRAY['estatus', 'fecha_fin', 'cierre_at', 'devolucion'];
  ELSE
    RAISE EXCEPTION 'rutas: transición % → % no permitida para Chofer', OLD.estatus, NEW.estatus
      USING ERRCODE = '42501';
  END IF;

  IF NOT (v_cambios <@ v_permitidas) THEN
    RAISE EXCEPTION 'rutas: Chofer no puede modificar % (en % → % solo %)',
      array_to_string(v_cambios, ', '), OLD.estatus, NEW.estatus, array_to_string(v_permitidas, ', ')
      USING ERRCODE = '42501';
  END IF;

  -- La carga real nunca supera lo autorizado por Admin (misma regla que el
  -- cliente, ahora en el servidor). Solo cuenta lo autorizado ANTES del UPDATE.
  IF 'carga_real' = ANY (v_cambios) THEN
    IF NEW.carga_real IS NULL OR jsonb_typeof(NEW.carga_real) <> 'object' THEN
      RAISE EXCEPTION 'rutas: carga_real inválida' USING ERRCODE = '42501';
    END IF;
    FOR v_sku, v_qty IN SELECT key, value FROM jsonb_each_text(NEW.carga_real) LOOP
      IF v_qty IS NULL OR v_qty !~ '^[0-9]+(\.[0-9]+)?$' THEN
        RAISE EXCEPTION 'rutas: cantidad inválida para % en carga_real', v_sku USING ERRCODE = '42501';
      END IF;
      v_max := COALESCE((OLD.carga_autorizada ->> v_sku)::NUMERIC, 0)
             + COALESCE((OLD.extra_autorizado ->> v_sku)::NUMERIC, 0);
      IF v_qty::NUMERIC > v_max THEN
        RAISE EXCEPTION 'rutas: carga_real de % (%) supera lo autorizado (%)', v_sku, v_qty, v_max
          USING ERRCODE = '42501';
      END IF;
    END LOOP;
  END IF;

  RETURN NEW;
END $$;

-- ═══ 8. Guard de inventario de ruta (todos los roles con JWT) ═══
CREATE OR REPLACE FUNCTION rutas_guard_inventario() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_jwt TEXT := fin_jwt_role();
  v_ctx BOOLEAN;
BEGIN
  IF v_jwt IS NULL OR v_jwt = 'service_role' THEN
    RETURN NEW;
  END IF;
  v_ctx := COALESCE(current_setting('app.cierre_ctx', true), '') = OLD.id::text;
  IF NEW.devolucion IS DISTINCT FROM OLD.devolucion AND NOT v_ctx THEN
    RAISE EXCEPTION 'rutas: devolucion solo la escribe finalizar_inventario_ruta' USING ERRCODE = '42501';
  END IF;
  IF OLD.carga_confirmada_at IS NOT NULL AND NEW.carga_confirmada_at IS DISTINCT FROM OLD.carga_confirmada_at THEN
    RAISE EXCEPTION 'rutas: la confirmación de carga es inmutable' USING ERRCODE = '42501';
  END IF;
  IF OLD.carga_confirmada_at IS NOT NULL AND NEW.estatus IS DISTINCT FROM OLD.estatus THEN
    IF NEW.estatus = 'Cerrada' AND NOT v_ctx THEN
      RAISE EXCEPTION 'rutas: una ruta cargada se cierra con finalizar_inventario_ruta' USING ERRCODE = '42501';
    END IF;
    IF NEW.estatus = 'Cancelada' THEN
      RAISE EXCEPTION 'rutas: una ruta cargada no se cancela; su inventario se resuelve con finalizar_inventario_ruta' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION rutas_guard_inventario() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_rutas_guard_inventario ON rutas;
CREATE TRIGGER trg_rutas_guard_inventario BEFORE UPDATE ON rutas FOR EACH ROW EXECUTE FUNCTION rutas_guard_inventario();

-- ═══ 9. Finalización canónica del inventario de ruta ═══
CREATE OR REPLACE FUNCTION finalizar_inventario_ruta(p_operacion_id UUID, p_ruta_id BIGINT, p_conteo JSONB)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_rol      TEXT := fin_mi_rol_activo();
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_ruta     rutas%ROWTYPE;
  v_conteo   JSONB := '{}'::jsonb;
  v_k        TEXT;
  v_v        JSONB;
  v_q        INTEGER;
  v_clave    TEXT;
  v_prev     JSONB;
  v_ant      stock_operaciones%ROWTYPE;
  v_pend     TEXT;
  v_b        RECORD;
  v_bal      JSONB := '[]'::jsonb;
  v_gap      JSONB := '{}'::jsonb;
  v_sobre    JSONB := '{}'::jsonb;
  v_carga_op UUID;
  v_rooms    TEXT[];
  v_n        INTEGER;
  v_src      RECORD;
  v_resto    INTEGER;
  v_toma     INTEGER;
  v_asig     JSONB := '[]'::jsonb;
  v_ref      TEXT;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Chofer']) THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_ruta_id IS NULL THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: ruta requerida' USING ERRCODE = '22023';
  END IF;
  IF p_conteo IS NULL OR jsonb_typeof(p_conteo) <> 'object' THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: el conteo debe ser un objeto {sku: cantidad}' USING ERRCODE = '22023';
  END IF;

  -- Conteo físico normalizado: enteros ≥ 0 de SKUs existentes; los ceros se
  -- omiten (un SKU cargado que falta del conteo cuenta como 0).
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(p_conteo) LOOP
    IF jsonb_typeof(v_v) NOT IN ('number', 'string') OR (v_v #>> '{}') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'finalizar_inventario_ruta: cantidad inválida para %', v_k USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM productos WHERE sku = btrim(v_k)) THEN
      RAISE EXCEPTION 'finalizar_inventario_ruta: SKU no encontrado: %', v_k USING ERRCODE = '22023';
    END IF;
    v_q := (v_v #>> '{}')::INTEGER;
    IF v_q > 0 THEN
      v_conteo := v_conteo || jsonb_build_object(btrim(v_k), v_q + COALESCE((v_conteo ->> btrim(v_k))::INTEGER, 0));
    END IF;
  END LOOP;
  v_clave := 'cierre|' || p_ruta_id || '|' || md5(v_conteo::text);

  v_prev := stock_op_replay(p_operacion_id, 'cierre_ruta', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_ruta FROM rutas WHERE id = p_ruta_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: ruta no encontrada: %', p_ruta_id USING ERRCODE = '22023';
  END IF;
  IF fin_jwt_role() = 'authenticated' AND v_rol = 'Chofer' AND v_ruta.chofer_id IS DISTINCT FROM v_actor_id THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta no pertenece a este chofer' USING ERRCODE = '42501';
  END IF;

  -- Ya finalizada por otra operación: mismo conteo → resultado almacenado;
  -- otro conteo → rechazo. Nunca una segunda devolución.
  SELECT * INTO v_ant FROM stock_operaciones WHERE ruta_id = p_ruta_id AND tipo = 'cierre_ruta';
  IF FOUND THEN
    IF v_ant.clave = v_clave THEN
      RETURN v_ant.resultado || jsonb_build_object('replay', true, 'operacion_original', v_ant.operacion_id);
    END IF;
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % ya tiene inventario finalizado con otro conteo', v_ruta.folio USING ERRCODE = '22023';
  END IF;

  IF v_ruta.estatus <> 'En progreso' THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % está % (se requiere En progreso)', v_ruta.folio, v_ruta.estatus USING ERRCODE = '22023';
  END IF;
  IF v_ruta.carga_confirmada_at IS NULL THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % no tiene carga confirmada', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cierres_financieros_ruta WHERE ruta_id = p_ruta_id) THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % no tiene cierre financiero registrado', v_ruta.folio USING ERRCODE = '22023';
  END IF;
  SELECT string_agg(folio, ', ' ORDER BY id) INTO v_pend FROM ordenes WHERE ruta_id = p_ruta_id AND estatus IN ('Asignada', 'En ruta');
  IF v_pend IS NOT NULL THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % tiene órdenes pendientes: %', v_ruta.folio, v_pend USING ERRCODE = '22023';
  END IF;

  -- Balance canónico (falla cerrado) contra el conteo físico.
  FOR v_b IN SELECT * FROM balance_ruta_interno(p_ruta_id) LOOP
    v_bal := v_bal || to_jsonb(v_b);
    IF v_b.devuelto <> 0 THEN
      RAISE EXCEPTION 'finalizar_inventario_ruta: la ruta % ya tiene devoluciones registradas (ambiguo)', v_ruta.folio;
    END IF;
    v_q := COALESCE((v_conteo ->> v_b.sku)::INTEGER, 0);
    IF v_q > v_b.restante THEN
      v_sobre := v_sobre || jsonb_build_object(v_b.sku, v_q - v_b.restante);
    ELSIF v_q < v_b.restante THEN
      v_gap := v_gap || jsonb_build_object(v_b.sku, v_b.restante - v_q);
    END IF;
  END LOOP;
  FOR v_k IN SELECT key FROM jsonb_each(v_conteo) LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_bal) x WHERE x ->> 'sku' = v_k) THEN
      v_sobre := v_sobre || jsonb_build_object(v_k, (v_conteo ->> v_k)::INTEGER);
    END IF;
  END LOOP;
  IF v_sobre <> '{}'::jsonb THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: el conteo supera el inventario del camión: %', v_sobre
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('sobrante', v_sobre)::text;
  END IF;
  IF v_gap <> '{}'::jsonb THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: faltante sin merma registrada: %', v_gap
      USING ERRCODE = '22023', DETAIL = jsonb_build_object('faltante', v_gap)::text,
            HINT = 'Registra la merma del faltante (causa y foto) y vuelve a finalizar';
  END IF;

  -- La operación va antes del kardex (FK inventario_mov.operacion_id).
  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, ruta_id, resultado)
  VALUES (p_operacion_id, 'cierre_ruta', v_clave, v_actor_id, v_etiqueta, p_ruta_id, '{}'::jsonb);

  -- Devolución a los cuartos de origen de la carga de ESTA ruta: por SKU, en
  -- orden inverso de la carga FIFO (cuarto de id mayor primero), tope por
  -- cuarto = lo que salió de ese cuarto. Sin cuarto elegido por el cliente.
  SELECT operacion_id INTO v_carga_op FROM stock_operaciones WHERE ruta_id = p_ruta_id AND tipo = 'carga_ruta';
  SELECT array_agg(DISTINCT cuarto_id ORDER BY cuarto_id) INTO v_rooms FROM inventario_mov WHERE operacion_id = v_carga_op;
  PERFORM 1 FROM cuartos_frios WHERE id = ANY (COALESCE(v_rooms, ARRAY[]::TEXT[])) ORDER BY id FOR UPDATE;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n <> COALESCE(array_length(v_rooms, 1), 0) THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: un cuarto de origen de la carga de la ruta % ya no existe', v_ruta.folio;
  END IF;
  v_ref := 'devolucion_ruta/' || COALESCE(v_ruta.folio, p_ruta_id::text);
  FOR v_k, v_v IN SELECT key, value FROM jsonb_each(v_conteo) ORDER BY key LOOP
    v_resto := (v_v #>> '{}')::INTEGER;
    FOR v_src IN SELECT cuarto_id, sum(cantidad)::INTEGER AS q FROM inventario_mov
                  WHERE operacion_id = v_carga_op AND producto = v_k GROUP BY cuarto_id ORDER BY cuarto_id DESC LOOP
      EXIT WHEN v_resto <= 0;
      v_toma := LEAST(v_src.q, v_resto);
      PERFORM stock_mov_cuarto(v_src.cuarto_id, v_k, v_toma, 'Entrada', 'Devolución ruta ' || COALESCE(v_ruta.folio, p_ruta_id::text), NULL,
                               v_ref, v_etiqueta, p_ruta_id, p_operacion_id);
      v_asig := v_asig || jsonb_build_object('cuarto_id', v_src.cuarto_id, 'sku', v_k, 'cantidad', v_toma);
      v_resto := v_resto - v_toma;
    END LOOP;
    IF v_resto > 0 THEN
      RAISE EXCEPTION 'finalizar_inventario_ruta: no se pudo reconstruir el origen de % en la ruta %', v_k, v_ruta.folio;
    END IF;
  END LOOP;

  -- Cierre de la ruta: solo este contrato lleva la marca app.cierre_ctx.
  PERFORM set_config('app.cierre_ctx', p_ruta_id::text, true);
  UPDATE rutas
     SET estatus    = 'Cerrada',
         fecha_fin  = COALESCE(fecha_fin, fin_hoy()),
         cierre_at  = now(),
         devolucion = v_conteo
   WHERE id = p_ruta_id;
  PERFORM set_config('app.cierre_ctx', '', true);

  IF EXISTS (SELECT 1 FROM balance_ruta_interno(p_ruta_id) b WHERE b.restante <> 0) THEN
    RAISE EXCEPTION 'finalizar_inventario_ruta: el balance de la ruta % no quedó en cero', v_ruta.folio;
  END IF;

  v_res := jsonb_build_object('ruta_id', p_ruta_id, 'folio', v_ruta.folio, 'estatus', 'Cerrada', 'devolucion', v_conteo,
                              'asignacion', v_asig, 'balance', v_bal, 'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION finalizar_inventario_ruta(UUID, BIGINT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION finalizar_inventario_ruta(UUID, BIGINT, JSONB) TO authenticated, service_role;

-- ═══ 10. Se retira la devolución arbitraria de Admin ═══
DROP FUNCTION IF EXISTS cerrar_ruta_atomic(BIGINT, JSONB, TEXT, JSONB, NUMERIC, NUMERIC, TEXT);
