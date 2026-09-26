// p0PagosSeguridad.test.js — P0: autenticidad de webhooks, invariantes
// de pago e idempotencia. Sin red: cliente Supabase falso + deps
// inyectadas en los handlers.
import { describe, it, expect } from 'vitest';
import {
  parseXSignature,
  buildMercadoPagoManifest,
  verifyMercadoPagoSignature,
  signMercadoPagoWebhook,
  evaluatePaymentInvariants,
  normalizeMercadoPagoPayment,
  normalizeStripeSession,
  resolveOrdenIdFromPayment,
} from '../../netlify/functions/_lib/paymentSecurity.js';
import { syncOrderPayment } from '../../netlify/functions/_lib/persistence.js';
import { createHandler as createMpHandler } from '../../netlify/functions/billing-webhook-mercadopago/index.js';
import { createHandler as createStripeHandler } from '../../netlify/functions/billing-webhook-stripe/index.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const SECRET = 'mp-secret-de-prueba';
const NOW = 1_800_000_000; // epoch seg fijo
const TS = String(NOW - 30);

const seedBase = () => ({
  clientes: [{ id: 32, nombre: 'SIX CANELAS', saldo: 350 }],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Asignada', cliente_id: 32 }],
  cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
});

const pagoMp = (over = {}) => ({
  id: 123456,
  status: 'approved',
  transaction_amount: 350,
  currency_id: 'MXN',
  external_reference: '46',
  metadata: { orden_id: '46' },
  ...over,
});

const eventoMp = ({ dataId = '123456', requestId = 'req-abc', ts = TS, sig, body } = {}) => ({
  httpMethod: 'POST',
  headers: {
    'x-signature': `ts=${ts},v1=${sig ?? signMercadoPagoWebhook({ dataId, requestId, ts, secret: SECRET })}`,
    'x-request-id': requestId,
  },
  queryStringParameters: { 'data.id': dataId, type: 'payment' },
  body: JSON.stringify(body || { action: 'payment.updated', type: 'payment', data: { id: dataId } }),
});

const mpHandler = (fake, fetchPayment) => createMpHandler({
  getSupabase: () => fake,
  fetchPayment,
  getSecret: () => SECRET,
  nowSec: () => NOW,
});

// ─── firma ────────────────────────────────────────────────────
describe('verifyMercadoPagoSignature', () => {
  it('parsea x-signature', () => {
    expect(parseXSignature('ts=1704908010,v1=abc')).toEqual({ ts: '1704908010', v1: 'abc' });
    expect(parseXSignature('v1=abc')).toBeNull();
    expect(parseXSignature('')).toBeNull();
    expect(parseXSignature(null)).toBeNull();
  });

  it('manifest oficial: id;request-id;ts; y alfanumérico en minúsculas', () => {
    expect(buildMercadoPagoManifest({ dataId: '123', requestId: 'r1', ts: '9' })).toBe('id:123;request-id:r1;ts:9;');
    expect(buildMercadoPagoManifest({ dataId: 'ABC1', requestId: 'r1', ts: '9' })).toBe('id:abc1;request-id:r1;ts:9;');
    expect(buildMercadoPagoManifest({ dataId: '123', ts: '9' })).toBe('id:123;ts:9;');
  });

  it('acepta una firma válida', () => {
    const ev = eventoMp();
    const r = verifyMercadoPagoSignature({ headers: ev.headers, query: ev.queryStringParameters, body: {}, secret: SECRET, nowSec: NOW });
    expect(r).toEqual({ ok: true, dataId: '123456' });
  });

  it('rechaza firma inválida, sin firma, sin secret, ts viejo y data.id alterado', () => {
    const ev = eventoMp();
    const q = ev.queryStringParameters;
    expect(verifyMercadoPagoSignature({ headers: ev.headers, query: q, secret: 'otro', nowSec: NOW }).reason).toBe('bad_signature');
    expect(verifyMercadoPagoSignature({ headers: {}, query: q, secret: SECRET, nowSec: NOW }).reason).toBe('missing_signature');
    expect(verifyMercadoPagoSignature({ headers: ev.headers, query: q, secret: '', nowSec: NOW }).reason).toBe('missing_secret');
    expect(verifyMercadoPagoSignature({ headers: ev.headers, query: q, secret: SECRET, nowSec: NOW + 3600 }).reason).toBe('stale_ts');
    expect(verifyMercadoPagoSignature({ headers: ev.headers, query: { 'data.id': '999' }, secret: SECRET, nowSec: NOW }).reason).toBe('bad_signature');
    expect(verifyMercadoPagoSignature({ headers: ev.headers, query: {}, body: {}, secret: SECRET, nowSec: NOW }).reason).toBe('missing_data_id');
  });

  it('acepta ts en milisegundos', () => {
    const tsMs = String((NOW - 5) * 1000);
    const ev = eventoMp({ ts: tsMs });
    const r = verifyMercadoPagoSignature({ headers: ev.headers, query: ev.queryStringParameters, secret: SECRET, nowSec: NOW });
    expect(r.ok).toBe(true);
  });
});

