import { describe, it, expect } from 'vitest';
import { resolverBarra, resumenBarra, faltaPreparado, productosParaVenta, esSkuBarra } from '../data/barraVentaLogic';

describe('barraVentaLogic: la barra se vende entera o media y se entrega sin preparar, picada o triturada', () => {
  it('traduce la elección al SKU y las bolsas de la orden', () => {
    expect(resolverBarra({ medida: 'entera', entrega: 'sin', cant: 3 })).toEqual({ sku: 'HIB-50K', qty: 3, bloqueo: null });
    expect(resolverBarra({ medida: 'entera', entrega: 'picada', cant: 2 })).toEqual({ sku: 'HIP-25K', qty: 4, bloqueo: null });
    expect(resolverBarra({ medida: 'entera', entrega: 'triturada', cant: 1 })).toEqual({ sku: 'HIT-25K', qty: 2, bloqueo: null });
    expect(resolverBarra({ medida: 'media', entrega: 'picada', cant: 1 })).toEqual({ sku: 'HIP-25K', qty: 1, bloqueo: null });
    expect(resolverBarra({ medida: 'media', entrega: 'triturada', cant: 3 })).toEqual({ sku: 'HIT-25K', qty: 3, bloqueo: null });
  });
  it('la media barra sin preparar aún no existe y se bloquea', () => {
    const r = resolverBarra({ medida: 'media', entrega: 'sin', cant: 1 });
    expect(r.sku).toBeNull();
    expect(r.bloqueo).toMatch(/sin preparar/);
  });
  it('cantidad inválida cuenta como 1; elección incompleta se bloquea', () => {
    expect(resolverBarra({ medida: 'entera', entrega: 'sin', cant: 0 }).qty).toBe(1);
    expect(resolverBarra({ medida: 'entera', entrega: 'sin', cant: 'x' }).qty).toBe(1);
    expect(resolverBarra({}).bloqueo).toBeTruthy();
  });
  it('una barra entera picada cuesta lo mismo que la barra: 2 bolsas de $60 = $120', () => {
    expect(resolverBarra({ medida: 'entera', entrega: 'picada', cant: 1 }).qty * 60).toBe(120);
  });
  it('resumen legible', () => {
    expect(resumenBarra({ medida: 'entera', entrega: 'picada', cant: 1 })).toBe('2 bolsas de picada (1 barra)');
    expect(resumenBarra({ medida: 'media', entrega: 'triturada', cant: 1 })).toBe('1 bolsa de triturada (media barra)');
    expect(resumenBarra({ medida: 'entera', entrega: 'sin', cant: 2 })).toBe('2 barras enteras');
    expect(resumenBarra({ medida: 'media', entrega: 'sin', cant: 1 })).toBe('');
  });
  it('si falta preparado avisa y manda a Producción; la barra sin preparar no avisa', () => {
    const stock = sku => ({ 'HIP-25K': 1, 'HIT-25K': 5 })[sku] || 0;
    expect(faltaPreparado({ sku: 'HIP-25K', qty: 2 }, stock)).toMatch(/Producción/);
    expect(faltaPreparado({ sku: 'HIT-25K', qty: 2 }, stock)).toBeNull();
    expect(faltaPreparado({ sku: 'HIB-50K', qty: 9 }, stock)).toBeNull();
  });
  it('el selector no ofrece picada ni triturada como productos sueltos', () => {
    const ps = [{ sku: 'HIB-50K' }, { sku: 'HIP-25K' }, { sku: 'HIT-25K' }, { sku: 'HPC-5K' }];
    expect(productosParaVenta(ps).map(p => p.sku)).toEqual(['HIB-50K', 'HPC-5K']);
    expect(esSkuBarra('HIP-25K') && esSkuBarra('HIB-50K') && !esSkuBarra('HPC-5K')).toBe(true);
  });
});
