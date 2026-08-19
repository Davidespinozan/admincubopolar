// cron-rutas-atoradas — cron diario (Tanda 21): detecta rutas de días
// anteriores que siguen en estatus no terminal y avisa en la campana.
//
// Una ruta de ayer sin cerrar = caja sin cortar + inventario en el
// limbo del camión. Programado en netlify.toml a las 13:30 UTC =
// 7:30 CDMX (después del cron de CxC para no empalmar).
//
// Solo LEE rutas y ESCRIBE en notificaciones; cerrar la ruta sigue
// siendo flujo humano (cerrarRutaCompleta desde el ERP). Dedup diario
// vía referencia `cron-rutas:YYYY-MM-DD`, igual que cron-cxc-vencidas.

import { ok, serverError } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import {
  buildNotifRutasAtoradas,
  fechaHoyMx,
  filtrarRutasAtoradas,
} from '../../../src/data/cronAlertasLogic.js';

const _handler = async () => {
  const supabase = getSupabaseAdmin();
  const hoy = fechaHoyMx();
  const referencia = `cron-rutas:${hoy}`;

  const { data: previa, error: prevError } = await supabase
    .from('notificaciones')
    .select('id')
    .eq('referencia', referencia)
    .limit(1);
  if (prevError) return serverError('No se pudo verificar dedup', prevError.message);
  if (previa && previa.length > 0) return ok({ skipped: true, referencia });

  // Mantener el literal en sync con ESTADOS_TERMINALES_RUTA
  // (src/data/rutasLogic.js); filtrarRutasAtoradas re-filtra en memoria
  // con el Set canónico por si esta query y el Set divergen.
  const { data: rutas, error } = await supabase
    .from('rutas')
    .select('id, folio, nombre, estatus, fecha')
    .lt('fecha', hoy)
    .not('estatus', 'in', '("Cerrada","Cancelada","Completada")');
  if (error) return serverError('No se pudo leer rutas', error.message);

  const atoradas = filtrarRutasAtoradas(rutas, hoy);
  const notif = buildNotifRutasAtoradas(atoradas, hoy);
  if (!notif) return ok({ atoradas: 0 });

  const { error: insError } = await supabase.from('notificaciones').insert(notif);
  if (insError) return serverError('No se pudo insertar la notificación', insError.message);

  return ok({ atoradas: atoradas.length, referencia });
};

export const handler = withSentry(_handler);
