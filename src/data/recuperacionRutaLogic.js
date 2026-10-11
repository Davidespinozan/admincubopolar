// recuperacionRutaLogic.js — T5-A (mig 138). Una ruta ya no puede quedar imposible de
// cerrar: el SERVIDOR rechaza una entrega que no cabe en lo cargado, no deja agregar
// pedidos a una ruta con carga y no registra un cierre financiero con exceso. Aquí está
// lo que la pantalla necesita para acompañarlo (avisar antes, explicar el rechazo y
// armar la recuperación de Admin). La autoridad es siempre el servidor.
import { nuevoOperacionId } from './stockContratosLogic';

const txt = (v) => (v === null || v === undefined ? '' : String(v)).trim();
const ent = (v) => { const x = Math.floor(Number(v)); return Number.isFinite(x) && x > 0 ? x : 0; };

/** Detalle estructurado que mandan los rechazos de 138 (`DETAIL` en JSON); {} si no es uno. */
export function detalleRechazo(error) {
  const raw = typeof error === 'object' && error ? (error.details ?? error.detail) : null;
  if (!raw) return {};
  try {
    const d = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return d && typeof d === 'object' && typeof d.codigo === 'string' ? d : {};
  } catch {
    return {};
  }
}

/** ¿El servidor rechazó porque la carga del camión no alcanza (o la ruta ya cerró)? */
export function esRechazoDeCarga(error) {
  const c = detalleRechazo(error).codigo;
  return c === 'CARGA_INSUFICIENTE' || c === 'RUTA_CERRADA';
}

/** Productos de una orden por SKU: [{ sku, cant|cantidad|qty }] → { sku: cantidad }. */
function pedidoDe(items) {
  const p = {};
  for (const it of items || []) {
    const q = ent(it?.cant ?? it?.cantidad ?? it?.qty);
    const sku = txt(it?.sku);
    if (sku && q > 0) p[sku] = (p[sku] || 0) + q;
  }
  return p;
}

/**
 * Lo que a una orden le falta en el camión, con lo que el TELÉFONO sabe (carga − entregas −
 * mermas). Sirve para avisar antes de intentar — también sin señal, cuando el servidor no
 * puede contestar. [] = cabe.
 * @returns {Array<{sku:string, pedido:number, disponible:number, falta:number}>}
 */
export function faltanteEnCamion(items, restante) {
  const out = [];
  for (const [sku, pedido] of Object.entries(pedidoDe(items))) {
    const disponible = Math.max(0, Math.floor(Number(restante?.[sku]) || 0));
    if (pedido > disponible) out.push({ sku, pedido, disponible, falta: pedido - disponible });
  }
  return out.sort((a, b) => a.sku.localeCompare(b.sku));
}

/** Mensaje para el chofer cuando una orden no cabe en lo que trae. */
export function mensajeNoCabe(faltan, nombreDe = (sku) => sku) {
  if (!faltan || faltan.length === 0) return null;
  const partes = faltan.map(f => `${f.pedido} de ${nombreDe(f.sku)} (te quedan ${f.disponible})`).join(', ');
  return `No alcanza lo que traes en el camión: la orden lleva ${partes}. Márcala "No entregada" o avisa a Administración.`;
}

/** Mensaje de un rechazo del servidor: su texto ya es para el usuario; se le quita el prefijo técnico. */
export function mensajeRechazoServidor(error, porOmision = 'No se pudo completar la operación. No se aplicó ningún cambio.') {
  const m = txt(typeof error === 'string' ? error : error?.message).replace(/^[a-z_]+:\s*/i, '');
  return m || porOmision;
}

/**
 * ¿A esta ruta todavía se le pueden agregar pedidos? Solo antes de que el chofer capture su
 * carga: después lo nuevo no iría a bordo (el camión se carga una sola vez).
 * @returns {{ ok: boolean, motivo: string|null }}
 */
export function puedeAgregarPedidos(ruta) {
  const est = txt(ruta?.estatus).toLowerCase();
  const cargada = !!(ruta?.carga_confirmada_at || ruta?.cargaConfirmadaAt);
  if (cargada || est === 'cargada' || est === 'en progreso') return { ok: false, motivo: 'El camión ya está cargado: un pedido nuevo no iría a bordo. Asígnalo a otra ruta.' };
  if (est === 'pendiente firma') return { ok: false, motivo: 'El chofer ya capturó su carga. Asigna el pedido a otra ruta.' };
  if (est === 'cerrada' || est === 'cancelada' || est === 'completada') return { ok: false, motivo: 'La ruta ya terminó.' };
  return { ok: true, motivo: null };
}

/** Estatus real de la ruta para mostrarlo (Rutas agrupaba "Pendiente firma" y "Cargada" como "Programada"). */
export function etapaDeRuta(ruta) {
  const est = txt(ruta?.estatus).toLowerCase();
  if (est === 'pendiente firma') return { clave: 'pendiente_firma', etiqueta: 'Carga por firmar', tono: 'aviso' };
  if (est === 'cargada') return { clave: 'cargada', etiqueta: 'Camión cargado', tono: 'ok' };
  return null;
}

/** Aviso tras agregar pedidos antes de cargar: lo que la carga autorizada no cubre. */
export function avisoSinCubrir(sinCubrir, nombreDe = (sku) => sku) {
  const lista = (Array.isArray(sinCubrir) ? sinCubrir : []).filter(x => ent(x?.falta) > 0);
  if (lista.length === 0) return null;
  return `La carga autorizada no cubre los pedidos: faltan ${lista.map(x => `${ent(x.falta)} de ${nombreDe(x.sku)}`).join(', ')}. Sube la carga en "Editar ruta" o el chofer no podrá entregarlos.`;
}

