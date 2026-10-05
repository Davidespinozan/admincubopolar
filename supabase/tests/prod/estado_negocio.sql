-- estado_negocio.sql — SOLO LECTURA. Huella compacta del estado de negocio,
-- financiero y de inventario (md5 y conteos de productos, cuartos, producción,
-- costos, movimientos, pagos, CxC/CxP, devoluciones, órdenes, kardex,
-- operaciones, auditoría y error_log). Un solo SELECT; no escribe nada.
-- Uso: debe ser IDÉNTICA antes y después de una activación que no cambia datos.
-- Si la fase cambia datos a propósito, la diferencia debe ser solo la esperada.
-- Origen: consulta de verificación usada desde 093; recuperada sin cambios.
SELECT jsonb_build_object(
 'productos_stock', (SELECT md5(string_agg(sku || ':' || COALESCE(stock::text, 'null') || ':' || COALESCE(empaque_sku, ''), '|' ORDER BY sku)) FROM productos),
 'emp', (SELECT jsonb_object_agg(sku, stock) FROM productos WHERE tipo = 'Empaque'),
 'cuartos', (SELECT md5(string_agg(id || ':' || stock::text, '|' ORDER BY id)) FROM cuartos_frios),
 'produccion', (SELECT md5(string_agg(concat_ws(':', id, folio, sku, cantidad, estatus, tipo, cuarto_id, empaque_sku, empaque_cantidad, costo_total), '|' ORDER BY id)) FROM produccion),
 'costos', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, tipo, categoria, monto, fecha, referencia, movimiento_id), '|' ORDER BY id), '')) FROM costos_historial),
 'movimientos', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, tipo, categoria, monto, fecha, orden_id, referencia), '|' ORDER BY id), '')) FROM movimientos_contables),
 'pagos', (SELECT md5(COALESCE(string_agg(concat_ws(':', id, orden_id, monto, metodo_pago, referencia), '|' ORDER BY id), '')) FROM pagos),
 'cxc', (SELECT count(*) FROM cuentas_por_cobrar), 'cxp', (SELECT count(*) FROM cuentas_por_pagar), 'devoluciones', (SELECT count(*) FROM devoluciones),
 'ordenes', (SELECT md5(string_agg(concat_ws(':', id, folio, estatus, total, fecha), '|' ORDER BY id)) FROM ordenes),
 'kardex', (SELECT jsonb_build_object('n', count(*), 'max', max(id)) FROM inventario_mov),
 'ops', (SELECT count(*) FROM stock_operaciones),
 'auditoria_max', (SELECT max(id) FROM auditoria),
 'error_log_max', (SELECT max(id) FROM error_log),
 'delivered_at_col', (SELECT count(*) FROM information_schema.columns WHERE table_name = 'ordenes' AND column_name = 'delivered_at')
) AS r;
