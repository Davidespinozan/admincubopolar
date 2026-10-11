// conteoEmpaqueLogic.js — T5-C (mig 140): conteo físico de empaques (bolsas).
// La pantalla compara lo contado contra lo registrado y pide confirmar; quien aplica es el
// servidor (`registrar_conteo_empaque`), que rechaza un conteo preparado sobre una existencia
// que ya cambió (alguien produjo, recibió compra o ajustó mientras tanto). Reglas del servidor:
//   · piezas enteras, 0 o más; motivo obligatorio;
//   · un empaque solo se ajusta A LA BAJA: lo que sobra entra por recepción de compra (108).
import { nuevoOperacionId } from './stockContratosLogic';

const txt = (v) => (v === null || v === undefined ? '' : String(v)).trim();

/** Texto capturado → entero de piezas, o null si no es un entero ≥ 0 ("8,450" y "8 450" valen). */
export function piezasDe(texto) {
  const t = txt(texto).replace(/[,\s]/g, '');
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n <= 2000000000 ? n : null;
}

/**
 * Compara el conteo con la existencia registrada.
 * @returns {{ valido:boolean, conteo:number|null, diferencia:number|null,
 *            tipo:'vacio'|'invalido'|'igual'|'faltante'|'sobrante', mensaje:string }}
 */
export function compararConteo(existencia, texto) {
  const ex = Math.max(0, Math.floor(Number(existencia) || 0));
  if (txt(texto) === '') return { valido: false, conteo: null, diferencia: null, tipo: 'vacio', mensaje: 'Escribe cuántas piezas contaste.' };
  const conteo = piezasDe(texto);
  if (conteo === null) return { valido: false, conteo: null, diferencia: null, tipo: 'invalido', mensaje: 'La cantidad debe ser un número entero de piezas, 0 o mayor (sin decimales ni negativos).' };
  const diferencia = conteo - ex;
  if (diferencia === 0) return { valido: true, conteo, diferencia, tipo: 'igual', mensaje: 'El conteo coincide con lo registrado. Se guardará como conteo sin diferencia.' };
  if (diferencia < 0) return { valido: true, conteo, diferencia, tipo: 'faltante', mensaje: `Faltan ${Math.abs(diferencia).toLocaleString('es-MX')} piezas: la existencia bajará de ${ex.toLocaleString('es-MX')} a ${conteo.toLocaleString('es-MX')}.` };
  return {
    valido: false, conteo, diferencia, tipo: 'sobrante',
    mensaje: `Sobran ${diferencia.toLocaleString('es-MX')} piezas. Las bolsas no se suben con un conteo: registra esa entrada como compra recibida (Insumos → Llegaron) y vuelve a contar.`,
  };
}

/** Lo que falta para poder confirmar; null = listo. */
export function motivoNoConfirmar({ comparacion, motivo, confirmado } = {}) {
  if (!comparacion?.valido) return comparacion?.mensaje || 'Revisa la cantidad contada.';
  if (txt(motivo).length < 5) return 'Escribe el motivo del conteo (mínimo 5 letras).';
  if (!confirmado) return 'Marca la casilla para confirmar que revisaste la diferencia.';
  return null;
}

/**
 * Argumentos de `registrar_conteo_empaque`. `existencia` y `revision` son lo que la pantalla
 * MOSTRABA al abrir el conteo: el servidor los compara con lo vigente antes de aplicar.
 */
export function buildRegistrarConteoArgs({ operacionId, sku, existencia, revision, conteo, motivo } = {}) {
  if (!txt(sku)) return { error: 'Empaque requerido' };
  const c = typeof conteo === 'number' ? (Number.isSafeInteger(conteo) && conteo >= 0 ? conteo : null) : piezasDe(conteo);
  if (c === null) return { error: 'La cantidad debe ser un número entero de piezas, 0 o mayor' };
  if (!Number.isInteger(Number(existencia))) return { error: 'Falta la existencia registrada: actualiza la lista' };
  const m = txt(motivo);
  if (m.length < 5) return { error: 'Escribe el motivo del conteo (mínimo 5 letras)' };
  return {
    args: {
      p_operacion_id: operacionId || nuevoOperacionId(), p_sku: txt(sku), p_existencia_vista: Number(existencia),
      p_revision_vista: Number(revision) || 0, p_conteo: c, p_motivo: m,
    },
  };
}

/** Código del rechazo del servidor (`DETAIL` en JSON), o null. */
export function codigoConteo(error) {
  try {
    const raw = error?.details ?? error?.detail;
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return d && typeof d.codigo === 'string' ? d : null;
  } catch { return null; }
}

/** Mensaje para la pantalla. El texto del servidor ya es para el usuario. */
export function mensajeErrorConteo(error) {
  const msg = txt(typeof error === 'string' ? error : error?.message).replace(/^[a-z_]+:\s*/i, '');
  const code = txt(error?.code);
  if (/no autorizado/i.test(msg) || code === '42501') return 'Solo Administración registra conteos de empaque.';
  if (/operacion_id ya usado/i.test(msg)) return 'Este conteo ya se envió con otra cantidad. Cierra y vuelve a abrir el conteo.';
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout/i.test(msg)) return 'Sin conexión con el servidor. Reintenta: el conteo no se aplicará dos veces.';
  return msg || 'No se pudo registrar el conteo. No se aplicó ningún cambio.';
}

/** Fila de la tabla a partir de lo que devuelve `empaques_para_conteo`. */
export function filaEmpaque(e) {
  const u = e?.ultimo_movimiento || null;
  return {
    sku: txt(e?.sku), nombre: txt(e?.nombre), unidad: txt(e?.unidad) || 'piezas',
    existencia: Math.floor(Number(e?.existencia) || 0), revision: Number(e?.revision) || 0,
    costo: e?.costo_unitario === null || e?.costo_unitario === undefined ? null : Number(e.costo_unitario),
    usadoPor: Number(e?.usado_por) || 0,
    ultimo: u ? { fecha: u.fecha, tipo: txt(u.tipo), cantidad: Number(u.cantidad) || 0, origen: txt(u.origen), usuario: txt(u.usuario) } : null,
  };
}

/** Movimiento del kardex listo para mostrarse (sin inventar lo que el ledger no guarda). */
export function filaMovimiento(m) {
  const entrada = txt(m?.tipo) === 'Entrada';
  const origen = txt(m?.origen);
  return {
    id: m?.id, fecha: m?.fecha, entrada, cantidad: Number(m?.cantidad) || 0,
    clase: /^Ajuste manual: Conteo físico/i.test(origen) ? 'Conteo físico' : /^Ajuste manual/i.test(origen) ? 'Ajuste'
      : /^Recepción de compra/i.test(origen) ? 'Compra recibida' : /^Producción/i.test(origen) ? 'Producción'
      : /^Preparación/i.test(origen) ? 'Preparación de barra' : /revers/i.test(origen) ? 'Reverso' : (entrada ? 'Entrada' : 'Salida'),
    detalle: origen.replace(/^Ajuste manual: (Conteo físico: )?/i, ''),
    responsable: txt(m?.usuario),
    anterior: m?.existencia_anterior ?? null, resultante: m?.existencia_resultante ?? null,
  };
}
