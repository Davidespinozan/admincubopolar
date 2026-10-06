// webhookSinEntrega.test.js — OL-02D1: el pago confirmado por el proveedor
// del link NO es la entrega física. syncOrderPayment registra el dinero (pago,
// CxC, saldo, método del catálogo) y nunca cambia el estatus de la orden: sin
// ruta, la entrega la hace completar_venta_directa (pagado_link); con ruta, el
// chofer. Tampoco mueve inventario ni fija fecha de entrega.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { syncOrderPayment } from '../../netlify/functions/_lib/persistence.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';
import { esElegibleVentaDirecta, linkPagadoCompleto } from '../data/ventaDirectaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const ORDEN = { id: 46, folio: 'OV-0085', total: 350, cliente_id: 32, metodo_pago: 'Efectivo' };
const seed = (orden, extra = {}) => ({ clientes: [{ id: 32, nombre: 'SIX CANELAS', saldo: 0 }], ordenes: [{ ...ORDEN, ...orden }], ...extra });
const pago = (ref = 'cs_1', amount = 350) => ({ provider: 'stripe', providerReference: ref, payment: { ordenId: 46, status: 'paid', amount, currency: 'MXN' } });
const NO_FISICO = ['cuartos_frios', 'inventario_mov', 'stock_operaciones', 'produccion', 'mermas'];
const sinEfectoFisico = (fake) => {
  expect(fake.writes.filter(w => NO_FISICO.includes(w.table))).toEqual([]);
  expect(fake.rpcs.map(r => r.name).filter(n => n !== 'increment_saldo')).toEqual([]);
  for (const w of fake.writes.filter(w => w.table === 'ordenes')) {
    expect(Object.keys(w.payload)).toEqual(['metodo_pago']);   // nunca estatus ni delivered_at
  }
};

