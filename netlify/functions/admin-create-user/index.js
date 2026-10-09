// admin-create-user — endpoint protegido para alta de usuarios desde el
// panel admin del ERP. Tanda 20 + P0 (auth consistency).
//
// Reemplaza la Edge Function `hyper-endpoint` (Supabase) que estaba rota:
//   - Comparaba rol con 'admin' minúscula vs 'Admin' del ERP → 403 fantasma.
//   - Lista de roles permitidos sin tildes ni el catálogo real.
//   - Leía rol de auth.users.user_metadata, pero el ERP lo guarda en
//     tabla `usuarios` (donde RLS y vistas lo consumen).
//
// P0: auth.users → usuarios se comporta como UNA unidad lógica.
//   ANTES: la function creaba en Auth y el frontend hacía el INSERT en
//   `usuarios`. Si el INSERT fallaba quedaba un auth user huérfano con
//   contraseña conocida y sin rollback.
//   AHORA:
//   1. getAuthenticatedProfile resuelve perfil del caller via JWT; sólo Admin.
//   2. validateAdminCreateUser valida body + rol contra catálogo canónico.
//   3. Pre-check: si ya existe fila en `usuarios` con ese email → 400 sin
//      tocar Auth.
//   4. supabase.auth.admin.createUser con email_confirm=true.
//   5. INSERT en `usuarios` con auth_id (service_role).
//   5b. GER-1 (120): fijar_password_temporal → cambio obligatorio al entrar.
//       El rol Admin solo lo crea el Dueño (usuarios.es_dueno).
//   6. Si el INSERT falla → auth.admin.deleteUser(authId). Si el rollback
//      también falla → 500 con code AUTH_ORPHAN y el auth_id para
//      intervención manual (queda en logs/Sentry).
//
// Se exporta `createHandler(deps)` para tests sin red.

import {
  badRequest,
  forbidden,
  json,
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
import { puedeCrearRol } from '../../../src/data/usuariosLogic.js';

export const createHandler = ({
  getProfile = getAuthenticatedProfile,
  getSupabase = getSupabaseAdmin,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  const authResult = await getProfile(event);
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
  // GER-1 (120): el rol Admin solo lo asigna el Dueño.
  if (!puedeCrearRol(authResult.profile, rol)) {
    return forbidden('Solo el Dueño puede crear un usuario Admin');
  }
  const supabase = getSupabase();

  // Pre-check en tabla usuarios (email ya viene trim+lowercase). Evita
  // crear en Auth algo que el INSERT rechazaría por UNIQUE(email).
  try {
    const { data: existente, error: existenteError } = await supabase
      .from('usuarios')
      .select('id')
      .ilike('email', email)
      .limit(1)
      .maybeSingle();
    if (existenteError) throw existenteError;
    if (existente) return badRequest('Ya existe un usuario del ERP con ese correo');
  } catch (error) {
    return serverError('No se pudo verificar el correo', error.message);
  }

  let authId = null;
  try {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      user_metadata: { nombre, rol },
      email_confirm: true,
    });

    if (error) return badRequest(mapAuthErrorToUserMessage(error.message));
    if (!data?.user?.id) return serverError('Supabase no devolvió ID del usuario');
    authId = data.user.id;
  } catch (error) {
    return serverError('No se pudo crear el usuario', error.message);
  }

  // INSERT en usuarios como parte de la misma unidad lógica.
  const { data: usuario, error: insertError } = await supabase
    .from('usuarios')
    .insert({ nombre, email, rol, auth_id: authId, estatus: 'Activo' })
    .select('id, nombre, email, rol, estatus, auth_id')
    .single();

  if (!insertError && usuario) {
    // GER-1 (120): con `forzarCambio` la contraseña que eligió Administración es
    // TEMPORAL: el servidor guarda su huella y la cuenta no tiene autoridad
    // hasta que su dueño la cambia. Si el paso falla la cuenta queda creada y
    // usable: se avisa para restablecerla (no se revierte un alta válida).
    // Decisión del dueño (2026-10-09): el cambio obligatorio es OPCIONAL; sin
    // `forzarCambio` la contraseña inicial sirve hasta que alguien la cambie.
    if (body?.forzarCambio !== true) {
      return ok({ user: { id: authId, email }, usuario, temporal: false, forzarCambio: false });
    }
    let temporal = true;
    try {
      const { error: tempError } = await supabase.rpc('fijar_password_temporal', {
        p_usuario_id: usuario.id,
        p_por: authResult.profile?.nombre || null,
      });
      if (tempError) throw tempError;
    } catch (error) {
      temporal = false;
      console.error('[admin-create-user] no se pudo fijar la contraseña temporal', { usuarioId: usuario.id, error: error?.message });
    }
    return ok({ user: { id: authId, email }, usuario, temporal, forzarCambio: true });
  }

  // Rollback: no dejar auth.users huérfano.
  const { error: deleteError } = await supabase.auth.admin.deleteUser(authId);
  if (deleteError) {
    console.error('[admin-create-user] AUTH_ORPHAN: no se pudo revertir auth user', {
      authId,
      email,
      insertError: insertError?.message,
      deleteError: deleteError?.message,
    });
    return json(500, {
      error: 'CRÍTICO: el usuario quedó creado en Auth pero no en el ERP y el rollback falló. Elimínalo manualmente en Supabase Auth.',
      code: 'AUTH_ORPHAN',
      details: { authId, email, insertError: insertError?.message, deleteError: deleteError?.message },
    });
  }

  return serverError(
    'No se pudo guardar el usuario en el ERP; se revirtió el alta en Auth',
    insertError?.message
  );
};

export const handler = withSentry(createHandler());
