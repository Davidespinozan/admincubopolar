// usuariosLogic.js — GER-1 (mig 120/121): Dueño, accesos adicionales y
// contraseñas. Lógica pura compartida por el frontend y las Netlify Functions.
// La autoridad real está en la base (guardar_usuario, fin_actor_permitido);
// esto solo evita ofrecer en pantalla lo que el servidor va a rechazar.

// Accesos que se pueden sumar al rol principal de una persona (CHECK de 120).
export const ACCESOS_EXTRA = Object.freeze(['Ventas', 'Almacén Bolsas']);
// Roles que un Admin (no dueño) puede asignar. Admin solo lo asigna el Dueño.
export const ROLES_OPERATIVOS = Object.freeze(['Ventas', 'Chofer', 'Producción', 'Almacén Bolsas', 'Facturación', 'Empleado', 'Sin asignar']);
export const PASSWORD_MIN = 8;

const lista = (v) => (Array.isArray(v) ? v.filter(x => typeof x === 'string' && x) : []);

export const esDueno = (u) => !!(u && (u.esDueno ?? u.es_dueno));
export const accesosDe = (u) => lista(u?.accesosExtra ?? u?.accesos_extra);
export const debeCambiarPassword = (u) => !!(u && (u.debeCambiarPassword ?? u.debe_cambiar_password));

/** Todos los roles con los que actúa un usuario: el principal y sus accesos. */
export function rolesDe(u) {
  const rol = typeof u?.rol === 'string' ? u.rol : '';
  return rol ? [rol, ...accesosDe(u).filter(a => a !== rol)] : [];
}
export const tieneRol = (u, rol) => rolesDe(u).includes(rol);

/** Etiqueta del usuario en pantalla: "Dueño", o su rol con sus accesos. */
export function etiquetaRol(u) {
  if (esDueno(u)) return 'Dueño';
  const extra = accesosDe(u).filter(a => a !== u?.rol);
  return extra.length ? `${u.rol} + ${extra.join(' + ')}` : (u?.rol || '');
}

/** Normaliza los accesos a guardar: solo los permitidos, sin el rol propio; Admin no lleva. */
export function normalizarAccesos(rol, accesos) {
  if (rol === 'Admin') return [];
  return ACCESOS_EXTRA.filter(a => a !== rol && lista(accesos).includes(a));
}

/** ¿El actor puede dar de alta un usuario con ese rol? (Admin: solo el Dueño). */
export function puedeCrearRol(actor, rol) {
  if (actor?.rol !== 'Admin') return false;
  if (rol === 'Admin') return esDueno(actor);
  return ROLES_OPERATIVOS.includes(rol);
}

/**
 * Qué puede cambiarle `actor` a `objetivo` (misma regla que guardar_usuario).
 * @returns {{ editar: boolean, rol: boolean, estatus: boolean, accesos: boolean, password: boolean, roles: string[], motivo: string|null }}
 */
export function permisosSobreUsuario(actor, objetivo) {
  const nada = (motivo) => ({ editar: false, rol: false, estatus: false, accesos: false, password: false, roles: [], motivo });
  if (actor?.rol !== 'Admin' || !objetivo) return nada('Solo Administración gestiona usuarios');
  const dueno = esDueno(actor);
  const mismo = String(actor.id) === String(objetivo.id);
  if (esDueno(objetivo)) {
    if (!dueno) return nada('Solo el Dueño modifica su propia cuenta');
    // El Dueño corrige su nombre; no se quita el rol ni se desactiva.
    return { editar: true, rol: false, estatus: false, accesos: false, password: false, roles: ['Admin'], motivo: 'El Dueño no cambia su rol ni se desactiva' };
  }
  if (dueno) return { editar: true, rol: true, estatus: true, accesos: true, password: true, roles: ['Admin', ...ROLES_OPERATIVOS], motivo: null };
  if (mismo) return { editar: true, rol: false, estatus: false, accesos: false, password: false, roles: [objetivo.rol], motivo: 'No puedes cambiar tu propio rol ni tu estatus' };
  if (objetivo.rol === 'Admin') return { editar: true, rol: false, estatus: false, accesos: false, password: false, roles: ['Admin'], motivo: 'Solo el Dueño cambia a otro Admin' };
  return { editar: true, rol: true, estatus: true, accesos: false, password: true, roles: [...ROLES_OPERATIVOS], motivo: null };
}

