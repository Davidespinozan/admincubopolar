// billing-webhook-mercadopago — P0 seguridad financiera.
//
// ANTES: aceptaba cualquier POST; si `Payment.get` fallaba usaba el body
// recibido como si fuera el pago → un POST forjado podía crear pagos,
// bajar CxC y mover clientes.saldo.
//
// AHORA (modelo de autenticidad):
//   1. Verifica `x-signature` (ts + v1 = HMAC-SHA256 del manifest
//      id:<data.id>;request-id:<x-request-id>;ts:<ts>;) con la clave
//      secreta de Webhooks de la app de Mercado Pago
//      (env MERCADOPAGO_WEBHOOK_SECRET). Sin secret o firma inválida →
//      401 y CERO writes.
//   2. Consulta el pago al proveedor por `data.id`. El body NUNCA se usa
//      como fuente de status/monto/moneda/orden. Pago inexistente →
//      CERO writes.
//   3. syncOrderPayment aplica invariantes (orden existe, status
//      approved, MXN, monto == total, idempotencia) antes de cualquier
//      mutación financiera.
//
// Se exporta `createHandler(deps)` para tests sin red.

import { Payment } from 'mercadopago';
import { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError, unauthorized } from '../_lib/http.js';
import { getMercadoPagoClient } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent } from '../_lib/persistence.js';
import { normalizeMercadoPagoPayment, verifyMercadoPagoSignature } from '../_lib/paymentSecurity.js';
import { withSentry } from '../_lib/sentry.js';

const defaultFetchPayment = async (id) => {
  const paymentApi = new Payment(getMercadoPagoClient());
  return paymentApi.get({ id });
};

export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchPayment = defaultFetchPayment,
  getSecret = () => process.env.MERCADOPAGO_WEBHOOK_SECRET || '',
  nowSec = () => Math.floor(Date.now() / 1000),
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = {};
  try {
    body = await readJsonBody(event);
  } catch {
    return badRequest('JSON inválido');
  }

  const query = event.queryStringParameters || {};

  // 1. Autenticidad server-side. Falla cerrado: sin secret configurado
  //    ningún webhook se procesa.
  const firma = verifyMercadoPagoSignature({
    headers: event.headers || {},
    query,
    body,
    secret: getSecret(),
    nowSec: nowSec(),
  });
  if (!firma.ok) {
    console.warn('[billing-webhook-mercadopago] rechazado:', firma.reason);
    return unauthorized(`Webhook no autenticado (${firma.reason})`);
  }

  // Solo procesamos notificaciones de pago. merchant_order / plan /
  // subscription etc. se responden 200 sin escribir nada.
  const tipo = String(query.type || body?.type || body?.action || '');
  if (tipo && !tipo.startsWith('payment')) {
    return ok({ received: true, ignored: tipo });
  }

  // 2. Fuente de verdad: el proveedor.
  let paymentRaw = null;
  try {
    paymentRaw = await fetchPayment(firma.dataId);
  } catch (error) {
    // MP reintenta ante 5xx. Cero writes.
    return json(502, { error: 'No se pudo consultar el pago en Mercado Pago', details: error?.message });
  }
  const payment = normalizeMercadoPagoPayment(paymentRaw);
  if (!payment?.id) return badRequest('Pago inexistente en Mercado Pago');
  if (String(payment.id) !== String(firma.dataId)) {
    return badRequest('El pago consultado no coincide con data.id');
  }

  try {
    const supabase = getSupabase();

    // Auditoría (no financiera): solo después de verificar autenticidad
    // y existencia del pago en el proveedor.
    const webhookEvent = await insertWebhookEvent({
      provider: 'mercadopago',
      event_type: tipo || 'payment',
      provider_reference: payment.id,
      raw_payload: { query, body, payment: paymentRaw },
    }, supabase);

    let result;
    if (payment.status === 'approved') {
      result = await syncOrderPayment({
        provider: 'mercadopago',
        providerReference: payment.id,
        payment,
        rawPayload: paymentRaw,
      }, { supabase });
    } else {
      // pending / rejected / cancelled / refunded: se refleja en el
      // intent sin mutación financiera.
      if (payment.ordenId) {
        await upsertPaymentIntent({
          orden_id: payment.ordenId,
          provider: 'mercadopago',
          provider_reference: payment.id,
          status: payment.status || 'pending',
          amount: Number.isFinite(payment.amount) ? payment.amount : 0,
          currency: payment.currency || 'MXN',
          raw_payload: paymentRaw,
        }, supabase);
      }
      result = { applied: false, code: `status_${payment.status || 'unknown'}` };
    }

    await markWebhookEventProcessed(webhookEvent.id, supabase);

    return ok({ received: true, applied: result.applied, code: result.code });
  } catch (error) {
    return serverError('Mercado Pago webhook failed', error.message);
  }
};

export const handler = withSentry(createHandler());
