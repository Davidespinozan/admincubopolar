// ── ordenLogic.js ───────────────────────────────────────────────
// Pure business logic for order creation — no Supabase, no React.
// Extracted so it can be unit-tested without mocking the entire store.
// supaStore.js imports and delegates to these functions.
// ────────────────────────────────────────────────────────────────
import { s, centavos, todayLocalISO } from '../utils/safe';

/**
 * Parse a productos string into structured items.
 * Accepted formats:
 *   "10×HC-5K, 5×HC-25K"   (unicode ×)
 *   "10xHC-5K,5xHC-25K"    (lowercase x)
 *
 * @param {string} raw
 * @returns {{ qty: number, sku: string }[]}  — empty array if invalid
 */
export function parseProductos(raw) {
  return s(raw)
    .split(',')
    .map(x => x.trim())
    .filter(Boolean)
    .map(item => {
      const m = item.match(/^(\d+)\s*[×x]\s*(.+)$/i);
      return m ? { qty: parseInt(m[1], 10), sku: m[2].trim() } : null;
    })
    .filter(Boolean);
}

/**
 * Validate parsed items before hitting the database.
 * Returns an error message string or null if valid.
 *
 * @param {{ qty: number, sku: string }[]} items
 * @returns {string|null}
 */
export function validateItems(items) {
  if (items.length === 0) return 'Productos inválidos o vacíos';
  if (items.some(i => i.qty <= 0)) return 'Las cantidades deben ser positivas';
  return null;
}

/**
 * Build order lines (lineas) from parsed items + catalog data.
 * Returns { lineas, total } or { error } if a SKU is missing / price is invalid.
 *
 * @param {{ qty: number, sku: string }[]} items
 * @param {{ sku: string, precio: number|string }[]} productos   — from DB
 * @param {{ sku: string, precio: number|string }[]} preciosEsp  — client-specific prices
 * @returns {{ lineas: object[], total: number } | { error: string }}
 */
export function buildLineas(items, productos = [], preciosEsp = []) {
  let total = 0;
  const lineas = [];

  for (const item of items) {
    const prod = productos.find(p => p.sku === item.sku);
    if (!prod) return { error: `SKU ${item.sku} no existe` };

    const pe = preciosEsp.find(p => p.sku === item.sku);
    const unitPrice = centavos(pe ? Number(pe.precio) : Number(prod.precio || 0));

    if (unitPrice < 0) return { error: `Precio inválido para ${item.sku}` };

    const subtotal = centavos(item.qty * unitPrice);
    total += subtotal;
    lineas.push({ sku: item.sku, cantidad: item.qty, precio_unit: unitPrice, subtotal });
  }

  total = centavos(total);
  if (total <= 0) return { error: 'El total de la orden debe ser mayor a 0' };

  return { lineas, total };
}

/**
 * Format a folio number into the canonical OV-XXXX string.
 * @param {number|string} seq
 * @returns {string}
 */
export function formatFolio(seq) {
  return `OV-${String(seq || 1).padStart(4, '0')}`;
}

// ─── FACTURACIÓN (FSM) ───────────────────────────────────────
// Helpers puros para decidir si una orden está pendiente de timbrar
// o ya tiene un CFDI vigente. Se usan tanto en supaStore.facturacionPendiente
// como en FacturacionView y en billing-create-invoice (idempotency).
//
// Convenciones:
//   - requiere_factura: toggle del UI; si es false la orden no aplica para CFDI.
//   - facturama_uuid: presente cuando se timbró exitosamente.
//   - cfdi_cancelado_at: presente cuando el CFDI fue cancelado ante SAT
//     (Tanda 5). Si está poblado, la orden vuelve a ser facturable
//     (re-timbrado permitido) — el UUID anterior queda como histórico.

/**
 * Una orden está pendiente de timbrar si:
 *   - requiere_factura = true
 *   - estatus = 'Entregada'
 *   - NO tiene CFDI vigente (sin facturama_uuid, o el último fue cancelado)
 *
 * @param {Object} orden — { estatus, requiere_factura, facturama_uuid, cfdi_cancelado_at }
 * @returns {boolean}
 */