// ─── invariantes ──────────────────────────────────────────────
describe('evaluatePaymentInvariants', () => {
  const orden = { id: 46, total: 350, estatus: 'Asignada' };
  const ok = { status: 'approved', amount: 350, currency: 'MXN' };

  it('pago aprobado, MXN, monto exacto → ok', () => {
    expect(evaluatePaymentInvariants({ provider: 'mercadopago', providerReference: '1', orden, payment: ok })).toEqual({ ok: true });
    expect(evaluatePaymentInvariants({ provider: 'stripe', providerReference: 'cs_1', orden, payment: { ...ok, status: 'paid' } }).ok).toBe(true);
  });

  it('tolera 1 centavo de redondeo, no más', () => {
    expect(evaluatePaymentInvariants({ provider: 'mercadopago', providerReference: '1', orden, payment: { ...ok, amount: 350.009 } }).ok).toBe(true);
    expect(evaluatePaymentInvariants({ provider: 'mercadopago', providerReference: '1', orden, payment: { ...ok, amount: 349.9 } }).code).toBe('amount_mismatch');
  });

  it('rechaza: proveedor, referencia, orden, cancelada, status, moneda, monto', () => {
    const base = { provider: 'mercadopago', providerReference: '1', orden, payment: ok };
    expect(evaluatePaymentInvariants({ ...base, provider: 'paypal' }).code).toBe('provider_invalid');
    expect(evaluatePaymentInvariants({ ...base, providerReference: 'unknown' }).code).toBe('reference_invalid');
    expect(evaluatePaymentInvariants({ ...base, orden: null }).code).toBe('orden_not_found');
    expect(evaluatePaymentInvariants({ ...base, orden: { ...orden, estatus: 'Cancelada' } }).code).toBe('orden_no_cobrable');
    expect(evaluatePaymentInvariants({ ...base, payment: { ...ok, status: 'pending' } }).code).toBe('status_not_paid');
    expect(evaluatePaymentInvariants({ ...base, payment: { ...ok, currency: 'USD' } }).code).toBe('currency_mismatch');
    expect(evaluatePaymentInvariants({ ...base, payment: { ...ok, amount: 1 } }).code).toBe('amount_mismatch');
    expect(evaluatePaymentInvariants({ ...base, payment: { ...ok, amount: 0 } }).code).toBe('amount_invalid');
  });

  it('resolveOrdenIdFromPayment solo acepta enteros positivos', () => {
    expect(resolveOrdenIdFromPayment({ metadata: { orden_id: '46' } })).toBe(46);
    expect(resolveOrdenIdFromPayment({ external_reference: '7' })).toBe(7);
    expect(resolveOrdenIdFromPayment({ external_reference: '7; DROP' })).toBeNull();
    expect(resolveOrdenIdFromPayment({ external_reference: '0' })).toBeNull();
    expect(resolveOrdenIdFromPayment({})).toBeNull();
  });

  it('normaliza pagos de MP y sesiones de Stripe', () => {
    expect(normalizeMercadoPagoPayment(pagoMp())).toEqual({ id: '123456', status: 'approved', amount: 350, currency: 'MXN', ordenId: 46 });
    expect(normalizeStripeSession({ id: 'cs_1', payment_status: 'paid', amount_total: 35000, currency: 'mxn', metadata: { orden_id: '46' } }))
      .toEqual({ id: 'cs_1', status: 'paid', amount: 350, currency: 'MXN', ordenId: 46 });
    expect(normalizeMercadoPagoPayment(null)).toBeNull();
  });
});

