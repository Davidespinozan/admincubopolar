/* global process */
// r5EmailIdentity.test.js — R5 (083): el email no identifica ni vincula
// perfiles. getAuthenticatedProfile resuelve SOLO por usuarios.auth_id; un
// Auth user cuyo email coincide con un perfil sin vincular no obtiene perfil,
// rol ni escritura de auth_id. Auditoría estática: Login, App y auth.js no
// buscan el perfil por email.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { getAuthenticatedProfile } from '../../netlify/functions/_lib/auth.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const seed = () => ({
  usuarios: [
    { id: 1, nombre: 'Admin', email: 'admin@cubopolar.com', rol: 'Admin', estatus: 'Activo', auth_id: 'uid-admin' },
    { id: 2, nombre: 'Vendedor', email: 'ventas@cubopolar.com', rol: 'Ventas', estatus: 'Activo', auth_id: 'uid-ventas' },
    { id: 3, nombre: 'Libre Admin', email: 'libre@cubopolar.com', rol: 'Admin', estatus: 'Activo', auth_id: null },
    { id: 4, nombre: 'Libre Inactivo', email: 'inactivo@cubopolar.com', rol: 'Ventas', estatus: 'Inactivo', auth_id: null },
    { id: 5, nombre: 'Inactivo vinculado', email: 'vinc-inactivo@cubopolar.com', rol: 'Admin', estatus: 'Inactivo', auth_id: 'uid-inactivo' },
  ],
});
const tokens = {
  'jwt-ventas': { id: 'uid-ventas', email: 'ventas@cubopolar.com' },
  'jwt-inactivo': { id: 'uid-inactivo', email: 'vinc-inactivo@cubopolar.com' },
  // ataque histórico: uid propio + email de un perfil sin vincular
  'jwt-reclamo-admin': { id: 'uid-atacante', email: 'libre@cubopolar.com' },
  'jwt-reclamo-admin-mayus': { id: 'uid-atacante', email: 'LIBRE@CUBOPOLAR.COM' },
  'jwt-reclamo-inactivo': { id: 'uid-atacante', email: 'inactivo@cubopolar.com' },
  // email de un perfil YA vinculado con otro uid
  'jwt-email-admin': { id: 'uid-atacante', email: 'admin@cubopolar.com' },
  // sin perfil
  'jwt-nadie': { id: 'uid-nadie', email: 'nadie@otro.com' },
  'jwt-sin-email': { id: 'uid-ventas' },
};
const ev = (token) => ({ httpMethod: 'POST', headers: { authorization: `Bearer ${token}` }, body: '{}' });
const usuariosWrites = (fake) => fake.writes.filter(w => w.table === 'usuarios');

