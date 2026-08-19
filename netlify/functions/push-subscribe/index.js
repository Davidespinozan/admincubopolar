// push-subscribe — alta/baja de dispositivos para Web Push (Tanda 30).
//
//   GET  (público)     → { enabled, publicKey } — el frontend decide si
//                        mostrar el botón y con qué llave suscribirse.
//   POST (autenticado) → { accion: 'subscribe'|'unsubscribe', subscription }
//                        subscribe: upsert por endpoint, ligado al
//                        usuario del token. unsubscribe: borra por
//                        endpoint.
//
// Seam: sin vars VAPID, GET responde enabled:false y POST 501.

import { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import { pushHabilitado } from '../_lib/push.js';

const _handler = async (event) => {
  if (event.httpMethod === 'GET') {
    if (!pushHabilitado()) return ok({ enabled: false });
    return ok({ enabled: true, publicKey: process.env.VAPID_PUBLIC_KEY });
  }

  if (event.httpMethod !== 'POST') return methodNotAllowed(['GET', 'POST']);
  if (!pushHabilitado()) return json(501, { error: 'Web Push no configurado (faltan vars VAPID en Netlify)' });

  const auth = await getAuthenticatedProfile(event);
  if (auth.errorResponse) return auth.errorResponse;
  const { profile } = auth;

  let body;
  try {
    body = await readJsonBody(event);
  } catch {
    return badRequest('JSON inválido');
  }

  const supabase = getSupabaseAdmin();
  const endpoint = String(body?.subscription?.endpoint || '').trim();
  if (!endpoint.startsWith('https://')) return badRequest('subscription.endpoint requerido');

  if (body.accion === 'unsubscribe') {
    const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    if (error) return serverError('No se pudo dar de baja', error.message);
    return ok({ unsubscribed: true });
  }

  const p256dh = String(body?.subscription?.keys?.p256dh || '');
  const claveAuth = String(body?.subscription?.keys?.auth || '');
  if (!p256dh || !claveAuth) return badRequest('subscription.keys incompleta');

  const { error } = await supabase.from('push_subscriptions').upsert({
    usuario_id: profile?.id ?? null,
    endpoint,
    p256dh,
    auth: claveAuth,
    user_agent: String(event.headers?.['user-agent'] || '').slice(0, 300),
  }, { onConflict: 'endpoint' });
  if (error) return serverError('No se pudo registrar el dispositivo', error.message);

  return ok({ subscribed: true });
};

export const handler = withSentry(_handler);
