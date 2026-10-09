-- 122_zona_negocio_test.sql — la zona del negocio es la de Durango (America/Monterrey).
\set ON_ERROR_STOP on
\set QUIET on
CREATE OR REPLACE FUNCTION t122_assert(p_ok BOOLEAN, p_msg TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: %', p_msg; END IF;
  RAISE NOTICE 'OK: %', p_msg;
END $$;

\echo '── 122: zona del negocio = America/Monterrey (Durango)'
SELECT t122_assert(fin_zona_negocio() = 'America/Monterrey', '122-01 fin_zona_negocio() = America/Monterrey');
SELECT t122_assert(fin_hoy() = (now() AT TIME ZONE 'America/Monterrey')::date AND fin_hoy() = fin_dia_negocio(now()),
  '122-02 fin_hoy() es el día de calendario en Durango');
-- Frontera: 2033-03-11 05:59:59Z = 23:59:59 del 10 en Durango; 06:00Z = 00:00 del 11.
SELECT t122_assert(fin_dia_negocio('2033-03-11 05:59:59+00') = '2033-03-10' AND fin_dia_negocio('2033-03-11 06:00:00+00') = '2033-03-11',
  '122-03 el día de negocio cambia a medianoche de Durango (06:00 UTC)');
-- Sin horario de verano: el desfase es -06:00 en invierno y en verano.
SELECT t122_assert(('2033-01-15 12:00+00'::timestamptz AT TIME ZONE fin_zona_negocio())::time = '06:00'
                   AND ('2033-07-15 12:00+00'::timestamptz AT TIME ZONE fin_zona_negocio())::time = '06:00',
  '122-04 UTC-6 todo el año (sin horario de verano)');
-- La sesión no manda: con TimeZone de Tokio o de Mazatlán el resultado es el mismo.
BEGIN; SET LOCAL TimeZone = 'Asia/Tokyo';
SELECT t122_assert(fin_hoy() = (now() AT TIME ZONE 'America/Monterrey')::date, '122-05 fin_hoy() ignora el TimeZone de la sesión (Tokio)');
COMMIT;
BEGIN; SET LOCAL TimeZone = 'America/Mazatlan';
SELECT t122_assert(fin_dia_negocio('2033-03-11 06:30:00+00') = '2033-03-11', '122-06 00:30 de Durango ya es el día 11 aunque la sesión esté en Mazatlán');
COMMIT;
-- ACL y search_path intactos (misma función de 096).
SELECT t122_assert(NOT has_function_privilege('anon', 'public.fin_zona_negocio()', 'EXECUTE')
                   AND has_function_privilege('authenticated', 'public.fin_zona_negocio()', 'EXECUTE')
                   AND (SELECT array_to_string(proconfig, ';') FROM pg_proc WHERE proname = 'fin_zona_negocio' AND pronamespace = 'public'::regnamespace) = 'search_path=public, pg_temp',
  '122-07 ACL y search_path de fin_zona_negocio() sin cambio');
-- Asistencia: una entrada programada a las 08:00 cae a las 14:00 UTC (no a las 15:00).
SELECT t122_assert(('2033-03-11'::date + '08:00'::time)::timestamp AT TIME ZONE fin_zona_negocio() = '2033-03-11 14:00:00+00'::timestamptz,
  '122-08 una hora de turno 08:00 corresponde a las 14:00 UTC (hora de Durango)');
DROP FUNCTION t122_assert(BOOLEAN, TEXT);