describe('OL-02D1: el webhook registra el pago y no entrega la orden', () => {
  it('A. sin ruta, Creada: pago registrado; la orden sigue Creada', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Creada', ruta_id: null }));
    const r = await syncOrderPayment(pago(), { supabase: fake });
    expect(r).toMatchObject({ applied: true, code: 'applied' });
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos[0]).toMatchObject({ orden_id: 46, monto: 350, referencia: 'stripe:cs_1', metodo_pago: 'QR / Link de pago', usuario_id: null });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Creada', ruta_id: null, metodo_pago: 'QR / Link de pago' });
    expect(fake.db.ordenes[0].delivered_at).toBeUndefined();
    sinEfectoFisico(fake);
  });
  it('B. sin ruta, Asignada: pago registrado; la orden sigue Asignada', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Asignada', ruta_id: null }));
    expect((await syncOrderPayment(pago(), { supabase: fake })).applied).toBe(true);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Asignada', ruta_id: null });
    sinEfectoFisico(fake);
  });
  it('C. con ruta, Asignada: pago registrado; NO se marca entregada (la entrega es del chofer)', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Asignada', ruta_id: 7 }));
    expect((await syncOrderPayment(pago(), { supabase: fake })).applied).toBe(true);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Asignada', ruta_id: 7 });
    sinEfectoFisico(fake);
  });
  it('D/H. webhook repetido: un solo pago (referencia proveedor:id), sin segundo efecto y sin entrega', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Creada', ruta_id: null }));
    await syncOrderPayment(pago('cs_9'), { supabase: fake });
    const r2 = await syncOrderPayment(pago('cs_9'), { supabase: fake });
    expect(r2.code).toBe('duplicate');
    expect(fake.db.pagos).toHaveLength(1);
    expect(fake.db.pagos[0].referencia).toBe('stripe:cs_9');
    expect(fake.db.ordenes[0].estatus).toBe('Creada');
    expect(fake.writes.filter(w => w.table === 'ordenes')).toHaveLength(1);
    sinEfectoFisico(fake);
  });
  it('E. monto distinto: queda en revisión; sin pago, sin cambios en la orden', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Creada', ruta_id: null }));
    const r = await syncOrderPayment(pago('cs_2', 10), { supabase: fake });
    expect(r.code).toBe('amount_mismatch');
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Creada', metodo_pago: 'Efectivo' });
    expect(fake.writes.filter(w => w.table === 'ordenes')).toHaveLength(0);
    expect(fake.db.payment_intents[0].status).toBe('review:amount_mismatch');
  });
  it('F. orden cancelada: no se cobra (comportamiento existente), sin escrituras a la orden', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Cancelada', ruta_id: null }));
    const r = await syncOrderPayment(pago(), { supabase: fake });
    expect(r.code).toBe('orden_no_cobrable');
    expect(fake.db.pagos).toHaveLength(0);
    expect(fake.db.ordenes[0].estatus).toBe('Cancelada');
    expect(fake.writes.filter(w => w.table === 'ordenes')).toHaveLength(0);
  });
  it('G. CxC existente: se liquida igual que antes (saldo, estatus, increment_saldo); la orden conserva su estatus y su método de crédito', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Entregada', ruta_id: null, metodo_pago: 'Crédito (fiado)' }, {
      clientes: [{ id: 32, nombre: 'SIX CANELAS', saldo: 350 }],
      cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
    }));
    expect((await syncOrderPayment(pago('cs_3'), { supabase: fake })).applied).toBe(true);
    expect(fake.db.cuentas_por_cobrar[0]).toMatchObject({ monto_pagado: 350, saldo_pendiente: 0, estatus: 'Pagada' });
    expect(fake.db.pagos[0]).toMatchObject({ cxc_id: 9, saldo_antes: 350, saldo_despues: 0 });
    expect(fake.rpcs.filter(r => r.name === 'increment_saldo')).toEqual([{ name: 'increment_saldo', args: { p_cli: 32, p_delta: -350 } }]);
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Entregada', metodo_pago: 'Crédito (fiado)' });
    sinEfectoFisico(fake);
  });
  it('orden Facturada: no se toca (comportamiento existente)', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Facturada', ruta_id: null }, {
      cuentas_por_cobrar: [{ id: 9, orden_id: 46, cliente_id: 32, monto_original: 350, monto_pagado: 0, saldo_pendiente: 350, estatus: 'Pendiente' }],
    }));
    await syncOrderPayment(pago('cs_4'), { supabase: fake });
    expect(fake.db.ordenes[0]).toMatchObject({ estatus: 'Facturada', metodo_pago: 'Efectivo' });
    expect(fake.writes.filter(w => w.table === 'ordenes')).toHaveLength(0);
  });
  it('I/J/K. el código del webhook no escribe estatus, fecha de entrega ni inventario', () => {
    const p = src('../../netlify/functions/_lib/persistence.js').replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(p).not.toMatch(/estatus:\s*'Entregada'|delivered_at|cuartos_frios|inventario_mov|stock_operaciones|completar_venta_directa/);
    expect(p).toMatch(/\.update\(\{ metodo_pago: metodoPagoTrasCobroLink\(orden\.metodo_pago\) \}\)/);
  });
});

describe('OL-02D1: la entrega física queda en el contrato correcto', () => {
  it('L. sin ruta: tras el webhook la orden sigue elegible y pagada → "Entregar pedido pagado" (pagado_link) es alcanzable', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Creada', ruta_id: null }));
    await syncOrderPayment(pago('cs_5'), { supabase: fake });
    const orden = fake.db.ordenes[0];
    const pagos = fake.db.pagos.map(p => ({ ordenId: p.orden_id, monto: p.monto }));
    expect(esElegibleVentaDirecta(orden)).toBe(true);
    expect(linkPagadoCompleto(orden, pagos)).toBe(true);
    // La suite de 109 completa una orden Creada ya pagada por link en modo pagado_link (109-62).
    expect(src('../../supabase/tests/109_venta_directa_test.sql')).toMatch(/'10900000-0000-0000-0000-000000000105', 10905, 'pagado_link', 'QR \/ Link de pago'/);
  });
  it('M. con ruta: no es venta directa (la UI no la ofrece y 109 la rechaza); la entrega sigue con el chofer', async () => {
    const fake = makeFakeSupabase(seed({ estatus: 'Asignada', ruta_id: 7 }));
    await syncOrderPayment(pago('cs_6'), { supabase: fake });
    expect(esElegibleVentaDirecta(fake.db.ordenes[0])).toBe(false);
    expect(src('../../supabase/tests/109_venta_directa_test.sql')).toMatch(/109-27 Asignada CON ruta: rechazada/);
  });
});
