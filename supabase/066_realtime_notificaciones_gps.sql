-- 066: Garantizar realtime para TODAS las tablas suscritas por el ERP
-- (Tanda 23 partió el realtime en núcleo + slices y sumó notificaciones
-- y chofer_ubicaciones; el dashboard mostraba solo 18 tablas en la
-- publicación cuando la app se suscribe a 22 — este script cierra la
-- brecha completa, no solo las 2 nuevas).
--
-- Idempotente: agrega a supabase_realtime únicamente las que falten.
-- Mantener la lista en sync con src/data/realtimeLogic.js
-- (TABLAS_CORE_RT + TABLAS_SLICE_RT). Correr en el SQL Editor.

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    -- núcleo (TABLAS_CORE_RT)
    'clientes', 'productos', 'ordenes', 'rutas', 'cuartos_frios',
    'empleados', 'cuentas_por_cobrar',
    -- slices (TABLAS_SLICE_RT)
    'produccion', 'inventario_mov', 'pagos', 'auditoria', 'comodatos',
    'leads', 'movimientos_contables', 'mermas', 'nomina_periodos',
    'cuentas_por_pagar', 'costos_fijos', 'devoluciones',
    'cierres_diarios', 'notificaciones', 'chofer_ubicaciones'
  ]
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
      RAISE NOTICE 'Agregada a realtime: %', t;
    END IF;
  END LOOP;
END $$;

-- Verificación: deben salir las 22 tablas de arriba (pueden aparecer
-- más si otras features las agregaron; eso es normal).
SELECT tablename
FROM pg_publication_tables
WHERE pubname = 'supabase_realtime' AND schemaname = 'public'
ORDER BY tablename;