/** Valida el cambio de la contraseña propia. */
export function validarCambioPassword({ actual, nueva, confirmar } = {}) {
  const a = typeof actual === 'string' ? actual : '';
  const n = typeof nueva === 'string' ? nueva : '';
  if (!a) return { error: 'Escribe tu contraseña actual' };
  if (n.length < PASSWORD_MIN) return { error: `La nueva contraseña debe tener al menos ${PASSWORD_MIN} caracteres` };
  if (n === a) return { error: 'La nueva contraseña debe ser distinta de la actual' };
  if (n !== confirmar) return { error: 'La confirmación no coincide' };
  if (/^(.)\1+$/.test(n) || ['12345678', '123456789', '87654321', 'password', 'contraseña'].includes(n.toLowerCase())) {
    return { error: 'Elige una contraseña menos obvia' };
  }
  return { ok: true };
}

/** Valida la contraseña temporal que fija Administración (alta o restablecer). */
export function validarPasswordTemporal(password) {
  const p = typeof password === 'string' ? password : '';
  if (p.length < PASSWORD_MIN) return { error: `La contraseña temporal debe tener al menos ${PASSWORD_MIN} caracteres` };
  return { ok: true };
}

const SLUG_ROL = { 'Admin': 'admin', 'Ventas': 'ventas', 'Chofer': 'chofer', 'Producción': 'produccion', 'Almacén Bolsas': 'almacen',
  'Facturación': 'facturacion', 'Empleado': 'empleado', 'Sin asignar': 'staff' };
const limpio = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim();

/**
 * Correo sugerido: nombre.apellido.rol@dominio (sin acentos). Con nombre
 * compuesto ("María de Jesús Ibarra Fernández") toma el primer nombre y el
 * primer apellido (penúltima palabra cuando hay 3 o más).
 */
export function correoSugerido(nombreCompleto, rol, dominio = 'cubopolar.com') {
  const partes = limpio(nombreCompleto).split(/\s+/).filter(p => p && !['de', 'del', 'la', 'las', 'los', 'y'].includes(p));
  if (partes.length === 0) return '';
  const nombre = partes[0];
  const apellido = partes.length >= 3 ? partes[partes.length - 2] : (partes[1] || '');
  return [nombre, apellido, SLUG_ROL[rol] || 'staff'].filter(Boolean).join('.') + '@' + dominio;
}

/** Mensaje para la persona a partir del error de guardar_usuario / contraseñas. */
export function mensajeErrorUsuario(error) {
  const m = String(error?.message || error || '');
  const limpio = m.replace(/^(guardar_usuario|confirmar_cambio_password|fijar_password_temporal):\s*/i, '');
  if (/Failed to fetch|NetworkError|network|conexi[oó]n/i.test(m)) return 'Sin conexión. Vuelve a intentar.';
  if (/sigue siendo la temporal/i.test(m)) return 'Esa sigue siendo la contraseña temporal. Elige una distinta.';
  if (/same_password|should be different|different from the old/i.test(m)) return 'La nueva contraseña debe ser distinta de la actual.';
  if (/weak|at least|characters/i.test(m)) return `La contraseña debe tener al menos ${PASSWORD_MIN} caracteres.`;
  if (/Invalid login credentials/i.test(m)) return 'La contraseña actual no es correcta.';
  if (/usuarios_rol_check/i.test(m)) return 'Rol no válido.';
  if (limpio && limpio !== m) return limpio.charAt(0).toUpperCase() + limpio.slice(1) + '.';
  if (/no autorizado|42501|permission denied/i.test(m)) return 'Tu usuario no tiene permiso para esta acción.';
  return m || 'No se pudo completar la acción.';
}

/** Argumentos de guardar_usuario (120) a partir del formulario. */
export function buildGuardarUsuarioArgs({ id, nombre, rol, estatus, accesosExtra } = {}, { incluirAccesos = false } = {}) {
  return {
    p_usuario_id: Number(id),
    p_nombre: String(nombre || '').trim(),
    p_rol: rol,
    p_estatus: estatus === 'Inactivo' ? 'Inactivo' : 'Activo',
    // NULL = no tocar los accesos (solo el Dueño los manda).
    p_accesos_extra: incluirAccesos ? normalizarAccesos(rol, accesosExtra) : null,
  };
}

