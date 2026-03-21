import Stripe from 'stripe';
import { MercadoPagoConfig } from 'mercadopago';
import { optionalEnv, requireEnv } from './env.js';

let stripeClient;
let mercadoPagoClient;

const getStripeClient = () => {
  if (!stripeClient) {
    stripeClient = new Stripe(requireEnv('STRIPE_SECRET_KEY'));
  }
  return stripeClient;
};

const getMercadoPagoClient = () => {
  if (!mercadoPagoClient) {
    mercadoPagoClient = new MercadoPagoConfig({ accessToken: requireEnv('MERCADOPAGO_ACCESS_TOKEN') });
  }
  return mercadoPagoClient;
};

const getFacturamaConfig = () => ({
  baseUrl: optionalEnv('FACTURAMA_API_URL', 'https://apisandbox.facturama.mx'),
  username: requireEnv('FACTURAMA_USERNAME'),
  password: requireEnv('FACTURAMA_PASSWORD'),
});

export { getFacturamaConfig, getMercadoPagoClient, getStripeClient };