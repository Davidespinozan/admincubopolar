-- 115_preparacion_barra.sql — OP-01D: "Preparar desde barra" (modelo de barra
-- de septiembre 2026). Solo FUNCIONES: sin tablas, columnas ni restricciones.
--
-- Operación física vigente (dueño, OP-01C):
--   * La Máquina Barra produce barras de ~50 kg: 1 barra física = 1 unidad
--     (se registra con registrar_produccion, sin empaque).
--   * Una barra se vende completa ($120, sin bolsa) o se pica / tritura: 1
--     barra rinde ~2 bolsas (hay merma física de peso) y consume 2 empaques.
--   * Medio equivalente = 1 bolsa preparada ($60). No hay fracciones de barra:
--     todo el sistema usa cantidades enteras; preparar es siempre por barras
--     enteras y la segunda bolsa queda como existencia preparada real.
--   * La picada a veces se prepara por adelantado (3 barras → 6 bolsas): en ese
--     momento las barras dejan de existir y los empaques se consumen; vender
--     después esas bolsas NO vuelve a consumir barra ni empaque.
--   * El flujo de Transformaciones de agosto quedó SUPERSEDED: no se usa, no
--     se repara y no se reutiliza (registrar_transformacion sigue intacto).
--
-- Contratos nuevos:
--   1. registrar_preparacion_barra(operacion, barra, salida, cuarto, barras)
--      Admin / Producción. Atómico e idempotente (produccion.operacion_id
--      único, igual que registrar_produccion): en el MISMO cuarto, barra −N,
--      salida +2N, y −2N del empaque CONFIGURADO en la salida
--      (productos.empaque_sku; sin empaque configurado → rechazo). Costo del
--      empaque al promedio vigente, igual que una producción (costos_historial
--      'Producción'). Queda como fila de produccion tipo 'Preparacion' (folio
--      PB-###; input_sku = barra, input_kg = barras usadas, output_kg = bolsas).
--      Mismo orden de candados que registrar_produccion: empaque → cuarto.
--   2. revertir_preparacion_barra(operacion, preparacion, motivo)
--      Solo Admin. Atómico e idempotente (stock_operaciones tipo
--      'reverso_produccion', clave 'reverso_preparacion|<id>|<motivo>'): salida
--      −2N (si ya se vendió y no alcanza, falla TODO), barra +N, empaque +2N al
--      costo unitario histórico de ESA preparación (misma regla que 107),
--      costos_historial 'Reverso producción'. Una sola vez por preparación.
--   3. registrar_produccion (definición de 106 + un rechazo): HIP-25K y HIT-25K
--      ya no se producen por máquina; solo nacen de registrar_preparacion_barra
--      (si no, crearían bolsas consumiendo empaque SIN consumir barra).
--   4. conciliacion_empaque: también cuenta el empaque consumido por
--      preparaciones (tipo 'Preparacion'); sin eso la conciliación mostraría una
--      diferencia falsa. Solo lectura; mismos permisos.
--
-- SKUs permitidos (constantes del modelo, no configurables en este paquete):
--   barra  = HIB-50K
--   salida = HIP-25K (picada de barra) | HIT-25K (triturada de barra)
-- Si un SKU se renombra con rename_sku, estas funciones fallan cerradas.
-- revertir_produccion (107) ya rechaza filas que no sean tipo 'Produccion', así
-- que una preparación no se puede revertir por esa vía.
--
-- Reversión del paquete (solo emergencia, sin preparaciones registradas):
--   DROP FUNCTION registrar_preparacion_barra(uuid, text, text, text, integer);
--   DROP FUNCTION revertir_preparacion_barra(uuid, bigint, text);
--   y conciliacion_empaque de 093.

-- ═══ 1. Preparar desde barra ═══
CREATE OR REPLACE FUNCTION public.registrar_preparacion_barra(
  p_operacion_id UUID, p_barra_sku TEXT, p_salida_sku TEXT, p_cuarto_id TEXT, p_barras INTEGER
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_barra    TEXT := btrim(COALESCE(p_barra_sku, ''));
  v_salida   TEXT := btrim(COALESCE(p_salida_sku, ''));
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_bolsas   INTEGER;
  v_actor    TEXT;
  v_pb       RECORD;
  v_ps       RECORD;
  v_emp      RECORD;
  v_cf       RECORD;
  v_prev     produccion%ROWTYPE;
  v_id       BIGINT;
  v_folio    TEXT;
  v_empaque  TEXT;
  v_costo_u  NUMERIC := 0;
  v_total    NUMERIC := 0;
  v_hoy      DATE := fin_hoy();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF p_barras IS NULL OR p_barras < 1 THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: se prepara al menos 1 barra entera' USING ERRCODE = '22023';
  END IF;
  IF v_barra <> 'HIB-50K' THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: % no es la barra de hielo', v_barra USING ERRCODE = '22023';
  END IF;
  IF v_salida NOT IN ('HIP-25K', 'HIT-25K') THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: % no es una preparación de barra permitida', v_salida USING ERRCODE = '22023';
  END IF;
  v_bolsas := p_barras * 2;

  -- Replay: misma petición → mismo resultado, cero efectos nuevos.
  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    IF v_prev.tipo IS DISTINCT FROM 'Preparacion' OR v_prev.input_sku IS DISTINCT FROM v_barra OR v_prev.sku IS DISTINCT FROM v_salida
       OR v_prev.input_kg IS DISTINCT FROM p_barras::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'registrar_preparacion_barra: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'barra_sku', v_prev.input_sku, 'barras', p_barras,
      'salida_sku', v_prev.sku, 'bolsas', v_prev.cantidad, 'cuarto_id', v_prev.cuarto_id, 'empaque_sku', v_prev.empaque_sku,
      'empaque_cantidad', v_prev.empaque_cantidad, 'costo_total', v_prev.costo_total, 'replay', true);
  END IF;

  SELECT id, sku, tipo INTO v_pb FROM productos WHERE sku = v_barra;
  IF NOT FOUND OR COALESCE(v_pb.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: la barra % no está en el catálogo como Producto Terminado', v_barra USING ERRCODE = '22023';
  END IF;
  SELECT id, sku, tipo, empaque_sku INTO v_ps FROM productos WHERE sku = v_salida;
  IF NOT FOUND OR COALESCE(v_ps.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: % no está en el catálogo como Producto Terminado', v_salida USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  -- Empaque: el CONFIGURADO en la salida; sin él no se prepara.
  v_empaque := NULLIF(btrim(COALESCE(v_ps.empaque_sku, '')), '');
  IF v_empaque IS NULL THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: % no tiene empaque configurado', v_salida USING ERRCODE = '22023';
  END IF;
  IF v_empaque IN (v_salida, v_barra) THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: el empaque de % es inválido', v_salida USING ERRCODE = '22023';
  END IF;
  SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_preparacion_barra: empaque % no existe en el catálogo', v_empaque USING ERRCODE = '22023';
  END IF;
  v_costo_u := COALESCE(v_emp.costo_unitario, 0);

  v_folio := (SELECT 'PB-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id,
                          empaque_sku, empaque_cantidad, input_sku, input_kg, output_kg)
  VALUES (p_operacion_id, v_folio, 'Preparación', 'Preparación desde barra', v_salida, v_bolsas, 'Confirmada', 'Preparacion', v_cuarto,
          v_empaque, v_bolsas, v_barra, p_barras, v_bolsas)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- Otra llamada concurrente con el mismo operacion_id confirmó primero.
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    IF v_prev.tipo IS DISTINCT FROM 'Preparacion' OR v_prev.input_sku IS DISTINCT FROM v_barra OR v_prev.sku IS DISTINCT FROM v_salida
       OR v_prev.input_kg IS DISTINCT FROM p_barras::numeric OR v_prev.cuarto_id IS DISTINCT FROM v_cuarto THEN
      RAISE EXCEPTION 'registrar_preparacion_barra: operacion_id ya usado con otros datos' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('id', v_prev.id, 'folio', v_prev.folio, 'barra_sku', v_prev.input_sku, 'barras', p_barras,
      'salida_sku', v_prev.sku, 'bolsas', v_prev.cantidad, 'cuarto_id', v_prev.cuarto_id, 'empaque_sku', v_prev.empaque_sku,
      'empaque_cantidad', v_prev.empaque_cantidad, 'costo_total', v_prev.costo_total, 'replay', true);
  END IF;

  -- Efectos (cualquier faltante aborta TODO): empaque → cuarto (barra, salida).
  -- Kardex sin operacion_id (es FK a stock_operaciones; igual que
  -- registrar_produccion): la traza es la referencia 'preparacion/<folio>'.
  PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
    'sku', v_empaque, 'delta', -v_bolsas, 'tipo', 'Salida', 'origen', 'Preparación ' || v_folio)));
  PERFORM stock_mov_cuarto(v_cuarto, v_barra, -p_barras, 'Salida',
    'Preparación ' || v_folio || ': ' || p_barras || ' barra(s) → ' || v_salida,
    NULL, 'preparacion/' || v_folio, v_actor, NULL, NULL);
  PERFORM stock_mov_cuarto(v_cuarto, v_salida, v_bolsas, 'Entrada',
    'Preparación ' || v_folio || ' en ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto),
    NULL, 'preparacion/' || v_folio, v_actor, NULL, NULL);

  -- Costo del empaque consumido (misma regla que registrar_produccion).
  IF v_costo_u > 0 THEN
    v_total := round(v_bolsas * v_costo_u, 2);
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas',
            'Preparación ' || v_folio || ': ' || p_barras || '× ' || v_barra || ' → ' || v_bolsas || '× ' || v_salida || ' (empaque: ' || v_empaque || ')',
            v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, NULL);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total WHERE id = v_id;
  END IF;

  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_actor, 'Preparar', 'Producción', v_folio || ' — ' || p_barras || '×' || v_barra || ' → ' || v_bolsas || '×' || v_salida);

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'barra_sku', v_barra, 'barras', p_barras, 'salida_sku', v_salida, 'bolsas', v_bolsas,
    'cuarto_id', v_cuarto, 'empaque_sku', v_empaque, 'empaque_cantidad', v_bolsas, 'costo_total', v_total,
    'actor', v_actor, 'replay', false);
