// cron-push — repartidor de Web Push (Tanda 30). Cada 5 minutos toma
// las notificaciones nuevas (push_enviada = false) y las manda a todos
// los dispositivos suscritos, con el mismo deep link que la campana.
//
// Diseño anti-inundación:
// - Solo notificaciones de las últimas 6 horas (si el cron estuvo
//   caído un fin de semana, no revienta los teléfonos el lunes).
// - Máximo 10 por corrida.
// - push_enviada se marca ANTES de enviar: si el envío falla a medias,
//   preferimos perder un aviso a repetirlo en loop cada 5 minutos.
// Seam: sin vars VAPID responde skipped y no toca nada.

import { ok, serverError } from '../_lib/http.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { enviarPushATodas, pushHabilitado } from '../_lib/push.js';
import { buildPushPayload } from '../../../src/data/pushLogic';

const _handler = async () => {
  if (!pushHabilitado()) return ok({ skipped: 'VAPID no configurado' });

  const supabase = getSupabaseAdmin();
  const desde = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  const { data: pendientes, error } = await supabase
    .from('notificaciones')
    .select('id, tipo, titulo, mensaje, referencia')
    .eq('push_enviada', false)
    .gte('created_at', desde)
    .order('id', { ascending: true })
    .limit(10);
  if (error) return serverError('No se pudieron leer notificaciones', error.message);
  if (!pendientes || pendientes.length === 0) return ok({ enviadas: 0 });

  const ids = pendientes.map(n => n.id);
  const { error: markError } = await supabase
    .from('notificaciones')
    .update({ push_enviada: true })
    .in('id', ids);
  if (markError) return serverError('No se pudo marcar push_enviada', markError.message);

  let totalEnviadas = 0;
  let totalBorradas = 0;
  for (const notif of pendientes) {
    const { enviadas, borradas } = await enviarPushATodas(supabase, buildPushPayload(notif));
    totalEnviadas += enviadas;
    totalBorradas += borradas;
  }

  return ok({ notificaciones: pendientes.length, enviadas: totalEnviadas, suscripcionesBorradas: totalBorradas });
};

export const handler = withSentry(_handler);
