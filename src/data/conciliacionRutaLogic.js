// conciliacionRutaLogic.js — T5-D2 (mig 142): cierre de ruta por Administración.
// Reglas puras de la pantalla. La autoridad es el servidor (`cerrar_ruta_admin`: todo o nada):
//   · con órdenes sin resolver no se cierra; cada una se resuelve con su acción (nada automático);
//   · una entrega de contado o crédito sin su registro financiero bloquea; un link de pago
//     pendiente NO bloquea, pero se ve y sigue pendiente después del cierre;
//   · el faltante del conteo se DECLARA como faltante no justificado (no es una merma comprobada);
//   · camión Cargado: Administración dice si no salió (devolver toda la carga y liberar sus
//     pedidos) o si salió sin iniciar (registrar la salida y seguir el flujo normal);
//   · toda intervención lleva motivo. El actor y la hora los pone el servidor.
// Lo que un chofer tenga guardado sin señal en su teléfono el servidor no lo conoce.
import { detalleRechazo, mensajeRechazoServidor } from './recuperacionRutaLogic';

const txt = (v) => String(v ?? '').trim();
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const ent = (v) => Math.max(0, Math.floor(num(v)));

export const MOTIVO_MINIMO = 10;
export const TIPO_CIERRE = { ADMIN: 'cierre_admin', NO_SALIO: 'no_salio' };
export const METODO_LINK = 'QR / Link de pago';

/**
 * Qué puede hacer Administración con la ruta según su estado.
 *  - 'cerrar': conteo y cierre (ruta En progreso).
 *  - 'cargada': elegir entre "no salió" y "salió sin iniciar".
 *  - null: nada que cerrar aquí (sin carga, cerrada o cancelada).
 */
export function modoCierreAdmin(ruta) {
  const est = txt(ruta?.estatus).toLowerCase();
  const cargada = !!(ruta?.carga_confirmada_at || ruta?.cargaConfirmadaAt || ruta?.carga_confirmada);
  if (est === 'en progreso') return 'cerrar';
  if (est === 'cargada' && cargada) return 'cargada';
  return null;
}

/** Fila de un cobro pendiente (`ruta_cobros_pendientes`). */
export function filaCobroPendiente(c) {
  return {
    ordenId: c?.orden_id, folio: txt(c?.folio), cliente: txt(c?.cliente), rutaId: c?.ruta_id ?? null, rutaFolio: txt(c?.ruta_folio),
    rutaCerrada: txt(c?.ruta_estatus).toLowerCase() === 'cerrada', metodo: txt(c?.metodo), total: num(c?.total), cobrado: num(c?.cobrado),
    falta: num(c?.falta), tipo: txt(c?.tipo) === 'link' ? 'link' : 'sin_registro', entregadaAt: c?.entregada_at || null,
  };
}

/** Lo que `conciliacion_ruta` devuelve, ordenado para la pantalla. Nada se inventa: lo que falta queda en null. */
export function resumenConciliacion(c) {
  const ordenes = (Array.isArray(c?.ordenes) ? c.ordenes : []).map(o => ({
    id: o.id, folio: txt(o.folio), cliente: txt(o.cliente), estatus: txt(o.estatus), total: num(o.total), metodo: txt(o.metodo_pago),
    cobrado: num(o.cobrado), cxcSaldo: o.cxc_saldo === null || o.cxc_saldo === undefined ? null : num(o.cxc_saldo),
    lineas: Array.isArray(o.lineas) ? o.lineas : [], noReversible: o.no_reversible || null,
  }));
  const grupo = (...est) => ordenes.filter(o => est.includes(o.estatus));
  const cobrosPendientes = (Array.isArray(c?.cobros_pendientes) ? c.cobros_pendientes : []).map(filaCobroPendiente);
  const mermasTodas = (Array.isArray(c?.mermas) ? c.mermas : []).map(m => ({
    id: m.id, sku: txt(m.sku), cantidad: ent(m.cantidad), causa: txt(m.causa), conFoto: m.con_foto === true, faltante: m.faltante === true,
    motivo: txt(m.motivo) || null, actor: txt(m.actor) || null,
  }));
  const cobros = (Array.isArray(c?.cobros_por_metodo) ? c.cobros_por_metodo : []).map(x => ({ metodo: txt(x.metodo), pagos: ent(x.pagos), monto: num(x.monto) }));
  const caja = c?.cierre_caja && typeof c.cierre_caja === 'object' ? {
    esperadoEfectivo: num(c.cierre_caja.esperado_efectivo), contadoEfectivo: num(c.cierre_caja.contado_efectivo), diferencia: num(c.cierre_caja.diferencia),
    motivo: txt(c.cierre_caja.motivo_diferencia) || null, cerradoPor: txt(c.cierre_caja.cerrado_por) || null,
  } : null;
  return {
    rutaId: c?.ruta_id ?? null, folio: txt(c?.folio), estatus: txt(c?.estatus), chofer: txt(c?.chofer) || null,
    cargaConfirmada: c?.carga_confirmada === true, marcaFinanciera: c?.cierre_financiero === true, consistente: c?.consistente !== false,
    inventario: (Array.isArray(c?.inventario) ? c.inventario : []).map(b => ({
      sku: txt(b.sku), cargado: ent(b.cargado), entregado: ent(b.entregado), merma: ent(b.merma), devuelto: ent(b.devuelto),
      restante: num(b.restante), exceso: ent(b.exceso),
    })),
    ordenes,
    entregadas: grupo('Entregada', 'Facturada'), noEntregadas: grupo('No entregada'), pendientes: grupo('Asignada', 'En ruta'),
    revertidas: Array.isArray(c?.revertidas) ? c.revertidas : [],
    cobros, cobradoTotal: cobros.reduce((t, x) => t + x.monto, 0), efectivo: cobros.filter(x => x.metodo === 'Efectivo').reduce((t, x) => t + x.monto, 0),
    credito: { cuentas: ent(c?.credito?.cuentas), monto: num(c?.credito?.monto), saldo: num(c?.credito?.saldo) },
    links: cobrosPendientes.filter(x => x.tipo === 'link'), sinRegistro: cobrosPendientes.filter(x => x.tipo === 'sin_registro'),
    mermas: mermasTodas.filter(m => !m.faltante), faltantes: mermasTodas.filter(m => m.faltante),
    ventasRapidas: { ventas: ent(c?.ventas_rapidas?.ventas), total: num(c?.ventas_rapidas?.total) },
    cierreCaja: caja,
    intervenciones: Array.isArray(c?.intervenciones) ? c.intervenciones : [],
  };
}