END $$;
REVOKE ALL ON FUNCTION public.registrar_preparacion_barra(UUID, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_preparacion_barra(UUID, TEXT, TEXT, TEXT, INTEGER) TO authenticated, service_role;

-- ═══ 2. Revertir una preparación equivocada ═══
CREATE OR REPLACE FUNCTION public.revertir_preparacion_barra(p_operacion_id UUID, p_preparacion_id BIGINT, p_motivo TEXT)
RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_actor_id BIGINT := erp_usuario_id();
  v_etiqueta TEXT := erp_actor_etiqueta();
  v_motivo   TEXT := NULLIF(btrim(COALESCE(p_motivo, '')), '');
  v_clave    TEXT;
  v_prev     JSONB;
  v_p        produccion%ROWTYPE;
  v_folio    TEXT;
  v_barras   INTEGER;
  v_emp      INTEGER;
  v_ins      RECORD;
  v_old_qty  INTEGER;
  v_old_avg  NUMERIC;
  v_hist     NUMERIC;
  v_new_avg  NUMERIC;
  v_costo    NUMERIC := 0;
  v_res      JSONB;
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin']) THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: no autorizado' USING ERRCODE = '42501';
  END IF;
  IF p_operacion_id IS NULL OR p_preparacion_id IS NULL THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: operación y preparación son obligatorias' USING ERRCODE = '22023';
  END IF;
  IF v_motivo IS NULL THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: el motivo es obligatorio' USING ERRCODE = '22023';
  END IF;
  v_clave := 'reverso_preparacion|' || p_preparacion_id || '|' || v_motivo;
  v_prev := stock_op_replay(p_operacion_id, 'reverso_produccion', v_clave);
  IF v_prev IS NOT NULL THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO v_p FROM produccion WHERE id = p_preparacion_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: preparación no encontrada: %', p_preparacion_id USING ERRCODE = '22023';
  END IF;
  v_folio := COALESCE(v_p.folio, 'ID ' || v_p.id);
  IF COALESCE(v_p.tipo, '') <> 'Preparacion' THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: % no es una preparación desde barra', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.revertida_at IS NOT NULL OR v_p.estatus = 'Revertida' THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: la preparación % ya fue revertida', v_folio USING ERRCODE = '22023';
  END IF;
  IF v_p.estatus <> 'Confirmada' OR v_p.input_sku IS NULL OR v_p.input_kg IS NULL OR v_p.empaque_sku IS NULL
     OR v_p.empaque_cantidad IS NULL OR NULLIF(btrim(COALESCE(v_p.cuarto_id, '')), '') IS NULL THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: la preparación % no tiene datos suficientes para revertirse', v_folio USING ERRCODE = '22023';
  END IF;
  v_barras := v_p.input_kg::INTEGER;
  v_emp := v_p.empaque_cantidad;

  -- Mismo orden de candados que la preparación: empaque → cuarto.
  SELECT id, tipo, COALESCE(stock, 0) AS stock, COALESCE(costo_unitario, 0) AS costo INTO v_ins
    FROM productos WHERE sku = v_p.empaque_sku FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'revertir_preparacion_barra: el empaque % ya no existe en el catálogo', v_p.empaque_sku USING ERRCODE = '22023';
  END IF;

  INSERT INTO stock_operaciones (operacion_id, tipo, clave, actor_id, actor, resultado)
  VALUES (p_operacion_id, 'reverso_produccion', v_clave, v_actor_id, v_etiqueta, '{}'::jsonb);

  -- Salida preparada: solo del cuarto ORIGINAL; si ya se vendió, falla todo.
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.sku, -v_p.cantidad, 'Salida', 'Reverso preparación ' || v_folio,
                           NULL, 'reverso_preparacion/' || v_folio, v_etiqueta, NULL, p_operacion_id);
  PERFORM stock_mov_cuarto(v_p.cuarto_id, v_p.input_sku, v_barras, 'Entrada', 'Reverso preparación ' || v_folio,
                           NULL, 'reverso_preparacion/' || v_folio, v_etiqueta, NULL, p_operacion_id);

  -- Empaque: reingresa al costo unitario histórico de ESTA preparación (107).
  IF v_ins.tipo = 'Empaque' THEN
    v_old_qty := v_ins.stock;
    v_old_avg := v_ins.costo;
    v_hist    := COALESCE(v_p.costo_empaque, 0);
    IF v_old_qty < 0 THEN
      RAISE EXCEPTION 'revertir_preparacion_barra: el empaque % tiene existencia negativa (%); estado inválido', v_p.empaque_sku, v_old_qty USING ERRCODE = '22023';
    END IF;
    IF v_hist < 0 THEN
      RAISE EXCEPTION 'revertir_preparacion_barra: la preparación % tiene un costo de empaque inválido', v_folio USING ERRCODE = '22023';
    END IF;
    v_new_avg := round((v_old_qty * v_old_avg + v_emp * v_hist) / (v_old_qty + v_emp), 6);
    UPDATE productos SET stock = v_old_qty + v_emp, costo_unitario = v_new_avg WHERE sku = v_p.empaque_sku;
    INSERT INTO costos_empaque_historial (producto_id, sku, evento, operacion_id, cantidad_anterior, costo_anterior, cantidad_recibida,
                                          costo_unitario_reingreso, cantidad_nueva, costo_nuevo, actor, actor_id)
    VALUES (v_ins.id, v_p.empaque_sku, 'Reverso producción', p_operacion_id, v_old_qty, v_old_avg, v_emp,
            v_hist, v_old_qty + v_emp, v_new_avg, v_etiqueta, v_actor_id);
  ELSE
    UPDATE productos SET stock = COALESCE(stock, 0) + v_emp WHERE sku = v_p.empaque_sku;
  END IF;
  INSERT INTO inventario_mov (tipo, producto, cantidad, origen, usuario, referencia, operacion_id)
  VALUES ('Entrada', v_p.empaque_sku, v_emp, 'Reverso preparación ' || v_folio, v_etiqueta, 'reverso_preparacion/' || v_folio, p_operacion_id);

  v_costo := COALESCE(v_p.costo_total, 0);
  IF v_costo > 0 THEN
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Reverso producción', 'Costo de Ventas',
            'Reverso preparación ' || v_folio || ': ' || v_p.cantidad || '× ' || v_p.sku || ' → ' || v_barras || '× ' || v_p.input_sku,
            v_costo, to_char(fin_hoy(), 'YYYY-MM'), fin_hoy(), 'PROD-' || v_p.id || '/reverso', NULL);
  END IF;

  UPDATE produccion SET estatus = 'Revertida', revertida_at = now(), revertida_por = v_actor_id,
                        reverso_operacion_id = p_operacion_id, motivo_reverso = v_motivo
   WHERE id = v_p.id;
  INSERT INTO auditoria (usuario, accion, modulo, detalle)
  VALUES (v_etiqueta, 'Revertir', 'Producción', 'Preparación ' || v_folio || ' — ' || v_p.cantidad || '×' || v_p.sku || ' → ' || v_barras || '×' || v_p.input_sku || ' — motivo: ' || v_motivo);

  v_res := jsonb_build_object('id', v_p.id, 'folio', v_folio, 'salida_sku', v_p.sku, 'bolsas', v_p.cantidad,
                              'barra_sku', v_p.input_sku, 'barras', v_barras, 'cuarto_id', v_p.cuarto_id,
                              'empaque_sku', v_p.empaque_sku, 'empaque_devuelto', v_emp, 'costo_revertido', v_costo,
                              'actor', v_etiqueta, 'operacion_id', p_operacion_id, 'replay', false);
  UPDATE stock_operaciones SET resultado = v_res WHERE operacion_id = p_operacion_id;
  RETURN v_res;
