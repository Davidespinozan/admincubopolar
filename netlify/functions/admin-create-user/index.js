// admin-create-user — endpoint protegido para alta de usuarios desde el
// panel admin del ERP. Tanda 20.
//
// Reemplaza la Edge Function `hyper-endpoint` (Supabase) que estaba rota:
//   - Comparaba rol con 'admin' minúscula vs 'Admin' del ERP → 403 fantasma.
//   - Lista de roles permitidos sin tildes ni el catálogo real.
//   - Leía rol de auth.users.user_metadata, pero el ERP lo guarda en
//     tabla `usuarios` (donde RLS y vistas lo consumen).
// Plus, vivía solo en el dashboard de Supabase: no estaba en este repo,
// no podíamos auditarla, ni testarla, ni rollback con git.
//
// Flujo:
//   1. getAuthenticatedProfile resuelve perfil del caller via JWT.
//   2. Sólo Admin pasa (403 si no).
//   3. validateAdminCreateUser valida body + rol contra catálogo canónico.
//   4. supabase.auth.admin.createUser con email_confirm=true.
//   5. Devuelve { user: { id, email } } — el INSERT en tabla usuarios
//      sigue haciéndolo el frontend (ConfiguracionView) con auth_id.

import {
  badRequest,
  forbidden,
  methodNotAllowed,
  ok,
  readJsonBody,
  serverError,
} from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { withSentry } from '../_lib/sentry.js';
import {
  validateAdminCreateUser,
  mapAuthErrorToUserMessage,
} from '../../../src/data/adminUserLogic.js';

const _handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  const authResult = await getAuthenticatedProfile(event);
  if (authResult.errorResponse) return authResult.errorResponse;
  if (authResult.profile?.rol !== 'Admin') {
    return forbidden('Solo Admin puede crear usuarios');
  }

  let body = null;
  try {
    body = await readJsonBody(event);
  } catch {
    return badRequest('JSON inválido');
  }

  const validation = validateAdminCreateUser(body);
  if (validation.error) return badRequest(validation.error);

  const { email, password, nombre, rol } = validation;
  const supabase = getSupabaseAdmin();

  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { nombre, rol },
      email_confirm: true,
    });

    if (error) return badRequest(mapAuthErrorToUserMessage(error.message));
    if (!data?.user?.id) return serverError('Supabase no devolvió ID del usuario');

    return ok({ user: { id: data.user.id, email: data.user.email } });
  } catch (error) {
    return serverError('No se pudo crear el usuario', error.message);
  }
};

export const handler = withSentry(_handler);
