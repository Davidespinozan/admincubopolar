// p0Checkout.test.js — P0: el cliente NO decide el monto a cobrar.
import { describe, it, expect } from 'vitest';
import { buildCheckoutPlan, checkCheckoutAllowed, validateCheckoutRequest } from '../../netlify/functions/_lib/checkoutLogic.js';
import { createHandler } from '../../netlify/functions/billing-create-checkout/index.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const seed = () => ({
  clientes: [{ id: 32, nombre: 'SIX CANELAS', correo: 'Compras@SixCanelas.mx ' }],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Asignada', cliente_id: 32, cliente_nombre: 'SIX CANELAS', vendedor_id: 45, ruta_id: 56 }],
  orden_lineas: [{ orden_id: 46, sku: 'HPC-5K', cantidad: 10, precio_unit: 35, subtotal: 350 }],
  productos: [{ sku: 'HPC-5K', nombre: 'Hielo Premium Cubo 5kg' }],
  rutas: [{ id: 56, chofer_id: 49 }],
});

const evento = (body, over = {}) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(body), ...over });
const perfil = (rol, id = 45) => async () => ({ profile: { id, rol, nombre: 'X', estatus: 'Activo' } });
const noAuth = async () => ({ errorResponse: { statusCode: 401, body: JSON.stringify({ error: 'Missing authorization token' }) } });

const handlerCon = (fake, deps = {}) => {
  const llamadas = { stripe: [], mp: [] };
  const h = createHandler({
    getProfile: deps.getProfile || perfil('Admin'),
    getSupabase: () => fake,
    createStripeSession: async (params) => { llamadas.stripe.push(params); return { id: 'cs_1', url: 'https://checkout.stripe.com/cs_1', status: 'open' }; },
    createMercadoPagoPreference: async (body) => { llamadas.mp.push(body); return { id: 'pref_1', init_point: 'https://mp.com/pref_1', status: 'pending' }; },
  });
  return { h, llamadas };
};

describe('checkoutLogic (puro)', () => {
  it('validateCheckoutRequest ignora amount/items/customer y valida lo mínimo', () => {
    const r = validateCheckoutRequest({ provider: 'stripe', ordenId: '46', amount: 1, items: [], customer: { email: 'x' }, successUrl: 'https://a/ok', cancelUrl: 'https://a/no' });
    expect(r).toEqual({ provider: 'stripe', ordenId: 46, successUrl: 'https://a/ok', cancelUrl: 'https://a/no' });
    expect(validateCheckoutRequest({ provider: 'paypal', ordenId: 46 }).error).toBeTruthy();
    expect(validateCheckoutRequest({ provider: 'stripe', ordenId: 'abc' }).error).toBeTruthy();
    expect(validateCheckoutRequest({ provider: 'stripe', ordenId: 46 }).error).toMatch(/successUrl/);
    expect(validateCheckoutRequest({ provider: 'mercadopago', ordenId: 46 }).error).toBeUndefined();
  });

  it('checkCheckoutAllowed: cancelada, total 0, ya pagada (pagos o intent paid)', () => {
    const orden = { id: 1, total: 100, estatus: 'Creada' };
    expect(checkCheckoutAllowed({ orden })).toEqual({ ok: true });
    expect(checkCheckoutAllowed({ orden: null }).code).toBe('orden_not_found');
    expect(checkCheckoutAllowed({ orden: { ...orden, estatus: 'Cancelada' } }).code).toBe('orden_cancelada');
    expect(checkCheckoutAllowed({ orden: { ...orden, total: 0 } }).code).toBe('total_invalid');
    expect(checkCheckoutAllowed({ orden, pagos: [{ id: 1 }] }).code).toBe('already_paid');
    expect(checkCheckoutAllowed({ orden, intents: [{ status: 'paid' }] }).code).toBe('already_paid');
    expect(checkCheckoutAllowed({ orden, intents: [{ status: 'open' }] }).ok).toBe(true);
  });

  it('buildCheckoutPlan: monto = ordenes.total; líneas solo si cuadran', () => {
    const s = seed();
    const plan = buildCheckoutPlan({ orden: s.ordenes[0], lineas: s.orden_lineas, productos: s.productos, cliente: s.clientes[0] });
    expect(plan.amount).toBe(350);
    expect(plan.currency).toBe('MXN');
    expect(plan.items).toEqual([{ name: 'Hielo Premium Cubo 5kg', sku: 'HPC-5K', quantity: 10, unitPrice: 35 }]);
    expect(plan.customerEmail).toBe('compras@sixcanelas.mx');

    const planDesfasado = buildCheckoutPlan({ orden: s.ordenes[0], lineas: [{ sku: 'HPC-5K', cantidad: 1, precio_unit: 999 }], productos: s.productos, cliente: null });
    expect(planDesfasado.items).toHaveLength(1);
    expect(planDesfasado.items[0].unitPrice).toBe(350);
    expect(planDesfasado.items[0].quantity).toBe(1);
    expect(planDesfasado.customerEmail).toBeNull();
  });
});

