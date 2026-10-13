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
  // Tiendas E6: configuración y activación.
  TIENDA_INCOMPLETA: 'A la tienda le falta configuración para activarse.',
  TURNOS_ABIERTOS: 'La tienda tiene turnos de caja abiertos. Ciérralos antes de desactivarla.',
  QUEDARIA_VENTAS_CENTRAL: 'Al quitarle su única tienda, esa persona volvería a ser Ventas central. Confírmalo o dala de baja.',
  PERMISOS_EXPLICITOS: 'Indica sí o no en cada permiso.',
  ROL_NO_ASIGNABLE: 'A una tienda se asignan cajeros (rol Ventas) y, para traspasos, Producción o Administración.',
  PERMISO_NO_CORRESPONDE: 'Ese permiso no corresponde al rol de la persona.',
  USUARIO_NO_VALIDO: 'Ese usuario no existe o está dado de baja.',
  CLAVE_INVALIDA: 'La clave lleva de 2 a 20 letras, números o guiones, y no se cambia después.',
  CLAVE_REPETIDA: 'Ya existe un establecimiento con esa clave.',
  NOMBRE_INVALIDO: 'Escribe el nombre.',
  CUARTO_INVALIDO: 'La clave del congelador lleva de 2 a 20 letras, números o guiones.',
  CUARTO_CON_EXISTENCIA: 'Ese cuarto tiene producto. Solo se asigna un cuarto vacío; el producto llega después por traspaso.',
  CUARTO_DE_OTRA_TIENDA: 'Ese congelador es de otra tienda.',
  MODO_INVALIDO: 'Elige si la tienda usa su lista de clientes o todos los clientes.',
  CLIENTE_NO_VALIDO: 'Uno de los clientes no existe, está inactivo o fue fusionado.',
  TRASPASO_NO_AUTORIZADO: 'No tienes permiso para traspasar entre el CEDIS y esa tienda.',
  // Tiendas E7: tiendas remotas y traspasos con tránsito.
  TIPO_INVALIDO: 'El tipo de la tienda no es válido o no se puede cambiar.',
  ULTIMO_CAJERO: 'Es el último cajero de una tienda activa. Asigna antes a otro cajero o desactiva la tienda.',
  RESPONSABLE_REQUERIDO: 'Escribe quién transporta el producto.',
  CANTIDAD_INVALIDA: 'Revisa las cantidades: enteros, sin productos repetidos.',
  TRASPASO_NO_VALIDO: 'Un traspaso va del CEDIS a una tienda o de una tienda al CEDIS.',
  TRASPASO_YA_DESPACHADO: 'Ese traspaso ya no está pendiente.',
  TRASPASO_NO_EN_TRANSITO: 'Ese traspaso ya no está en tránsito (alguien ya lo recibió o regresó).',
  TRASPASO_EN_TRANSITO: 'El traspaso ya se despachó: el producto va en camino. Recíbelo en la tienda o registra su retorno al origen.',
  TRASPASO_CERRADO: 'Ese traspaso ya está cerrado.',
  RECEPCION_INCOMPLETA: 'Captura lo que llegó de cada producto del traspaso.',
  RECEPCION_EXCEDE: 'No puede llegar más producto del que se despachó.',
  NOTA_INCIDENCIA_REQUERIDA: 'Llegó producto dañado o faltó producto: escribe qué pasó.',
  SIN_INCIDENCIA: 'Ese traspaso no tiene una incidencia abierta.',
  // Tiendas E8: reportes.
  RANGO_INVALIDO: 'Revisa el periodo: fecha inicial y final, en orden, y de 400 días como máximo.',
};
// Lo que le falta a una tienda para activarse (claves de la lista de verificación del servidor).
const FALTANTES = {
  interruptor: 'el dueño todavía no habilita las tiendas propias', tipo: 'no es una tienda de fábrica', cuarto: 'un congelador propio', caja: 'una caja activa',
  personal: 'un cajero asignado', permisos: 'corregir personas o permisos que no corresponden', ventas_centrales: 'que sus cajeros terminen sus ventas centrales pendientes',
  seguridad: 'la instalación de seguridad de tiendas',
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
    if (codigo === 'TIENDA_INCOMPLETA' && Array.isArray(datos?.faltan) && datos.faltan.length) mensaje = `Para activar la tienda falta: ${datos.faltan.map(f => FALTANTES[f] || f).join('; ')}.`;
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

// ── Administración: configuración y activación de una tienda (Tiendas E6) ─────

/** Qué permiso de inventario puede tener cada rol. Son dos permisos distintos y nunca van juntos. */
export function permisosPorRol(rol) {
  return { asignable: ['Ventas', 'Producción', 'Admin'].includes(rol), vende: rol === 'Ventas', traspasa: rol === 'Producción' || rol === 'Admin' };
}

/** Personas que se pueden asignar a una tienda: activas, de un rol asignable y que aún no están en ella. */
export function usuariosAsignables(usuarios, personal) {
  const ya = new Set((Array.isArray(personal) ? personal : []).map(p => String(p.usuario_id)));
  return (Array.isArray(usuarios) ? usuarios : [])
    .filter(u => u && (u.estatus ?? 'Activo') === 'Activo' && permisosPorRol(u.rol).asignable && !ya.has(String(u.id)))
    .sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
}

/**
 * Argumentos de asignar_usuario_tienda. Los dos permisos van SIEMPRE como sí o no (el servidor
 * rechaza un permiso sin decir): aquí nunca se rellena uno "por omisión" a favor de la persona.
 */
export function construirAsignacion({ establecimientoId, usuario, vendeDesdeCedis, traspasaConCedis }) {
  if (!establecimientoId) return { error: 'Elige la tienda.' };
  if (!usuario?.id) return { error: 'Elige a la persona.' };
  const p = permisosPorRol(usuario.rol);
  if (!p.asignable) return { error: MENSAJES.ROL_NO_ASIGNABLE };
  if (typeof vendeDesdeCedis !== 'boolean' || typeof traspasaConCedis !== 'boolean') return { error: MENSAJES.PERMISOS_EXPLICITOS };
  if (vendeDesdeCedis && !p.vende) return { error: 'Vender desde el CEDIS es solo para un cajero (rol Ventas).' };
  if (traspasaConCedis && !p.traspasa) return { error: 'Traspasar con el CEDIS es solo para Producción o Administración.' };
  return { args: { p_establecimiento_id: establecimientoId, p_usuario_id: usuario.id, p_vende_desde_cedis: vendeDesdeCedis, p_traspasa_con_cedis: traspasaConCedis } };
}

/** De la lista de verificación del servidor: qué falta (obligatorio) y qué es solo aviso. */
export function resumenVerificacion(verificacion) {
  const lista = Array.isArray(verificacion) ? verificacion : [];
  const faltan = lista.filter(v => v.obligatorio && !v.ok);
  const avisos = lista.filter(v => !v.obligatorio && !v.ok);
  return { faltan, avisos, lista: lista.length > 0 && faltan.length === 0 };
}

/** Clave sugerida para una tienda a partir de lo tecleado (mayúsculas, sin espacios ni signos). */
export function normalizarClave(texto) {
  return String(texto || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 20);
}

// ── Tiendas E7: tiendas remotas y traspasos con tránsito ─────────────────────

export const TIPOS_TIENDA = Object.freeze([
  { id: 'tienda_fabrica', label: 'Tienda de fábrica', nota: 'Junto al CEDIS. Puede recibir traspasos directos y, con permiso, vender producto del CEDIS.' },
  { id: 'tienda', label: 'Tienda (remota)', nota: 'Vende solo su inventario. Se surte por traspaso: despacho desde el CEDIS y recepción en la tienda.' },
]);

/** Permisos de inventario según el rol Y el tipo de tienda: los del CEDIS son solo de la tienda de fábrica. */
export function permisosEnTienda(rol, tipoTienda) {
  const p = permisosPorRol(rol);
  const fabrica = tipoTienda === 'tienda_fabrica';
  return { asignable: p.asignable, vende: p.vende && fabrica, traspasa: p.traspasa && fabrica, recibe: rol === 'Ventas' };
}

export const ESTADOS_TRASPASO = Object.freeze([
  { id: 'pendiente', label: 'Pendientes' }, { id: 'en_transito', label: 'En tránsito' }, { id: 'recibido', label: 'Recibidos' },
  { id: 'incidencias', label: 'Incidencias' }, { id: 'retornado', label: 'Retornados' }, { id: 'cancelado', label: 'Cancelados' },
]);

/** Cómo se dice el estado de un traspaso. */
export function textoTraspaso(t) {
  const inc = t?.incidencia ? (t.incidencia_cerrada ? ' · incidencia cerrada' : ' · con incidencia') : '';
  switch (t?.estado) {
    case 'pendiente': return { tono: 'neutro', texto: 'Pendiente de despachar' };
    case 'en_transito': return { tono: 'aviso', texto: 'En tránsito' };
    case 'recibido': return { tono: t.incidencia && !t.incidencia_cerrada ? 'error' : 'ok', texto: `Recibido${inc}` };
    case 'retornado': return { tono: t.incidencia && !t.incidencia_cerrada ? 'error' : 'neutro', texto: `Regresó al origen${inc}` };
    case 'cancelado': return { tono: 'neutro', texto: 'Cancelado' };
    default: return { tono: 'neutro', texto: '—' };
  }
}

/** Qué se puede hacer con un traspaso según su estado (el servidor lo vuelve a decidir). */
export function accionesTraspaso(t, { admin = false, puedeRecibir = false } = {}) {
  const e = t?.estado;
  return {
    despachar: admin && e === 'pendiente',
    cancelar: admin && e === 'pendiente',
    recibir: e === 'en_transito' && (admin || puedeRecibir),
    retornar: admin && e === 'en_transito',
    cerrarIncidencia: admin && !!t?.incidencia && !t?.incidencia_cerrada,
  };
}

/**
 * Argumentos de crear_traspaso. `direccion`: 'abasto' (CEDIS → tienda) o 'devolucion' (tienda → CEDIS).
 * Nunca tienda ↔ tienda. Las cantidades son enteros mayores a 0, sin producto repetido.
 */
export function construirTraspaso({ operacionId, direccion, tiendaId, cuartoCedis, cuartoTienda, lineas, responsable, notas }) {
  if (!['abasto', 'devolucion'].includes(direccion)) return { error: 'Indica si el producto va a la tienda o regresa al CEDIS.' };
  if (!tiendaId) return { error: 'Elige la tienda.' };
  if (!cuartoCedis) return { error: 'Elige el cuarto del CEDIS.' };
  if (!cuartoTienda) return { error: 'Elige el congelador de la tienda.' };
  const items = (Array.isArray(lineas) ? lineas : []).filter(l => l?.sku && String(l.cantidad ?? '').trim() !== '');
  if (items.length === 0) return { error: 'Agrega al menos un producto.' };
  if (items.some(l => !/^\d{1,6}$/.test(String(l.cantidad).trim()) || Number(l.cantidad) <= 0)) return { error: MENSAJES.CANTIDAD_INVALIDA };
  if (new Set(items.map(l => l.sku)).size !== items.length) return { error: 'Hay un producto repetido.' };
  const resp = String(responsable || '').replace(/\s+/g, ' ').trim();
  if (resp.length < 3) return { error: MENSAJES.RESPONSABLE_REQUERIDO };
  const abasto = direccion === 'abasto';
  return {
    args: {
      p_operacion_id: operacionId || nuevaOperacionId(),
      p_origen_establecimiento_id: abasto ? CEDIS_ID : tiendaId,
      p_destino_establecimiento_id: abasto ? tiendaId : CEDIS_ID,
      p_cuarto_origen: abasto ? cuartoCedis : cuartoTienda,
      p_cuarto_destino: abasto ? cuartoTienda : cuartoCedis,
      p_items: items.map(l => ({ sku: l.sku, cantidad: Number(l.cantidad) })),
      p_responsable: resp,
      p_notas: String(notas || '').trim() || null,
    },
  };
}

/**
 * Partidas de una recepción (o de un retorno): por cada producto, cuánto llegó bien y cuánto dañado.
 * Lo que falta lo calcula el servidor; aquí se calcula igual solo para mostrarlo y para exigir la nota.
 * `capturas` = { [sku]: { recibida, danada } }. Lo no capturado NO se da por recibido.
 */
export function construirRecepcion(traspaso, capturas, notas) {
  const lineas = Array.isArray(traspaso?.lineas) ? traspaso.lineas : [];
  if (lineas.length === 0) return { error: 'El traspaso no tiene productos.' };
  const items = []; let incidencia = false; const resumen = [];
  for (const l of lineas) {
    const c = capturas?.[l.sku] || {};
    const txtR = String(c.recibida ?? '').trim(); const txtD = String(c.danada ?? '').trim() || '0';
    if (txtR === '') return { error: `Captura cuánto llegó de ${l.nombre || l.sku}.` };
    if (!/^\d{1,6}$/.test(txtR) || !/^\d{1,6}$/.test(txtD)) return { error: MENSAJES.CANTIDAD_INVALIDA };
    const recibida = Number(txtR); const danada = Number(txtD); const despachada = entero(l.despachada ?? l.cantidad);
    if (recibida + danada > despachada) return { error: `De ${l.nombre || l.sku} se despacharon ${despachada}: no pueden llegar ${recibida + danada}.` };
    const faltante = despachada - recibida - danada;
    if (danada > 0 || faltante > 0) incidencia = true;
    items.push({ sku: l.sku, recibida, danada });
    resumen.push({ sku: l.sku, recibida, danada, faltante });
  }
  const nota = String(notas || '').trim();
  if (incidencia && nota.length < 5) return { error: MENSAJES.NOTA_INCIDENCIA_REQUERIDA, incidencia, resumen };
  return { items, notas: nota || null, incidencia, resumen };
}

// ── Tiendas E8: reportes por establecimiento ────────────────────────────────

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const diasEntre = (a, b) => Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 86400000);
/** Suma días a una fecha 'AAAA-MM-DD' sin pasar por la zona horaria del navegador. */
export function sumarDias(iso, dias) {
  const d = new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + dias));
  return d.toISOString().slice(0, 10);
}

