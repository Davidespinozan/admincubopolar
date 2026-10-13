// e5NetlifyPerfilTienda.test.js — Tiendas E5: las Netlify Functions respetan el perfil efectivo.
// Un usuario con rol guardado "Ventas" asignado a una tienda es "Ventas Tienda" para el servidor:
// no factura, no genera links de pago ni notas por las funciones centrales. Los usuarios
// centrales no cambian. Base en memoria y proveedores falsos: nada sale a la red.
import { describe, it, expect } from 'vitest';
import { getAuthenticatedProfile, canAccessOrden, ROL_VENTAS_TIENDA } from '../../netlify/functions/_lib/auth.js';
import { rolPuedeFacturar, autorizarOrdenFacturacion } from '../../netlify/functions/_lib/facturacionGuard.js';
import { createHandler as crearRecibo } from '../../netlify/functions/recibo/index.js';
import { createHandler as crearCheckout } from '../../netlify/functions/billing-create-checkout/index.js';
import { createHandler as crearTimbrado } from '../../netlify/functions/billing-create-invoice/index.js';
import { createHandler as crearCancelacion } from '../../netlify/functions/billing-cancel-invoice/index.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';
import { makeCfdiRpc } from './helpers/fakeCfdiRpc.js';

const U = { admin: [1, 'Admin'], fact: [2, 'Facturación'], central: [5, 'Ventas'], tienda: [6, 'Ventas'], chofer: [9, 'Chofer'], prod: [3, 'Producción'], bolsas: [4, 'Almacén Bolsas'] };
const usuarios = Object.entries(U).map(([k, [id, rol]]) => ({ id, nombre: 'U ' + k, email: k + '@t', rol, estatus: 'Activo', auth_id: 'uid-' + k,
  accesos_extra: k === 'bolsas' ? ['Ventas'] : [] }));
const tokens = Object.fromEntries(Object.keys(U).map(k => ['jwt-' + k, { id: 'uid-' + k, email: k + '@t' }]));
const orden = (o = {}) => ({ id: 900, folio: 'OV-0900', cliente_id: 32, cliente_nombre: 'CLIENTE', productos: '1x P', total: 350, metodo_pago: 'Efectivo',
  estatus: 'Entregada', vendedor_id: 6, ruta_id: null, facturama_id: null, facturama_uuid: null, facturama_folio: null, cfdi_cancelado_at: null, ...o });
const seed = (o) => ({
  usuarios, ordenes: [o], orden_lineas: [{ orden_id: 900, sku: 'P', cantidad: 1, precio_unit: 350, subtotal: 350 }],
  clientes: [{ id: 32, nombre: 'CLIENTE SA', rfc: 'XAXX010101000', regimen: '616', uso_cfdi: 'S01', cp: '34000', correo: '' }],
  productos: [{ sku: 'P', nombre: 'Hielo', clave_prod_serv: '50202302', clave_unidad: 'H87' }],
  configuracion_empresa: [{ id: 1, codigo_postal: '34186' }], invoice_attempts: [],
});
// Usuario 6 = asignado a una tienda (lo dice la base); el 5 es Ventas central.
const fakeCon = (o = orden(), opts = {}) => makeFakeSupabase(seed(o), { tokens, usuariosDeTienda: [6], rpcImpl: makeCfdiRpc(), ...opts });
const ev = (who, body = { ordenId: 900 }) => ({ httpMethod: 'POST', headers: who ? { authorization: `Bearer jwt-${who}` } : {}, body: JSON.stringify(body) });
const perfil = async (fake, who) => getAuthenticatedProfile(ev(who), { supabase: fake });

