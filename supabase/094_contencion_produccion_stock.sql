-- 094_contencion_produccion_stock.sql — parte 2 de 2 (contención final).
-- Se aplica DESPUÉS de desplegar el frontend que usa revertir_produccion y
-- ajustar_existencia (093). Idempotente.
--
--   1. produccion: sin DELETE para la API (ni grant ni guarda). Ninguna ruta
--      libera un operacion_id borrando la fila; la producción se revierte.
--   2. productos: el stock de insumos (todo lo que no es Producto
--      Terminado) ya no cambia por UPDATE REST; solo por contratos
--      (recepción, producción, reverso, ajuste_existencia). El stock de
--      producto terminado vive en los cuartos fríos (productos.stock es su
--      espejo y lo mantiene el ajuste por cuarto).

REVOKE DELETE ON produccion FROM authenticated;

CREATE OR REPLACE FUNCTION public.produccion_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF NOT b4_escritura_api() THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'produccion: la producción no se borra; se revierte con revertir_produccion' USING ERRCODE = '42501';
  END IF;
  IF (to_jsonb(NEW) - 'turno' - 'maquina') IS DISTINCT FROM (to_jsonb(OLD) - 'turno' - 'maquina') THEN
    RAISE EXCEPTION 'produccion: la producción es un evento inmutable; solo se corrigen turno y máquina (para deshacerla usa el reverso)' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION public.productos_guard_stock() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF b4_escritura_api() AND COALESCE(OLD.tipo, '') <> 'Producto Terminado'
     AND NEW.stock IS DISTINCT FROM OLD.stock THEN
    RAISE EXCEPTION 'productos: el stock de % solo cambia por movimientos trazables (compra, producción, ajuste de existencia)', OLD.sku USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.productos_guard_stock() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_productos_guard_stock ON productos;
CREATE TRIGGER trg_productos_guard_stock BEFORE UPDATE ON productos FOR EACH ROW EXECUTE FUNCTION public.productos_guard_stock();