/** Periodo por omisión de los reportes: los últimos 7 días de negocio, terminando hoy. */
export function rangoReportePorOmision(hoyNegocio) {
  return { desde: sumarDias(hoyNegocio, -6), hasta: hoyNegocio };
}

/** Mismo criterio que el servidor: las dos fechas, en orden, y máximo 400 días. */
export function validarRangoReporte(desde, hasta) {
  if (!ISO.test(String(desde || '')) || !ISO.test(String(hasta || ''))) return { error: 'Elige la fecha inicial y la final.' };
  if (desde > hasta) return { error: 'La fecha inicial no puede ser posterior a la final.' };
  if (diasEntre(desde, hasta) > 400) return { error: 'El periodo máximo es de 400 días.' };
  return { desde, hasta };
}

export const TIPO_ESTABLECIMIENTO = Object.freeze({ cedis: 'CEDIS (ventas centrales)', tienda_fabrica: 'Tienda de fábrica', tienda: 'Tienda remota' });

/** Opciones del selector: consolidado, y cada establecimiento (CEDIS primero). `valor ''` = todos. */
export function opcionesEstablecimiento(establecimientos) {
  const lista = (Array.isArray(establecimientos) ? establecimientos : []).slice().sort((a, b) => Number(a.id) - Number(b.id));
  return [{ value: '', label: 'Consolidado (todos)' }, ...lista.map(e => ({ value: String(e.id), label: `${e.nombre}${e.tipo === 'cedis' ? ' · ventas centrales' : e.activo === false ? ' · inactiva' : ''}` }))];
}