describe('R5: getAuthenticatedProfile resuelve solo por auth_id', () => {
  it('usuario vinculado → su perfil; el email del JWT no se consulta', async () => {
    const fake = makeFakeSupabase(seed(), { tokens });
    const r = await getAuthenticatedProfile(ev('jwt-ventas'), { supabase: fake });
    expect(r.profile).toMatchObject({ id: 2, rol: 'Ventas', auth_id: 'uid-ventas' });
    expect(usuariosWrites(fake)).toHaveLength(0);
    const sinEmail = await getAuthenticatedProfile(ev('jwt-sin-email'), { supabase: fake });
    expect(sinEmail.profile).toMatchObject({ id: 2, rol: 'Ventas' });
  });

  it('ataque histórico: email de un perfil Admin sin vincular → 401, sin auth_id escrito, sin rol', async () => {
    for (const token of ['jwt-reclamo-admin', 'jwt-reclamo-admin-mayus']) {
      const fake = makeFakeSupabase(seed(), { tokens });
      const r = await getAuthenticatedProfile(ev(token), { supabase: fake });
      expect(r.profile).toBeUndefined();
      expect(r.errorResponse.statusCode).toBe(401);
      expect(usuariosWrites(fake)).toHaveLength(0);
      expect(fake.db.usuarios.find(u => u.id === 3).auth_id).toBeNull();
    }
  });

  it('perfil inactivo sin vincular: tampoco se reclama', async () => {
    const fake = makeFakeSupabase(seed(), { tokens });
    const r = await getAuthenticatedProfile(ev('jwt-reclamo-inactivo'), { supabase: fake });
    expect(r.errorResponse.statusCode).toBe(401);
    expect(usuariosWrites(fake)).toHaveLength(0);
    expect(fake.db.usuarios.find(u => u.id === 4).auth_id).toBeNull();
  });

  it('email de un perfil ya vinculado con otro uid → 401 y el auth_id existente no cambia', async () => {
    const fake = makeFakeSupabase(seed(), { tokens });
    const r = await getAuthenticatedProfile(ev('jwt-email-admin'), { supabase: fake });
    expect(r.errorResponse.statusCode).toBe(401);
    expect(usuariosWrites(fake)).toHaveLength(0);
    expect(fake.db.usuarios.find(u => u.id === 1).auth_id).toBe('uid-admin');
  });

  it('Auth user sin perfil → 401 (fail-closed, nada creado)', async () => {
    const fake = makeFakeSupabase(seed(), { tokens });
    const r = await getAuthenticatedProfile(ev('jwt-nadie'), { supabase: fake });
    expect(r.errorResponse.statusCode).toBe(401);
    expect(usuariosWrites(fake)).toHaveLength(0);
    expect(fake.db.usuarios).toHaveLength(5);
  });

  it('perfil vinculado pero inactivo → 401 (semántica previa conservada)', async () => {
    const fake = makeFakeSupabase(seed(), { tokens });
    const r = await getAuthenticatedProfile(ev('jwt-inactivo'), { supabase: fake });
    expect(r.errorResponse.statusCode).toBe(401);
    expect(usuariosWrites(fake)).toHaveLength(0);
  });
});

describe('R5: auditoría estática — sin identidad por email en el código', () => {
  const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
  const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  it('_lib/auth.js no busca usuarios por email ni escribe auth_id', () => {
    const s = sinComentarios(src('../../netlify/functions/_lib/auth.js'));
    expect(s).not.toMatch(/\.eq\(\s*['"]email['"]/);
    expect(s).not.toMatch(/\.ilike\(\s*['"]email['"]/);
    expect(s).not.toMatch(/update\(\s*\{\s*auth_id/);
    expect(s).toMatch(/\.eq\(\s*['"]auth_id['"]\s*,\s*authUser\.id\s*\)/);
  });

  it('Login.jsx y App.jsx cargan el perfil por auth_id y no seleccionan identidad por email', () => {
    const login = sinComentarios(src('../components/Login.jsx'));
    expect(login).toMatch(/from\(\s*['"]usuarios['"]\s*\)[\s\S]{0,80}\.eq\(\s*['"]auth_id['"]\s*,\s*authData\.user\.id\s*\)/);
    expect(login).not.toMatch(/\.eq\(\s*['"]email['"]/);
    const app = sinComentarios(src('../App.jsx'));
    expect(app).toMatch(/from\(\s*['"]usuarios['"]\s*\)[\s\S]{0,80}\.eq\(\s*['"]auth_id['"]\s*,\s*session\.user\.id\s*\)/);
    expect(app).not.toMatch(/\.eq\(\s*['"]email['"]/);
    expect(app).not.toMatch(/byEmail/);
  });

  it('el único uso de email en provisión es el pre-check de duplicados de admin-create-user', () => {
    const s = sinComentarios(src('../../netlify/functions/admin-create-user/index.js'));
    expect(s).toMatch(/\.ilike\(\s*['"]email['"]\s*,\s*email\s*\)/);
    expect(s).toMatch(/auth_id:\s*authId/);
  });
});
