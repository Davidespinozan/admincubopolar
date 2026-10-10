// sucursalLogic.js — multisucursal (123): lógica pura de sucursales por cliente.
//
// Un cliente (razón social, crédito, saldo, factura) tiene varias sucursales
// (domicilio, ubicación, contacto, zona). Toda orden con cliente lleva una
// sucursal; el servidor copia la dirección de la sucursal a la orden al
// crearla. Aquí vive lo que las vistas comparten: elegir sucursales, resolver
// la dirección efectiva de una orden (orden → sucursal → cliente), el precio
// sucursal → cliente → lista y la etiqueta "Cliente · Sucursal".

import { formatDireccion } from './direccionLogic';

const s = v => (v === null || v === undefined) ? '' : String(v);
const n = v => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const eqId = (a, b) => s(a) !== '' && s(a) === s(b);

/** Sucursales de un cliente, principal primero, luego por nombre. */
export function sucursalesDeCliente(sucursales, clienteId, { incluirInactivas = false } = {}) {
  if (!clienteId) return [];
  return (sucursales || [])
    .filter(x => eqId(x.clienteId ?? x.cliente_id, clienteId))
    .filter(x => incluirInactivas || s(x.estatus) !== 'Inactiva')
    .sort((a, b) => {
      const pa = (a.esPrincipal ?? a.es_principal) ? 0 : 1;
      const pb = (b.esPrincipal ?? b.es_principal) ? 0 : 1;
      return pa - pb || s(a.nombre).localeCompare(s(b.nombre), 'es');
    });
}

/** Sucursal principal del cliente (o null). */
export function sucursalPrincipal(sucursales, clienteId) {
  return sucursalesDeCliente(sucursales, clienteId, { incluirInactivas: true })
    .find(x => x.esPrincipal ?? x.es_principal) || null;
}

/** ¿Hay que pedir sucursal al vender? Solo si el cliente tiene más de una activa. */
export function clienteConVariasSucursales(sucursales, clienteId) {
  return sucursalesDeCliente(sucursales, clienteId).length > 1;
}

/**
 * Precio canónico del frontend (espejo de precio_canonico del servidor):
 * precio de la sucursal → precio del cliente (sin sucursal) → precio de lista.
 */
export function precioParaSucursal(preciosEsp, productos, clienteId, sucursalId, sku) {
  if (!sku) return 0;
  const lista = preciosEsp || [];
  if (clienteId && sucursalId) {
    const ps = lista.find(p => eqId(p.sucursalId ?? p.sucursal_id, sucursalId) && p.sku === sku);
    if (ps) return n(ps.precio);
  }
  if (clienteId) {
    const pc = lista.find(p => eqId(p.clienteId ?? p.cliente_id, clienteId) && !(p.sucursalId ?? p.sucursal_id) && p.sku === sku);
    if (pc) return n(pc.precio);
  }
  const prod = (productos || []).find(p => p.sku === sku);
  return prod ? n(prod.precio) : 0;
}

/**
 * Reduce las filas de precios_esp de UN cliente a una lista {sku, precio} para
 * buildLineas: por SKU, la fila de la sucursal pedida gana sobre la del cliente.
 */
export function preciosParaLineas(filasCliente, sucursalId) {
  const porSku = new Map();
  for (const p of filasCliente || []) {
    const sid = p.sucursalId ?? p.sucursal_id ?? null;
    if (sid && !eqId(sid, sucursalId)) continue;
    const prev = porSku.get(p.sku);
    if (!prev || (sid && !(prev.sucursalId ?? prev.sucursal_id))) porSku.set(p.sku, p);
  }
  return [...porSku.values()].map(p => ({ sku: p.sku, precio: n(p.precio) }));
}

/**
 * Dirección efectiva de una orden: la propia de la orden (texto y coordenadas),
 * si no la de su sucursal, si no la del cliente (órdenes anteriores a 123).
 * Devuelve siempre el mismo shape para que Chofer, Rutas y Ventas coincidan.
 */
