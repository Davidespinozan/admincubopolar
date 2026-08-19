// cron-cxc-vencidas — cron diario (Tanda 21): detecta cartera vencida
// y deja UNA notificación resumen en la campana del ERP.
//
// Programado en netlify.toml a las 13:00 UTC = 7:00 CDMX, antes de que
// arranque el día operativo. Solo LEE cuentas_por_cobrar y ESCRIBE en
// notificaciones — nunca muta el estatus de las cuentas (eso es
// decisión del humano en el módulo Por cobrar).
//
// Dedup: referencia `cron-cxc:YYYY-MM-DD`. Si Netlify reintenta el cron
// o alguien lo invoca a mano dos veces, la segunda corrida ve la
// notificación existente y sale sin insertar.

import { ok, serverError } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import {
  buildNotifCxcVencidas,
  fechaHoyMx,
  filtrarCxcVencidas,
} from '../../../src/data/cronAlertasLogic.js';

const _handler = async () => {
  const supabase = getSupabaseAdmin();
  const hoy = fechaHoyMx();
  const referencia = `cron-cxc:${hoy}`;

  const { data: previa, error: prevError } = await supabase
    .from('notificaciones')
    .select('id')
    .eq('referencia', referencia)
    .limit(1);
  if (prevError) return serverError('No se pudo verificar dedup', prevError.message);
  if (previa && previa.length > 0) return ok({ skipped: true, referencia });

  // El filtro grueso va en SQL (estatus cobrable + saldo + vencida);
  // filtrarCxcVencidas re-valida en memoria por si el esquema cambia.
  const { data: cuentas, error } = await supabase
    .from('cuentas_por_cobrar')
    .select('id, cliente_id, saldo_pendiente, fecha_vencimiento, estatus')
    .in('estatus', ['Pendiente', 'Parcial', 'Vencida'])
    .gt('saldo_pendiente', 0)
    .lt('fecha_vencimiento', hoy);
  if (error) return serverError('No se pudo leer cuentas_por_cobrar', error.message);

  const vencidas = filtrarCxcVencidas(cuentas, hoy);
  const notif = buildNotifCxcVencidas(vencidas, hoy);
  if (!notif) return ok({ vencidas: 0 });

  const { error: insError } = await supabase.from('notificaciones').insert(notif);
  if (insError) return serverError('No se pudo insertar la notificación', insError.message);

  return ok({ vencidas: vencidas.length, referencia });
};

export const handler = withSentry(_handler);
