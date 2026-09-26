// p0MetodoPago.test.js — P0.2: syncOrderPayment respeta el contrato de
// ordenes.metodo_pago / pagos.metodo_pago (método del catálogo SAT, no
// proveedor).
import { describe, it, expect } from 'vitest';
import { PAYMENT_FORM_MAP, isPPD } from '../../netlify/functions/_lib/invoiceLogic.js';
import { METODO_PAGO_LINK, metodoPagoTrasCobroLink } from '../../netlify/functions/_lib/paymentSecurity.js';
import { syncOrderPayment } from '../../netlify/functions/_lib/persistence.js';
import { createHandler as createStripeHandler } from '../../netlify/functions/billing-webhook-stripe/index.js';
import { createHandler as createMpHandler } from '../../netlify/functions/billing-webhook-mercadopago/index.js';
import { signMercadoPagoWebhook } from '../../netlify/functions/_lib/paymentSecurity.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const seed = (metodo = 'Efectivo') => ({
  clientes: [{ id: 32, nombre: 'SIX CANELAS', saldo: 350 }],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Asignada', cliente_id: 32, metodo_pago: metodo }],
  cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
});
const pagoStripe = (ref = 'cs_1') => ({ provider: 'stripe', providerReference: ref, payment: { ordenId: 46, status: 'paid', amount: 350, currency: 'MXN' } });

describe('contrato metodo_pago', () => {
  it('METODO_PAGO_LINK es un valor existente del catálogo (PAYMENT_FORM_MAP)', () => {
    expect(Object.keys(PAYMENT_FORM_MAP)).toContain(METODO_PAGO_LINK);
    expect(PAYMENT_FORM_MAP.Stripe).toBeUndefined();
    expect(PAYMENT_FORM_MAP['Mercado Pago']).toBeUndefined();
  });

  it('metodoPagoTrasCobroLink: crédito (PPD) se conserva; el resto → link', () => {
    expect(metodoPagoTrasCobroLink('Crédito')).toBe('Crédito');
    expect(metodoPagoTrasCobroLink('Crédito (fiado)')).toBe('Crédito (fiado)');
    expect(isPPD(metodoPagoTrasCobroLink('Crédito'))).toBe(true);
    expect(metodoPagoTrasCobroLink('Efectivo')).toBe(METODO_PAGO_LINK);
    expect(metodoPagoTrasCobroLink('Transferencia')).toBe(METODO_PAGO_LINK);
    expect(metodoPagoTrasCobroLink(null)).toBe(METODO_PAGO_LINK);
    expect(metodoPagoTrasCobroLink('Stripe')).toBe(METODO_PAGO_LINK);
  });
});

