// correccionesTiendaLogic.js — P4-H3E: lógica pura de la pantalla de correcciones autorizadas del inventario de
// un congelador de tienda (contratos de la migración 153). El servidor decide todo lo autoritativo: quién puede
// solicitar, autorizar, ejecutar o cancelar; la vigencia (24 h); la existencia vigente; el kardex. Aquí solo se
// arman los parámetros EXACTOS de cada contrato, se conserva el operacion_id de cada intento, se decide qué botones
// ofrecer (experiencia; nunca seguridad) y se traducen los códigos de error de 153.
import { nuevoOperacionId, resolverOperacion, pertenenciaCuarto } from './stockContratosLogic.js';
import { esDueno } from './usuariosLogic.js';
import { esErrorDeRed } from './asistenciaLogic.js';
import { diaNegocio } from '../utils/fechas.js';

export { nuevoOperacionId, resolverOperacion };

const txt = (v) => (v == null ? '' : String(v)).trim();

export const MOTIVO_MIN_SOLICITUD = 10; // 153: CHECK length(btrim(motivo)) >= 10
export const MOTIVO_MIN_CANCELACION = 5; // 153: cancelar_correccion_tienda exige >= 5

/** Estados de 153, con texto (el color nunca es el único indicador). */
export const ESTADOS_CORRECCION = Object.freeze({
  solicitada: { label: 'Solicitada', tono: 'amber', explica: 'Espera la decisión del Dueño. No ha cambiado el inventario.' },
  autorizada: { label: 'Autorizada', tono: 'blue', explica: 'Administración puede ejecutarla antes de que venza. No ha cambiado el inventario.' },
  ejecutada: { label: 'Ejecutada', tono: 'green', explica: 'El inventario del congelador ya se corrigió.' },
  rechazada: { label: 'Rechazada', tono: 'red', explica: 'El Dueño la rechazó. No cambió el inventario.' },
  cancelada: { label: 'Cancelada', tono: 'slate', explica: 'Se canceló antes de ejecutarse. No cambió el inventario.' },
  vencida: { label: 'Vencida', tono: 'slate', explica: 'La autorización pasó de 24 horas sin ejecutarse. No cambió el inventario.' },
});

/** Estado que se muestra: el que calcula el servidor (`estado_efectivo`: una autorizada vencida se ve vencida). */
export function estadoDe(fila) {
  return txt(fila?.estado_efectivo || fila?.estado) || 'solicitada';
}

/**
 * Perfil de la pantalla para la persona. Solo Administración (rol Admin) la ve; dentro de Admin, el Dueño (Admin +
 * es_dueno) decide y Administración sin el Dueño solicita y ejecuta (D-H3-02/03/04). El servidor lo vuelve a exigir.
 */
export function perfilCorrecciones(usuario) {
  const admin = txt(usuario?.rol) === 'Admin';
  const dueno = admin && esDueno(usuario);
  return {
    visible: admin,
    dueno,
    administracion: admin && !dueno,
    puedeSolicitar: admin && !dueno,
    puedeDecidir: dueno,
    puedeEjecutar: admin && !dueno,
  };
}

const mismoId = (a, b) => a != null && b != null && String(a) === String(b);

/**
 * Botones que se ofrecen para una fila. `usuarioId` = usuarios.id de la persona (para "su propia solicitud" y "quien
 * autorizó"); si no se conoce, no se ofrece lo que depende de él. La autoridad final es el contrato.
 */
export function accionesFila(fila, perfil, usuarioId = null) {
  const est = estadoDe(fila);
  const guardado = txt(fila?.estado);
  const abierta = guardado === 'solicitada' || guardado === 'autorizada';
  const propia = mismoId(fila?.solicitada_por, usuarioId);
  const cancelar = abierta && (!!perfil?.dueno || (!!perfil?.administracion && propia));
  return {
    decidir: !!perfil?.puedeDecidir && est === 'solicitada' && usuarioId != null && !propia,
    ejecutar: !!perfil?.puedeEjecutar && est === 'autorizada' && usuarioId != null && !mismoId(fila?.decidida_por, usuarioId),
    cancelar,
    cierraVencida: cancelar && est === 'vencida',
  };
}

/** Congeladores de UNA tienda: pertenencia por establecimiento_id (nunca nombre ni prefijo); CEDIS y desconocidos fuera. */
export function cuartosDeTienda(cuartos, establecimientoId) {
  if (establecimientoId == null || establecimientoId === '') return [];
  return (Array.isArray(cuartos) ? cuartos : [])
    .filter(c => pertenenciaCuarto(c) === 'tienda' && String(c.establecimiento_id) === String(establecimientoId));
}

