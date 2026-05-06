// adminUserLogic.js — lógica pura para alta de usuarios desde el ERP.
// Tanda 20. Reemplaza la Edge Function `hyper-endpoint` (Supabase) que
// estaba rota: comparaba roles con minúscula y leía rol del lugar
// equivocado. Aislado para tests sin Supabase.

// Catálogo canónico del ERP. Debe coincidir con FormSelect en
// ConfiguracionView.jsx — si se agrega un rol allá hay que agregarlo aquí.
export const ROLES_VALIDOS = [
  'Admin',
  'Ventas',
  'Chofer',
  'Producción',
  'Almacén Bolsas',
  'Facturación',
  'Sin asignar',
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida y normaliza el body de creación de usuario antes de hablar con
 * Supabase Auth admin.
 *
 * @param {Object|null|undefined} input — { nombre, email, password, rol }
 * @returns {{ ok: true, nombre, email, password, rol } | { error: string }}
 */
export function validateAdminCreateUser(input) {
  const nombre = typeof input?.nombre === 'string' ? input.nombre.trim() : '';
  const emailRaw = typeof input?.email === 'string' ? input.email.trim() : '';
  const email = emailRaw.toLowerCase();
  const password = typeof input?.password === 'string' ? input.password : '';
  const rol = typeof input?.rol === 'string' ? input.rol : '';

  if (!nombre) return { error: 'Nombre requerido' };
  if (!email) return { error: 'Email requerido' };
  if (!EMAIL_RE.test(email)) return { error: 'Email inválido' };
  if (!password) return { error: 'Password requerido' };
  if (password.length < 6) return { error: 'Password mínimo 6 caracteres' };
  if (!ROLES_VALIDOS.includes(rol)) return { error: `Rol inválido: ${rol}` };

  return { ok: true, nombre, email, password, rol };
}

/**
 * Convierte el mensaje crudo de supabase.auth.admin.createUser a algo que
 * un usuario admin del ERP pueda entender. Para casos no reconocidos,
 * devuelve el original (mejor un mensaje técnico que un placeholder vacío).
 *
 * @param {string|null|undefined} message
 * @returns {string}
 */
export function mapAuthErrorToUserMessage(message) {
  const m = String(message || '').toLowerCase();
  if (!m) return 'Error al crear usuario';
  if (/already.*registered|already.*exists|duplicate.*email|user.*exists|email.*taken/.test(m)) {
    return 'Ese correo ya está registrado';
  }
  if (/password/.test(m) && /(weak|short|length)/.test(m)) {
    return 'Password muy débil — usa al menos 6 caracteres';
  }
  if (/invalid.*email|email.*invalid/.test(m)) {
    return 'Email inválido';
  }
  return message;
}