/**
 * Comprueba en pantalla lo que el servidor garantiza: el consolidado es la suma exacta de los
 * establecimientos. Si alguna vez no cuadrara, la pantalla lo dice en vez de mostrar un total dudoso.
 */
export function consolidadoCuadra(reporteVentas) {
  const filas = Array.isArray(reporteVentas?.por_establecimiento) ? reporteVentas.por_establecimiento : [];
  const c = reporteVentas?.consolidado;
  if (!c) return false;
  const suma = (k) => dinero(filas.reduce((t, f) => t + Number(f[k] || 0), 0));
  return ['ventas', 'unidades', 'bruto', 'devoluciones', 'neto', 'cobrado'].every(k => suma(k) === dinero(c[k]));
}

/** En abastecimiento: despachadas = recibidas + retornadas + dañadas + faltantes + en tránsito. */
export function unidadesCuadran(u) {
  if (!u) return false;
  const n = (k) => entero(u[k]);
  return n('despachadas') === n('recibidas_correctamente') + n('retornadas') + n('danadas') + n('faltantes') + n('en_transito');
}

/** Texto de la diferencia de un turno: cerrado con faltante, sobrante o cuadrado; abierto no tiene. */
export function textoDiferencia(turno) {
  if (turno?.estado !== 'cerrado') return { tono: 'neutro', texto: 'Turno abierto' };
  const d = dinero(turno.diferencia);
  if (d === 0) return { tono: 'ok', texto: 'Cuadró' };
  return d < 0 ? { tono: 'error', texto: `Faltaron ${pesos(-d)}` } : { tono: 'aviso', texto: `Sobraron ${pesos(d)}` };
}
