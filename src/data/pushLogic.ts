// pushLogic.ts — lógica pura de Web Push (Tanda 30).
//
// Dos piezas testeables que comparten frontend y backend:
// - buildPushPayload: convierte una fila de `notificaciones` en el
//   payload que muestra el service worker (título, cuerpo y deep link
//   #/modulo usando el mismo mapeo de la campana).
// - urlBase64ToUint8Array: la llave pública VAPID viaja en base64url y
//   PushManager.subscribe exige bytes.

import { moduloParaNotificacion } from './navegacionShellLogic';

export interface PushPayload {
  title: string;
  body: string;
  url: string;
}

/**
 * Payload de push desde una fila de notificaciones (snake o camel: los
 * campos usados se llaman igual en ambos). El deep link reutiliza
 * moduloParaNotificacion — el push abre el MISMO módulo que abriría
 * tocar la notificación en la campana; sin mapeo cae a Mi bandeja.
 */
export function buildPushPayload(notif: {
  tipo?: string;
  titulo?: string;
  mensaje?: string;
  referencia?: string;
} | null | undefined): PushPayload {
  const modulo = moduloParaNotificacion(notif) || 'bandeja';
  return {
    title: String(notif?.titulo || 'CuboPolar'),
    body: String(notif?.mensaje || ''),
    url: `/#/${modulo}`,
  };
}

/**
 * base64url → Uint8Array (applicationServerKey para
 * pushManager.subscribe). Acepta base64 estándar y base64url, con o
 * sin padding. String inválido lanza (mejor fallar al activar que
 * suscribirse con una llave corrupta).
 */
export function urlBase64ToUint8Array(base64url: string): Uint8Array {
  const limpio = String(base64url || '').trim();
  if (!limpio) throw new Error('Llave VAPID vacía');
  const padding = '='.repeat((4 - (limpio.length % 4)) % 4);
  const base64 = (limpio + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
