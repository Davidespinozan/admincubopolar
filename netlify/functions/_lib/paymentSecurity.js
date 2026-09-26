// paymentSecurity.js — P0 seguridad financiera.
//
// Lógica PURA (sin red, sin Supabase) para:
//   1. Verificar la autenticidad de un webhook de Mercado Pago con el
//      mecanismo oficial: header `x-signature` (ts=...,v1=...) firmado
//      con HMAC-SHA256 sobre el manifest
//        id:<data.id>;request-id:<x-request-id>;ts:<ts>;
//      usando la "clave secreta" que Mercado Pago muestra en la
//      configuración de Webhooks de la aplicación
//      (env MERCADOPAGO_WEBHOOK_SECRET).
//   2. Evaluar las invariantes que un pago confirmado por el proveedor
//      debe cumplir contra la orden interna antes de tocar pagos / CxC /
//      clientes.saldo.
//
// Las Netlify Functions solo orquestan; todo lo decidible se decide
// aquí para que sea testeable sin mocks de red.

import { createHmac, timingSafeEqual } from 'node:crypto';

const TOLERANCIA_TS_SEG_DEFAULT = 10 * 60; // 10 min, igual que el ejemplo oficial de MP
const CENTAVO = 0.01;

/**
 * Parsea `x-signature: ts=1704908010,v1=abcdef...` → { ts, v1 }.
 * Devuelve null si el header no trae ambas partes.
 */
export function parseXSignature(header) {
  if (!header || typeof header !== 'string') return null;
  const out = {};
  for (const part of header.split(',')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key === 'ts') out.ts = val;
    if (key === 'v1') out.v1 = val;
  }
  if (!out.ts || !out.v1) return null;
  return out;
}

/**
 * Manifest oficial de Mercado Pago. Las partes ausentes se omiten
 * (documentación: "si no está presente, se omite del manifest").
 * `data.id` alfanumérico va en minúsculas; numérico queda igual.
 */
export function buildMercadoPagoManifest({ dataId, requestId, ts }) {
  let manifest = '';
  if (dataId !== undefined && dataId !== null && String(dataId) !== '') {
    const id = String(dataId);
    manifest += `id:${/[a-zA-Z]/.test(id) ? id.toLowerCase() : id};`;
  }
  if (requestId) manifest += `request-id:${requestId};`;
  if (ts) manifest += `ts:${ts};`;
  return manifest;
}

const headerCI = (headers, name) => {
  if (!headers) return undefined;
  const lower = name.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (String(k).toLowerCase() === lower) return v;
  }
  return undefined;
};

const safeEqualHex = (a, b) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (!/^[0-9a-f]+$/i.test(a) || !/^[0-9a-f]+$/i.test(b)) return false;
  const ba = Buffer.from(a.toLowerCase(), 'hex');
  const bb = Buffer.from(b.toLowerCase(), 'hex');
  if (ba.length === 0 || ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
};

/**
 * Verifica server-side la autenticidad de un webhook de Mercado Pago.
 *
 * @param {Object} p
 * @param {Object} p.headers  - headers del request (case-insensitive)
 * @param {Object} p.query    - query string params (`data.id`, `id`, `type`)
 * @param {Object} p.body     - body JSON ya parseado (fallback para data.id)
 * @param {string} p.secret   - MERCADOPAGO_WEBHOOK_SECRET
 * @param {number} [p.nowSec] - epoch en segundos (inyectable para tests)
 * @param {number} [p.toleranceSec]
 * @returns {{ ok: boolean, reason?: string, dataId?: string }}
 */
export function verifyMercadoPagoSignature({ headers, query, body, secret, nowSec, toleranceSec = TOLERANCIA_TS_SEG_DEFAULT }) {
  if (!secret) return { ok: false, reason: 'missing_secret' };

  const parsed = parseXSignature(headerCI(headers, 'x-signature'));
  if (!parsed) return { ok: false, reason: 'missing_signature' };

  const requestId = headerCI(headers, 'x-request-id');
  const dataId = query?.['data.id'] ?? query?.id ?? body?.data?.id ?? null;
  if (dataId === null || dataId === undefined || String(dataId) === '') {
    return { ok: false, reason: 'missing_data_id' };
  }

  const tsNum = Number(parsed.ts);
  if (!Number.isFinite(tsNum)) return { ok: false, reason: 'invalid_ts' };
  // MP manda ts en milisegundos en la práctica; el ejemplo oficial lo
  // trata como opaco. Toleramos ambos: normalizamos a segundos.
  const tsSec = tsNum > 1e12 ? Math.floor(tsNum / 1000) : tsNum;
  const now = Number.isFinite(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsSec) > toleranceSec) return { ok: false, reason: 'stale_ts' };

  const manifest = buildMercadoPagoManifest({ dataId, requestId, ts: parsed.ts });
  const expected = createHmac('sha256', secret).update(manifest).digest('hex');
  if (!safeEqualHex(expected, parsed.v1)) return { ok: false, reason: 'bad_signature' };

  return { ok: true, dataId: String(dataId) };
}