describe('perfil efectivo en getAuthenticatedProfile', () => {
  it('Ventas asignado a una tienda → "Ventas Tienda", sin accesos adicionales; el rol guardado se conserva aparte', async () => {
    const r = await perfil(fakeCon(), 'tienda');
    expect(r.errorResponse).toBeUndefined();
    expect(r.profile).toMatchObject({ id: 6, rol: ROL_VENTAS_TIENDA, rol_guardado: 'Ventas', accesos_extra: [] });
  });

  it('Ventas central sigue siendo Ventas', async () => {
    const r = await perfil(fakeCon(), 'central');
    expect(r.profile).toMatchObject({ id: 5, rol: 'Ventas' });
    expect(r.profile.rol_guardado).toBeUndefined();
  });

  it('los demás roles no cambian y ni siquiera se consulta el perfil efectivo', async () => {
    const fake = fakeCon();
    for (const [k, [id, rol]] of Object.entries(U)) {
      if (rol === 'Ventas') continue;
      const r = await perfil(fake, k);
      expect(r.profile).toMatchObject({ id, rol });
    }
    expect(fake.lecturasPerfil).toEqual([]);
    await perfil(fake, 'central'); await perfil(fake, 'tienda');
    expect(fake.lecturasPerfil).toEqual([{ p_usuario_id: 5 }, { p_usuario_id: 6 }]);
  });

  it('Almacén Bolsas con acceso de Ventas conserva su perfil (la regla es solo para el rol guardado Ventas)', async () => {
    const r = await perfil(fakeCon(), 'bolsas');
    expect(r.profile).toMatchObject({ rol: 'Almacén Bolsas', accesos_extra: ['Ventas'] });
  });

  it('migración 145 sin aplicar (la función no existe) → no puede haber tiendas: Ventas central', async () => {
    for (const code of ['PGRST202', '42883']) {
      const r = await perfil(fakeCon(orden(), { errorPerfilEfectivo: { code, message: 'no existe' } }), 'tienda');
      expect(r.profile).toMatchObject({ id: 6, rol: 'Ventas' });
    }
  });

  it('cualquier otro error al resolver el perfil → FALLA CERRADO (503), nunca Ventas central por omisión', async () => {
    for (const error of [{ code: '42501', message: 'permission denied' }, { message: 'fetch failed' }, { code: '57014', message: 'timeout' }]) {
      const r = await perfil(fakeCon(orden(), { errorPerfilEfectivo: error }), 'central');
      expect(r.profile).toBeUndefined();
      expect(r.errorResponse.statusCode).toBe(503);
      expect(JSON.parse(r.errorResponse.body).code).toBe('PERFIL_NO_VERIFICADO');
    }
  });

  it('un cliente de base sin rpc (no responde) también falla cerrado para Ventas, y no afecta a Admin', async () => {
    const fake = fakeCon();
    const sinRpc = { from: fake.from, auth: fake.auth };
    const v = await getAuthenticatedProfile(ev('central'), { supabase: sinRpc });
    expect(v.errorResponse.statusCode).toBe(503);
    const a = await getAuthenticatedProfile(ev('admin'), { supabase: sinRpc });
    expect(a.profile).toMatchObject({ rol: 'Admin' });
  });
});

