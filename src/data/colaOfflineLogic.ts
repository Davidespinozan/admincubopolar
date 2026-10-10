// colaOfflineLogic.ts — lógica pura de la cola offline del chofer (Tanda 22;
// migrado a TypeScript en Tanda 29).
//
// El chofer opera en campo con red intermitente. Cuando no hay señal,
// las mutaciones críticas (entrega, no-entrega, merma) se encolan en
// localStorage y se reintentan al reconectar. Este módulo es la parte
// pura y testeable: estructura de la cola, FIFO, reintentos y helpers
// derivados para la UI. La parte con efectos (localStorage, listeners
// online, ejecución contra supaStore) vive en useColaOffline.js.
//
// Política de reintentos: FIFO estricto. Un fallo detiene la pasada y se
// reintenta después. Un fallo de RED (sin respuesta del servidor) no cuenta
// como intento: con mala señal la operación espera lo que haga falta. Solo
// los RECHAZOS del servidor cuentan; tras MAX_INTENTOS la mutación queda
// "fallida" (p.ej. la orden fue cancelada por admin mientras el chofer estaba
// sin señal): deja de bloquear a las demás, guarda el motivo y NO se pierde:
// el chofer la ve con su motivo, puede reintentarla o quitarla, y la ruta no
// se cierra mientras exista.

export const TIPOS_MUTACION = {
  ENTREGA: 'entrega',
  NO_ENTREGA: 'no_entrega',
  MERMA: 'merma',
} as const;

export type TipoMutacion = (typeof TIPOS_MUTACION)[keyof typeof TIPOS_MUTACION];

export interface MutacionPayload {
  ordenId?: string | number;
  [clave: string]: unknown;
}

export interface Mutacion {
  id: string;
  tipo: TipoMutacion;
  payload: MutacionPayload;
  creadaEn: number;
  intentos: number;
  /** Motivo del último rechazo del servidor (para mostrarlo al chofer). */
  ultimoError?: string;
}

const TIPOS_VALIDOS = new Set<string>(Object.values(TIPOS_MUTACION));

export const MAX_INTENTOS = 5;

/** UUID v4 para el operacion_id de un evento encolado (084). */
export function uuidOperacion(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c && typeof c.getRandomValues === 'function') c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export const claveColaRuta = (rutaId: string | number): string => `cola_offline_ruta_${rutaId}`;

/**
 * Agrega una mutación al final de la cola (inmutable). El id combina
 * timestamp + secuencia derivada de la propia cola para ser único y
 * determinista en tests.
 */
export function encolar(
  cola: Mutacion[] | null | undefined,
  tipo: TipoMutacion,
  payload: MutacionPayload,
  ahora: number = Date.now()
): Mutacion[] {
  if (!TIPOS_VALIDOS.has(tipo)) {
    throw new Error(`Tipo de mutación desconocido: ${tipo}`);
  }
  const base = Array.isArray(cola) ? cola : [];
  // R2 (084): cada evento encolado lleva su operacion_id desde el momento de
  // encolar; cada replay del mismo evento reutiliza el mismo UUID.
  const conOperacion: MutacionPayload = payload.operacionId ? payload : { ...payload, operacionId: uuidOperacion() };
  const maxSeq = base.reduce((mx, m) => {
    const seq = Number(String(m?.id || '').split('-')[1]);
    return Number.isFinite(seq) ? Math.max(mx, seq) : mx;
  }, 0);
  return [
    ...base,
    { id: `${ahora}-${maxSeq + 1}`, tipo, payload: conOperacion, creadaEn: ahora, intentos: 0 },
  ];
}

/** Cola sin la mutación indicada. */
export function quitar(cola: Mutacion[] | null | undefined, id: string): Mutacion[] {
  return (cola || []).filter((m) => m.id !== id);
}

/** Cola con intentos+1 en la mutación indicada (y el motivo del rechazo, si se conoce). */
export function marcarIntento(cola: Mutacion[] | null | undefined, id: string, motivo?: string): Mutacion[] {
  return (cola || []).map((m) =>
    m.id === id ? { ...m, intentos: (m.intentos || 0) + 1, ...(motivo ? { ultimoError: String(motivo).slice(0, 200) } : {}) } : m
  );
}