/**
 * Lectura del diagnóstico del servidor (`diagnostico_ruta`) para la pantalla de Admin.
 * No decide nada: ordena y resume.
 */
export function resumenDiagnostico(d) {
  const inv = Array.isArray(d?.inventario) ? d.inventario : [];
  const ordenes = Array.isArray(d?.ordenes) ? d.ordenes : [];
  const excesos = inv.filter(x => ent(x.exceso) > 0);
  const skusConExceso = new Set(excesos.map(x => x.sku));
  const entregadas = ordenes.filter(o => o.estatus === 'Entregada' || o.estatus === 'Facturada');
  return {
    consistente: d?.consistente === true,
    cargaConfirmada: d?.carga_confirmada === true,
    cierreFinanciero: d?.cierre_financiero === true,
    estatus: txt(d?.estatus),
    inventario: inv,
    excesos,
    // Entregadas que llevan algún producto en exceso primero: son las candidatas a revisar.
    entregadas: entregadas
      .map(o => ({ ...o, enExceso: (o.lineas || []).some(l => skusConExceso.has(l.sku)), reversible: !o.no_reversible, cobrado: Number(o.cobrado) || 0 }))
      .sort((a, b) => Number(b.enExceso) - Number(a.enExceso) || Number(a.id) - Number(b.id)),
    pendientes: ordenes.filter(o => o.estatus === 'Asignada' || o.estatus === 'En ruta'),
    revertidas: Array.isArray(d?.revertidas) ? d.revertidas : [],
    abierta: !['cerrada', 'cancelada', 'completada'].includes(txt(d?.estatus).toLowerCase()),
  };
}

/** Argumentos de `revertir_entrega_ruta` (Admin). El motivo es obligatorio. */
export function buildRevertirEntregaArgs({ operacionId, ordenId, motivo, conservarCobro } = {}) {
  if (!ordenId) return { error: 'Orden requerida' };
  const m = txt(motivo);
  if (m.length < 5) return { error: 'Escribe el motivo (por qué esa entrega no ocurrió)' };
  return { args: { p_operacion_id: operacionId || nuevoOperacionId(), p_orden_id: Number(ordenId), p_motivo: m, p_conservar_cobro: conservarCobro === true } };
}

// ── T5-B (mig 139): la entrega de ruta y su obligación financiera van en UNA transacción ──

/** ¿El servidor rechazó el fiado (sin autorización, límite 0, límite excedido, sin cliente)? */
export function esCreditoRechazado(error) {
  return detalleRechazo(error).codigo === 'CREDITO_RECHAZADO';
}

/** Argumentos de `entregar_orden_ruta`. El método es obligatorio; el servidor lo valida y normaliza. */
export function buildEntregarOrdenRutaArgs({ operacionId, ordenId, metodo, folioNota, referencia } = {}) {
  if (!ordenId) return { error: 'Orden requerida' };
  const m = txt(metodo);
  if (!m) return { error: 'Elige cómo se cobra' };
  return {
    args: {
      p_operacion_id: operacionId || nuevoOperacionId(), p_orden_id: Number(ordenId), p_metodo: m,
      p_folio_nota: txt(folioNota) || null, p_referencia: txt(referencia) || null,
    },
  };
}

const esFiado = (metodo) => /cr[eé]dito|fiado/i.test(txt(metodo));

/**
 * ¿Se puede fiar ESTA entrega desde aquí? Aviso previo; la autoridad es el servidor.
 * Regla (la misma de `fin_validar_credito`): crédito autorizado explícito; el límite es un tope
 * real y **límite 0 = sin capacidad** (antes el teléfono lo tomaba como "sin límite"); cuenta lo
 * que el cliente ya debe. Sin señal no se fía: el crédito solo lo aprueba el servidor.
 * @returns {string|null} motivo para mostrar, o null si se puede intentar.
 */
export function motivoNoFiar({ metodo, cliente, importe, enLinea = true } = {}) {
  if (!esFiado(metodo)) return null;
  if (!enLinea) return 'Sin señal no se puede fiar: el crédito lo aprueba el servidor. Cobra de otra forma o busca señal.';
  if (!cliente) return 'El crédito necesita un cliente registrado. Cobra de otra forma.';
  const nombre = txt(cliente.nombre) || 'Este cliente';
  if (!(cliente.credito_autorizado ?? cliente.creditoAutorizado)) return `${nombre} no tiene crédito autorizado. Cobra de otra forma o avisa a Administración.`;
  const limite = Number(cliente.limite_credito ?? cliente.limiteCredito) || 0;
  const saldo = Number(cliente.saldo) || 0;
  const disponible = Math.max(Math.round((limite - saldo) * 100) / 100, 0);
  if ((Number(importe) || 0) > disponible + 0.004) {
    return limite <= 0
      ? `${nombre} tiene crédito autorizado pero su límite es $0: no tiene capacidad para fiar. Cobra de otra forma o pide a Administración que le asigne un límite.`
      : `${nombre} ya no tiene crédito suficiente (le quedan $${disponible.toLocaleString('es-MX')}). Cobra de otra forma o avisa a Administración.`;
  }
  return null;
}
