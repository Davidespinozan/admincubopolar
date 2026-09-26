// p0AdminCreateUser.test.js — P0: auth.users → usuarios como unidad
// lógica con rollback.
import { describe, it, expect } from 'vitest';
import { createHandler } from '../../netlify/functions/admin-create-user/index.js';
import { makeFakeSupabase } from './helpers/fakeSupabase.js';

const body = { email: 'Nuevo@CuboPolar.com', password: 'secreto1', nombre: '  Nuevo Usuario ', rol: 'Ventas' };
const evento = (b = body) => ({ httpMethod: 'POST', headers: {}, body: JSON.stringify(b) });
const admin = async () => ({ profile: { id: 1, rol: 'Admin', estatus: 'Activo' } });
const ventas = async () => ({ profile: { id: 2, rol: 'Ventas', estatus: 'Activo' } });

describe('admin-create-user', () => {
  it('alta válida: crea en Auth e inserta en usuarios con auth_id', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-nuevo' });
    const res = await createHandler({ getProfile: admin, getSupabase: () => fake })(evento());
    expect(res.statusCode).toBe(200);
    const json = JSON.parse(res.body);
    expect(json.user).toEqual({ id: 'uuid-nuevo', email: 'nuevo@cubopolar.com' });
    expect(json.usuario).toMatchObject({ nombre: 'Nuevo Usuario', email: 'nuevo@cubopolar.com', rol: 'Ventas', auth_id: 'uuid-nuevo', estatus: 'Activo' });
    expect(fake.db.usuarios).toHaveLength(1);
    expect(fake.db.usuarios[0].auth_id).toBe('uuid-nuevo');
    expect(fake.authCalls.createUser[0]).toMatchObject({ email: 'nuevo@cubopolar.com', email_confirm: true });
    expect(fake.authCalls.deleteUser).toHaveLength(0);
  });

  it('si el INSERT en usuarios falla → rollback en Auth y 500 sin huérfano', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-x', failInsert: { table: 'usuarios', error: { message: 'column "auth_id" does not exist' } } });
    const res = await createHandler({ getProfile: admin, getSupabase: () => fake })(evento());
    expect(res.statusCode).toBe(500);
    expect(JSON.parse(res.body).error).toMatch(/revirtió/);
    expect(fake.db.usuarios).toHaveLength(0);
    expect(fake.authCalls.deleteUser).toEqual(['uuid-x']);
  });

  it('si además el rollback falla → 500 con code AUTH_ORPHAN y el auth_id', async () => {
    const fake = makeFakeSupabase({}, { authId: 'uuid-huerfano', failInsert: { table: 'usuarios' }, deleteUserError: 'network' });
    const res = await createHandler({ getProfile: admin, getSupabase: () => fake })(evento());
    expect(res.statusCode).toBe(500);
    const json = JSON.parse(res.body);
    expect(json.code).toBe('AUTH_ORPHAN');
    expect(json.details.authId).toBe('uuid-huerfano');
  });

  it('email ya existente en usuarios (case-insensitive) → 400 y NO toca Auth', async () => {
    const fake = makeFakeSupabase({ usuarios: [{ id: 5, email: 'nuevo@cubopolar.com', rol: 'Ventas' }] });
    const res = await createHandler({ getProfile: admin, getSupabase: () => fake })(evento());
    expect(res.statusCode).toBe(400);
    expect(fake.authCalls.createUser).toHaveLength(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('email ya registrado en Auth → 400 traducido, sin insert', async () => {
    const fake = makeFakeSupabase({}, { createUserError: 'A user with this email address has already been registered' });
    const res = await createHandler({ getProfile: admin, getSupabase: () => fake })(evento());
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body).error).toMatch(/ya está registrado/);
    expect(fake.db.usuarios).toHaveLength(0);
  });

  it('no Admin → 403; body inválido → 400', async () => {
    const fake = makeFakeSupabase();
    expect((await createHandler({ getProfile: ventas, getSupabase: () => fake })(evento())).statusCode).toBe(403);
    expect((await createHandler({ getProfile: admin, getSupabase: () => fake })(evento({ ...body, rol: 'admin' }))).statusCode).toBe(400);
    expect((await createHandler({ getProfile: admin, getSupabase: () => fake })(evento({ ...body, password: '123' }))).statusCode).toBe(400);
    expect(fake.authCalls.createUser).toHaveLength(0);
  });
});
