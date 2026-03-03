-- ═══════════════════════════════════════════════════════════════
-- CUBO POLAR ERP — Seed Data
-- Run AFTER 001_schema.sql
-- ═══════════════════════════════════════════════════════════════

-- USUARIOS (without auth_id — link to Supabase Auth later)
INSERT INTO usuarios (id, nombre, rol, email) VALUES
  (1, 'Administrador General', 'Admin', 'admin@cubopolar.com'),
  (2, 'Carlos Mendoza', 'Chofer', 'carlos@cubopolar.com'),
  (3, 'Miguel Á. Torres', 'Chofer', 'miguel@cubopolar.com'),
  (4, 'Laura García', 'Ventas', 'laura@cubopolar.com'),
  (5, 'Ana López', 'Facturación', 'ana@cubopolar.com'),
  (6, 'Roberto Díaz', 'Almacén', 'roberto@cubopolar.com');
SELECT setval('usuarios_id_seq', 6);

-- CLIENTES
INSERT INTO clientes (id, nombre, rfc, regimen, uso_cfdi, cp, correo, tipo, contacto, saldo, estatus) VALUES
  (1, 'Abarrotes El Sol', 'ASO980512AB3', 'Régimen General', 'G03', '34000', 'sol@mail.com', 'Tienda', '618 123 4567', 2400, 'Activo'),
  (2, 'Restaurant La Cabaña', 'RLC010320XY1', 'Régimen General', 'G03', '34100', 'cabana@mail.com', 'Restaurante', '618 234 5678', 0, 'Activo'),
  (3, 'OXXO Sucursal Centro', 'OXX950101GH5', 'Régimen General', 'G01', '34000', 'oxxo@mail.com', 'Cadena', '618 345 6789', 8100, 'Activo'),
  (4, 'Público en general', 'XAXX010101000', 'Sin obligaciones', 'S01', '34000', '—', 'General', '—', 0, 'Activo'),
  (5, 'Nevería Don Pepe', 'NDP880715QW2', 'Régimen General', 'G03', '34200', 'pepe@mail.com', 'Nevería', '618 456 7890', 1200, 'Activo'),
  (6, 'Hotel Gobernador', 'HGO770310RT4', 'Régimen General', 'G03', '34000', 'hotel@gob.com', 'Hotel', '618 567 8901', 15600, 'Activo');
SELECT setval('clientes_id_seq', 6);

-- PRODUCTOS (with empaque mapping)
INSERT INTO productos (id, sku, nombre, tipo, stock, ubicacion, precio, empaque_sku) VALUES
  (1, 'HC-25K', 'Bolsa cubos 25 kg', 'Producto Terminado', 1420, 'CF-1', 85.00, 'EMP-25'),
  (2, 'HC-5K', 'Bolsa cubos 5 kg', 'Producto Terminado', 890, 'CF-2', 25.00, 'EMP-5'),
  (3, 'HT-25K', 'Hielo triturado 25 kg', 'Producto Terminado', 340, 'CF-1', 75.00, 'EMP-25'),
  (4, 'BH-50K', 'Barra de hielo 50 kg', 'Producto Terminado', 80, 'CF-3', 120.00, NULL),
  (5, 'EMP-25', 'Empaque bolsa 25 kg', 'Empaque', 2100, 'Almacén', 0.00, NULL),
  (6, 'EMP-5', 'Empaque bolsa 5 kg', 'Empaque', 120, 'Almacén', 0.00, NULL);
SELECT setval('productos_id_seq', 6);

-- PRECIOS ESPECIALES
INSERT INTO precios_esp (id, cliente_id, sku, precio) VALUES
  (1, 6, 'HC-25K', 78.00),
  (2, 3, 'HC-5K', 22.00),
  (3, 5, 'HC-25K', 80.00);
SELECT setval('precios_esp_id_seq', 3);

-- RUTAS
INSERT INTO rutas (id, folio, nombre, chofer_id, estatus, carga) VALUES
  (1, 'R-012', 'Ruta Norte', 2, 'En progreso', '180 bolsas'),
  (2, 'R-011', 'Ruta Centro', 3, 'Completada', '220 bolsas'),
  (3, 'R-010', 'Ruta Sur', NULL, 'En progreso', '150 bolsas'),
  (4, 'R-009', 'Ruta Poniente', NULL, 'Programada', '120 bolsas');
SELECT setval('rutas_id_seq', 4);

-- ORDENES
INSERT INTO ordenes (id, folio, cliente_id, fecha, total, estatus, ruta_id) VALUES
  (1, 'OV-0041', 1, '2026-03-02', 2125.00, 'Creada', NULL),
  (2, 'OV-0040', 6, '2026-03-02', 3620.00, 'Asignada', 1),
  (3, 'OV-0039', 3, '2026-03-01', 1320.00, 'Entregada', 2),
  (4, 'OV-0038', 2, '2026-03-01', 1225.00, 'Facturada', 3),
  (5, 'OV-0037', 5, '2026-03-01', 375.00, 'Entregada', 2);
SELECT setval('ordenes_id_seq', 5);

-- ORDEN LINEAS (with price snapshots)
-- OV-0041: Abarrotes El Sol — 25×HC-25K at $85 (lista)
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (1, 'HC-25K', 25, 85.00, 2125.00);
-- OV-0040: Hotel Gobernador — 40×HC-25K at $78 (especial) + 20×HC-5K at $25
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (2, 'HC-25K', 40, 78.00, 3120.00),
  (2, 'HC-5K', 20, 25.00, 500.00);
-- OV-0039: OXXO — 60×HC-5K at $22 (especial)
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (3, 'HC-5K', 60, 22.00, 1320.00);
-- OV-0038: La Cabaña — 10×HC-25K at $85 + 5×HT-25K at $75
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (4, 'HC-25K', 10, 85.00, 850.00),
  (4, 'HT-25K', 5, 75.00, 375.00);
-- OV-0037: Nevería — 15×HC-5K at $25
INSERT INTO orden_lineas (orden_id, sku, cantidad, precio_unit, subtotal) VALUES
  (5, 'HC-5K', 15, 25.00, 375.00);

-- PRODUCCIÓN
INSERT INTO produccion (id, folio, fecha, turno, maquina, sku, cantidad, estatus) VALUES
  (1, 'OP-088', '2026-03-02', 'Matutino', 'Máquina 30', 'HC-25K', 420, 'En proceso'),
  (2, 'OP-087', '2026-03-02', 'Matutino', 'Máquina 20', 'HC-5K', 600, 'Confirmada'),
  (3, 'OP-086', '2026-03-01', 'Vespertino', 'Máquina 15', 'HT-25K', 220, 'Confirmada');
SELECT setval('produccion_id_seq', 3);

-- CUARTOS FRÍOS
INSERT INTO cuartos_frios (id, nombre, temp, capacidad) VALUES
  (1, 'Cuarto Frío 1', -8, 72),
  (2, 'Cuarto Frío 2', -10, 85),
  (3, 'Cuarto Frío 3', -6, 45);

INSERT INTO cuarto_frio_stock (cuarto_frio_id, sku, cantidad) VALUES
  (1, 'HC-25K', 890), (1, 'HT-25K', 340),
  (2, 'HC-25K', 530), (2, 'HC-5K', 890),
  (3, 'BH-50K', 80);

-- UMBRALES
INSERT INTO umbrales (sku, recomendada, accionable, critica) VALUES
  ('EMP-25', 500, 300, 150),
  ('EMP-5', 300, 200, 100),
  ('HC-25K', 400, 200, 80);
