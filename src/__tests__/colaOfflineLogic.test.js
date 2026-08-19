// colaOfflineLogic.test.js — cola offline del chofer (Tanda 22).
import { describe, it, expect } from 'vitest';
import {
  TIPOS_MUTACION,
  MAX_INTENTOS,
  claveColaRuta,
  descripcionMutacion,
  encolar,
  marcarIntento,
  mutacionesFallidas,
  mutacionesPendientes,
  ordenesBloqueadas,
  parseCola,
  quitar,
  siguientePendiente,
} from '../data/colaOfflineLogic';

const T = 1750000000000; // timestamp fijo para determinismo

describe('encolar', () => {
  it('agrega al final con intentos=0 y payload intacto', () => {
    const cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 7, metodoPago: 'Efectivo' }, T);
    expect(cola).toHaveLength(1);
    expect(cola[0].tipo).toBe('entrega');
    expect(cola[0].intentos).toBe(0);
    expect(cola[0].creadaEn).toBe(T);
    expect(cola[0].payload).toEqual({ ordenId: 7, metodoPago: 'Efectivo' });
  });

  it('mantiene orden FIFO y genera ids únicos aunque sea el mismo ms', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    cola = encolar(cola, TIPOS_MUTACION.MERMA, { sku: 'HC-5K', cant: 2 }, T);
    cola = encolar(cola, TIPOS_MUTACION.NO_ENTREGA, { ordenId: 2 }, T);
    expect(cola.map(m => m.tipo)).toEqual(['entrega', 'merma', 'no_entrega']);
    expect(new Set(cola.map(m => m.id)).size).toBe(3);
  });

  it('ids únicos incluso tras quitar elementos (la secuencia no se recicla)', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    cola = encolar(cola, TIPOS_MUTACION.ENTREGA, { ordenId: 2 }, T);
    const idSegundo = cola[1].id;
    cola = quitar(cola, cola[0].id);
    cola = encolar(cola, TIPOS_MUTACION.ENTREGA, { ordenId: 3 }, T);
    expect(cola.map(m => m.id)).not.toContain(undefined);
    expect(new Set(cola.map(m => m.id)).size).toBe(2);
    expect(cola[0].id).toBe(idSegundo);
  });

  it('no muta la cola original', () => {
    const original = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    const copia = [...original];
    encolar(original, TIPOS_MUTACION.MERMA, { sku: 'X', cant: 1 }, T);
    expect(original).toEqual(copia);
  });

  it('rechaza tipos desconocidos', () => {
    expect(() => encolar([], 'venta_express', {}, T)).toThrow(/desconocido/);
  });

  it('tolera cola null/undefined como cola vacía', () => {
    expect(encolar(null, TIPOS_MUTACION.MERMA, { sku: 'X', cant: 1 }, T)).toHaveLength(1);
  });
});

describe('quitar / marcarIntento', () => {
  it('quitar elimina solo la mutación indicada', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    cola = encolar(cola, TIPOS_MUTACION.ENTREGA, { ordenId: 2 }, T);
    const result = quitar(cola, cola[0].id);
    expect(result).toHaveLength(1);
    expect(result[0].payload.ordenId).toBe(2);
  });

  it('marcarIntento incrementa solo la indicada', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    cola = encolar(cola, TIPOS_MUTACION.ENTREGA, { ordenId: 2 }, T);
    const result = marcarIntento(cola, cola[0].id);
    expect(result[0].intentos).toBe(1);
    expect(result[1].intentos).toBe(0);
  });
});

