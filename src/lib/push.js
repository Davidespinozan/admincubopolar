// push.js — cliente de Web Push (Tanda 30). Activar/desactivar avisos
// en este dispositivo contra la function push-subscribe. La conversión
// de llave y el payload viven en src/data/pushLogic.ts (testeados).

import { backendGet, backendPost } from './backend';
import { urlBase64ToUint8Array } from '../data/pushLogic';

export const soportaPush = () =>
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  'PushManager' in window &&
  'Notification' in window;

/** Config del servidor: { enabled, publicKey? }. Nunca lanza. */
export async function obtenerConfigPush() {
  try {
    return await backendGet('push-subscribe');
  } catch {
    return { enabled: false };
  }
}

/** Suscripción actual de este navegador, o null. */
export async function suscripcionActual() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

/**
 * Flujo completo de activación: permiso del navegador → subscribe con
 * la llave pública → registrar en backend. Lanza con mensaje humano si
 * algo falla (la UI lo muestra tal cual).
 */
export async function activarPush(publicKey) {
  const permiso = await Notification.requestPermission();
  if (permiso !== 'granted') {
    throw new Error('Permiso de notificaciones denegado — actívalo en la configuración del navegador');
  }
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });
  await backendPost('push-subscribe', { accion: 'subscribe', subscription: sub.toJSON() });
  return sub;
}

/** Baja local + en backend. Tolerante: si algo ya no existe, no truena. */
export async function desactivarPush() {
  const sub = await suscripcionActual();
  if (!sub) return;
  const endpoint = sub.endpoint;
  try { await sub.unsubscribe(); } catch { /* ya estaba dada de baja en el navegador */ }
  try {
    await backendPost('push-subscribe', { accion: 'unsubscribe', subscription: { endpoint } });
  } catch { /* backend caído: la suscripción muerta se auto-limpia al 410 */ }
}
