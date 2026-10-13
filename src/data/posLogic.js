// posLogic.js — Tiendas E5: lógica pura del punto de venta de tiendas propias.
//
// La verdad es del servidor (migraciones 143–146): el precio, el total, quién puede
// vender, de qué congelador y en qué turno los decide la base de datos. Aquí solo se
// arma lo que se manda, se muestra lo que se recibe y se cuida que un cobro no se
// repita: cada intento lleva un operacion_id que se guarda ANTES de mandarlo y se
// reusa hasta saber qué pasó con él.
import { esErrorDeRed } from './asistenciaLogic';

export const ROL_VENTAS_TIENDA = 'Ventas Tienda';
export const CEDIS_ID = 1;

/** Formas de pago del POS: una por venta, siempre inmediata (nunca crédito). */
export const METODOS_POS = Object.freeze([
  { id: 'Efectivo', label: 'Efectivo', referencia: false },
  { id: 'Tarjeta (terminal)', label: 'Tarjeta', referencia: true },
  { id: 'Transferencia SPEI', label: 'Transferencia', referencia: true },
]);
const IDS_METODO = new Set(METODOS_POS.map(m => m.id));

const entero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
};
const dinero = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
};

/** UUID del intento. Se genera UNA vez por cobro y se reusa en cada reintento. */
export function nuevaOperacionId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  // Respaldo (navegadores viejos): UUID v4 con getRandomValues o, al final, Math.random.
  const b = new Uint8Array(16);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map(x => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ── Pantalla ────────────────────────────────────────────────────────────────

/**
 * Qué muestra el POS según lo que respondió el servidor (mis_establecimientos + mi_turno_caja).
 *   'cargando' | 'no_activadas' | 'sin_tienda' | 'elegir_tienda' | 'abrir_turno' | 'vender'
 */
export function pantallaPos({ cargado, tiendasHabilitadas, establecimientos, establecimientoId, turno }) {
  if (!cargado) return 'cargando';
  if (!tiendasHabilitadas) return 'no_activadas';
  const lista = Array.isArray(establecimientos) ? establecimientos : [];
  if (lista.length === 0) return 'sin_tienda';
  if (turno) return 'vender';
  if (lista.length > 1 && !lista.some(e => String(e.id) === String(establecimientoId))) return 'elegir_tienda';
  return 'abrir_turno';
}

/** Establecimiento activo: el del turno abierto manda; si no, el elegido; si solo hay uno, ese. */
export function establecimientoActivo(establecimientos, establecimientoId, turno) {
  const lista = Array.isArray(establecimientos) ? establecimientos : [];
  const id = turno?.establecimiento_id ?? establecimientoId ?? (lista.length === 1 ? lista[0].id : null);
  return lista.find(e => String(e.id) === String(id)) || null;
}

// ── Carrito ─────────────────────────────────────────────────────────────────

export const CANTIDAD_MAXIMA = 999999;

/** Agrega (o suma) un producto. El carrito solo guarda sku, nombre y cantidad: nunca precios. */
export function agregarAlCarrito(carrito, producto, cantidad = 1) {
  const sku = String(producto?.sku || '').trim();
  const q = entero(cantidad);
  const base = Array.isArray(carrito) ? carrito : [];
  if (!sku || q <= 0) return base;
  const ya = base.find(l => l.sku === sku);
  if (ya) return base.map(l => (l.sku === sku ? { ...l, cantidad: Math.min(CANTIDAD_MAXIMA, l.cantidad + q) } : l));
  return [...base, { sku, nombre: String(producto?.nombre || sku), cantidad: Math.min(CANTIDAD_MAXIMA, q) }];
}

/** Fija la cantidad de una línea; 0 o menos la quita. */
export function cambiarCantidad(carrito, sku, cantidad) {
  const q = entero(cantidad);
  const base = Array.isArray(carrito) ? carrito : [];
  if (q <= 0) return base.filter(l => l.sku !== sku);
  return base.map(l => (l.sku === sku ? { ...l, cantidad: Math.min(CANTIDAD_MAXIMA, q) } : l));
}

export function quitarDelCarrito(carrito, sku) {
  return (Array.isArray(carrito) ? carrito : []).filter(l => l.sku !== sku);
}

/** Filtra el catálogo por nombre o SKU (sin acentos ni mayúsculas). */
export function buscarProductos(precios, texto) {
  const lista = Array.isArray(precios) ? precios : [];
  const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
  const t = norm(texto);
  if (!t) return lista;
  return lista.filter(p => norm(p.nombre).includes(t) || norm(p.sku).includes(t));
}

/**
 * Total que se MUESTRA antes de cobrar, con los precios que dio el servidor (precios_pos).
 * No se manda: vender_en_tienda vuelve a calcular todo. `sinPrecio` = SKUs que el servidor no listó.
 */
export function totalEstimado(carrito, precios) {
  const porSku = new Map((Array.isArray(precios) ? precios : []).map(p => [p.sku, dinero(p.precio)]));
  let total = 0; const sinPrecio = [];
  const lineas = (Array.isArray(carrito) ? carrito : []).map(l => {
    const tiene = porSku.has(l.sku);
    if (!tiene) sinPrecio.push(l.sku);
    const precio = tiene ? porSku.get(l.sku) : 0;
    const subtotal = dinero(precio * l.cantidad);
    total += subtotal;
    return { ...l, precio, subtotal };
  });
  return { lineas, total: dinero(total), sinPrecio };
}

// ── Inventario ──────────────────────────────────────────────────────────────

const estDe = (c) => c?.establecimiento_id ?? c?.establecimientoId ?? null;
const stockDe = (c, sku) => Math.max(0, entero(c?.stock?.[sku]));

/** Existencia visible por SKU: en los congeladores de la tienda y, si hay permiso, en el CEDIS. */
export function existenciasPorSku(cuartos, establecimientoId, permitirCedis = false) {
  const out = {};
  for (const c of Array.isArray(cuartos) ? cuartos : []) {
    const est = estDe(c);
    const esTienda = String(est) === String(establecimientoId);
    const esCedis = permitirCedis && Number(est) === CEDIS_ID && !esTienda;
    if (!esTienda && !esCedis) continue;
    for (const sku of Object.keys(c?.stock || {})) {
      const q = stockDe(c, sku);
      if (!out[sku]) out[sku] = { tienda: 0, cedis: 0, total: 0 };
      if (esTienda) out[sku].tienda += q; else out[sku].cedis += q;
      out[sku].total += q;
    }
  }
  return out;
}

/**
 * De qué congelador sale cada línea: primero los de la tienda (por id), y solo si la tienda
 * tiene permiso, el CEDIS. Es una PROPUESTA: el servidor valida cada cuarto y su existencia.
 * @returns {{ asignacion: {sku, cantidad, cuarto_id}[], faltantes: {sku, falta}[], desdeCedis: boolean }}
 */
export function asignarCuartos(carrito, cuartos, establecimientoId, permitirCedis = false) {
  const lista = Array.isArray(cuartos) ? cuartos : [];
  const porId = (a, b) => String(a.id).localeCompare(String(b.id));
  const propios = lista.filter(c => String(estDe(c)) === String(establecimientoId)).sort(porId);
  const cedis = permitirCedis ? lista.filter(c => Number(estDe(c)) === CEDIS_ID && String(estDe(c)) !== String(establecimientoId)).sort(porId) : [];
  const asignacion = []; const faltantes = []; let desdeCedis = false;
  for (const l of Array.isArray(carrito) ? carrito : []) {
    let resta = entero(l.cantidad);
    for (const c of [...propios, ...cedis]) {
      if (resta <= 0) break;
      const toma = Math.min(resta, stockDe(c, l.sku));
      if (toma <= 0) continue;
      asignacion.push({ sku: l.sku, cantidad: toma, cuarto_id: c.id });
      if (Number(estDe(c)) === CEDIS_ID) desdeCedis = true;
      resta -= toma;
    }
    if (resta > 0) faltantes.push({ sku: l.sku, falta: resta });
  }
  return { asignacion, faltantes, desdeCedis };
}

// ── Venta ───────────────────────────────────────────────────────────────────

/**
 * Argumentos de vender_en_tienda. Cada partida lleva SOLO sku, cantidad y cuarto_id:
 * precio, descuento y total los pone el servidor (y rechaza cualquier otro campo).
 */
export function construirVenta({ operacionId, turnoId, carrito, cuartos, establecimiento, metodo, cliente, referencia, requiereFactura }) {
  if (!turnoId) return { error: 'Abre tu turno de caja antes de vender.' };
  const lineas = (Array.isArray(carrito) ? carrito : []).filter(l => l?.sku && entero(l.cantidad) > 0);
  if (lineas.length === 0) return { error: 'Agrega al menos un producto.' };
  if (!IDS_METODO.has(metodo)) return { error: 'Elige la forma de pago: efectivo, tarjeta o transferencia.' };
  const permitirCedis = !!establecimiento?.vende_desde_cedis;
  const { asignacion, faltantes } = asignarCuartos(lineas, cuartos, establecimiento?.id, permitirCedis);
  if (faltantes.length > 0) {
    const f = faltantes[0];
    const nombre = lineas.find(l => l.sku === f.sku)?.nombre || f.sku;
    return { error: `No hay suficiente ${nombre} en la tienda (faltan ${f.falta}).`, faltantes };
  }
  const factura = !!requiereFactura;
  if (factura && !cliente?.id) return { error: 'Para facturar elige un cliente.' };
  if (factura && cliente && cliente.puede_facturar === false) return { error: 'A ese cliente le faltan datos fiscales; no se le puede facturar.' };
  const ref = String(referencia || '').replace(/\s+/g, ' ').trim();
  return {
    args: {
      p_operacion_id: operacionId || nuevaOperacionId(),
      p_turno_id: turnoId,
      p_items: asignacion.map(a => ({ sku: a.sku, cantidad: a.cantidad, cuarto_id: a.cuarto_id })),
      p_metodo: metodo,
      p_cliente_id: cliente?.id ?? null,
      p_referencia: ref || null,
      p_requiere_factura: factura,
    },
  };
}

// ── Operación pendiente (cobro, apertura o cierre) ──────────────────────────
// Se guarda en el aparato ANTES de mandarla. Si se cae la conexión a medio cobro, al volver
// la pantalla NO deja empezar otra venta: primero pregunta al servidor por esa misma operación
// (el mismo operacion_id y los mismos datos devuelven la venta original o la procesan una vez).

const clavePendiente = (tipo, usuarioId) => `cubopolar_pos_${tipo}_${usuarioId ?? 'x'}`;

export function guardarPendiente(storage, tipo, usuarioId, pendiente) {
  if (!storage) return false;
  try { storage.setItem(clavePendiente(tipo, usuarioId), JSON.stringify(pendiente)); return true; } catch { return false; }
}

export function leerPendiente(storage, tipo, usuarioId) {
  try {
    const raw = storage?.getItem(clavePendiente(tipo, usuarioId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    if (!p || typeof p !== 'object' || !p.args || !p.args.p_operacion_id) return null;
    return p;
  } catch { return null; }
}

export function limpiarPendiente(storage, tipo, usuarioId) {
  try { storage?.removeItem(clavePendiente(tipo, usuarioId)); } catch { /* noop */ }
}

/**
 * Manda una operación del POS (cobro, apertura o cierre) cuidando que no se repita:
 *   1. la guarda en el aparato ANTES de mandarla;
 *   2. si el servidor la hizo            → 'hecha'      (se borra del aparato);
 *   3. si el servidor la rechazó         → 'rechazada'  (no se hizo nada; se borra);
 *   4. si no se sabe (sin conexión, 5xx) → 'pendiente'  (se queda guardada: el siguiente intento
 *      debe ser ESTA MISMA operación, con el mismo operacion_id y los mismos datos).
 * `llamar(args)` devuelve { data } o { error, codigo, incierto } (acciones pos* del store).
 */
export async function ejecutarOperacionPos({ tipo, storage, usuarioId, pendiente, llamar }) {
  guardarPendiente(storage, tipo, usuarioId, pendiente);
  let r;
  try { r = await llamar(pendiente.args); } catch (e) { const c = clasificarErrorPos(e, true); r = { error: c.mensaje, codigo: c.codigo, incierto: c.incierto }; }
  if (r?.error) {
    if (r.incierto) return { estado: 'pendiente', mensaje: r.error, codigo: r.codigo, pendiente };
    limpiarPendiente(storage, tipo, usuarioId);
    return { estado: 'rechazada', mensaje: r.error, codigo: r.codigo };
  }
  limpiarPendiente(storage, tipo, usuarioId);
  return { estado: 'hecha', data: r?.data };
}

// ── Respuestas del servidor ─────────────────────────────────────────────────

/** Texto para la persona según el código del rechazo. Nunca se muestra el mensaje interno. */
const MENSAJES = {
  SOLO_PAGO_INMEDIATO: 'La venta de tienda se cobra al momento: efectivo, tarjeta o transferencia.',
  PRECIO_NO_PERMITIDO: 'El precio lo pone el sistema; no se puede cambiar.',
  CUARTO_REQUERIDO: 'Falta indicar de qué congelador sale el producto.',
  INVENTARIO_DE_OTRA_TIENDA: 'Ese congelador no es de tu tienda.',
  INVENTARIO_DE_TIENDA: 'Ese congelador es de una tienda y no lo puedes mover.',
  INVENTARIO_DEL_CEDIS: 'Tu tienda no tiene permiso para usar inventario del CEDIS.',
  CEDIS_SIN_PERMISO: 'Tu tienda no tiene permiso para vender desde el CEDIS.',
  SIN_EXISTENCIA: 'No hay suficiente producto en el congelador.',
  CLIENTE_NO_DISPONIBLE: 'Ese cliente no está disponible en esta tienda.',
  FACTURA_SIN_CLIENTE: 'Para facturar elige un cliente.',
  PRODUCTO_NO_VENDIBLE: 'Ese producto no se vende en tienda.',
  TURNO_CERRADO: 'El turno ya está cerrado.',
  TURNO_ABIERTO: 'El turno ya está abierto.',
  TIENDAS_NO_ACTIVADAS: 'Las tiendas todavía no están activadas.',
  TIENDA_NO_DISPONIBLE: 'Ya no puedes vender en esta tienda o en esta caja. Habla con Administración.',
  OPERACION_REPETIDA: 'Esa operación ya se registró con otros datos. Empieza una nueva.',
  CAJA_OCUPADA: 'Esa caja ya tiene un turno abierto.',
  CAJERO_CON_TURNO: 'Ya hay un turno abierto para ese cajero. Hay que cerrarlo primero.',
  CAJA_INACTIVA: 'Esa caja está desactivada.',
  CAJA_REPETIDA: 'Esa tienda ya tiene una caja con ese nombre.',
  CAJA_CON_TURNO_ABIERTO: 'La caja tiene un turno abierto; ciérralo antes de desactivarla.',
  ESTABLECIMIENTO_NO_VALIDO: 'Ese establecimiento no es una tienda activa.',
  FONDO_INVALIDO: 'Escribe el fondo inicial (0 o más).',
  CONTADO_INVALIDO: 'Escribe el efectivo contado (0 o más).',
  MOTIVO_DIFERENCIA: 'Lo contado no coincide con lo esperado. Vuelve a contar o escribe el motivo de la diferencia.',
  NOTAS_REQUERIDAS: 'Al cerrar el turno de otra persona escribe por qué.',
  MOTIVO_REQUERIDO: 'Escribe el motivo.',
  CAJERO_NO_DISPONIBLE: 'El cajero de ese turno ya no trabaja en esa tienda.',
  NO_ES_VENTA_DE_TIENDA: 'Esa orden no es una venta de tienda.',
  YA_CORREGIDA: 'Esa venta ya tiene una corrección.',
  MEDIO_NO_CORRESPONDE: 'La venta se cobró en efectivo; el reembolso es en efectivo.',
  REEMBOLSO_EXTERNO_PENDIENTE: 'La devolución a tarjeta o transferencia se hace en la terminal o el banco. Regístrala y confírmala después con su referencia.',
  TURNO_REEMBOLSO_INVALIDO: 'El efectivo solo puede salir de un turno abierto de la misma tienda.',
  CUARTO_NO_VALIDO: 'El producto vuelve a un congelador de la misma tienda o al cuarto del que salió.',
  REEMBOLSO_NO_PENDIENTE: 'Ese reembolso ya no está pendiente.',
  REFERENCIA_REQUERIDA: 'Escribe la referencia de la devolución que dio la terminal o el banco.',
  BUSQUEDA_CORTA: 'Escribe al menos 3 letras del nombre.',
};
const GENERICO = 'No se pudo completar la operación. Intenta de nuevo.';
// Rechazos definitivos de la base de datos (la operación NO se hizo).
const SQLSTATE_RECHAZO = /^(22023|42501|23505|23503|23514|P0001)$/;

function codigoDe(error) {
  for (const campo of [error?.details, error?.detail]) {
    if (!campo) continue;
    try { const j = typeof campo === 'string' ? JSON.parse(campo) : campo; if (j?.codigo) return { codigo: String(j.codigo), datos: j }; } catch { /* no es JSON */ }
  }
  return { codigo: null, datos: null };
}

/**
 * Clasifica el error de una llamada del POS.
 *   incierto: true  → NO se sabe si el servidor la hizo (sin conexión, tiempo agotado, 5xx):
 *                     la operación queda pendiente y se vuelve a preguntar con el MISMO id.
 *   incierto: false → el servidor la rechazó: no se hizo nada.
 */
export function clasificarErrorPos(error, enLinea = true) {
  if (esErrorDeRed(error, enLinea)) {
    return { incierto: true, codigo: 'SIN_CONEXION', mensaje: 'Sin conexión. No sabemos si la operación llegó; revísala antes de repetirla.' };
  }
  const sqlstate = String(error?.code || '');
  const { codigo, datos } = codigoDe(error);
  if (codigo && MENSAJES[codigo]) {
    let mensaje = MENSAJES[codigo];
    if (codigo === 'SIN_EXISTENCIA' && datos?.sku) mensaje = `No hay suficiente ${datos.sku}: hay ${entero(datos.disponible)} y se piden ${entero(datos.pedido)}.`;
    return { incierto: false, codigo, mensaje };
  }
  if (sqlstate === '42501') return { incierto: false, codigo: 'NO_AUTORIZADO', mensaje: 'No tienes permiso para esta acción.' };
  if (SQLSTATE_RECHAZO.test(sqlstate)) return { incierto: false, codigo: codigo || sqlstate, mensaje: GENERICO };
  // Sin un rechazo reconocible (respuesta rara, 5xx, tiempo agotado del servidor): se trata como incierto.
  return { incierto: true, codigo: 'SIN_RESPUESTA', mensaje: 'El servidor no confirmó la operación; revísala antes de repetirla.' };
}

// ── Turno ───────────────────────────────────────────────────────────────────

/** Convierte lo tecleado (fondo o efectivo contado) en pesos con centavos; error si no es válido. */
export function leerMonto(texto, etiqueta = 'el monto') {
  const limpio = String(texto ?? '').replace(/[$,\s]/g, '');
  if (limpio === '' || !/^\d{1,8}(\.\d{1,2})?$/.test(limpio)) return { error: `Escribe ${etiqueta} (solo números, hasta centavos).` };
  return { valor: dinero(limpio) };
}

/** Ventas del turno a partir de las órdenes que el servidor deja ver (RLS: solo las de la tienda). */
export function ventasDelTurno(ordenes, turnoId) {
  return (Array.isArray(ordenes) ? ordenes : [])
    .filter(o => String(o.turno_id ?? o.turnoId) === String(turnoId))
    .sort((a, b) => Number(b.id) - Number(a.id));
}

/** Conteo y suma por forma de pago de las ventas del turno (informativo; NO es el efectivo esperado). */
export function resumenVentas(ventas) {
  const porMetodo = {}; let total = 0;
  for (const v of Array.isArray(ventas) ? ventas : []) {
    const m = v.metodo_pago ?? v.metodoPago ?? '—';
    porMetodo[m] = dinero((porMetodo[m] || 0) + dinero(v.total));
    total += dinero(v.total);
  }
  return { ventas: (ventas || []).length, total: dinero(total), porMetodo };
}

// ── Administración: correcciones ────────────────────────────────────────────

export const MEDIOS_REEMBOLSO = Object.freeze([
  { id: 'efectivo_caja', label: 'Efectivo de una caja' },
  { id: 'efectivo_administracion', label: 'Efectivo de Administración' },
  { id: 'electronico', label: 'Devolución a tarjeta o transferencia' },
]);

/** Medios de reembolso que aplican a una venta: el electrónico solo si NO se cobró en efectivo. */
export function mediosParaVenta(metodoVenta) {
  return MEDIOS_REEMBOLSO.filter(m => m.id !== 'electronico' || (metodoVenta && metodoVenta !== 'Efectivo'));
}

/** Argumentos de corregir_venta_tienda, con las mismas reglas que exige el servidor. */
export function construirCorreccion({ operacionId, ordenId, motivo, disposicion, cuartoId, items, medio, entregado, turnoReembolsoId, metodoVenta }) {
  const m = String(motivo || '').trim();
  if (!ordenId) return { error: 'Elige la venta a corregir.' };
  if (m.length < 5) return { error: 'Escribe el motivo de la corrección.' };
  if (!['Reintegrar', 'Merma'].includes(disposicion)) return { error: 'Indica si el producto vuelve al congelador o es merma.' };
  if (!mediosParaVenta(metodoVenta).some(x => x.id === medio)) return { error: 'Elige de dónde sale el reembolso.' };
  const yaEntregado = !!entregado;
  if (medio === 'electronico' && yaEntregado) return { error: MENSAJES.REEMBOLSO_EXTERNO_PENDIENTE };
  if (medio === 'efectivo_caja' && yaEntregado && !turnoReembolsoId) return { error: 'Indica de qué turno abierto salió el efectivo.' };
  const partidas = Array.isArray(items) ? items.filter(i => i?.sku && entero(i.cantidad) > 0).map(i => ({ sku: i.sku, cantidad: entero(i.cantidad) })) : null;
  if (Array.isArray(items) && partidas.length === 0) return { error: 'Indica qué se devuelve.' };
  return {
    args: {
      p_operacion_id: operacionId || nuevaOperacionId(),
      p_orden_id: ordenId,
      p_motivo: m,
      p_disposicion: disposicion,
      p_cuarto_id: disposicion === 'Reintegrar' ? (cuartoId || null) : null,
      p_items: partidas,
      p_reembolso_medio: medio,
      p_reembolso_entregado: yaEntregado,
      p_turno_reembolso_id: medio === 'efectivo_caja' && yaEntregado ? turnoReembolsoId : null,
    },
  };
}

/** Cómo se dice el estado de un reembolso: registrado NO es dinero devuelto. */
export function textoReembolso(c) {
  const estado = c?.reembolso_estado ?? c?.reembolsoEstado ?? c?.estado;
  const medio = c?.reembolso_medio ?? c?.reembolsoMedio ?? c?.medio;
  if (estado === 'sin_reembolso') return { tono: 'neutro', texto: 'Sin reembolso' };
  if (estado === 'ejecutado') return { tono: 'ok', texto: 'Dinero devuelto' };
  if (medio === 'electronico') return { tono: 'aviso', texto: 'Pendiente: falta hacer la devolución en la terminal o el banco' };
  return { tono: 'aviso', texto: 'Pendiente: falta entregar el efectivo' };
}

/** Pesos para mostrar. */
export function pesos(v) {
  return dinero(v).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' });
}
