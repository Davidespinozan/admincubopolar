-- 132_datos_bancarios.sql — datos bancarios de la empresa para cobrar por
-- transferencia (banco, CLABE, beneficiario, número de cuenta).
--
-- Aditiva e idempotente. Compatible con el frontend desplegado antes.
--
-- Para qué: el vendedor o el chofer le manda al cliente los datos para
-- transferir (WhatsApp) y el cliente regresa su comprobante.
--
-- Decisión (delegada por el dueño, 2026-10-09): la cuenta a la que pagan los
-- clientes SOLO la cambia el Dueño. Un Admin puede editar los demás datos de
-- la empresa como hasta hoy, pero no redirigir los cobros a otra cuenta.
-- El cambio queda en `bitacora_cambios` (120 ya vigila `configuracion_empresa`).
-- Lectura: como el resto de la configuración (usuarios activos del negocio).
--
-- Reversión: borrar el trigger, la función y las 4 columnas.

ALTER TABLE public.configuracion_empresa ADD COLUMN IF NOT EXISTS banco TEXT;
ALTER TABLE public.configuracion_empresa ADD COLUMN IF NOT EXISTS clabe TEXT;
ALTER TABLE public.configuracion_empresa ADD COLUMN IF NOT EXISTS beneficiario TEXT;
ALTER TABLE public.configuracion_empresa ADD COLUMN IF NOT EXISTS cuenta_bancaria TEXT;

ALTER TABLE public.configuracion_empresa DROP CONSTRAINT IF EXISTS configuracion_empresa_clabe;
ALTER TABLE public.configuracion_empresa ADD CONSTRAINT configuracion_empresa_clabe CHECK (clabe IS NULL OR clabe ~ '^[0-9]{18}$');
ALTER TABLE public.configuracion_empresa DROP CONSTRAINT IF EXISTS configuracion_empresa_banco;
ALTER TABLE public.configuracion_empresa ADD CONSTRAINT configuracion_empresa_banco
  CHECK (char_length(COALESCE(banco, '')) <= 60 AND char_length(COALESCE(beneficiario, '')) <= 120 AND char_length(COALESCE(cuenta_bancaria, '')) <= 30);

-- Por API, los datos bancarios solo los cambia el Dueño.
CREATE OR REPLACE FUNCTION public.configuracion_empresa_banco_guard() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY INVOKER SET search_path = public, pg_temp AS $$
BEGIN
  IF (NEW.banco, NEW.clabe, NEW.beneficiario, NEW.cuenta_bancaria) IS DISTINCT FROM (OLD.banco, OLD.clabe, OLD.beneficiario, OLD.cuenta_bancaria)
     AND b4_escritura_api() AND NOT erp_es_dueno() THEN
    RAISE EXCEPTION 'Solo el dueño puede cambiar los datos bancarios de la empresa' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.configuracion_empresa_banco_guard() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS trg_configuracion_empresa_banco_guard ON public.configuracion_empresa;
CREATE TRIGGER trg_configuracion_empresa_banco_guard BEFORE UPDATE ON public.configuracion_empresa
  FOR EACH ROW EXECUTE FUNCTION public.configuracion_empresa_banco_guard();