/** Texto del error que devolvió un ejecutor ({ error }, Error, error de Supabase o texto). */
export function textoError(err: unknown): string {
  if (!err) return '';
  if (typeof err === 'string') return err;
  const e = err as { error?: unknown; message?: unknown };
  if (typeof e.error === 'string') return e.error;
  if (e.error && typeof (e.error as { message?: unknown }).message === 'string') return (e.error as { message: string }).message;
  if (typeof e.message === 'string') return e.message;
  return 'Error desconocido';
}

/**
 * ¿El fallo fue de RED (no hubo respuesta del servidor)? Entonces no cuenta como intento:
 * antes, cinco intentos con mala señal dejaban la operación como fallida para siempre.
 */
export function esFalloDeRed(err: unknown, enLinea: boolean = true): boolean {
  if (!enLinea) return true;
  return /Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout|timed out|ERR_INTERNET|conexi[oó]n/i.test(textoError(err));
}

/** Vuelve a poner en espera las fallidas (todas, o solo la indicada): intentos a 0. */
export function reactivar(cola: Mutacion[] | null | undefined, id?: string): Mutacion[] {
  return (cola || []).map((m) => ((m.intentos || 0) >= MAX_INTENTOS && (!id || m.id === id) ? { ...m, intentos: 0 } : m));
}

/** Mutaciones que aún deben reintentarse (intentos < MAX_INTENTOS). */
export function mutacionesPendientes(cola: Mutacion[] | null | undefined): Mutacion[] {
  return (cola || []).filter((m) => (m.intentos || 0) < MAX_INTENTOS);
}

/** Mutaciones que agotaron reintentos — la UI las reporta al chofer. */
export function mutacionesFallidas(cola: Mutacion[] | null | undefined): Mutacion[] {
  return (cola || []).filter((m) => (m.intentos || 0) >= MAX_INTENTOS);
}

/** Primera mutación reintentable en orden FIFO, o null. */
export function siguientePendiente(cola: Mutacion[] | null | undefined): Mutacion | null {
  return mutacionesPendientes(cola)[0] || null;
}

/**
 * Deserializa la cola desde localStorage con tolerancia total a basura:
 * JSON corrupto → []; entradas sin id/tipo válido o sin payload se
 * descartan (mejor perder una entrada malformada que tronar la vista
 * del chofer en campo).
 */
export function parseCola(json: string | null | undefined): Mutacion[] {
  if (!json) return [];
  let arr: unknown;
  try {
    arr = JSON.parse(json);
  } catch {
    return [];
  }
  if (!Array.isArray(arr)) return [];
  return arr.filter(
    (m): m is Mutacion =>
      Boolean(m) &&
      typeof m === 'object' &&
      typeof (m as Mutacion).id === 'string' &&
      TIPOS_VALIDOS.has((m as Mutacion).tipo) &&
      Boolean((m as Mutacion).payload) &&
      typeof (m as Mutacion).payload === 'object'
  );
}

/**
 * Ids de órdenes que ya fueron atendidas offline (entrega o no-entrega
 * en cola). La lista de "Por entregar" las excluye para que el chofer
 * no atienda dos veces la misma parada mientras espera señal.
 */
export function ordenesBloqueadas(cola: Mutacion[] | null | undefined): Set<string> {
  const ids = new Set<string>();
  for (const m of cola || []) {
    if (m.tipo === TIPOS_MUTACION.ENTREGA || m.tipo === TIPOS_MUTACION.NO_ENTREGA) {
      if (m.payload?.ordenId !== undefined && m.payload?.ordenId !== null) {
        ids.add(String(m.payload.ordenId));
      }
    }
  }
  return ids;
}

/** Etiqueta corta y humana de una mutación, para listarla en la UI. */
export function descripcionMutacion(m: Mutacion | null | undefined): string {
  if (!m) return '';
  const p = m.payload || {};
  switch (m.tipo) {
    case TIPOS_MUTACION.ENTREGA:
      return `Entrega orden #${p.ordenId}${p.metodoPago ? ` (${p.metodoPago})` : ''}`;
    case TIPOS_MUTACION.NO_ENTREGA:
      return `No entregada orden #${p.ordenId}`;
    case TIPOS_MUTACION.MERMA:
      return `Merma ${p.cant}× ${p.sku}`;
    default:
      return m.tipo;
  }
}