export function resolverEntrega(orden, sucursales, clientes) {
  const o = orden || {};
  const clienteId = o.clienteId ?? o.cliente_id;
  const sucursalId = o.sucursalId ?? o.sucursal_id;
  const cliente = clienteId ? (clientes || []).find(c => eqId(c.id, clienteId)) || null : null;
  const sucursal = sucursalId
    ? (sucursales || []).find(x => eqId(x.id, sucursalId)) || null
    : (cliente ? sucursalPrincipal(sucursales, clienteId) : null);

  const propia = s(o.direccionEntrega ?? o.direccion_entrega).trim();
  const latO = o.latitudEntrega ?? o.latitud_entrega;
  const lngO = o.longitudEntrega ?? o.longitud_entrega;
  const coordsOrden = latO !== null && latO !== undefined && latO !== '' && lngO !== null && lngO !== undefined && lngO !== '';

  let direccion = propia;
  let origen = propia ? 'orden' : null;
  if (!direccion && sucursal) { direccion = formatDireccion(sucursal); if (direccion) origen = 'sucursal'; }
  if (!direccion && cliente) { direccion = formatDireccion(cliente); if (direccion) origen = 'cliente'; }

  let latitud = null, longitud = null;
  if (coordsOrden) { latitud = Number(latO); longitud = Number(lngO); }
  else if (sucursal && sucursal.latitud != null && sucursal.longitud != null) { latitud = Number(sucursal.latitud); longitud = Number(sucursal.longitud); }
  else if (cliente && cliente.latitud != null && cliente.longitud != null) { latitud = Number(cliente.latitud); longitud = Number(cliente.longitud); }

  const contacto = s(sucursal?.contacto || cliente?.contacto);
  const telefono = s(sucursal?.telefono);
  const referencia = s(o.referenciaEntrega ?? o.referencia_entrega).trim() || s(sucursal?.referencia);
  const sucursalNombre = sucursal && !(sucursal.esPrincipal ?? sucursal.es_principal) ? s(sucursal.nombre) : '';

  return { direccion, latitud, longitud, origen, contacto, telefono, referencia, sucursal, sucursalNombre };
}

/** "LEVIN · Jardines" cuando la sucursal no es la principal; solo el cliente si lo es. */
export function etiquetaClienteSucursal(nombreCliente, sucursal) {
  const base = s(nombreCliente).trim();
  if (!sucursal || (sucursal.esPrincipal ?? sucursal.es_principal)) return base;
  const nom = s(sucursal.nombre).trim();
  return nom ? `${base} · ${nom}` : base;
}

/** Payload del contrato guardar_sucursal a partir del formulario (todo en snake_case, strings recortados). */
export function buildSucursalPayload(form) {
  const f = form || {};
  const txt = k => s(f[k]).trim();
  const coord = v => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v))) ? '' : String(Number(v));
  return {
    nombre: txt('nombre'),
    calle: txt('calle'),
    numero_exterior: txt('numero_exterior') || txt('numeroExterior'),
    numero_interior: txt('numero_interior') || txt('numeroInterior'),
    colonia: txt('colonia'),
    ciudad: txt('ciudad'),
    estado: txt('estado'),
    codigo_postal: txt('codigo_postal') || txt('codigoPostal'),
    latitud: coord(f.latitud),
    longitud: coord(f.longitud),
    zona: txt('zona'),
    contacto: txt('contacto'),
    telefono: txt('telefono'),
    referencia: txt('referencia'),
    estatus: txt('estatus') || 'Activa',
  };
}

/** Validación del formulario de sucursal antes de llamar al contrato. */
export function validarSucursal(form) {
  const errors = {};
  const p = buildSucursalPayload(form);
  if (!p.nombre) errors.nombre = 'Nombre de la sucursal requerido';
  if ((p.latitud === '') !== (p.longitud === '')) errors.latitud = 'Latitud y longitud van juntas';
  if (p.codigo_postal && !/^\d{5}$/.test(p.codigo_postal)) errors.codigo_postal = 'Código postal de 5 dígitos';
  return errors;
}
