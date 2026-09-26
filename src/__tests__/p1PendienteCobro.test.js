// p1PendienteCobro.test.js — P0-2: el webhook cobra contra el PENDIENTE
// real de la orden (total - SUM(pagos)), no contra el total.
import { describe, it, expect } from 'vitest';
import { evaluatePaymentInvariants } from '../../netlify/functions/_lib/paymentSecurity.js';
import { syncOrderPayment } from '../../netlify/functions/_lib/persistence.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const seed = () => ({
  clientes: [{ id: 32, nombre: 'C', saldo: 350 }],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Entregada', cliente_id: 32, metodo_pago: 'Crédito' }],
  cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
});
const link = (amount) => ({ provider: 'stripe', providerReference: 'cs_link', payment: { ordenId: 46, status: 'paid', amount, currency: 'MXN' } });

describe('evaluatePaymentInvariants con expectedAmount', () => {
  const orden = { id: 46, total: 350, estatus: 'Entregada' };
  it('compara contra el pendiente cuando se provee', () => {
    expect(evaluatePaymentInvariants({ provider: 'stripe', providerReference: 'x', orden, payment: { status: 'paid', amount: 150, currency: 'MXN' }, expectedAmount: 150 }).ok).toBe(true);
    expect(evaluatePaymentInvariants({ provider: 'stripe', providerReference: 'x', orden, payment: { status: 'paid', amount: 350, currency: 'MXN' }, expectedAmount: 150 }).code).toBe('amount_mismatch');
  });
  it('sin expectedAmount conserva el comportamiento por total', () => {
    expect(evaluatePaymentInvariants({ provider: 'stripe', providerReference: 'x', orden, payment: { status: 'paid', amount: 350, currency: 'MXN' } }).ok).toBe(true);
  });
});

describe('syncOrderPayment usa el pendiente real (P0-2)', () => {
  it('abono manual previo de 200 + link por 350 → review, SUM(pagos) no supera el total', async () => {
    const s = seed();
    s.cuentas_por_cobrar[0] = { ...s.cuentas_por_cobrar[0], monto_pagado: 200, saldo_pendiente: 150, estatus: 'Parcial' };
    s.pagos = [{ id: 1, orden_id: 46, cxc_id: 9, monto: 200, referencia: 'Abono CxC #9 x', metodo_pago: 'Efectivo' }];
    s.clientes[0].saldo = 150;
    const fake = makeFakeSupabase(s);
    const r = await syncOrderPayment(link(350), { supabase: fake });
    expect(r.code).toBe('amount_mismatch');
    expect(r.detail).toMatch(/esperado=150/);
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos.reduce((a, p) => a + Number(p.monto), 0)).toBe(200);
    expect(fake.db.cuentas_por_cobrar[0].saldo_pendiente).toBe(150);
    expect(fake.db.clientes[0].saldo).toBe(150);
    expect(fake.db.payment_intents[0].status).toBe('review:amount_mismatch');
  });

  it('abono previo de 200 + link por el pendiente 150 → aplica y liquida', async () => {
    const s = seed();
    s.cuentas_por_cobrar[0] = { ...s.cuentas_por_cobrar[0], monto_pagado: 200, saldo_pendiente: 150, estatus: 'Parcial' };
    s.pagos = [{ id: 1, orden_id: 46, cxc_id: 9, monto: 200, referencia: 'Abono CxC #9 x', metodo_pago: 'Efectivo' }];
    s.clientes[0].saldo = 150;
    const fake = makeFakeSupabase(s);
    const r = await syncOrderPayment(link(150), { supabase: fake });
    expect(r.applied).toBe(true);
    expect(fake.db.pagos.reduce((a, p) => a + Number(p.monto), 0)).toBe(350);
    expect(fake.db.cuentas_por_cobrar[0]).toMatchObject({ saldo_pendiente: 0, estatus: 'Pagada' });
    expect(fake.db.clientes[0].saldo).toBe(0);
  });

  it('orden ya pagada por completo (por cualquier vía) → duplicate sin writes financieros', async () => {
    const s = seed();
    s.pagos = [{ id: 1, orden_id: 46, monto: 350, referencia: 'OV-0085-Efectivo', metodo_pago: 'Efectivo' }];
    const fake = makeFakeSupabase(s);
    const r = await syncOrderPayment(link(350), { supabase: fake });
    expect(r.code).toBe('duplicate');
    expect(fake.writesFinancieras()).toHaveLength(0);
    expect(fake.db.pagos).toHaveLength(1);
  });
});