export function isFacturable(orden) {
  if (!orden) return false;
  if (!orden.requiere_factura) return false;
  if (String(orden.estatus || '') !== 'Entregada') return false;
  if (!orden.facturama_uuid) return true;
  return !!orden.cfdi_cancelado_at;
}

/**
 * Una orden está facturada (CFDI vigente ante SAT) si:
 *   - tiene facturama_uuid
 *   - cfdi_cancelado_at está vacío
 *
 * Nota: no chequeamos requiere_factura — si por alguna razón hay UUID
 * en la orden (datos legacy), la consideramos facturada igualmente
 * para no perder el historial.
 *
 * @param {Object} orden
 * @returns {boolean}
 */
export function isFacturada(orden) {
  if (!orden) return false;
  if (!orden.facturama_uuid) return false;
  return !orden.cfdi_cancelado_at;
}

/**
 * Valida si una orden puede cancelar su CFDI.
 * Reglas:
 *   1. Debe tener un CFDI vigente (isFacturada == true).
 *   2. Motivo debe ser código SAT válido (01-04).
 *   3. Si motivo='01', uuidSustituto es obligatorio.
 *
 * @param {Object} params
 * @param {Object} params.orden
 * @param {string} params.motivo
 * @param {string} [params.uuidSustituto]
 * @returns {{ error: string }|null}
 */
export function validateCancelacionCFDI({ orden, motivo, uuidSustituto }) {
  if (!isFacturada(orden)) {
    return { error: 'Esta orden no tiene un CFDI vigente que cancelar' };
  }
  const mot = String(motivo || '').trim();
  if (!['01', '02', '03', '04'].includes(mot)) {
    return { error: 'Motivo SAT inválido (debe ser 01, 02, 03 o 04)' };
  }
  if (mot === '01') {
    const sus = String(uuidSustituto || '').trim();
    if (!sus) {
      return { error: 'El motivo 01 requiere el UUID del CFDI que sustituye al cancelado' };
    }
  }
  return null;
}

/**
 * Construye el payload del UPDATE de la orden tras cancelar el CFDI.
 * Revierte estatus a 'Entregada' (vuelve a aparecer como pendiente
 * facturable) y guarda las anotaciones de cancelación.
 *
 * @param {Object} params
 * @param {string} params.motivo
 * @param {string} [params.motivoDetalle]
 * @param {string} [params.uuidSustituto]
 * @param {string} params.usuario
 * @param {Date}   [params.now=new Date()]
 * @returns {Object}
 */
export function buildAnotacionCancelacionCFDI({ motivo, motivoDetalle, uuidSustituto, usuario, now = new Date() }) {
  return {
    estatus: 'Entregada',
    cfdi_cancelado_at: now.toISOString(),
    cfdi_cancelado_motivo: String(motivo || '').trim(),
    cfdi_cancelado_motivo_detalle: motivoDetalle ? String(motivoDetalle).trim() : null,
    cfdi_cancelado_uuid_sustituto: uuidSustituto ? String(uuidSustituto).trim() : null,
    cfdi_cancelado_por: String(usuario || 'Admin'),
  };
}

// ─── CANCELACIÓN ──────────────────────────────────────────────

/**
 * Valida si una orden puede cancelarse a partir de su estatus actual,
 * la CxC asociada (si existe) y los pagos directos registrados.
 *
 * @param {Object} params
 * @param {string} params.estatusActual  Estatus de la orden ('Creada' | 'Asignada' | 'Entregada' | 'Facturada' | 'Cancelada')
 * @param {Object|null} params.cxc       Row de cuentas_por_cobrar asociada o null. Necesita `monto_pagado`.
 * @param {boolean} params.hayPagosDirectos  true si hay pagos.orden_id matcheando y NO hay CxC
 * @param {string} params.motivo         Motivo capturado en UI (debe ser no-vacío)
 * @returns {{ error: string }|null}     null si puede cancelarse; objeto con error si no
 */