describe('billing-create-checkout (handler)', () => {
  const bodyAtacante = { provider: 'stripe', ordenId: 46, amount: 1, items: [{ name: 'x', quantity: 1, unitPrice: 1 }], customer: { email: 'atacante@evil.com' }, successUrl: 'https://cubopolar.com/ok', cancelUrl: 'https://cubopolar.com/no' };

  it('amount manipulado por el frontend no cambia el cobro (Stripe)', async () => {
    const fake = makeFakeSupabase(seed());
    const { h, llamadas } = handlerCon(fake);
    const res = await h(evento(bodyAtacante));
    expect(res.statusCode).toBe(200);
    const params = llamadas.stripe[0];
    const centavos = params.line_items.reduce((acc, li) => acc + li.quantity * li.price_data.unit_amount, 0);
    expect(centavos).toBe(35000);
    expect(params.metadata.orden_id).toBe('46');
    expect(JSON.parse(res.body).amount).toBe(350);
    expect(fake.db.payment_intents[0]).toMatchObject({ orden_id: 46, provider: 'stripe', amount: 350, checkout_url: 'https://checkout.stripe.com/cs_1' });
  });

  it('amount manipulado no cambia el cobro (Mercado Pago)', async () => {
    const fake = makeFakeSupabase(seed());
    const { h, llamadas } = handlerCon(fake);
    const res = await h(evento({ ...bodyAtacante, provider: 'mercadopago' }));
    expect(res.statusCode).toBe(200);
    const pref = llamadas.mp[0];
    const total = pref.items.reduce((acc, i) => acc + i.quantity * i.unit_price, 0);
    expect(total).toBe(350);
    expect(pref.external_reference).toBe('46');
    expect(pref.metadata.orden_id).toBe('46');
  });

  it('email manipulado no cambia la identidad: se usa clientes.correo', async () => {
    const fake = makeFakeSupabase(seed());
    const { h, llamadas } = handlerCon(fake);
    await h(evento(bodyAtacante));
    expect(llamadas.stripe[0].customer_email).toBe('compras@sixcanelas.mx');
    await h(evento({ ...bodyAtacante, provider: 'mercadopago' }));
    expect(llamadas.mp[0].payer.email).toBe('compras@sixcanelas.mx');
  });

  it('sin token → 401 sin writes', async () => {
    const fake = makeFakeSupabase(seed());
    const { h, llamadas } = handlerCon(fake, { getProfile: noAuth });
    const res = await h(evento(bodyAtacante));
    expect(res.statusCode).toBe(401);
    expect(llamadas.stripe).toHaveLength(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('Ventas de otro vendedor → 403; Ventas dueño → 200; Chofer de la ruta → 200; Chofer ajeno → 403', async () => {
    const fake = makeFakeSupabase(seed());
    expect((await handlerCon(fake, { getProfile: perfil('Ventas', 99) }).h(evento(bodyAtacante))).statusCode).toBe(403);
    expect((await handlerCon(fake, { getProfile: perfil('Ventas', 45) }).h(evento(bodyAtacante))).statusCode).toBe(200);
    expect((await handlerCon(fake, { getProfile: perfil('Chofer', 49) }).h(evento(bodyAtacante))).statusCode).toBe(200);
    expect((await handlerCon(fake, { getProfile: perfil('Chofer', 50) }).h(evento(bodyAtacante))).statusCode).toBe(403);
    expect((await handlerCon(fake, { getProfile: perfil('Producción', 7) }).h(evento(bodyAtacante))).statusCode).toBe(403);
  });

  it('orden inexistente → 404 sin writes', async () => {
    const fake = makeFakeSupabase(seed());
    const { h, llamadas } = handlerCon(fake);
    const res = await h(evento({ ...bodyAtacante, ordenId: 999 }));
    expect(res.statusCode).toBe(404);
    expect(llamadas.stripe).toHaveLength(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('orden ya pagada → 409 sin nuevo checkout', async () => {
    const s = seed();
    s.pagos = [{ id: 1, orden_id: 46, referencia: 'OV-0085-Efectivo' }];
    const fake = makeFakeSupabase(s);
    const { h, llamadas } = handlerCon(fake);
    const res = await h(evento(bodyAtacante));
    expect(res.statusCode).toBe(409);
    expect(JSON.parse(res.body).code).toBe('already_paid');
    expect(llamadas.stripe).toHaveLength(0);
  });

  it('orden con intent paid → 409', async () => {
    const s = seed();
    s.payment_intents = [{ id: 1, orden_id: 46, provider: 'stripe', provider_reference: 'cs_old', status: 'paid' }];
    const fake = makeFakeSupabase(s);
    const res = await handlerCon(fake).h(evento(bodyAtacante));
    expect(res.statusCode).toBe(409);
  });

  it('orden cancelada → 409', async () => {
    const s = seed();
    s.ordenes[0].estatus = 'Cancelada';
    const res = await handlerCon(makeFakeSupabase(s)).h(evento(bodyAtacante));
    expect(res.statusCode).toBe(409);
  });

  it('body inválido → 400', async () => {
    const fake = makeFakeSupabase(seed());
    const { h } = handlerCon(fake);
    expect((await h(evento({ provider: 'stripe', ordenId: 'x' }))).statusCode).toBe(400);
    expect((await h(evento({ provider: 'stripe', ordenId: 46 }))).statusCode).toBe(400);
    expect((await h({ httpMethod: 'GET', headers: {} })).statusCode).toBe(405);
  });
});
