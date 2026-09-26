/* global process */
// p0AuthFailClosed.test.js — P0.1: ausencia de configuración nunca
// produce un perfil privilegiado; recibo POST deniega sin auth válida.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getAuthenticatedProfile, canAccessOrden } from '../../netlify/functions/_lib/auth.js';
import { createHandler as createReciboHandler } from '../../netlify/functions/recibo/index.js';
import { createHandler as createCheckoutHandler } from '../../netlify/functions/billing-create-checkout/index.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const TOKEN_ADMIN = 'jwt-admin';
const TOKEN_VENTAS = 'jwt-ventas';
const TOKEN_PROD = 'jwt-prod';
const TOKEN_SIN_PERFIL = 'jwt-huerfano';

const seed = () => ({
  usuarios: [
    { id: 1, nombre: 'Admin', email: 'admin@cubopolar.com', rol: 'Admin', estatus: 'Activo', auth_id: 'uid-admin' },
    { id: 2, nombre: 'Vendedor', email: 'ventas@cubopolar.com', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-ventas' },
    { id: 3, nombre: 'Prod', email: 'prod@cubopolar.com', rol: 'Producción', estatus: 'Activo', auth_id: 'uid-prod' },
  ],
  ordenes: [{ id: 46, folio: 'OV-0085', total: 350, estatus: 'Asignada', cliente_id: 32, cliente_nombre: 'X', vendedor_id: 2, ruta_id: null }],
});
const tokens = {
  [TOKEN_ADMIN]: { id: 'uid-admin', email: 'admin@cubopolar.com' },
  [TOKEN_VENTAS]: { id: 'uid-ventas', email: 'ventas@cubopolar.com' },
  [TOKEN_PROD]: { id: 'uid-prod', email: 'prod@cubopolar.com' },
  [TOKEN_SIN_PERFIL]: { id: 'uid-nadie', email: 'nadie@otro.com' },
};
const fakeCon = () => makeFakeSupabase(seed(), { tokens });
const ev = (token, body = { ordenId: 46 }, method = 'POST') => ({
  httpMethod: method,
  headers: token ? { authorization: `Bearer ${token}` } : {},
  body: JSON.stringify(body),
});

let envBackup;
beforeEach(() => {
  envBackup = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SERVICE_ROLE_KEY };
});
afterEach(() => {
  if (envBackup.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = envBackup.url;
  if (envBackup.key === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY; else process.env.SUPABASE_SERVICE_ROLE_KEY = envBackup.key;
});

describe('getAuthenticatedProfile falla cerrado', () => {
  it('sin env de Supabase → 503 configuration error, nunca Admin', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await getAuthenticatedProfile(ev(TOKEN_ADMIN));
    expect(r.profile).toBeUndefined();
    expect(r.errorResponse.statusCode).toBe(503);
    expect(JSON.parse(r.errorResponse.body).code).toBe('AUTH_NOT_CONFIGURED');
  });

  it('sin env y sin token → 401 (nunca perfil)', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const r = await getAuthenticatedProfile(ev(null));
    expect(r.profile).toBeUndefined();
    expect(r.errorResponse.statusCode).toBe(401);
  });

  it('JWT válido con perfil → perfil real; JWT inválido → 401; sin fila usuarios → 401', async () => {
    const fake = fakeCon();
    const ok = await getAuthenticatedProfile(ev(TOKEN_VENTAS), { supabase: fake });
    expect(ok.profile).toMatchObject({ id: 2, rol: 'Ventas' });
    const bad = await getAuthenticatedProfile(ev('jwt-falso'), { supabase: fake });
    expect(bad.errorResponse.statusCode).toBe(401);
    expect(bad.profile).toBeUndefined();
    const huerfano = await getAuthenticatedProfile(ev(TOKEN_SIN_PERFIL), { supabase: fake });
    expect(huerfano.errorResponse.statusCode).toBe(401);
  });

  it('canAccessOrden sin cliente Supabase deniega a todo rol no-Admin', async () => {
    const orden = { id: 1, vendedor_id: null, ruta_id: 7 };
    expect(await canAccessOrden({ profile: { rol: 'Ventas', id: 2 }, orden, supabase: null })).toBe(false);
    expect(await canAccessOrden({ profile: { rol: 'Chofer', id: 9 }, orden, supabase: null })).toBe(false);
    expect(await canAccessOrden({ profile: { rol: 'Admin', id: 1 }, orden, supabase: null })).toBe(true);
    expect(await canAccessOrden({ profile: null, orden, supabase: null })).toBe(false);
  });
});

describe('recibo POST', () => {
  const handlerCon = (fake) => createReciboHandler({
    getProfile: (event) => getAuthenticatedProfile(event, { supabase: fake }),
    getSupabase: () => fake,
    getSecret: () => 'secreto-recibo',
  });

  it('1. auth válida + autorizado → URL firmada (Admin y Ventas dueño)', async () => {
    const fake = fakeCon();
    const r1 = await handlerCon(fake)(ev(TOKEN_ADMIN));
    expect(r1.statusCode).toBe(200);
    expect(JSON.parse(r1.body).url).toMatch(/^\/nota\/46\?t=[0-9a-f]{32}$/);
    const r2 = await handlerCon(fake)(ev(TOKEN_VENTAS));
    expect(r2.statusCode).toBe(200);
    expect(fake.writes).toHaveLength(0);
  });

  it('2. sin JWT → 401, cero writes', async () => {
    const fake = fakeCon();
    const r = await handlerCon(fake)(ev(null));
    expect(r.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it('3. JWT inválido → 401, cero writes', async () => {
    const fake = fakeCon();
    const r = await handlerCon(fake)(ev('jwt-falso'));
    expect(r.statusCode).toBe(401);
    expect(fake.writes).toHaveLength(0);
  });

  it('4. env/config de auth faltante → 503, nunca Admin, cero writes', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fake = fakeCon();
    // Handler real de auth (sin inyección) con env ausente
    const h = createReciboHandler({ getSupabase: () => fake, getSecret: () => 'secreto-recibo' });
    const r = await h(ev(TOKEN_ADMIN));
    expect(r.statusCode).toBe(503);
    expect(JSON.parse(r.body).code).toBe('AUTH_NOT_CONFIGURED');
    expect(fake.writes).toHaveLength(0);
  });

  it('5. usuario sin rol requerido → 403, cero writes', async () => {
    const fake = fakeCon();
    const r = await handlerCon(fake)(ev(TOKEN_PROD));
    expect(r.statusCode).toBe(403);
    expect(fake.writes).toHaveLength(0);
  });

  it('orden inexistente → 400 sin URL', async () => {
    const fake = fakeCon();
    const r = await handlerCon(fake)(ev(TOKEN_ADMIN, { ordenId: 999 }));
    expect(r.statusCode).toBe(400);
  });
});

describe('env faltante no autoriza un write protegido (checkout)', () => {
  it('billing-create-checkout con auth real y sin env → 503, sin sesión de pago ni writes', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const fake = fakeCon();
    let sesiones = 0;
    const h = createCheckoutHandler({
      getSupabase: () => fake,
      createStripeSession: async () => { sesiones++; return { id: 'cs', url: 'u' }; },
    });
    const r = await h(ev(TOKEN_ADMIN, { provider: 'stripe', ordenId: 46, successUrl: 'https://a/ok', cancelUrl: 'https://a/no' }));
    expect(r.statusCode).toBe(503);
    expect(sesiones).toBe(0);
    expect(fake.writes).toHaveLength(0);
  });
});