const ETIQUETA_TABLA = { usuarios: 'Usuarios', productos: 'Catálogo', precios_esp: 'Precios especiales', cuentas_por_pagar: 'Cuentas por pagar',
  empleados: 'Empleados', costos_fijos: 'Costos fijos', costos_historial: 'Gastos', movimientos_contables: 'Movimientos', configuracion_empresa: 'Datos de la empresa',
  clientes: 'Clientes', cuartos_frios: 'Congeladores', ordenes: 'Ventas', rutas: 'Rutas', camiones: 'Camiones', nomina_conceptos: 'Conceptos de nómina' };
const ETIQUETA_CAMPO = { precio: 'precio', salario_diario: 'salario diario', rol: 'rol', estatus: 'estatus', accesos_extra: 'accesos', nombre: 'nombre',
  monto: 'monto', saldo_pendiente: 'saldo', limite_credito: 'límite de crédito', credito_autorizado: 'crédito autorizado', total: 'total', debe_cambiar_password: 'contraseña',
  aplica_a: 'a quién aplica', personas: 'personas', activo: 'activo', calculo: 'cálculo', vigente_desde: 'desde', vigente_hasta: 'hasta' };
const ACCION = { INSERT: 'creó', UPDATE: 'cambió', DELETE: 'borró', CONTRATO: 'cambió' };
const corto = (v) => {
  if (v === null || v === undefined || v === '') return '—';
  // Personas de un concepto de nómina: nombres (con su monto o tope si lo tienen).
  if (Array.isArray(v) && v.length && typeof v[0] === 'object') {
    const t = v.map(p => `${p?.nombre || '?'}${p?.excluido ? ' (no)' : p?.limite_total != null ? ` (tope ${p.limite_total})` : p?.monto != null ? ` (${p.monto})` : ''}`).join(', ');
    return t.length > 60 ? t.slice(0, 59) + '…' : t;
  }
  if (Array.isArray(v)) return v.length ? v.join(', ') : 'ninguno';
  if (typeof v === 'boolean') return v ? 'sí' : 'no';
  if (typeof v === 'object') return '…';
  const t = String(v);
  return t.length > 28 ? t.slice(0, 27) + '…' : t;
};

/** Fila de la bitácora lista para pintar: módulo, frase, cambios antes → después y si es de dinero. */
export function describirCambio(row) {
  const tabla = String(row?.tabla || '');
  const antes = row?.antes && typeof row.antes === 'object' ? row.antes : {};
  const despues = row?.despues && typeof row.despues === 'object' ? row.despues : {};
  // Alta de un concepto de nómina (contrato sin "antes"): lo que importa es cuánto y a quién.
  const altaConcepto = tabla === 'nomina_conceptos' && row?.accion === 'CONTRATO' && !row?.antes;
  const campos = Array.isArray(row?.cambios) && row.cambios.length ? row.cambios
    : altaConcepto ? ['monto', 'aplica_a', 'personas'] : (row?.accion === 'CONTRATO' ? Object.keys(despues) : []);
  const cambios = campos.filter(k => !['id', 'created_at', 'auth_id'].includes(k)).slice(0, 4)
    .map(k => ({ campo: ETIQUETA_CAMPO[k] || k.replace(/_/g, ' '), antes: corto(antes[k]), despues: corto(despues[k]) }));
  const quien = despues.nombre || antes.nombre || despues.folio || antes.folio || despues.sku || antes.sku || despues.concepto || antes.concepto || (row?.registro_id ? `#${row.registro_id}` : '');
  const sensibles = ['precio', 'salario_diario', 'rol', 'estatus', 'accesos_extra', 'monto', 'saldo_pendiente', 'limite_credito', 'credito_autorizado', 'total'];
  return {
    id: row?.id,
    at: row?.at,
    modulo: ETIQUETA_TABLA[tabla] || tabla,
    actor: row?.actor || 'Sistema',
    titulo: `${row?.actor || 'Sistema'} ${altaConcepto ? 'creó' : ACCION[row?.accion] || 'cambió'} ${quien}`.trim(),
    detalle: row?.accion === 'CONTRATO' && row?.detalle && !['guardar_usuario', 'guardar_concepto_nomina'].includes(row.detalle) ? row.detalle : null,
    cambios,
    importante: row?.accion === 'DELETE' || campos.some(k => sensibles.includes(k)),
  };
}
