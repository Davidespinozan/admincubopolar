-- 073_contencion_vista_gps.sql — Contención B2-V (exposición pública de GPS).
--
-- Causa raíz: la vista chofer_ubicacion_actual se creó en 032, cuando la
-- tabla base chofer_ubicaciones tenía read_all USING (true). 046 cerró la
-- tabla pero no la vista. La vista es propiedad de postgres (BYPASSRLS) y no
-- usa security_invoker, así que lee la tabla base con los permisos del dueño
-- y se salta su RLS. Además anon tenía todos los privilegios sobre ella.
-- Verificado en producción el 2026-09-27: con la anon key pública la vista
-- devolvía filas mientras la tabla base devolvía 0.
--
-- Contención mínima:
--   1. security_invoker = true → la vista se evalúa con los permisos y el RLS
--      del que consulta (las policies actuales de chofer_ubicaciones).
--   2. anon y PUBLIC sin privilegios; authenticated solo SELECT.
--
-- Sin consumidores en frontend ni Netlify Functions, sin dependientes, fuera
-- de la publicación Realtime (que publica la tabla base). No toca la tabla
-- base ni sus policies (su resolución legacy por email es deuda B3).
-- Idempotente.

ALTER VIEW public.chofer_ubicacion_actual SET (security_invoker = true);

-- REVOKE ALL cubre también MAINTAIN (PG17+) además de a/r/w/d/D/x/t.
REVOKE ALL ON public.chofer_ubicacion_actual FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.chofer_ubicacion_actual TO authenticated;