describe('pendientes / fallidas / siguientePendiente', () => {
  it('una mutación pasa a fallida al llegar a MAX_INTENTOS', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    for (let i = 0; i < MAX_INTENTOS; i++) cola = marcarIntento(cola, cola[0].id);
    expect(mutacionesPendientes(cola)).toHaveLength(0);
    expect(mutacionesFallidas(cola)).toHaveLength(1);
  });

  it('siguientePendiente salta las fallidas y respeta FIFO', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T);
    cola = encolar(cola, TIPOS_MUTACION.ENTREGA, { ordenId: 2 }, T);
    for (let i = 0; i < MAX_INTENTOS; i++) cola = marcarIntento(cola, cola[0].id);
    expect(siguientePendiente(cola).payload.ordenId).toBe(2);
  });

  it('siguientePendiente devuelve null con cola vacía o toda fallida', () => {
    expect(siguientePendiente([])).toBeNull();
    let cola = encolar([], TIPOS_MUTACION.MERMA, { sku: 'X', cant: 1 }, T);
    for (let i = 0; i < MAX_INTENTOS; i++) cola = marcarIntento(cola, cola[0].id);
    expect(siguientePendiente(cola)).toBeNull();
  });
});

describe('parseCola', () => {
  it('round-trip: serializar y parsear conserva la cola', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1, metodoPago: 'Crédito' }, T);
    cola = encolar(cola, TIPOS_MUTACION.MERMA, { sku: 'HC-25K', cant: 3, causa: 'Bolsa rota' }, T);
    expect(parseCola(JSON.stringify(cola))).toEqual(cola);
  });

  it('JSON corrupto → [] (no truena la vista del chofer)', () => {
    expect(parseCola('{{{basura')).toEqual([]);
    expect(parseCola(null)).toEqual([]);
    expect(parseCola('')).toEqual([]);
    expect(parseCola('"un string"')).toEqual([]);
  });

  it('descarta entradas malformadas y conserva las válidas', () => {
    const valida = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1 }, T)[0];
    const json = JSON.stringify([
      valida,
      null,
      { id: 'x' }, // sin tipo ni payload
      { id: 'y', tipo: 'tipo_inventado', payload: {} },
      { tipo: 'entrega', payload: {} }, // sin id
    ]);
    expect(parseCola(json)).toEqual([valida]);
  });
});

describe('ordenesBloqueadas', () => {
  it('incluye ordenIds de entregas y no-entregas, excluye mermas', () => {
    let cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 10 }, T);
    cola = encolar(cola, TIPOS_MUTACION.NO_ENTREGA, { ordenId: 20 }, T);
    cola = encolar(cola, TIPOS_MUTACION.MERMA, { sku: 'X', cant: 1 }, T);
    const ids = ordenesBloqueadas(cola);
    expect(ids.has('10')).toBe(true);
    expect(ids.has('20')).toBe(true);
    expect(ids.size).toBe(2);
  });

  it('normaliza a string (ordenId numérico vs string)', () => {
    const cola = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 10 }, T);
    expect(ordenesBloqueadas(cola).has(String(10))).toBe(true);
  });

  it('cola vacía o null → set vacío', () => {
    expect(ordenesBloqueadas([]).size).toBe(0);
    expect(ordenesBloqueadas(null).size).toBe(0);
  });
});

describe('descripcionMutacion / claveColaRuta', () => {
  it('describe cada tipo en lenguaje de operador', () => {
    const [e] = encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 5, metodoPago: 'Efectivo' }, T);
    const [ne] = encolar([], TIPOS_MUTACION.NO_ENTREGA, { ordenId: 6 }, T);
    const [m] = encolar([], TIPOS_MUTACION.MERMA, { sku: 'HC-5K', cant: 2 }, T);
    expect(descripcionMutacion(e)).toBe('Entrega orden #5 (Efectivo)');
    expect(descripcionMutacion(ne)).toBe('No entregada orden #6');
    expect(descripcionMutacion(m)).toBe('Merma 2× HC-5K');
    expect(descripcionMutacion(null)).toBe('');
  });

  it('la clave de localStorage es por ruta', () => {
    expect(claveColaRuta(42)).toBe('cola_offline_ruta_42');
    expect(claveColaRuta(42)).not.toBe(claveColaRuta(43));
  });
});
