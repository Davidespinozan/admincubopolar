// sessionUser.test.js — Tanda 19. Helper puro para construir el user
// state de App.jsx desde session de Supabase + perfil de tabla usuarios.

import { describe, it, expect } from 'vitest';
import { buildUserFromSessionAndProfile } from '../lib/sessionUser';

describe('buildUserFromSessionAndProfile', () => {
  const session = {
    user: {
      id: '76e1d265-514f-44a2-b665-c348333c2319',
      email: 'admin@cubopolar.com',
    },
  };
  const profile = {
    id: 7,
    nombre: 'David',
    email: 'admin@cubopolar.com',
    rol: 'Admin',
    estatus: 'Activo',
    auth_id: '76e1d265-514f-44a2-b665-c348333c2319',
  };

  it('session + profile válidos → user con auth_id correcto', () => {
    const u = buildUserFromSessionAndProfile(session, profile);
    expect(u).toEqual({
      ...profile,
      auth_id: '76e1d265-514f-44a2-b665-c348333c2319',
      authUserId: '76e1d265-514f-44a2-b665-c348333c2319',
    });
  });

  it('profile sin auth_id (legacy) → usa session.user.id', () => {
    const profileLegacy = { ...profile, auth_id: null };
    const u = buildUserFromSessionAndProfile(session, profileLegacy);
    expect(u.auth_id).toBe(session.user.id);
    expect(u.authUserId).toBe(session.user.id);
  });

  it('profile con auth_id distinto → respeta el del profile', () => {
    const otherUuid = '00000000-0000-0000-0000-000000000000';
    const profileWithOther = { ...profile, auth_id: otherUuid };
    const u = buildUserFromSessionAndProfile(session, profileWithOther);
    expect(u.auth_id).toBe(otherUuid);
    expect(u.authUserId).toBe(session.user.id); // authUserId siempre del session
  });

  it('session null → null', () => {
    expect(buildUserFromSessionAndProfile(null, profile)).toBeNull();
  });

  it('session sin user → null', () => {
    expect(buildUserFromSessionAndProfile({}, profile)).toBeNull();
  });

  it('profile null → null', () => {
    expect(buildUserFromSessionAndProfile(session, null)).toBeNull();
  });

  it('ambos null → null', () => {
    expect(buildUserFromSessionAndProfile(null, null)).toBeNull();
  });

  it('preserva campos extra del profile (ej. is_test_account)', () => {
    const profileExt = { ...profile, is_test_account: true };
    const u = buildUserFromSessionAndProfile(session, profileExt);
    expect(u.is_test_account).toBe(true);
  });
});