/** Tiendas que se pueden elegir: las de estado_tienda (nunca el CEDIS) que tienen al menos un congelador propio. */
export function tiendasConCongelador(tiendas, cuartos) {
  return (Array.isArray(tiendas) ? tiendas : [])
    .filter(t => t && String(t.id) !== '1' && String(t.tipo) !== 'cedis' && cuartosDeTienda(cuartos, t.id).length > 0);
}

/** Existencia registrada de un SKU en un congelador (la misma lectura que hace 153: stock ->> sku, ausente = 0). */
export function existenciaDe(cuarto, sku) {
  const v = cuarto?.stock?.[txt(sku)];
  const q = Number(v ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/** Diferencia = contada − registrada, con su tipo para mostrarla. */
export function compararCorreccion(registrada, contadoTexto) {
  const t = txt(contadoTexto);
  if (t === '') return { tipo: 'vacio', valido: false, diferencia: null, contada: null };
  if (!/^\d{1,9}$/.test(t)) return { tipo: 'invalido', valido: false, diferencia: null, contada: null, mensaje: 'Escribe la existencia contada en piezas enteras (0 o más).' };
  const contada = Number(t);
  const reg = Number(registrada);
  const diferencia = contada - reg;
  if (diferencia === 0) return { tipo: 'sin_diferencia', valido: false, diferencia: 0, contada, mensaje: 'Lo contado es igual a lo registrado: no hay nada que corregir.' };
  return {
    tipo: diferencia > 0 ? 'positiva' : 'negativa', valido: true, diferencia, contada,
    mensaje: diferencia > 0 ? `Se sumarán ${diferencia} piezas al ejecutarla (ajuste positivo).` : `Se restarán ${Math.abs(diferencia)} piezas al ejecutarla (ajuste negativo).`,
  };
}

export function signoDiferencia(d) {
  const q = Number(d);
  if (!Number.isFinite(q) || q === 0) return '0';
  return q > 0 ? `+${q}` : `−${Math.abs(q)}`;
}

/**
 * Valida la solicitud antes de enviarla. `cuarto` es la lectura FRESCA del servidor (id, stock, establecimiento_id);
 * `registrada` es la existencia que la persona tiene a la vista. Devuelve { errores } o { args sin operación }.
 */
export function validarSolicitud({ tiendaId, cuarto, sku, registrada, contadoTexto, motivo } = {}) {
  const errores = {};
  if (tiendaId == null || tiendaId === '') errores.tienda = 'Elige la tienda.';
  if (!cuarto) errores.cuarto = 'Elige el congelador.';
  else if (pertenenciaCuarto(cuarto) !== 'tienda') errores.cuarto = pertenenciaCuarto(cuarto) === 'cedis'
    ? 'Ese congelador es del CEDIS: se ajusta con su propio proceso, no con una corrección de tienda.'
    : 'No se pudo confirmar a qué tienda pertenece este congelador.';
  else if (String(cuarto.establecimiento_id) !== String(tiendaId)) errores.cuarto = 'Ese congelador no es de la tienda elegida.';
  if (!txt(sku)) errores.sku = 'Elige el producto.';
  const comp = compararCorreccion(registrada, contadoTexto);
  if (!comp.valido) errores.contado = comp.mensaje || 'Escribe la existencia contada.';
  if (txt(motivo).length < MOTIVO_MIN_SOLICITUD) errores.motivo = `Explica el motivo (mínimo ${MOTIVO_MIN_SOLICITUD} caracteres).`;
  if (cuarto && !errores.cuarto && txt(sku) && existenciaDe(cuarto, sku) !== Number(registrada)) {
    errores.registrada = MENSAJE_CONTEO_OBSOLETO;
  }
  if (Object.keys(errores).length) return { errores };
  return { datos: { cuartoId: txt(cuarto.id), sku: txt(sku), vista: Number(registrada), propuesta: comp.contada, motivo: txt(motivo) } };
}

// ── Claves de intento lógico (mismo dato → misma operación en cada reintento) ──
export const claveSolicitud = (d = {}) => ['CIT-SOL', txt(d.cuartoId), txt(d.sku), Number(d.vista), Number(d.propuesta), txt(d.motivo)].join('|');
export const claveDecision = ({ correccionId, decision, nota } = {}) => ['CIT-DEC', txt(correccionId), txt(decision), txt(nota)].join('|');
export const claveEjecucion = ({ correccionId } = {}) => ['CIT-EJE', txt(correccionId)].join('|');
export const claveCancelacion = ({ correccionId, motivo } = {}) => ['CIT-CAN', txt(correccionId), txt(motivo)].join('|');

// ── Parámetros EXACTOS de los contratos de 153 ──
export function buildSolicitarArgs({ operacionId, cuartoId, sku, vista, propuesta, motivo } = {}) {
  return { p_operacion_id: operacionId, p_cuarto_id: txt(cuartoId), p_sku: txt(sku), p_existencia_vista: Number(vista), p_existencia_propuesta: Number(propuesta), p_motivo: txt(motivo) };
}
export function buildDecisionArgs({ operacionId, correccionId, decision, nota } = {}) {
  const d = txt(decision);
  if (d !== 'autorizar' && d !== 'rechazar') return { error: 'Decisión inválida' };
  return { args: { p_operacion_id: operacionId, p_correccion_id: Number(correccionId), p_decision: d, p_nota: txt(nota) || null } };
}
/** Ejecutar recibe SOLO la operación y la corrección: congelador, SKU y cantidades salen de la solicitud autorizada. */
export function buildEjecutarArgs({ operacionId, correccionId } = {}) {
  return { p_operacion_id: operacionId, p_correccion_id: Number(correccionId) };
}
export function buildCancelarArgs({ operacionId, correccionId, motivo } = {}) {
  return { p_operacion_id: operacionId, p_correccion_id: Number(correccionId), p_motivo: txt(motivo) };
}
export function buildConsultaArgs({ establecimientoId = null, limite = 200 } = {}) {
  return { p_establecimiento_id: establecimientoId == null || establecimientoId === '' ? null : Number(establecimientoId), p_limite: limite };
}

// ── Errores (códigos reales de 153 en DETAIL) ──
export const MENSAJE_CONTEO_OBSOLETO = 'La existencia cambió desde que se solicitó la corrección. Es necesario realizar un nuevo conteo y generar otra solicitud.';
const MENSAJES_153 = {
  NO_AUTORIZADO: 'No tienes permiso para esta acción.',
  SOLO_ADMINISTRACION: 'Las solicitudes las hace Administración; el Dueño autoriza o rechaza.',
  SOLO_DUENO: 'Solo el Dueño autoriza o rechaza correcciones de inventario de tienda.',
  AUTOAUTORIZACION: 'Nadie autoriza su propia solicitud.',
  AUTORIZADOR_NO_EJECUTA: 'Quien autorizó la corrección no puede ejecutarla; la ejecuta otra persona de Administración.',
  OPERACION_REQUERIDA: 'Falta el identificador de la operación. Vuelve a intentarlo.',
  OPERACION_REUSADA: 'Esta operación ya se usó con otros datos. Cierra el diálogo y vuelve a empezar.',
  CANTIDAD_INVALIDA: 'Las existencias deben ser enteros de 0 en adelante.',
  SIN_DIFERENCIA: 'Lo contado es igual a lo registrado: no hay nada que corregir.',
  MOTIVO_REQUERIDO: 'El motivo es obligatorio.',
  CUARTO_NO_ES_DE_TIENDA: 'Ese congelador no es de una tienda (el CEDIS se ajusta con su propio proceso).',
  CUARTO_NO_PERTENECE: 'El congelador ya no pertenece a la tienda de la solicitud. Cancélala y genera otra.',
  SKU_NO_VALIDO: 'El producto ya no existe como producto terminado (¿cambió su clave?). Cancela la solicitud y genera otra.',
  CONTEO_OBSOLETO: MENSAJE_CONTEO_OBSOLETO,
  CORRECCION_ABIERTA: 'Ya hay una corrección abierta para ese congelador y producto. Termina o cancela esa primero.',
  CORRECCION_NO_EXISTE: 'La corrección no existe.',
  DECISION_INVALIDA: 'Indica si autorizas o rechazas.',
  ESTADO_INVALIDO: 'La corrección ya cambió de estado; actualiza la lista.',
  NO_AUTORIZADA: 'Solo se ejecuta una corrección autorizada; actualiza la lista.',
  YA_EJECUTADA: 'Esta corrección ya se ejecutó; el inventario no se volvió a mover.',
  AUTORIZACION_VENCIDA: 'La autorización venció (24 horas). Hace falta una nueva solicitud y una nueva autorización.',
  CORRECCION_INMUTABLE: 'La corrección no se puede modificar así.',
  INVENTARIO_DE_TIENDA: 'El inventario de una tienda solo se corrige con este proceso autorizado.',
};
const RECHAZO_DEFINITIVO = /^(22023|42501|23505|23503|23514|P0001)$/;

function codigoDe(error) {
  for (const campo of [error?.details, error?.detail]) {
    if (!campo) continue;
    try { const j = typeof campo === 'string' ? JSON.parse(campo) : campo; if (j?.codigo) return { codigo: String(j.codigo), datos: j }; } catch { /* no es JSON */ }
  }
  return { codigo: null, datos: null };
}

/**
 * Traduce el error de un contrato de 153. `incierto: true` = no se sabe si el servidor la hizo (red, tiempo, 5xx):
 * se reintenta con la MISMA operación (153 responde `replay`). Nunca expone SQL ni trazas.
 */
export function clasificarErrorCorreccion(error, enLinea = true) {
  if (esErrorDeRed(error, enLinea)) return { incierto: true, codigo: 'SIN_CONEXION', mensaje: 'Sin conexión. No sabemos si la operación llegó: reintenta (no se duplica) o actualiza la lista.' };
  const { codigo, datos } = codigoDe(error);
  if (codigo && MENSAJES_153[codigo]) {
    let mensaje = MENSAJES_153[codigo];
    if (codigo === 'CONTEO_OBSOLETO' && datos?.actual != null) mensaje = `${MENSAJE_CONTEO_OBSOLETO} (Existencia registrada ahora: ${datos.actual}.)`;
    return { incierto: false, codigo, mensaje };
  }
  const sqlstate = String(error?.code || '');
  if (sqlstate === '42501') return { incierto: false, codigo: 'NO_AUTORIZADO', mensaje: MENSAJES_153.NO_AUTORIZADO };
  if (RECHAZO_DEFINITIVO.test(sqlstate)) return { incierto: false, codigo: codigo || sqlstate, mensaje: 'El servidor rechazó la operación. No se hizo nada.' };
  return { incierto: true, codigo: 'SIN_RESPUESTA', mensaje: 'El servidor no confirmó la operación: reintenta (no se duplica) o actualiza la lista.' };
}

// ── Historial ──
/** Filtra por estado mostrado, tienda y día de negocio de la solicitud (desde/hasta 'YYYY-MM-DD', inclusive). */
export function filtrarCorrecciones(filas, { estado = '', tiendaId = '', desde = '', hasta = '' } = {}) {
  return (Array.isArray(filas) ? filas : []).filter(f => {
    if (estado && estadoDe(f) !== estado) return false;
    if (tiendaId !== '' && tiendaId != null && String(f.establecimiento_id) !== String(tiendaId)) return false;
    if (desde || hasta) {
      const dia = f.solicitada_at ? diaNegocio(new Date(f.solicitada_at)) : '';
      if (!dia) return false;
      if (desde && dia < desde) return false;
      if (hasta && dia > hasta) return false;
    }
    return true;
  });
}

/** Cuenta por estado mostrado (resumen). */
export function resumenEstados(filas) {
  const r = Object.fromEntries(Object.keys(ESTADOS_CORRECCION).map(k => [k, 0]));
  for (const f of Array.isArray(filas) ? filas : []) { const e = estadoDe(f); if (e in r) r[e] += 1; }
  return r;
}

/** Diferencia de una solicitud (lo pedido): propuesta − vista. Tras ejecutar, el servidor guarda la real. */
export function diferenciaFila(f) {
  if (f?.diferencia != null) return Number(f.diferencia);
  return Number(f?.existencia_propuesta) - Number(f?.existencia_vista);
}

/**
 * Enviador de operaciones de la pantalla: por cada intento lógico (clave) usa SIEMPRE la misma operación hasta que el
 * servidor confirma; un segundo envío de la misma clave mientras el primero sigue en camino se ignora (doble clic). Tras
 * un error (incierto o rechazo) conserva la operación: el reintento la reutiliza y 153 responde `replay` sin duplicar.
 * `accion(operacionId)` devuelve { data } o { error, incierto }.
 */
export function crearEnviadorCorrecciones(gen = nuevoOperacionId) {
  const ops = {};
  const enVuelo = new Set();
  const enviar = async (clave, accion) => {
    if (enVuelo.has(clave)) return { ignorado: true };
    const o = resolverOperacion(ops[clave], clave, gen);
    ops[clave] = o;
    enVuelo.add(clave);
    try {
      const r = await accion(o.id);
      if (r && !r.error) delete ops[clave];
      return r;
    } finally {
      enVuelo.delete(clave);
    }
  };
  enviar.operacionDe = (clave) => ops[clave]?.id || null;
  return enviar;
}