export function validateCancelacion({ estatusActual, cxc, hayPagosDirectos, motivo }) {
  const motivoTxt = String(motivo || '').trim();
  if (!motivoTxt) return { error: 'Motivo requerido' };

  const est = String(estatusActual || '').trim();
  if (est === 'Cancelada') return { error: 'Esta orden ya está cancelada' };
  if (est === 'Entregada' || est === 'Facturada') {
    return { error: 'No se puede cancelar una orden ya entregada o facturada. Registra una devolución.' };
  }

  if (cxc && Number(cxc.monto_pagado || cxc.montoPagado || 0) > 0) {
    return { error: 'Esta venta tiene pagos parciales. Anula los pagos primero.' };
  }

  if (hayPagosDirectos && !cxc) {
    return { error: 'Esta venta de contado ya está pagada. Registra una devolución.' };
  }

  return null;
}

/**
 * Construye el payload del UPDATE con las anotaciones de cancelación.
 * @param {string} motivo       Texto capturado del usuario (se trimea)
 * @param {string} usuario      Username quien cancela
 * @param {Date}   [now=new Date()]  Fecha de corte (inyectable para tests)
 * @returns {Object}            { motivo_cancelacion, cancelada_at, cancelada_por }
 */
export function buildAnotacionCancelacion(motivo, usuario, now = new Date()) {
  return {
    motivo_cancelacion: String(motivo || '').trim(),
    cancelada_at: now.toISOString(),
    cancelada_por: String(usuario || 'Admin'),
  };
}

// ─── MÁQUINA DE ESTADOS ──────────────────────────────────────
// Transiciones legales del estatus de una orden. Cualquier salto fuera
// de este mapa se rechaza desde el backend (updateOrdenEstatus).
// Facturada, Cancelada y 'No entregada' son terminales.
// 'No entregada' es un terminal distinto a Cancelada: la orden quedó
// cargada en el camión pero el cliente no la recibió (cerrado, ausente,
// rechazo). Se usa para reagendar a la siguiente ruta.
export const TRANSICIONES_ORDEN = {
  Creada:         ['Asignada', 'Cancelada'],
  Asignada:       ['En ruta', 'Entregada', 'No entregada', 'Cancelada'],
  'En ruta':      ['Entregada', 'No entregada', 'Cancelada'],
  Entregada:      ['Facturada'],
  Facturada:      [],
  Cancelada:      [],
  'No entregada': [],
};

// Motivos canónicos para la UI. 'Otro' permite captura libre.
export const MOTIVOS_NO_ENTREGA = [
  'Local cerrado',
  'Cliente ausente',
  'Cliente rechazó pedido',
  'Sin acceso al lugar',
  'Otro',
];

/**
 * Valida que una orden pueda marcarse como No entregada.
 * Solo aplica desde 'Asignada' o 'En ruta' (la orden ya está en el camión
 * o asignada a la ruta). Cualquier otro estatus se rechaza.
 *
 * @param {Object} orden        — { estatus }
 * @param {string} motivo       — texto capturado en UI
 * @returns {{ error: string }|null}
 */
export function validateMarcarNoEntregada(orden, motivo) {
  const motivoTxt = String(motivo || '').trim();
  if (!motivoTxt) return { error: 'Motivo requerido' };

  const est = String(orden?.estatus || '').trim();
  if (!est) return { error: 'Orden sin estatus' };
  if (est !== 'Asignada' && est !== 'En ruta') {
    return { error: `No se puede marcar como No entregada desde estatus ${est}` };
  }
  return null;
}

/**
 * Construye el payload UPDATE para marcar una orden como No entregada.
 *
 * @param {string}  motivo
 * @param {boolean} reagendar
 * @param {Date}    [now=new Date()]  inyectable para tests
 * @returns {Object} payload listo para .update()
 */
export function buildNoEntregaPayload(motivo, reagendar, now = new Date()) {
  return {
    estatus: 'No entregada',
    motivo_no_entrega: String(motivo || '').trim(),
    fecha_no_entrega: now.toISOString(),
    reagendada: !!reagendar,
  };
}

