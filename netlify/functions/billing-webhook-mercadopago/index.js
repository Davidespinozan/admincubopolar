import { Payment } from 'mercadopago';
import { methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getMercadoPagoClient } from '../_lib/providers.js';
import { insertWebhookEvent, markWebhookEventProcessed, syncOrderPayment, upsertPaymentIntent } from '../_lib/persistence.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const payload = await readJsonBody(event);
    const providerReference = String(payload?.data?.id || payload?.id || 'unknown');

    const webhookEvent = await insertWebhookEvent({
      provider: 'mercadopago',
      event_type: payload?.type || payload?.action || 'unknown',
      provider_reference: providerReference,
      raw_payload: payload,
    });

    let paymentDetail = null;
    if (providerReference !== 'unknown') {
      try {
        const paymentApi = new Payment(getMercadoPagoClient());
        paymentDetail = await paymentApi.get({ id: providerReference });
      } catch {
        paymentDetail = null;
      }
    }

    const effectivePayload = paymentDetail || payload?.data || payload;
    const ordenId = Number(
      effectivePayload?.metadata?.orden_id ||
      effectivePayload?.external_reference ||
      payload?.data?.metadata?.orden_id ||
      0
    ) || null;
    const status = effectivePayload?.status || payload?.status || 'pending';
    const amount = Number(effectivePayload?.transaction_amount || payload?.transaction_amount || 0);
    const currency = (effectivePayload?.currency_id || payload?.currency_id || 'MXN').toUpperCase();

    if (status === 'approved') {
      await syncOrderPayment({
        ordenId,
        provider: 'mercadopago',
        providerReference,
        amount,
        currency,
        metodoPago: 'Mercado Pago',
        rawPayload: paymentDetail || payload,
      });
    } else {
      await upsertPaymentIntent({
        orden_id: ordenId,
        provider: 'mercadopago',
        provider_reference: providerReference,
        status,
        amount,
        currency,
        raw_payload: paymentDetail || payload,
      });
    }

    await markWebhookEventProcessed(webhookEvent.id);

    return ok({ received: true });
  } catch (error) {
    return serverError('Mercado Pago webhook failed', error.message);
  }
};