/** Conteo contra lo que debe regresar: faltantes y sobrantes por producto. */
export function diferenciasDelConteo(inventario, conteo) {
  const faltante = {}; const sobrante = {};
  for (const b of Array.isArray(inventario) ? inventario : []) {
    const contado = ent(conteo?.[b.sku]);
    const d = ent(b.restante) - contado;
    if (d > 0) faltante[b.sku] = d;
    if (d < 0) sobrante[b.sku] = -d;
  }
  return { faltante, sobrante };
}

/** Lista [{sku, cantidad}] para el servidor, a partir del faltante del conteo. */
export const faltantesParaServidor = (faltante) => Object.entries(faltante || {}).filter(([, q]) => ent(q) > 0)
  .map(([sku, q]) => ({ sku, cantidad: ent(q) })).sort((a, b) => a.sku.localeCompare(b.sku));

/**
 * Lo que impide cerrar ANTES de preguntar al servidor (que vuelve a validarlo todo). null = se puede intentar.
 * `tipo`: 'cierre_admin' | 'no_salio'.
 */
export function motivoNoCerrar({ resumen, tipo, conteo, motivo, faltanteReconocido } = {}) {
  if (!resumen) return 'Cargando la conciliación de la ruta…';
  if (!resumen.consistente) return 'El inventario de la ruta no cuadra: revisa "Inventario de la ruta" antes de cerrar.';
  if (tipo === TIPO_CIERRE.NO_SALIO) {
    if (resumen.entregadas.length + resumen.noEntregadas.length > 0 || resumen.ventasRapidas.ventas > 0 || resumen.mermas.length + resumen.faltantes.length > 0) {
      return 'Esta ruta ya tiene operaciones: el camión sí salió. Usa "El camión salió" y ciérrala con su conteo.';
    }
  } else if (resumen.pendientes.length > 0) {
    return `Hay ${resumen.pendientes.length} ${resumen.pendientes.length === 1 ? 'orden sin resolver' : 'órdenes sin resolver'}: márcalas una por una antes de cerrar.`;
  }
  if (resumen.sinRegistro.length > 0) {
    return `Hay ${resumen.sinRegistro.length} ${resumen.sinRegistro.length === 1 ? 'entrega sin cobro ni cuenta por cobrar' : 'entregas sin cobro ni cuenta por cobrar'}: registra cómo se cobró cada una.`;
  }
  const dif = diferenciasDelConteo(resumen.inventario, conteo);
  if (Object.keys(dif.sobrante).length > 0) return 'El conteo supera lo que debe regresar: vuelve a contar.';
  if (Object.keys(dif.faltante).length > 0 && !faltanteReconocido) return 'Falta producto: decláralo como faltante no justificado (o regístralo antes como merma con su causa) para poder cerrar.';
  if (txt(motivo).length < MOTIVO_MINIMO) return `Escribe el motivo de la intervención (mínimo ${MOTIVO_MINIMO} letras).`;
  return null;
}

const conteoLimpio = (conteo) => Object.fromEntries(Object.entries(conteo || {}).map(([k, v]) => [txt(k), ent(v)]).filter(([k, q]) => k && q > 0).sort(([a], [b]) => a.localeCompare(b)));

/** Clave estable de la petición lógica: misma clave ⇒ misma operación en el reintento. */
export function claveCierreAdmin({ rutaId, tipo, conteo, faltantes, motivo } = {}) {
  return JSON.stringify({ r: Number(rutaId), t: txt(tipo), c: conteoLimpio(conteo), f: faltantesParaServidor(Object.fromEntries((faltantes || []).map(x => [x.sku, x.cantidad]))), m: txt(motivo) });
}
export const claveStorageCierreAdmin = (rutaId) => `cierre_admin_op_${txt(rutaId)}`;
export const claveStorageInicioAdmin = (rutaId) => `inicio_admin_op_${txt(rutaId)}`;

