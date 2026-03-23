import { Preference } from 'mercadopago';
import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getMercadoPagoClient, getStripeClient } from '../_lib/providers.js';
import { upsertPaymentIntent } from '../_lib/persistence.js';

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const body = await readJsonBody(event);
    const { provider, ordenId, amount, currency = 'MXN', description, items, customer, successUrl, cancelUrl } = body;

    if (!provider || !ordenId || !amount || Number(amount) <= 0) {
      return badRequest('provider, ordenId and amount are required');
    }

    const canonicalAmount = Number(amount);
    const canonicalItems = items || [];

    // Build line items from order items or fallback to single line
    const buildStripeLineItems = () => {
      if (canonicalItems.length > 0) {
        const lineItems = canonicalItems.map(item => ({
          quantity: item.quantity || 1,
          price_data: {
            currency: currency.toLowerCase(),
            unit_amount: Math.round(Number(item.unitPrice) * 100),
            product_data: { name: item.name || item.sku || 'Producto' },
          },
        }));
        // IVA tasa 0% para hielo — no se agrega línea de impuesto
        return lineItems;
      }
      return [{ quantity: 1, price_data: { currency: currency.toLowerCase(), unit_amount: Math.round(canonicalAmount * 100), product_data: { name: description || `Orden ${ordenId}` } } }];
    };

    if (provider === 'stripe') {
      if (!successUrl || !cancelUrl) return badRequest('successUrl and cancelUrl are required for Stripe');
      const stripe = getStripeClient();
      const session = await stripe.checkout.sessions.create({
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        payment_method_types: ['card'],
        customer_email: customer?.email || undefined,
        metadata: { orden_id: String(ordenId) },
        line_items: buildStripeLineItems(),
      });

      upsertPaymentIntent({
        orden_id: ordenId,
        provider: 'stripe',
        provider_reference: session.id,
        status: session.status || 'open',
        amount: canonicalAmount,
        currency,
        checkout_url: session.url,
        raw_payload: session,
      }).catch(() => {});

      return ok({ provider: 'stripe', checkoutUrl: session.url, reference: session.id });
    }

    if (provider === 'mercadopago') {
      const preference = new Preference(getMercadoPagoClient());
      const mpItems = canonicalItems.length > 0
        ? canonicalItems.map((item, i) => ({
            id: `${ordenId}-${i}`,
            title: item.name || item.sku || 'Producto',
            quantity: item.quantity || 1,
            currency_id: currency,
            unit_price: Number(item.unitPrice || 0),
          }))
        : [{ id: String(ordenId), title: description || `Orden ${ordenId}`, quantity: 1, currency_id: currency, unit_price: canonicalAmount }];

      if (canonicalItems.length > 0) {
        // IVA tasa 0% para hielo — no se agrega línea de impuesto
      }

      const result = await preference.create({
        body: {
          external_reference: String(ordenId),
          items: mpItems,
          payer: { email: customer?.email || 'pagos@cubopolar.local' },
          back_urls: successUrl && cancelUrl ? { success: successUrl, failure: cancelUrl, pending: cancelUrl } : undefined,
          auto_return: successUrl ? 'approved' : undefined,
          metadata: { orden_id: String(ordenId) },
        },
      });

      upsertPaymentIntent({
        orden_id: ordenId,
        provider: 'mercadopago',
        provider_reference: String(result.id),
        status: result.status || 'pending',
        amount: canonicalAmount,
        currency,
        checkout_url: result.init_point || result.sandbox_init_point || null,
        raw_payload: result,
      }).catch(() => {});

      return ok({
        provider: 'mercadopago',
        checkoutUrl: result.init_point || result.sandbox_init_point || null,
        reference: result.id,
      });
    }

    return badRequest('Unsupported provider');
  } catch (error) {
    return serverError(error.message || 'Could not create checkout', error.message);
  }
};
