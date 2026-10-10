// multisucursal.test.js — 123: lógica pura de sucursales por cliente.
import { describe, it, expect } from 'vitest';
import {
  sucursalesDeCliente,
  clientesVigentes, sucursalPrincipal, clienteConVariasSucursales, precioParaSucursal,
  preciosParaLineas, resolverEntrega, etiquetaClienteSucursal, buildSucursalPayload, validarSucursal,
} from '../data/sucursalLogic';
import { buildUpdateFieldsOrden, buildOrdenPayload } from '../data/ordenLogic';
import { grupoParaTabla } from '../data/realtimeLogic';

const clientes = [
  { id: 1, nombre: 'LEVIN', calle: 'Blvd Durango', numero_exterior: '100', colonia: 'Centro', ciudad: 'Durango', latitud: 24.0, longitud: -104.6, contacto: 'Gerente' },
  { id: 2, nombre: 'Sin domicilio' },
];
const sucursales = [
  { id: 10, cliente_id: 1, nombre: 'Principal', es_principal: true, calle: 'Blvd Durango', numero_exterior: '100', colonia: 'Centro', ciudad: 'Durango', latitud: 24.0, longitud: -104.6, contacto: 'Gerente' },
  { id: 11, cliente_id: 1, nombre: 'Jardines', es_principal: false, calle: 'Av. Jardines', numero_exterior: '12', colonia: 'Jardines', ciudad: 'Durango', latitud: 24.05, longitud: -104.66, contacto: 'Enc.', telefono: '618', referencia: 'Frente al parque' },
  { id: 12, cliente_id: 1, nombre: 'Sur', es_principal: false, estatus: 'Inactiva', calle: 'Sur 1' },
  { id: 20, cliente_id: 2, nombre: 'Principal', es_principal: true },
];
const productos = [{ sku: 'A', precio: 30 }, { sku: 'B', precio: 50 }];
const preciosEsp = [
  { id: 1, cliente_id: 1, sucursal_id: null, sku: 'A', precio: 25.5 },
  { id: 2, cliente_id: 1, sucursal_id: 11, sku: 'A', precio: 22 },
];

describe('sucursalesDeCliente', () => {
  it('principal primero, solo activas por omisión', () => {
    expect(sucursalesDeCliente(sucursales, 1).map(x => x.id)).toEqual([10, 11]);
    expect(sucursalesDeCliente(sucursales, '1', { incluirInactivas: true }).map(x => x.id)).toEqual([10, 11, 12]);
    expect(sucursalesDeCliente(sucursales, null)).toEqual([]);
  });
  it('principal y "varias sucursales"', () => {
    expect(sucursalPrincipal(sucursales, 1)?.id).toBe(10);
    expect(clienteConVariasSucursales(sucursales, 1)).toBe(true);
    expect(clienteConVariasSucursales(sucursales, 2)).toBe(false);
  });
});

describe('precioParaSucursal (sucursal → cliente → lista)', () => {
  it('prioridad', () => {
    expect(precioParaSucursal(preciosEsp, productos, 1, 11, 'A')).toBe(22);
    expect(precioParaSucursal(preciosEsp, productos, 1, 10, 'A')).toBe(25.5);
    expect(precioParaSucursal(preciosEsp, productos, 1, null, 'A')).toBe(25.5);
    expect(precioParaSucursal(preciosEsp, productos, 1, 11, 'B')).toBe(50);
    expect(precioParaSucursal(preciosEsp, productos, null, null, 'A')).toBe(30);
    expect(precioParaSucursal(preciosEsp, productos, 2, 20, 'ZZ')).toBe(0);
  });
  it('acepta camelCase del store', () => {
    const pe = [{ clienteId: 1, sucursalId: 11, sku: 'A', precio: '21' }];
    expect(precioParaSucursal(pe, productos, 1, 11, 'A')).toBe(21);
  });
  it('preciosParaLineas: la fila de la sucursal pedida gana; las de otras sucursales se ignoran', () => {
    expect(preciosParaLineas(preciosEsp, 11)).toEqual([{ sku: 'A', precio: 22 }]);
    expect(preciosParaLineas(preciosEsp, 10)).toEqual([{ sku: 'A', precio: 25.5 }]);
    expect(preciosParaLineas(preciosEsp, null)).toEqual([{ sku: 'A', precio: 25.5 }]);
    expect(preciosParaLineas([{ sku: 'B', precio: 40, sucursal_id: 11 }], null)).toEqual([]);
  });
});