describe('syncOrderPayment no persiste valores fuera del contrato', () => {
  it('Stripe → pagos.metodo_pago y ordenes.metodo_pago dentro de PAYMENT_FORM_MAP', async () => {
    const fake = makeFakeSupabase(seed('Efectivo'));
    const r = await syncOrderPayment(pagoStripe(), { supabase: fake });
    expect(r.applied).toBe(true);
    expect(fake.db.pagos[0].metodo_pago).toBe('QR / Link de pago');
    expect(PAYMENT_FORM_MAP[fake.db.pagos[0].metodo_pago]).toBeDefined();
    expect(fake.db.ordenes[0].metodo_pago).toBe('QR / Link de pago');
    expect(PAYMENT_FORM_MAP[fake.db.ordenes[0].metodo_pago]).toBeDefined();
    expect(fake.db.pagos[0].referencia).toBe('stripe:cs_1'); // proveedor vive aquí
  });

  it('Mercado Pago → mismo contrato; proveedor solo en referencia e intent', async () => {
    const fake = makeFakeSupabase(seed('Transferencia'));
    const r = await syncOrderPayment({ provider: 'mercadopago', providerReference: '777', payment: { ordenId: 46, status: 'approved', amount: 350, currency: 'MXN' } }, { supabase: fake });
    expect(r.applied).toBe(true);
    expect(fake.db.pagos[0].metodo_pago).toBe('QR / Link de pago');
    expect(fake.db.ordenes[0].metodo_pago).toBe('QR / Link de pago');
    expect(fake.db.pagos[0].referencia).toBe('mercadopago:777');
    expect(fake.db.payment_intents[0].provider).toBe('mercadopago');
    expect(JSON.stringify(fake.db.ordenes[0])).not.toMatch(/Mercado Pago|Stripe/);
  });

  it('orden a crédito (PPD): conserva Crédito en la orden; el pago se registra como link', async () => {
    const fake = makeFakeSupabase(seed('Crédito'));
    await syncOrderPayment(pagoStripe(), { supabase: fake });
    expect(fake.db.ordenes[0].metodo_pago).toBe('Crédito');
    expect(fake.db.pagos[0].metodo_pago).toBe('QR / Link de pago');
    expect(fake.db.cuentas_por_cobrar[0].estatus).toBe('Pagada');
  });

  it('orden Facturada: no se toca metodo_pago ni estatus', async () => {
    const s = seed('Efectivo');
    s.ordenes[0].estatus = 'Facturada';
    const fake = makeFakeSupabase(s);
    await syncOrderPayment(pagoStripe(), { supabase: fake });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', metodo_pago: 'Efectivo' });
  });

  it('webhook duplicado sigue produciendo un solo pago lógico y no re-escribe metodo_pago', async () => {
    const fake = makeFakeSupabase(seed('Efectivo'));
    await syncOrderPayment(pagoStripe(), { supabase: fake });
    const escrituras = fake.writes.length;
    const r2 = await syncOrderPayment(pagoStripe(), { supabase: fake });
    expect(r2.code).toBe('duplicate');
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.writes).toHaveLength(escrituras);
    expect(fake.rpcs).toHaveLength(1);
  });

  it('invariantes intactas: monto distinto no aplica ni toca metodo_pago', async () => {
    const fake = makeFakeSupabase(seed('Efectivo'));
    const r = await syncOrderPayment({ ...pagoStripe(), payment: { ordenId: 46, status: 'paid', amount: 1, currency: 'MXN' } }, { supabase: fake });
    expect(r.code).toBe('amount_mismatch');
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.ordenes[0].metodo_pago).toBe('Efectivo');
    expect(fake.db.clientes[0].saldo).toBe(350);
  });
});

describe('handlers end-to-end respetan el contrato', () => {
  it('Stripe checkout.session.completed', async () => {
    const fake = makeFakeSupabase(seed('Efectivo'));
    const h = createStripeHandler({
      getSupabase: () => fake,
      constructEvent: () => ({ id: 'evt', type: 'checkout.session.completed', data: { object: { id: 'cs_9', payment_status: 'paid', amount_total: 35000, currency: 'mxn', metadata: { orden_id: '46' } } } }),
    });
    await h({ httpMethod: 'POST', headers: { 'stripe-signature': 'ok' }, body: '{}' });
    expect(fake.db.pagos[0].metodo_pago).toBe('QR / Link de pago');
    expect(fake.db.ordenes[0].metodo_pago).toBe('QR / Link de pago');
  });

  it('Mercado Pago payment approved', async () => {
    const fake = makeFakeSupabase(seed('Tarjeta'));
    const NOW = 1_800_000_000; const TS = String(NOW - 10); const SECRET = 's';
    const h = createMpHandler({ getSupabase: () => fake, getSecret: () => SECRET, nowSec: () => NOW, fetchPayment: async () => ({ id: 555, status: 'approved', transaction_amount: 350, currency_id: 'MXN', external_reference: '46' }) });
    const sig = signMercadoPagoWebhook({ dataId: '555', requestId: 'r', ts: TS, secret: SECRET });
    await h({ httpMethod: 'POST', headers: { 'x-signature': `ts=${TS},v1=${sig}`, 'x-request-id': 'r' }, queryStringParameters: { 'data.id': '555', type: 'payment' }, body: '{}' });
    expect(fake.db.pagos[0].metodo_pago).toBe('QR / Link de pago');
    expect(fake.db.ordenes[0].metodo_pago).toBe('QR / Link de pago');
  });
});