/**
 * Helper para tests / herramientas: firma un webhook como lo haría
 * Mercado Pago. NO se usa en producción.
 */
export function signMercadoPagoWebhook({ dataId, requestId, ts, secret }) {
  const manifest = buildMercadoPagoManifest({ dataId, requestId, ts });
  return createHmac('sha256', secret).update(manifest).digest('hex');
}

/**
 * Resuelve el id de orden interno a partir del pago confirmado por el
 * proveedor. Solo acepta enteros positivos.
 */
export function resolveOrdenIdFromPayment(payment) {
  const raw = payment?.metadata?.orden_id ?? payment?.external_reference ?? null;
  if (raw === null || raw === undefined) return null;
  const str = String(raw).trim();
  if (!/^\d+$/.test(str)) return null;
  const num = Number(str);
  return num > 0 ? num : null;
}

const ESTATUS_ORDEN_NO_COBRABLE = new Set(['Cancelada']);

/**
 * Invariantes que debe cumplir un pago ANTES de mutar pagos/CxC/saldo.
 *
 * @param {Object} p
 * @param {'stripe'|'mercadopago'} p.provider
 * @param {string} p.providerReference
 * @param {Object|null} p.orden  - fila de ordenes { id, total, estatus, cliente_id }
 * @param {Object} p.payment     - { status, amount, currency } normalizado
 * @param {string} [p.expectedCurrency='MXN']
 * @returns {{ ok: boolean, code?: string, detail?: string }}
 */
export function evaluatePaymentInvariants({ provider, providerReference, orden, payment, expectedCurrency = 'MXN' }) {
  if (provider !== 'stripe' && provider !== 'mercadopago') {
    return { ok: false, code: 'provider_invalid', detail: String(provider) };
  }
  if (!providerReference || String(providerReference) === 'unknown') {
    return { ok: false, code: 'reference_invalid' };
  }
  if (!orden || !orden.id) return { ok: false, code: 'orden_not_found' };
  if (ESTATUS_ORDEN_NO_COBRABLE.has(String(orden.estatus || ''))) {
    return { ok: false, code: 'orden_no_cobrable', detail: String(orden.estatus) };
  }

  const status = String(payment?.status || '').toLowerCase();
  const aprobado = (provider === 'mercadopago' && status === 'approved')
    || (provider === 'stripe' && (status === 'paid' || status === 'complete'));
  if (!aprobado) return { ok: false, code: 'status_not_paid', detail: status };

  const currency = String(payment?.currency || '').toUpperCase();
  if (currency !== String(expectedCurrency).toUpperCase()) {
    return { ok: false, code: 'currency_mismatch', detail: currency };
  }

  const montoConfirmado = Number(payment?.amount);
  const montoEsperado = Number(orden.total);
  if (!Number.isFinite(montoConfirmado) || montoConfirmado <= 0) {
    return { ok: false, code: 'amount_invalid', detail: String(payment?.amount) };
  }
  if (!Number.isFinite(montoEsperado) || montoEsperado <= 0) {
    return { ok: false, code: 'orden_total_invalid', detail: String(orden.total) };
  }
  if (Math.abs(montoConfirmado - montoEsperado) > CENTAVO) {
    return { ok: false, code: 'amount_mismatch', detail: `esperado=${montoEsperado} confirmado=${montoConfirmado}` };
  }

  return { ok: true };
}

/**
 * Normaliza el pago que devuelve `Payment.get()` del SDK de Mercado Pago
 * al shape que consume evaluatePaymentInvariants.
 */
export function normalizeMercadoPagoPayment(payment) {
  if (!payment || typeof payment !== 'object') return null;
  return {
    id: payment.id != null ? String(payment.id) : null,
    status: payment.status || null,
    amount: Number(payment.transaction_amount),
    currency: String(payment.currency_id || '').toUpperCase() || null,
    ordenId: resolveOrdenIdFromPayment(payment),
  };
}

/**
 * Normaliza una Checkout Session de Stripe (evento
 * checkout.session.completed) al shape común.
 */
export function normalizeStripeSession(session) {
  if (!session || typeof session !== 'object') return null;
  return {
    id: session.id || null,
    status: session.payment_status || session.status || null,
    amount: Number(session.amount_total || 0) / 100,
    currency: String(session.currency || '').toUpperCase() || null,
    ordenId: resolveOrdenIdFromPayment({ metadata: session.metadata, external_reference: session.client_reference_id }),
  };
}
