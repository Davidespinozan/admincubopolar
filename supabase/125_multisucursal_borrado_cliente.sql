-- 125_multisucursal_borrado_cliente.sql — MULTISUCURSAL, corrección (2026-10-09).
-- Solo cambia dos llaves foráneas de `sucursales`. Aditiva e idempotente.
--
-- Defecto de 123 (lo destapó el gate local al re-correr la suite 088 tras 123, no
-- producción): como todo cliente nace con su sucursal principal y la llave
-- `sucursales.cliente_id` no tenía acción de borrado, DELETE de un cliente
-- fallaba SIEMPRE con 23503, también para un cliente sin historia (el único
-- caso en que Admin puede borrarlo: "Eliminar permanentemente" en Clientes).
--
-- Arreglo: la sucursal es parte del cliente → ON DELETE CASCADE. La historia sigue
-- protegida: una sucursal con órdenes no se puede borrar (`ordenes.sucursal_id`
-- sin acción de borrado), igual que un cliente con órdenes, pagos, CxC o comodatos.
-- `sucursales.origen_cliente_id` (cliente fusionado del que viene la sucursal) pasa
-- a ON DELETE SET NULL: la sucursal sobrevive si algún día se borra el cliente
-- origen ya inactivo. `clientes.fusionado_en` no cambia (un destino con sucursales
-- fusionadas tiene historia).
--
-- Reversión: volver ambas llaves a NO ACTION (reabre el bloqueo del borrado).

ALTER TABLE public.sucursales DROP CONSTRAINT IF EXISTS sucursales_cliente_id_fkey;
ALTER TABLE public.sucursales ADD CONSTRAINT sucursales_cliente_id_fkey
  FOREIGN KEY (cliente_id) REFERENCES public.clientes(id) ON DELETE CASCADE;
ALTER TABLE public.sucursales DROP CONSTRAINT IF EXISTS sucursales_origen_cliente_id_fkey;
ALTER TABLE public.sucursales ADD CONSTRAINT sucursales_origen_cliente_id_fkey
  FOREIGN KEY (origen_cliente_id) REFERENCES public.clientes(id) ON DELETE SET NULL;
