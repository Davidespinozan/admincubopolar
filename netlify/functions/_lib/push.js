// push.js — envío de Web Push desde las functions (Tanda 30).
//
// Seam: pushHabilitado() exige las 3 vars VAPID; sin ellas, quien nos
// llame se apaga limpio (cron → skipped, subscribe → enabled:false).

import webpush from 'web-push';

export const pushHabilitado = () =>
  Boolean(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );

let configurado = false;
const configurar = () => {
  if (configurado) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
  configurado = true;
};

/**
 * Envía un payload a las suscripciones registradas. Un endpoint muerto
 * (404/410 = el usuario revocó el permiso o cambió de navegador) se borra
 * de la tabla en el acto — así la lista se auto-limpia.
 *
 * `usuarioIds` limita el envío a los dispositivos de esas personas
 * (lista vacía = a nadie). Sin `usuarioIds` va a todas las suscripciones.
 *
 * @param {object} supabase cliente service_role
 * @param {{ title: string, body: string, url: string }} payload
 * @param {{ usuarioIds?: number[] }} [opciones]
 * @returns {Promise<{ enviadas: number, borradas: number, fallidas: number }>}
 */
export async function enviarPush(supabase, payload, { usuarioIds } = {}) {
  if (Array.isArray(usuarioIds) && usuarioIds.length === 0) return { enviadas: 0, borradas: 0, fallidas: 0 };
  configurar();
  let consulta = supabase.from('push_subscriptions').select('id, endpoint, p256dh, auth');
  if (Array.isArray(usuarioIds)) consulta = consulta.in('usuario_id', usuarioIds);
  const { data: subs, error } = await consulta;
  if (error) throw new Error(`push_subscriptions: ${error.message}`);

  let enviadas = 0;
  let borradas = 0;
  let fallidas = 0;
  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify(payload),
        { TTL: 3600 }
      );
      enviadas += 1;
    } catch (e) {
      if (e?.statusCode === 404 || e?.statusCode === 410) {
        await supabase.from('push_subscriptions').delete().eq('id', s.id);
        borradas += 1;
      } else {
        fallidas += 1;
        console.warn('[push] envío falló:', e?.statusCode, e?.message);
      }
    }
  }
  return { enviadas, borradas, fallidas };
}

/**
 * Usuarios activos de los roles que ven la campana de notificaciones del
 * negocio (Admin y Facturación). Los avisos de cartera, rutas, etc. no van
 * al teléfono de un chofer o un empleado que activó avisos para su asistencia.
 */
export async function usuariosDeCampana(supabase) {
  const { data, error } = await supabase
    .from('usuarios')
    .select('id')
    .eq('estatus', 'Activo')
    .in('rol', ['Admin', 'Facturación']);
  if (error) throw new Error(`usuarios: ${error.message}`);
  return (data || []).map(u => u.id);
}