/**
 * Calcula la distribución FIFO inverso para devolver al cuarto frío el
 * stock de las líneas de una orden no entregada. Multi-SKU, multi-cuarto.
 *
 * Como el stock fue descontado al firmar la carga de la ruta y la
 * mercancía vuelve física al almacén, se devuelve al primer cuarto activo
 * (en orden de id) hasta que el delta para cada SKU complete su cantidad.
 * Cada change tiene delta POSITIVO (es entrada al cuarto).
 *
 * @param {Array}  lineas   — [{ sku, cantidad }, ...] de la orden
 * @param {Array}  cuartos  — [{ id, stock?: { sku: qty } }, ...] activos
 * @param {string} usuario  — quien dispara la devolución (audit)
 * @param {string} ordenRef — folio o "ID N" para el campo origen
 * @returns {{ changes: Array }}  changes: lista para update_stocks_atomic
 */
export function calcReversoChangesNoEntrega(lineas, cuartos, usuario, ordenRef) {
  const changes = [];
  const cuartosLista = Array.isArray(cuartos) ? cuartos : [];
  const user = String(usuario || 'Chofer');
  const ref = String(ordenRef || 'orden');

  if (!Array.isArray(lineas)) return { changes };

  // Si no hay cuartos, no hay donde devolver — caller debe manejar el caso
  if (cuartosLista.length === 0) return { changes };
  const cuartoDestino = cuartosLista[0];

  for (const l of lineas) {
    const sku = String(l?.sku || '');
    const qty = Number(l?.cantidad || 0);
    if (!sku || qty <= 0) continue;
    changes.push({
      cuarto_id: cuartoDestino.id,
      sku,
      delta: qty,
      tipo: 'Devolución no entregada',
      origen: `No entregada ${ref}`,
      usuario: user,
    });
  }
  return { changes };
}

/**
 * Valida si la transición de estatus es legal.
 * @param {string} estatusActual
 * @param {string} nuevoEstatus
 * @returns {{ error: string }|null}
 */
export function validateTransicionOrden(estatusActual, nuevoEstatus) {
  const actual = String(estatusActual || '').trim();
  const nuevo  = String(nuevoEstatus  || '').trim();
  if (actual === nuevo) return null; // no-op idempotente
  const permitidas = TRANSICIONES_ORDEN[actual];
  if (!permitidas) {
    return { error: `Estatus actual desconocido: ${actual}` };
  }
  if (!permitidas.includes(nuevo)) {
    return { error: `No se puede pasar de ${actual} a ${nuevo}` };
  }
  return null;
}

// ─── EDICIÓN ──────────────────────────────────────────────────

/**
 * Valida si una orden puede editarse. Reglas:
 *   1. Solo se permite editar órdenes en estatus 'Creada'.
 *   2. Si la orden está asignada a una ruta cuyo chofer ya confirmó la
 *      carga física (carga_confirmada_at != null), editar líneas/cantidades
 *      genera desacuerdo entre la nota y lo cargado al camión. Bloqueamos.
 *      Admin debe primero quitar la orden de la ruta.
 *
 * @param {string} estatusActual
 * @param {Object|null} ruta - { carga_confirmada_at } | null si no aplica
 * @returns {{ error: string }|null}
 */
export function validateEdicionOrden(estatusActual, ruta = null) {
  const est = String(estatusActual || '').trim();
  if (est !== 'Creada') {
    return { error: 'Solo se pueden editar órdenes en estatus Creada' };
  }
  if (ruta && ruta.carga_confirmada_at) {
    return {
      error: 'No se puede editar: la ruta ya cargó esta orden. Quítala de la ruta primero.',
    };
  }
  return null;
}

/**
 * Normaliza un array de líneas del UI a items {qty, sku} válidos.
 * Filtra entradas vacías o con qty inválido.
 *
 * @param {Array} lines - [{ sku, qty?, cantidad?, precio? }, ...]
 * @returns {Array}      [{ qty: number, sku: string }, ...]
 */
