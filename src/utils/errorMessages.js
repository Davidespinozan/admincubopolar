// errorMessages.js — traduce errores crudos de Supabase/Postgres a
// mensajes legibles para el usuario final. Usado en toast.error de las
// vistas para no exponer códigos como "23503" o stacks técnicos.

const POSTGRES_ERRORS = {
  '23503': 'No se puede borrar — tiene registros asociados.',
  '23505': 'Ya existe un registro con esos datos. Verifica duplicados.',
  '23514': 'Los datos ingresados no cumplen las reglas de la base de datos.',
  '23502': 'Falta llenar un campo requerido.',
  '22P02': 'Formato de dato inválido.',
  '42P01': 'Tabla no encontrada — contacta a soporte.',
  '42703': 'Columna no encontrada — contacta a soporte.',
  'PGRST116': 'No se encontraron resultados.',
  'PGRST301': 'Sin permisos para esta acción.',
};

/**
 * Traduce un objeto error de Supabase/Postgres a un mensaje legible.
 *
 * Acepta:
 *   - Error con shape { code, message, details }
 *   - Wrapper de store con shape { error, code, message }
 *   - String suelto
 *   - null/undefined
 *
 * @param {*}      err            Error crudo o wrapper del store
 * @param {string} fallbackMsg    Mensaje genérico si no se puede traducir
 * @returns {string}              Mensaje legible para el usuario
 */
export function traducirError(err, fallbackMsg = 'Error al guardar. Intenta de nuevo.') {
  if (!err) return fallbackMsg;
  if (typeof err === 'string') return err;

  // Si el wrapper trae error.error (string ya legible), usar ese
  if (typeof err.error === 'string' && err.error) return err.error;

  const code = err.code || err.error?.code;
  if (code && POSTGRES_ERRORS[code]) return POSTGRES_ERRORS[code];

  // Si el message contiene "duplicate key" o similar, usar mapeo manual
  const msg = String(err.message || err.error?.message || '').toLowerCase();
  if (msg.includes('duplicate key')) return POSTGRES_ERRORS['23505'];
  if (msg.includes('violates foreign key')) return POSTGRES_ERRORS['23503'];
  if (msg.includes('violates check constraint')) return POSTGRES_ERRORS['23514'];
  if (msg.includes('not-null constraint')) return POSTGRES_ERRORS['23502'];
  if (msg.includes('failed to fetch') || msg.includes('network')) {
    return 'Sin conexión al servidor. Verifica tu red.';
  }

  // Si hay un mensaje legible (en español o sin códigos técnicos), úsalo
  const rawMsg = err.message || err.error?.message;
  if (rawMsg && !/^[A-Z0-9_]+$/.test(rawMsg) && rawMsg.length < 200) {
    return rawMsg;
  }

  return fallbackMsg;
}