describe('resolverEntrega (orden → sucursal → cliente)', () => {
  it('orden con dirección propia y coordenadas propias', () => {
    const r = resolverEntrega({ cliente_id: 1, sucursal_id: 11, direccion_entrega: 'Propia 9', latitud_entrega: 24.2, longitud_entrega: -104.8, referencia_entrega: 'ref' }, sucursales, clientes);
    expect(r.direccion).toBe('Propia 9');
    expect(r.origen).toBe('orden');
    expect([r.latitud, r.longitud]).toEqual([24.2, -104.8]);
    expect(r.referencia).toBe('ref');
    expect(r.sucursalNombre).toBe('Jardines');
  });
  it('orden sin dirección: la de la sucursal, con su contacto, teléfono y referencia', () => {
    const r = resolverEntrega({ clienteId: 1, sucursalId: 11 }, sucursales, clientes);
    expect(r.direccion).toBe('Av. Jardines 12, Jardines, Durango');
    expect(r.origen).toBe('sucursal');
    expect([r.latitud, r.longitud]).toEqual([24.05, -104.66]);
    expect(r.contacto).toBe('Enc.');
    expect(r.telefono).toBe('618');
    expect(r.referencia).toBe('Frente al parque');
  });
  it('orden anterior a 123 (sin sucursal): principal del cliente; sin sucursales, el cliente', () => {
    const r = resolverEntrega({ cliente_id: 1 }, sucursales, clientes);
    expect(r.direccion).toBe('Blvd Durango 100, Centro, Durango');
    expect(r.origen).toBe('sucursal');
    expect(r.sucursalNombre).toBe('');
    const r2 = resolverEntrega({ cliente_id: 1 }, [], clientes);
    expect(r2.origen).toBe('cliente');
    expect(r2.latitud).toBe(24.0);
    expect(r2.contacto).toBe('Gerente');
  });
  it('público en general o cliente sin domicilio: vacío, sin reventar', () => {
    expect(resolverEntrega({ cliente_nombre: 'Mostrador' }, sucursales, clientes)).toMatchObject({ direccion: '', latitud: null, origen: null, sucursal: null });
    expect(resolverEntrega({ cliente_id: 2 }, sucursales, clientes)).toMatchObject({ direccion: '', origen: null });
    expect(resolverEntrega(null, null, null).direccion).toBe('');
  });
});

describe('etiqueta y payload', () => {
  it('etiquetaClienteSucursal', () => {
    expect(etiquetaClienteSucursal('LEVIN', sucursales[1])).toBe('LEVIN · Jardines');
    expect(etiquetaClienteSucursal('LEVIN', sucursales[0])).toBe('LEVIN');
    expect(etiquetaClienteSucursal('LEVIN', null)).toBe('LEVIN');
  });
  it('buildSucursalPayload recorta, acepta camelCase y normaliza coordenadas', () => {
    const p = buildSucursalPayload({ nombre: ' Jardines ', calle: 'Av', numeroExterior: '12', codigoPostal: '34200', latitud: '24.05', longitud: 'x', estatus: '' });
    expect(p).toMatchObject({ nombre: 'Jardines', numero_exterior: '12', codigo_postal: '34200', latitud: '24.05', longitud: '', estatus: 'Activa' });
  });
  it('validarSucursal', () => {
    expect(validarSucursal({ nombre: '' })).toHaveProperty('nombre');
    expect(validarSucursal({ nombre: 'X', latitud: '24' })).toHaveProperty('latitud');
    expect(validarSucursal({ nombre: 'X', codigo_postal: '123' })).toHaveProperty('codigo_postal');
    expect(validarSucursal({ nombre: 'X', latitud: '24', longitud: '-104', codigo_postal: '34200' })).toEqual({});
  });
});

describe('orden con sucursal (ordenLogic) y realtime', () => {
  it('buildUpdateFieldsOrden mapea sucursalId → sucursal_id (null si vacío) y no la toca si no viene', () => {
    expect(buildUpdateFieldsOrden({ sucursalId: 11 })).toEqual({ sucursal_id: 11 });
    expect(buildUpdateFieldsOrden({ sucursalId: '' })).toEqual({ sucursal_id: null });
    expect(buildUpdateFieldsOrden({ fecha: '2026-10-09' })).not.toHaveProperty('sucursal_id');
  });
  it('buildOrdenPayload incluye sucursal_id', () => {
    const ctx = { folio: 'OV-1', clienteNombre: 'LEVIN', total: 1, productosStr: '1×A' };
    expect(buildOrdenPayload({ clienteId: 1, sucursalId: 11 }, ctx).sucursal_id).toBe(11);
    expect(buildOrdenPayload({ clienteId: 1 }, ctx).sucursal_id).toBeNull();
  });
  it('sucursales es tabla de núcleo del realtime', () => {
    expect(grupoParaTabla('sucursales')).toBe('core');
  });
});

describe('clientesVigentes (selector de precio especial)', () => {
  const clientes = [
    { id: 115, nombre: 'LEVIN', tipo: 'Comercial', estatus: 'Activo', fusionado_en: null },
    { id: 109, nombre: 'LEVIN JARDINES', tipo: 'Comercial', estatus: 'Inactivo', fusionado_en: 115 },
    { id: 7, nombre: 'Cerrado', tipo: 'Comercial', estatus: 'Inactivo', fusionado_en: null },
    { id: 1, nombre: 'Público en general', tipo: 'General', estatus: 'Activo' },
    { id: 8, nombre: 'Camel', tipo: 'Comercial', estatus: 'Activo', fusionadoEn: null },
  ];
  it('excluye General, Inactivos y fusionados como sucursal', () => {
    expect(clientesVigentes(clientes).map(c => c.id)).toEqual([115, 8]);
    expect(clientesVigentes(null)).toEqual([]);
  });
});