describe('Ventas Tienda no usa las funciones centrales', () => {
  it('reglas puras: no factura ni accede a órdenes (ni a las suyas, ni a una sin vendedor)', async () => {
    const p = { id: 6, rol: ROL_VENTAS_TIENDA, accesos_extra: [] };
    expect(rolPuedeFacturar(p)).toBe(false);
    expect(autorizarOrdenFacturacion(p, orden())).toMatchObject({ ok: false, status: 403, code: 'ROL_NO_AUTORIZADO' });
    const fake = fakeCon();
    expect(await canAccessOrden({ profile: p, orden: orden(), supabase: fake })).toBe(false);
    expect(await canAccessOrden({ profile: p, orden: orden({ vendedor_id: null }), supabase: fake })).toBe(false);
    // Aunque alguien le dejara el acceso de Ventas en el perfil, el rol efectivo manda.
    expect(await canAccessOrden({ profile: { ...p, accesos_extra: ['Ventas'] }, orden: orden(), supabase: fake })).toBe(false);
  });

  it('timbrar y cancelar factura: rechazado por rol (como Chofer o Producción) antes de tocar al proveedor; sin escrituras', async () => {
    const llamadas = [];
    const deps = (fake) => ({ getSupabase: () => fake, fetchImpl: async (u) => { llamadas.push(String(u)); return { ok: true, status: 200, json: async () => ({}) }; },
      getConfig: () => ({ username: 's', password: 's', baseUrl: 'https://facturama.invalid' }) });
    const fake = fakeCon();
    const t = await crearTimbrado(deps(fake))(ev('tienda'));
    expect(t.statusCode).toBe(400);
    expect(JSON.parse(t.body).error).toMatch(/rol no puede timbrar/);
    const fake2 = fakeCon(orden({ estatus: 'Facturada', facturama_id: 'FM-1', facturama_uuid: 'UUID', facturama_folio: 'A1' }));
    const c = await crearCancelacion(deps(fake2))(ev('tienda', { ordenId: 900, motivo: '02' }));
    expect([400, 403]).toContain(c.statusCode);
    expect(JSON.parse(c.body).error).toMatch(/rol no puede/i);
    expect(llamadas).toEqual([]);
    expect(fake.writes).toHaveLength(0);
    expect(fake2.writes).toHaveLength(0);
  });

  it('link de pago: 403, no se crea sesión de cobro ni intento de pago', async () => {
    const fake = fakeCon(orden({ estatus: 'Creada' }));
    let sesiones = 0;
    const h = crearCheckout({ getProfile: (e) => getAuthenticatedProfile(e, { supabase: fake }), getSupabase: () => fake, createStripeSession: async () => { sesiones++; return { id: 'cs', url: 'u' }; } });
    const r = await h(ev('tienda', { provider: 'stripe', ordenId: 900, successUrl: 'https://a/ok', cancelUrl: 'https://a/no' }));
    expect(r.statusCode).toBe(403);
    expect(sesiones).toBe(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('nota firmada (recibo): 403 también para su propia venta', async () => {
    const fake = fakeCon();
    const h = crearRecibo({ getProfile: (e) => getAuthenticatedProfile(e, { supabase: fake }), getSupabase: () => fake, getSecret: () => 'secreto' });
    const r = await h(ev('tienda'));
    expect(r.statusCode).toBe(403);
    expect(fake.writes).toHaveLength(0);
  });
});

describe('los usuarios centrales conservan sus permisos', () => {
  it('Ventas central: nota de su orden y link de pago de su orden siguen funcionando', async () => {
    const fake = fakeCon(orden({ vendedor_id: 5, estatus: 'Creada' }));
    const recibo = crearRecibo({ getProfile: (e) => getAuthenticatedProfile(e, { supabase: fake }), getSupabase: () => fake, getSecret: () => 'secreto' });
    expect((await recibo(ev('central'))).statusCode).toBe(200);
    expect(await canAccessOrden({ profile: (await perfil(fake, 'central')).profile, orden: orden({ vendedor_id: 5 }), supabase: fake })).toBe(true);
    expect(await canAccessOrden({ profile: (await perfil(fake, 'central')).profile, orden: orden({ vendedor_id: 6 }), supabase: fake })).toBe(false);
  });

  it('Ventas central factura SU orden; Admin y Facturación, cualquiera', async () => {
    const fake = fakeCon();
    const pc = (await perfil(fake, 'central')).profile;
    expect(rolPuedeFacturar(pc)).toBe(true);
    expect(autorizarOrdenFacturacion(pc, orden({ vendedor_id: 5 }))).toEqual({ ok: true });
    expect(autorizarOrdenFacturacion(pc, orden({ vendedor_id: 6 }))).toMatchObject({ ok: false, code: 'ORDEN_AJENA' });
    for (const k of ['admin', 'fact']) expect(autorizarOrdenFacturacion((await perfil(fake, k)).profile, orden())).toEqual({ ok: true });
  });

  it('Administración sí puede facturar la venta de una tienda (la orden existe como cualquier otra)', async () => {
    const fake = fakeCon();
    expect(autorizarOrdenFacturacion((await perfil(fake, 'admin')).profile, orden({ vendedor_id: 6 }))).toEqual({ ok: true });
  });
});