/** Argumentos de `cerrar_ruta_admin`. El actor NO viaja: lo resuelve el servidor. */
export function buildCerrarRutaAdminArgs({ operacionId, rutaId, tipo, conteo, faltantes, motivo } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (rutaId === null || rutaId === undefined || rutaId === '') return { error: 'Ruta requerida' };
  if (![TIPO_CIERRE.ADMIN, TIPO_CIERRE.NO_SALIO].includes(txt(tipo))) return { error: 'Tipo de cierre inválido' };
  for (const v of Object.values(conteo || {})) {
    if (txt(v) !== '' && (!Number.isInteger(Number(v)) || Number(v) < 0)) return { error: 'El conteo lleva cantidades enteras, 0 o mayores' };
  }
  const lista = (Array.isArray(faltantes) ? faltantes : []).map(f => ({ sku: txt(f?.sku), cantidad: Number(f?.cantidad) }));
  if (lista.some(f => !f.sku || !Number.isInteger(f.cantidad) || f.cantidad <= 0)) return { error: 'Cada faltante lleva producto y cantidad entera mayor a 0' };
  const m = txt(motivo);
  if (m.length < MOTIVO_MINIMO) return { error: `Escribe el motivo de la intervención (mínimo ${MOTIVO_MINIMO} letras)` };
  return {
    args: {
      p_operacion_id: txt(operacionId), p_ruta_id: Number(rutaId), p_tipo: txt(tipo), p_conteo: conteoLimpio(conteo),
      p_faltantes: lista.length > 0 ? lista.sort((a, b) => a.sku.localeCompare(b.sku)) : null, p_motivo: m,
    },
  };
}

/** Argumentos de `iniciar_ruta_admin`. */
export function buildIniciarRutaAdminArgs({ operacionId, rutaId, motivo } = {}) {
  if (!txt(operacionId)) return { error: 'Falta el identificador de la operación' };
  if (rutaId === null || rutaId === undefined || rutaId === '') return { error: 'Ruta requerida' };
  const m = txt(motivo);
  if (m.length < MOTIVO_MINIMO) return { error: `Escribe el motivo (mínimo ${MOTIVO_MINIMO} letras): por qué Administración inicia la ruta` };
  return { args: { p_operacion_id: txt(operacionId), p_ruta_id: Number(rutaId), p_motivo: m } };
}

/** Rechazo del servidor: código (si lo trae) y texto para la pantalla. `cambio` = el estado ya no es el que se veía. */
export function rechazoCierreAdmin(error) {
  const det = detalleRechazo(error);
  const msg = txt(typeof error === 'string' ? error : error?.message);
  const code = txt(error?.code);
  if (/no autorizado/i.test(msg) || code === '42501') return { codigo: 'NO_AUTORIZADO', mensaje: 'Solo Administración puede cerrar una ruta de esta forma.', cambio: false, detalle: det };
  if (/operacion_id ya usado/i.test(msg)) return { codigo: 'OPERACION_REPETIDA', mensaje: 'Este cierre ya se envió con otros datos. Cierra el diálogo y vuelve a abrirlo.', cambio: true, detalle: det };
  if (/Failed to fetch|NetworkError|Load failed|network|fetch failed|timeout/i.test(msg)) return { codigo: 'RED', mensaje: 'Sin conexión con el servidor. Reintenta: el cierre no se aplicará dos veces.', cambio: false, detalle: det };
  const sobrante = /supera el inventario del camión/i.test(msg);
  return {
    codigo: det.codigo || (sobrante ? 'CONTEO_SOBRANTE' : null),
    mensaje: sobrante ? 'El conteo supera lo que debe regresar el camión (alguien registró una venta, entrega o merma mientras contabas). Se actualizó la conciliación: vuelve a contar. No se cerró nada.'
      : mensajeRechazoServidor(error, 'No se pudo cerrar la ruta. No se aplicó ningún cambio.'),
    cambio: sobrante || ['ORDENES_PENDIENTES', 'ENTREGAS_SIN_REGISTRO', 'FALTANTE_NO_COINCIDE', 'RUTA_YA_CERRADA', 'ESTADO_NO_VALIDO', 'NO_SALIO_CON_OPERACIONES'].includes(det.codigo),
    detalle: det,
  };
}

// ── Bandeja: cobros de ruta que siguen pendientes (también después del cierre) ──

/** Resumen de `ruta_cobros_pendientes()` para los avisos de Administración. */
export function resumenCobrosPendientes(lista) {
  const filas = (Array.isArray(lista) ? lista : []).map(filaCobroPendiente);
  const links = filas.filter(f => f.tipo === 'link'); const sinRegistro = filas.filter(f => f.tipo === 'sin_registro');
  const suma = (xs) => xs.reduce((t, x) => t + x.falta, 0);
  return { links, sinRegistro, montoLinks: suma(links), montoSinRegistro: suma(sinRegistro) };
}