export function parseLineasEdicion(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .filter(l => l && l.sku && Number(l.qty || l.cantidad) > 0)
    .map(l => ({ qty: Number(l.qty || l.cantidad), sku: String(l.sku) }));
}

/**
 * Construye los campos para el UPDATE de la tabla ordenes desde el
 * payload de la UI (camelCase) a snake_case. Solo incluye los campos
 * que vinieron en payload (no setea undefined → no pisa columnas).
 * Si vienen líneas nuevas, agrega total + productos string.
 *
 * @param {Object} payload  Objeto del UI (cliente, clienteId, fecha, tipoCobro, etc.)
 * @param {Array|null} lineasNuevas  Resultado de buildLineas — { sku, cantidad, precio_unit, subtotal }
 * @param {number|null} totalNuevo    Total recalculado por buildLineas
 * @returns {Object}        Campos snake_case listos para .update()
 */
export function buildUpdateFieldsOrden(payload, lineasNuevas = null, totalNuevo = null) {
  const update = {};
  if (payload.cliente !== undefined) update.cliente_nombre = payload.cliente;
  if (payload.clienteId !== undefined) update.cliente_id = payload.clienteId || null;
  if (payload.fecha !== undefined) update.fecha = payload.fecha;
  if (payload.tipoCobro !== undefined) update.tipo_cobro = payload.tipoCobro;
  if (payload.folioNota !== undefined) update.folio_nota = payload.folioNota || null;
  if (payload.direccionEntrega !== undefined) update.direccion_entrega = payload.direccionEntrega || null;
  if (payload.referenciaEntrega !== undefined) update.referencia_entrega = payload.referenciaEntrega || null;
  if (payload.latitudEntrega !== undefined) update.latitud_entrega = payload.latitudEntrega ?? null;
  if (payload.longitudEntrega !== undefined) update.longitud_entrega = payload.longitudEntrega ?? null;
  if (Array.isArray(lineasNuevas) && lineasNuevas.length > 0) {
    update.total = Number(totalNuevo);
    update.productos = lineasNuevas.map(l => `${l.cantidad}×${l.sku}`).join(', ');
  }
  return update;
}

/**
 * Construye el payload para INSERT en la tabla ordenes a partir del
 * objeto de la UI. Función pura (sin Supabase) para que sea testeable.
 *
 * Convención: undefined/null/'' en direccion_entrega → la orden hereda
 * la dirección del cliente. Si trae valor, override.
 *
 * @param {Object} o - objeto de la UI (clienteId, fecha, tipoCobro, etc.)
 * @param {Object} ctx - { folio, clienteNombre, total, productosStr }
 * @returns {Object} payload listo para .insert()
 */
export function buildOrdenPayload(o, ctx) {
  const dir = typeof o?.direccionEntrega === 'string' ? o.direccionEntrega.trim() : '';
  const ref = typeof o?.referenciaEntrega === 'string' ? o.referenciaEntrega.trim() : '';
  const lat = o?.latitudEntrega;
  const lng = o?.longitudEntrega;
  const latNum = (lat === '' || lat === null || lat === undefined) ? null : Number(lat);
  const lngNum = (lng === '' || lng === null || lng === undefined) ? null : Number(lng);

  return {
    folio: ctx.folio,
    cliente_id: o.clienteId || null,
    cliente_nombre: ctx.clienteNombre,
    productos: ctx.productosStr,
    fecha: o.fecha || todayLocalISO(),
    total: ctx.total,
    estatus: 'Creada',
    metodo_pago: o.metodoPago || 'Efectivo',
    vendedor_id: o.usuarioId || null,
    tipo_cobro: o.tipoCobro || 'Contado',
    folio_nota: o.folioNota || null,
    direccion_entrega: dir || null,
    referencia_entrega: ref || null,
    latitud_entrega: Number.isFinite(latNum) ? latNum : null,
    longitud_entrega: Number.isFinite(lngNum) ? lngNum : null,
  };
}
