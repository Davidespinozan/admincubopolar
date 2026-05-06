// sessionUser.js — helper puro para mapear (session de Supabase Auth +
// perfil de tabla `usuarios`) → user state que App.jsx maneja.
// Tanda 19. Aislado para tests sin necesidad de mockear Supabase.

/**
 * Construye el objeto `user` que vive en el state de App.jsx a partir
 * de una session de Supabase y el perfil leído de tabla `usuarios`.
 *
 * Convención del campo `auth_id`:
 *   - Si el perfil ya tiene auth_id, se respeta (puede venir de un
 *     login anterior).
 *   - Si está null (perfil legacy pre-Supabase-Auth), se rellena con
 *     el UUID del session.user — en memoria. La fila en BD queda
 *     intacta hasta que se haga UPDATE explícito en algún flujo.
 *
 * @param {Object|null} session — supabase.auth.getSession().data.session
 * @param {Object|null} profile — fila de tabla usuarios
 * @returns {Object|null} user state, o null si faltan datos para construirlo
 */
export function buildUserFromSessionAndProfile(session, profile) {
  if (!session || !session.user) return null;
  if (!profile) return null;
  return {
    ...profile,
    auth_id: profile.auth_id || session.user.id,
    authUserId: session.user.id,
  };
}
