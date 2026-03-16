import Stripe from 'stripe';
import { methodNotAllowed, ok, serverError } from '../_lib/http.js';
import { requireEnv } from '../_lib/env.js';
import { insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent } from '../_lib/persistence.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const stripe = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
    const signature = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
    const webhookSecret = requireEnv('STRIPE_WEBHOOK_SECRET');
    const payload = stripe.webhooks.constructEvent(event.body, signature, webhookSecret);

    const webhookEvent = await insertWebhookEvent({
      provider: 'stripe',
      event_type: payload.type,
      provider_reference: payload.id,
      raw_payload: payload,
    });

    if (payload.type === 'checkout.session.completed') {
      const session = payload.data.object;
      await syncOrderPayment({
        ordenId: Number(session.metadata?.orden_id) || null,
        provider: 'stripe',
        providerReference: session.id,
        amount: (session.amount_total || 0) / 100,
        currency: (session.currency || 'mxn').toUpperCase(),
        metodoPago: 'Stripe',
        rawPayload: session,
      });
    } else if (payload.type.startsWith('checkout.session.')) {
      const session = payload.data.object;
      await upsertPaymentIntent({
        orden_id: Number(session.metadata?.orden_id) || null,
        provider: 'stripe',
        provider_reference: session.id,
        status: session.payment_status || session.status || 'open',
        amount: (session.amount_total || 0) / 100,
        currency: (session.currency || 'mxn').toUpperCase(),
        checkout_url: session.url || null,
        raw_payload: session,
      });
    }

    await markWebhookEventProcessed(webhookEvent.id);

    return ok({ received: true });
  } catch (error) {
    return serverError('Stripe webhook failed', error.message);
  }
};