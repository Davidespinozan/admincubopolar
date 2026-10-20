// camionesLogic.js — CAM-1 (mig 154): ficha de camiones. Lógica pura: validar el formulario igual que el contrato
// `guardar_camion` (que es la autoridad), armar sus parámetros, etiquetar un camión y traducir sus errores.

const txt = (v) => (v == null ? '' : String(v)).trim();

export const ESTATUS_CAMION = Object.freeze(['Activo', 'En taller', 'Inactivo']);

/** Campo de un camión aceptando snake_case (fila del servidor) o camelCase (data del store). */
const campo = (c, snake, camel) => (c?.[camel] ?? c?.[snake]);

/** Placas comparables: sin espacios, guiones ni signos, en mayúsculas (mismo criterio que el índice único). */
export function normalizarPlacas(p) {
  return txt(p).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/** VIN (número de serie): 17 caracteres, letras y números, sin I, O ni Q. Vacío = no capturado. */
export function esVinValido(vin) {
  const v = txt(vin).replace(/\s/g, '').toUpperCase();
  return v === '' || /^[A-HJ-NPR-Z0-9]{17}$/.test(v);
}

/** Valores del formulario a partir de un camión (o vacío para uno nuevo). */
export function formDesdeCamion(c = null) {
  return {
    nombre: txt(c?.nombre),
    numero_economico: txt(campo(c, 'numero_economico', 'numeroEconomico')),
    marca: txt(c?.marca),
    modelo: txt(c?.modelo),
    vin: txt(c?.vin),
    placas: txt(c?.placas),
    estatus: txt(c?.estatus) || 'Activo',
    kilometraje: campo(c, 'kilometraje', 'kilometraje') == null ? '' : String(campo(c, 'kilometraje', 'kilometraje')),
    chofer_id: campo(c, 'chofer_id', 'choferId') == null ? '' : String(campo(c, 'chofer_id', 'choferId')),
    observaciones: txt(c?.observaciones),
  };
}

/**
 * Valida el formulario. `camiones` = los demás camiones (para avisar de repetidos antes de enviar; el servidor lo vuelve
 * a exigir con sus índices únicos). Devuelve { errores } o { datos } listos para `guardar_camion`.
 */
export function validarCamion(form, { camiones = [], id = null } = {}) {
  const f = form || {};
  const errores = {};
  const nombre = txt(f.nombre);
  const eco = txt(f.numero_economico).toUpperCase();
  const vin = txt(f.vin).replace(/\s/g, '').toUpperCase();
  const placas = txt(f.placas).toUpperCase();
  const km = txt(f.kilometraje).replace(/[,\s]/g, '');
  if (!nombre) errores.nombre = 'La unidad es obligatoria (ej. 0001).';
  if (!esVinValido(vin)) errores.vin = 'El número de serie (VIN) tiene 17 caracteres, sin I, O ni Q.';
  if (km !== '' && !/^\d{1,9}$/.test(km)) errores.kilometraje = 'Escribe el kilometraje en números enteros.';
  if (!ESTATUS_CAMION.includes(txt(f.estatus) || 'Activo')) errores.estatus = 'Estatus inválido.';
  const otros = (Array.isArray(camiones) ? camiones : []).filter(c => String(c.id) !== String(id));
  if (eco && otros.some(c => txt(campo(c, 'numero_economico', 'numeroEconomico')).toUpperCase() === eco)) errores.numero_economico = 'Ya hay otro camión con ese número económico.';
  if (vin && otros.some(c => txt(c.vin).toUpperCase() === vin)) errores.vin = 'Ya hay otro camión con ese número de serie.';
  if (normalizarPlacas(placas) && otros.some(c => normalizarPlacas(c.placas) === normalizarPlacas(placas))) errores.placas = 'Ya hay otro camión con esas placas.';
  if (Object.keys(errores).length) return { errores };
  return {
    datos: {
      nombre, numero_economico: eco, marca: txt(f.marca), modelo: txt(f.modelo), vin, placas,
      estatus: txt(f.estatus) || 'Activo', kilometraje: km, chofer_id: txt(f.chofer_id) || null, observaciones: txt(f.observaciones),
    },
  };
}

/** Parámetros exactos de `guardar_camion(p_id, p_datos)`. */
export function buildGuardarCamionArgs({ id = null, datos } = {}) {
  return { p_id: id == null || id === '' ? null : Number(id), p_datos: datos || {} };
}

/** Etiqueta corta para listas: "CP01 · Isuzu · FW6216B" (cae a la unidad si no hay número económico). */
export function etiquetaCamion(c) {
  if (!c) return '';
  const eco = txt(campo(c, 'numero_economico', 'numeroEconomico'));
  const partes = [eco || txt(c.nombre), txt(c.marca), txt(c.placas)].filter(Boolean);
  return partes.join(' · ');
}

/** Choferes que se pueden asignar: usuarios activos con rol Chofer (mismo criterio que el contrato). */
export function choferesAsignables(usuarios) {
  return (Array.isArray(usuarios) ? usuarios : []).filter(u => txt(u.rol) === 'Chofer' && txt(u.estatus) === 'Activo');
}

const MENSAJES = {
  NO_AUTORIZADO: 'Solo Administración da de alta o edita camiones.',
  DATOS_REQUERIDOS: 'Faltan los datos del camión.',
  ESTATUS_INVALIDO: 'Estatus inválido (Activo, En taller o Inactivo).',
  VIN_INVALIDO: 'El número de serie (VIN) tiene 17 caracteres, sin I, O ni Q.',
  KILOMETRAJE_INVALIDO: 'El kilometraje es un número entero de 0 en adelante.',
  CHOFER_INVALIDO: 'El chofer asignado debe ser un usuario activo con rol Chofer.',
  UNIDAD_REQUERIDA: 'La unidad es obligatoria.',
  CAMION_NO_EXISTE: 'El camión ya no existe; actualiza la lista.',
  CAMION_DUPLICADO: 'Ya existe otro camión con ese número económico, número de serie o placas.',
};

/** Mensaje para el error del contrato (por su código en DETAIL; nunca muestra SQL). */
export function mensajeErrorCamion(error) {
  for (const d of [error?.details, error?.detail]) {
    if (!d) continue;
    try { const j = typeof d === 'string' ? JSON.parse(d) : d; if (j?.codigo && MENSAJES[j.codigo]) return MENSAJES[j.codigo]; } catch { /* no es JSON */ }
  }
  if (String(error?.code) === '42501') return MENSAJES.NO_AUTORIZADO;
  if (String(error?.code) === '23505') return MENSAJES.CAMION_DUPLICADO;
  return 'No se pudo guardar el camión. Intenta de nuevo.';
}