// ─── webhook Mercado Pago end-to-end (sin red) ────────────────
describe('billing-webhook-mercadopago', () => {
  it('1. sin firma → 401 y cero writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const ev = eventoMp();
    delete ev.headers['x-signature'];
    const res = await mpHandler(fake, async () => pagoMp())(ev);
    expect(res.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it('2. firma inválida → 401 y cero writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    let fetches = 0;
    const res = await mpHandler(fake, async () => { fetches++; return pagoMp(); })(eventoMp({ sig: 'deadbeef' }));
    expect(res.statusCode).toBe(401);
    expect(fetches).toBe(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('2b. body forjado con status approved pero firma de otro secret → 401 y cero writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const body = { action: 'payment.updated', type: 'payment', data: { id: '123456', status: 'approved', transaction_amount: 350, metadata: { orden_id: '46' } } };
    const sig = signMercadoPagoWebhook({ dataId: '123456', requestId: 'req-abc', ts: TS, secret: 'secret-del-atacante' });
    const res = await mpHandler(fake, async () => pagoMp())(eventoMp({ sig, body }));
    expect(res.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
    expect(fake.db.pagos).toHaveLength(0);
  });

  it('3. payment inexistente en MP → sin writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => null)(eventoMp());
    expect(res.statusCode).toBe(400);
    expect(fake.writes).toHaveLength(0);
  });

  it('3b. MP no responde → 502 y cero writes (MP reintenta)', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => { throw new Error('timeout'); })(eventoMp());
    expect(res.statusCode).toBe(502);
    expect(fake.writes).toHaveLength(0);
  });

  it('3c. el body no es fuente de verdad: MP dice pending aunque el body diga approved', async () => {
    const fake = makeFakeSupabase(seedBase());
    const body = { action: 'payment.updated', type: 'payment', data: { id: '123456', status: 'approved', transaction_amount: 350 } };
    const res = await mpHandler(fake, async () => pagoMp({ status: 'pending' }))(eventoMp({ body }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).applied).toBe(false);
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.cuentas_por_cobrar[0].saldo_pendiente).toBe(350);
    expect(fake.db.payment_intents[0].status).toBe('pending');
  });

  it('4. orden inexistente → cero writes financieros', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => pagoMp({ external_reference: '999', metadata: { orden_id: '999' } }))(eventoMp());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).code).toBe('orden_not_found');
    expect(fake.writesFinancieras()).toHaveLength(0);
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.payment_intents).toHaveLength(0);
    // Solo auditoría del webhook autenticado
    expect(fake.db.payment_webhook_events).toHaveLength(1);
  });

  it('5. monto diferente → no aplica pago; queda intent review', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => pagoMp({ transaction_amount: 10 }))(eventoMp());
    expect(JSON.parse(res.body).code).toBe('amount_mismatch');
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.cuentas_por_cobrar[0].saldo_pendiente).toBe(350);
    expect(fake.db.clientes[0].saldo).toBe(350);
    expect(fake.db.ordenes[0].estatus).toBe('Asignada');
    expect(fake.rpcs).toHaveLength(0);
    expect(fake.db.payment_intents[0].status).toBe('review:amount_mismatch');
  });

  it('6. moneda diferente → no aplica pago', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => pagoMp({ currency_id: 'USD' }))(eventoMp());
    expect(JSON.parse(res.body).code).toBe('currency_mismatch');
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.cuentas_por_cobrar[0].saldo_pendiente).toBe(350);
    expect(fake.rpcs).toHaveLength(0);
  });

  it('7. webhook duplicado → exactamente un efecto financiero', async () => {
    const fake = makeFakeSupabase(seedBase());
    const h = mpHandler(fake, async () => pagoMp());
    const r1 = await h(eventoMp());
    const r2 = await h(eventoMp({ requestId: 'req-reintento' }));
    expect(JSON.parse(r1.body).applied).toBe(true);
    expect(JSON.parse(r2.body).code).toBe('duplicate');
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.cuentas_por_cobrar[0].saldo_pendiente).toBe(0);
    expect(fake.db.cuentas_por_cobrar[0].estatus).toBe('Pagada');
    expect(fake.db.clientes[0].saldo).toBe(0);
    expect(fake.rpcs.filter(r => r.name === 'increment_saldo')).toHaveLength(1);
    expect(fake.writes.filter(w => w.table === 'cuentas_por_cobrar')).toHaveLength(1);
  });

  it('8. pago aprobado válido → efecto esperado una sola vez', async () => {
    const fake = makeFakeSupabase(seedBase());
    const res = await mpHandler(fake, async () => pagoMp())(eventoMp());
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ received: true, applied: true, code: 'applied' });
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos[0]).toMatchObject({ cliente_id: 32, orden_id: 46, monto: 350, referencia: 'mercadopago:123456', metodo_pago: 'QR / Link de pago' });
    expect(fake.db.ordenes[0].estatus).toBe('Entregada');
    expect(fake.db.payment_intents[0]).toMatchObject({ provider: 'mercadopago', provider_reference: '123456', status: 'paid', amount: 350 });
    expect(fake.db.payment_webhook_events[0].processed).toBe(true);
  });

  it('orden anónima: pagos.cliente_id NULL, nunca 0', async () => {
    const seed = seedBase();
    seed.ordenes[0].cliente_id = null;
    seed.cuentas_por_cobrar = [];
    const fake = makeFakeSupabase(seed);
    await mpHandler(fake, async () => pagoMp())(eventoMp());
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos[0].cliente_id).toBeNull();
  });

  it('notificación que no es de pago → 200 sin writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const ev = eventoMp();
    ev.queryStringParameters.type = 'merchant_order';
    const res = await mpHandler(fake, async () => pagoMp())(ev);
    expect(res.statusCode).toBe(200);
    expect(fake.writes).toHaveLength(0);
  });
});

