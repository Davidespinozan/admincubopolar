import { ok } from '../_lib/http.js';

export const handler = async () => {
  return ok({
    payments: {
      stripe: Boolean(process.env.STRIPE_SECRET_KEY),
      mercadoPago: Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN),
    },
    invoicing: {
      facturama: Boolean(process.env.FACTURAMA_USERNAME && process.env.FACTURAMA_PASSWORD),
    },
  });
};