END $$;
REVOKE ALL ON FUNCTION public.revertir_preparacion_barra(UUID, BIGINT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revertir_preparacion_barra(UUID, BIGINT, TEXT) TO authenticated, service_role;

-- ═══ 3. Producción normal: rechaza las bolsas que solo nacen de preparar ═══
-- Definición vigente de 106, idéntica salvo el bloque marcado "115 (OP-01D.1)".
-- CREATE OR REPLACE conserva los permisos (authenticated, service_role).
CREATE OR REPLACE FUNCTION public.registrar_produccion(p_operacion_id uuid, p_turno text, p_maquina text, p_sku text, p_cantidad integer, p_cuarto_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_turno    TEXT := btrim(COALESCE(p_turno, ''));
  v_maquina  TEXT := btrim(COALESCE(p_maquina, ''));
  v_sku      TEXT := btrim(COALESCE(p_sku, ''));
  v_cuarto   TEXT := btrim(COALESCE(p_cuarto_id, ''));
  v_actor    TEXT;
  v_uid      BIGINT;
  v_prod     RECORD;
  v_emp      RECORD;
  v_cf       RECORD;
  v_prev     produccion%ROWTYPE;
  v_id       BIGINT;
  v_folio    TEXT;
  v_empaque  TEXT;
  v_costo_u  NUMERIC := 0;
  v_total    NUMERIC := 0;
  v_mov      BIGINT;
  v_concepto TEXT;
  v_hoy      DATE := fin_hoy();
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Producción']) THEN
    RAISE EXCEPTION 'registrar_produccion: actor no autorizado' USING ERRCODE = '42501';
  END IF;
  v_actor := erp_actor_etiqueta();
  v_uid   := erp_usuario_id();

  IF p_operacion_id IS NULL THEN
    RAISE EXCEPTION 'registrar_produccion: operacion_id es obligatorio' USING ERRCODE = '22023';
  END IF;
  IF v_turno = '' OR v_maquina = '' THEN
    RAISE EXCEPTION 'registrar_produccion: turno y máquina son obligatorios' USING ERRCODE = '22023';
  END IF;
  IF p_cantidad IS NULL OR p_cantidad <= 0 THEN
    RAISE EXCEPTION 'registrar_produccion: la cantidad debe ser mayor a 0' USING ERRCODE = '22023';
  END IF;

  -- Replay (petición ya confirmada): mismo resultado, cero efectos nuevos.
  SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
  IF FOUND THEN
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  SELECT id, sku, tipo, empaque_sku INTO v_prod FROM productos WHERE sku = v_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: SKU no encontrado: %', v_sku USING ERRCODE = '22023';
  END IF;
  IF COALESCE(v_prod.tipo, '') <> 'Producto Terminado' THEN
    RAISE EXCEPTION 'registrar_produccion: % no es Producto Terminado', v_sku USING ERRCODE = '22023';
  END IF;
  -- 115 (OP-01D.1): las bolsas de picada / triturada de barra solo entran al
  -- inventario por registrar_preparacion_barra (consumen la barra); una
  -- producción normal las crearía sin consumir barras.
  IF v_sku IN ('HIP-25K', 'HIT-25K') THEN
    RAISE EXCEPTION 'registrar_produccion: % solo se obtiene con Preparar desde barra', v_sku USING ERRCODE = '22023';
  END IF;
  SELECT id, nombre INTO v_cf FROM cuartos_frios WHERE id = v_cuarto;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'registrar_produccion: cuarto frío % no existe', v_cuarto USING ERRCODE = '22023';
  END IF;

  -- Empaque: resuelto en el servidor; 1 unidad por unidad producida.
  v_empaque := NULLIF(btrim(COALESCE(v_prod.empaque_sku, '')), '');
  IF v_empaque IS NOT NULL THEN
    IF v_empaque = v_sku THEN
      RAISE EXCEPTION 'registrar_produccion: el empaque de % apunta al mismo SKU', v_sku USING ERRCODE = '22023';
    END IF;
    -- 106: el costo (promedio ponderado) se lee con el producto bloqueado: se
    -- serializa con las recepciones de compra del mismo empaque.
    SELECT id, costo_unitario INTO v_emp FROM productos WHERE sku = v_empaque FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'registrar_produccion: empaque % no existe en el catálogo', v_empaque USING ERRCODE = '22023';
    END IF;
    v_costo_u := COALESCE(v_emp.costo_unitario, 0);
  END IF;

  v_folio := (SELECT 'OP-' || lpad(q.s, greatest(3, length(q.s)), '0') FROM (SELECT pg_catalog.nextval('folio_op_seq'::regclass)::text AS s) q);  -- 090: ancho mínimo, sin truncar

  INSERT INTO produccion (operacion_id, folio, turno, maquina, sku, cantidad, estatus, tipo, cuarto_id, empaque_sku, empaque_cantidad)
  VALUES (p_operacion_id, v_folio, v_turno, v_maquina, v_sku, p_cantidad, 'Confirmada', 'Produccion', v_cuarto,
          v_empaque, CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END)
  ON CONFLICT (operacion_id) DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    -- Otra llamada concurrente con el mismo operacion_id confirmó primero.
    SELECT * INTO v_prev FROM produccion WHERE operacion_id = p_operacion_id;
    RETURN registrar_produccion__replay(v_prev, v_turno, v_maquina, v_sku, p_cantidad, v_cuarto);
  END IF;

  -- Consumo de empaque por el contrato seguro de 071 (lock, sin negativos,
  -- kardex con el actor real). Si no alcanza, aborta TODO.
  IF v_empaque IS NOT NULL THEN
    PERFORM productos_stock_interno(jsonb_build_array(jsonb_build_object(
      'sku', v_empaque, 'delta', -p_cantidad, 'tipo', 'Salida', 'origen', 'Producción ' || v_folio)));
  END IF;

  -- Entrada del producto terminado al cuarto (contrato seguro de 071).
  -- 085: escritura directa del cuarto vía el primitivo interno (084), no el RPC
  -- genérico: misma cantidad, cuarto, tipo, origen y atribución (v_actor); el
  -- kardex gana cuarto_id y referencia estructurada.
  PERFORM stock_mov_cuarto(v_cuarto, v_sku, p_cantidad, 'Entrada',
    'Entrada a ' || COALESCE(NULLIF(v_cf.nombre, ''), v_cuarto) || ' — ' || v_folio,
    NULL, 'produccion/' || v_folio, v_actor, NULL, NULL);

  -- Costo (D6): cantidad × costo unitario del empaque, en el servidor.
  -- 092: el consumo reconoce COSTO (costos_historial, fuente del Costo de
  -- Ventas del Dashboard) pero NO crea un Egreso en movimientos_contables: el
  -- dinero ya salió al comprar (Egreso Proveedores) o saldrá al pagar la CxP.
  -- mov_contable_id queda NULL.
  IF v_empaque IS NOT NULL AND v_costo_u > 0 THEN
    v_total := round(p_cantidad * v_costo_u, 2);
    v_concepto := 'Producción ' || v_folio || ': ' || p_cantidad || '× ' || v_sku || ' (empaque: ' || v_empaque || ')';
    INSERT INTO costos_historial (tipo, categoria, concepto, monto, periodo, fecha, referencia, movimiento_id)
    VALUES ('Producción', 'Costo de Ventas', v_concepto, v_total, to_char(v_hoy, 'YYYY-MM'), v_hoy, 'PROD-' || v_id, NULL);
    UPDATE produccion SET costo_empaque = v_costo_u, costo_total = v_total WHERE id = v_id;
  END IF;

  RETURN jsonb_build_object(
    'id', v_id, 'folio', v_folio, 'sku', v_sku, 'cantidad', p_cantidad, 'cuarto_id', v_cuarto,
    'empaque_sku', v_empaque, 'empaque_cantidad', CASE WHEN v_empaque IS NULL THEN NULL ELSE p_cantidad END,
    'costo_total', v_total, 'mov_contable_id', v_mov, 'actor', v_actor, 'replay', false);
END $function$;

-- ═══ 4. Conciliación de empaque: también el consumido por preparaciones ═══
CREATE OR REPLACE FUNCTION public.conciliacion_empaque() RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT fin_actor_permitido(ARRAY['Admin', 'Almacén Bolsas']) THEN
    RAISE EXCEPTION 'conciliacion_empaque: no autorizado' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'sku', p.sku, 'nombre', p.nombre, 'stock_total', COALESCE(p.stock, 0),
      'entregado_produccion', e.qty, 'entregas', e.n,
      'consumido_produccion', c.qty, 'producciones', c.n,
      'diferencia', e.qty - c.qty,
      'legado_salidas', ls.qty, 'legado_salidas_n', ls.n,
      'legado_consumo', lc.qty, 'legado_consumo_n', lc.n) ORDER BY p.sku)
    FROM productos p
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Entrega a Producción' AND m.referencia LIKE 'salida_empaque/%' AND m.operacion_id IS NOT NULL) e
    CROSS JOIN LATERAL (SELECT COALESCE(sum(pr.empaque_cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM produccion pr
                         WHERE pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL AND pr.tipo IN ('Produccion', 'Preparacion') AND pr.estatus <> 'Revertida') c
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida'
                           AND (m.referencia LIKE 'salida_empaque/%' OR (m.referencia IS NULL AND m.origen = 'Producción'))) ls
    CROSS JOIN LATERAL (SELECT COALESCE(sum(m.cantidad), 0)::BIGINT AS qty, count(*)::BIGINT AS n FROM inventario_mov m
                         WHERE m.producto = p.sku AND m.tipo = 'Salida' AND m.origen LIKE 'Producción OP-%'
                           AND NOT EXISTS (SELECT 1 FROM produccion pr WHERE 'Producción ' || pr.folio = m.origen
                                            AND pr.empaque_sku = p.sku AND pr.empaque_cantidad IS NOT NULL)) lc
    WHERE p.tipo = 'Empaque'), '[]'::jsonb);
END $$;
