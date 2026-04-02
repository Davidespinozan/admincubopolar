-- 030: Indexes para rendimiento en consultas frecuentes

CREATE INDEX IF NOT EXISTS idx_rutas_chofer ON rutas(chofer_id);
CREATE INDEX IF NOT EXISTS idx_rutas_estatus ON rutas(estatus);
CREATE INDEX IF NOT EXISTS idx_ordenes_estatus ON ordenes(estatus);
CREATE INDEX IF NOT EXISTS idx_ordenes_ruta ON ordenes(ruta_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_cliente ON ordenes(cliente_id);
CREATE INDEX IF NOT EXISTS idx_ordenes_fecha ON ordenes(fecha);
CREATE INDEX IF NOT EXISTS idx_produccion_sku ON produccion(sku);
CREATE INDEX IF NOT EXISTS idx_produccion_estatus ON produccion(estatus);
CREATE INDEX IF NOT EXISTS idx_clientes_estatus ON clientes(estatus);
CREATE INDEX IF NOT EXISTS idx_inventario_mov_producto ON inventario_mov(producto);
CREATE INDEX IF NOT EXISTS idx_cxc_cliente ON cuentas_por_cobrar(cliente_id);
CREATE INDEX IF NOT EXISTS idx_cxc_estatus ON cuentas_por_cobrar(estatus);
CREATE INDEX IF NOT EXISTS idx_mov_contables_fecha ON movimientos_contables(fecha);
CREATE INDEX IF NOT EXISTS idx_mov_contables_tipo ON movimientos_contables(tipo);
