-- 126_cuartos_frios_orden.sql — orden manual de los cuartos fríos (2026-10-09).
-- Solo agrega una columna de presentación; no toca existencias ni contratos.
-- Aditiva e idempotente. El UPDATE de `orden` pasa por la guarda cuartos_frios_guard
-- (solo vigila id y stock) igual que nombre y temperatura.
-- Reversión: ALTER TABLE public.cuartos_frios DROP COLUMN orden;
ALTER TABLE public.cuartos_frios ADD COLUMN IF NOT EXISTS orden INT;

-- Backfill una sola vez: orden numérico del id (CF-1, CF-2, …).
UPDATE public.cuartos_frios c
   SET orden = r.rn
  FROM (SELECT id, row_number() OVER (
          ORDER BY COALESCE(NULLIF(regexp_replace(id, '\D', '', 'g'), '')::int, 2147483647), id) AS rn
          FROM public.cuartos_frios) r
 WHERE c.id = r.id AND c.orden IS NULL;
