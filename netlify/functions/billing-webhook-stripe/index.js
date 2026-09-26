import Stripe from 'stripe';
import { methodNotAllowed, ok, serverError, unauthorized } from '../_lib/http.js';
import { requireEnv } from '../_lib/env.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent } from '../_lib/persistence.js';
import { normalizeStripeSession } from '../_lib/paymentSecurity.js';
import { withSentry } from '../_lib/sentry.js';

// Autenticidad: firma `stripe-signature` verificada con
// STRIPE_WEBHOOK_SECRET (constructEvent lanza si no coincide) → 401 y
// cero writes. Después, syncOrderPayment aplica las mismas invariantes
// que Mercado Pago (orden existe, pagado, MXN, monto == total,
// idempotencia).
export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  constructEvent = (rawBody, signature) => {
    const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
    return stripe.webhooks.constructEvent(rawBody, signature, requireEnv('STRIPE_WEBHOOK_SECRET'));
  },
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let payload;
  try {
    const signature = event.headers?.['stripe-signature'] || event.headers?.['Stripe-Signature'];
    if (!signature) return unauthorized('Webhook no autenticado (missing_signature)');
    payload = constructEvent(event.body, signature);
  } catch (error) {
    console.warn('[billing-webhook-stripe] rechazado:', error?.message);
    return unauthorized('Webhook no autenticado (bad_signature)');
  }

  try {
    const supabase = getSupabase();
    const webhookEvent = await insertWebhookEvent({
      provider: 'stripe',
      event_type: payload.type,
      provider_reference: payload.id,
      raw_payload: payload,
    }, supabase);

    let result = { applied: false, code: 'ignored' };
    if (payload.type === 'checkout.session.completed') {
      const session = payload.data.object;
      const payment = normalizeStripeSession(session);
      result = await syncOrderPayment({
        provider: 'stripe',
        providerReference: session.id,
        payment,
        rawPayload: session,
      }, { supabase });
    } else if (String(payload.type || '').startsWith('checkout.session.')) {
      const session = payload.data.object;
      const payment = normalizeStripeSession(session);
      if (payment.ordenId) {
        const intent = {
          orden_id: payment.ordenId,
          provider: 'stripe',
          provider_reference: session.id,
          status: session.payment_status || session.status || 'open',
          amount: payment.amount,
          currency: payment.currency || 'MXN',
          raw_payload: session,
        };
        // No pisar checkout_url con NULL en eventos expired/async_*.
        if (session.url) intent.checkout_url = session.url;
        await upsertPaymentIntent(intent, supabase);
      }
      result = { applied: false, code: `status_${session.payment_status || session.status || 'unknown'}` };
    }

    await markWebhookEventProcessed(webhookEvent.id, supabase);

    return ok({ received: true, applied: result.applied, code: result.code });
  } catch (error) {
    return serverError('Stripe webhook failed', error.message);
  }
};

export const handler = withSentry(createHandler());