// ─── syncOrderPayment directo ─────────────────────────────────
describe('syncOrderPayment', () => {
  it('sin ordenId → sin writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const r = await syncOrderPayment({ provider: 'stripe', providerReference: 'cs_1', payment: { ordenId: null, status: 'paid', amount: 350, currency: 'MXN' } }, { supabase: fake });
    expect(r.code).toBe('orden_id_missing');
    expect(fake.writes).toHaveLength(0);
  });

  it('orden Facturada: registra pago pero no cambia estatus', async () => {
    const seed = seedBase();
    seed.ordenes[0].estatus = 'Facturada';
    const fake = makeFakeSupabase(seed);
    const r = await syncOrderPayment({ provider: 'stripe', providerReference: 'cs_1', payment: { ordenId: 46, status: 'paid', amount: 350, currency: 'MXN' } }, { supabase: fake });
    expect(r.applied).toBe(true);
    expect(fake.db.ordenes[0].estatus).toBe('Facturada');
  });
});

// ─── webhook Stripe ───────────────────────────────────────────
describe('billing-webhook-stripe', () => {
  const sesion = (over = {}) => ({ id: 'cs_test_1', payment_status: 'paid', status: 'complete', amount_total: 35000, currency: 'mxn', metadata: { orden_id: '46' }, url: null, ...over });
  const evento = (type, session) => ({ id: 'evt_1', type, data: { object: session } });

  it('firma inválida → 401 y cero writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const h = createStripeHandler({ getSupabase: () => fake, constructEvent: () => { throw new Error('No signatures found'); } });
    const res = await h({ httpMethod: 'POST', headers: { 'stripe-signature': 'x' }, body: '{}' });
    expect(res.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it('sin header de firma → 401 y cero writes', async () => {
    const fake = makeFakeSupabase(seedBase());
    const h = createStripeHandler({ getSupabase: () => fake, constructEvent: () => evento('checkout.session.completed', sesion()) });
    const res = await h({ httpMethod: 'POST', headers: {}, body: '{}' });
    expect(res.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it('checkout.session.completed válido → aplica una vez; duplicado no repite', async () => {
    const fake = makeFakeSupabase(seedBase());
    const h = createStripeHandler({ getSupabase: () => fake, constructEvent: () => evento('checkout.session.completed', sesion()) });
    const ev = { httpMethod: 'POST', headers: { 'stripe-signature': 'ok' }, body: '{}' };
    const r1 = await h(ev);
    const r2 = await h(ev);
    expect(JSON.parse(r1.body).applied).toBe(true);
    expect(JSON.parse(r2.body).code).toBe('duplicate');
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos[0].referencia).toBe('stripe:cs_test_1');
    expect(fake.db.cuentas_por_cobrar[0].estatus).toBe('Pagada');
    expect(fake.rpcs).toHaveLength(1);
  });

  it('monto manipulado en la sesión → no aplica', async () => {
    const fake = makeFakeSupabase(seedBase());
    const h = createStripeHandler({ getSupabase: () => fake, constructEvent: () => evento('checkout.session.completed', sesion({ amount_total: 100 })) });
    const res = await h({ httpMethod: 'POST', headers: { 'stripe-signature': 'ok' }, body: '{}' });
    expect(JSON.parse(res.body).code).toBe('amount_mismatch');
    expect(fake.db.pagos).toHaveLength(0);
  });

  it('checkout.session.expired no pisa checkout_url con NULL', async () => {
    const seed = seedBase();
    seed.payment_intents = [{ id: 1, orden_id: 46, provider: 'stripe', provider_reference: 'cs_test_1', status: 'open', amount: 350, currency: 'MXN', checkout_url: 'https://checkout.stripe.com/x' }];
    const fake = makeFakeSupabase(seed);
    const h = createStripeHandler({ getSupabase: () => fake, constructEvent: () => evento('checkout.session.expired', sesion({ payment_status: 'unpaid', status: 'expired', url: null })) });
    await h({ httpMethod: 'POST', headers: { 'stripe-signature': 'ok' }, body: '{}' });
    expect(fake.db.payment_intents[0].checkout_url).toBe('https://checkout.stripe.com/x');
    expect(fake.db.payment_intents[0].status).toBe('unpaid');
    expect(fake.db.pagos).toHaveLength(0);
  });
});
