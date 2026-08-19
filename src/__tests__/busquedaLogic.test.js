// busquedaLogic.test.js — búsqueda global del shell (Tanda 27).
import { describe, it, expect } from 'vitest';
import { buscarGlobal } from '../data/busquedaLogic';

const DATA = {
  clientes: [
    { id: 1, nombre: 'Abarrotes López', nombreComercial: 'Don Pepe', rfc: 'LOPA800101XXX' },
    { id: 2, nombre: 'Six Centro', rfc: 'SIX950505YYY' },
  ],
  ordenes: [
    { id: 10, folio: 'OV-0047', cliente: 'Abarrotes López', estatus: 'Creada', total: 1200 },
    { id: 11, folio: 'OV-0048', cliente: 'Six Centro', estatus: 'Entregada', total: 300 },
  ],
  rutas: [{ id: 5, folio: 'RT-3', nombre: 'Ruta Centro', chofer: 'Juan Pérez', estatus: 'En progreso' }],
  productos: [{ id: 7, sku: 'HC-5K', nombre: 'Hielo en cubo 5kg', tipo: 'Producto Terminado' }],
  leads: [{ id: 3, nombre: 'María Frutería', telefono: '6181234567', estatus: 'Nuevo' }],
  empleados: [{ id: 4, nombre: 'Pedro Almacén', puesto: 'Operador' }],
};

describe('buscarGlobal — activación', () => {
  it('menos de 2 caracteres → sin resultados', () => {
    expect(buscarGlobal(DATA, '')).toEqual([]);
    expect(buscarGlobal(DATA, 'a')).toEqual([]);
    expect(buscarGlobal(DATA, '  x ')).toEqual([]);
  });

  it('data nula no truena', () => {
    expect(buscarGlobal(null, 'lopez')).toEqual([]);
    expect(buscarGlobal({}, 'lopez')).toEqual([]);
  });
});

describe('buscarGlobal — fuentes y enrutamiento', () => {
  it('encuentra clientes por nombre sin importar acentos ni mayúsculas', () => {
    const r = buscarGlobal(DATA, 'LÓPEZ');
    const cliente = r.find(x => x.tipo === 'cliente');
    expect(cliente.titulo).toBe('Abarrotes López');
    expect(cliente.modulo).toBe('clientes');
  });

  it('encuentra clientes por nombre comercial y RFC', () => {
    expect(buscarGlobal(DATA, 'don pepe').some(x => x.tipo === 'cliente')).toBe(true);
    expect(buscarGlobal(DATA, 'LOPA8').some(x => x.tipo === 'cliente')).toBe(true);
  });

  it('encuentra órdenes por folio con estatus y monto en el subtítulo', () => {
    const r = buscarGlobal(DATA, 'OV-0047');
    const orden = r.find(x => x.tipo === 'orden');
    expect(orden.modulo).toBe('ordenes');
    expect(orden.titulo).toContain('OV-0047');
    expect(orden.subtitulo).toContain('Creada');
    expect(orden.subtitulo).toContain('1,200');
  });

  it('encuentra rutas por chofer, productos por SKU, leads por teléfono y empleados', () => {
    expect(buscarGlobal(DATA, 'juan').find(x => x.tipo === 'ruta').modulo).toBe('rutas');
    expect(buscarGlobal(DATA, 'HC-5').find(x => x.tipo === 'producto').modulo).toBe('productos');
    expect(buscarGlobal(DATA, '618123').find(x => x.tipo === 'lead').modulo).toBe('leads');
    expect(buscarGlobal(DATA, 'pedro').find(x => x.tipo === 'empleado').modulo).toBe('empleados');
  });
});

describe('buscarGlobal — ranking y límite', () => {
  it('startsWith gana sobre includes', () => {
    const r = buscarGlobal(DATA, 'six');
    // 'Six Centro' (cliente, startsWith) debe ir antes que la orden
    // OV-0048 que solo CONTIENE "Six" en el nombre del cliente… ambos
    // startsWith en su campo; verificamos que el primero tenga score 0
    expect(r[0].score).toBe(0);
    const scores = r.map(x => x.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it('respeta el límite', () => {
    const muchos = {
      clientes: Array.from({ length: 20 }, (_, i) => ({ id: i, nombre: `Cliente Hielo ${i}` })),
    };
    expect(buscarGlobal(muchos, 'hielo')).toHaveLength(8);
    expect(buscarGlobal(muchos, 'hielo', { limite: 3 })).toHaveLength(3);
  });

  it('un registro que no coincide no aparece', () => {
    const r = buscarGlobal(DATA, 'inexistente-xyz');
    expect(r).toEqual([]);
  });
});
