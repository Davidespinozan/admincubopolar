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
  it('la media barra sin preparar es HIB-25K cuando el catálogo ya la tiene; si no, se bloquea', () => {
    expect(resolverBarra({ medida: 'media', entrega: 'sin', cant: 2 })).toEqual({ sku: 'HIB-25K', qty: 2, bloqueo: null });
    const r = resolverBarra({ medida: 'media', entrega: 'sin', cant: 1 }, { hayMedia: false });
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
    expect(resumenBarra({ medida: 'media', entrega: 'sin', cant: 1 })).toBe('1 media barra sin preparar');
  });
  it('si falta preparado avisa y manda a Producción; la barra sin preparar no avisa', () => {
    const stock = sku => ({ 'HIP-25K': 1, 'HIT-25K': 5 })[sku] || 0;
    expect(faltaPreparado({ sku: 'HIP-25K', qty: 2 }, stock)).toMatch(/Producción/);
    expect(faltaPreparado({ sku: 'HIT-25K', qty: 2 }, stock)).toBeNull();
    expect(faltaPreparado({ sku: 'HIB-50K', qty: 9 }, stock)).toBeNull();
    expect(faltaPreparado({ sku: 'HIB-25K', qty: 1 }, stock)).toMatch(/parta una barra/);
  });
  it('el selector no ofrece picada ni triturada como productos sueltos', () => {
    const ps = [{ sku: 'HIB-50K' }, { sku: 'HIB-25K' }, { sku: 'HIP-25K' }, { sku: 'HIT-25K' }, { sku: 'HPC-5K' }];
    expect(productosParaVenta(ps).map(p => p.sku)).toEqual(['HIB-50K', 'HPC-5K']);
    expect(esSkuBarra('HIP-25K') && esSkuBarra('HIB-50K') && !esSkuBarra('HPC-5K')).toBe(true);
  });
});

import { planDesglose, vistaPreviaDesglose, buildPartirArgs, buildPreparacionMediaArgs, esFilaDerivada, barrasUsadasFila, textoFilaDerivada, skusProducibles } from '../data/preparacionBarraLogic';

describe('129: desglose de barra (Producción decide qué queda de cada mitad)', () => {
  const productos = [
    { sku: 'HIB-50K', tipo: 'Producto Terminado' }, { sku: 'HIB-25K', tipo: 'Producto Terminado' },
    { sku: 'HIP-25K', tipo: 'Producto Terminado', empaqueSku: 'EMP-25-SL' }, { sku: 'HIT-25K', tipo: 'Producto Terminado', empaqueSku: 'EMP-25-SL' },
    { sku: 'EMP-25-SL', tipo: 'Empaque', stock: 5 },
  ];
  const cuartos = [{ id: 'CF-1', stock: { 'HIB-50K': 3 } }];
  it('cuenta medias, picada y triturada por mitad', () => {
    expect(planDesglose({ barras: 2, mitadA: 'media', mitadB: 'triturada' })).toMatchObject({ valido: true, medias: 4, quedanMedias: 2, triturada: 2, picada: 0 });
    expect(planDesglose({ barras: 1, mitadA: 'picada', mitadB: 'triturada' })).toMatchObject({ picada: 1, triturada: 1, quedanMedias: 0 });
    expect(planDesglose({ barras: 1, mitadA: 'picada', mitadB: 'picada' })).toMatchObject({ picada: 2 });
    expect(planDesglose({ barras: 0, mitadA: 'media', mitadB: 'media' }).valido).toBe(false);
    expect(planDesglose({ barras: 1, mitadA: 'x', mitadB: 'media' }).valido).toBe(false);
  });
  it('vista previa: resumen, consumo de empaque y bloqueos', () => {
    const ok = vistaPreviaDesglose({ productos, cuartos, cuartoId: 'CF-1', barras: 1, mitadA: 'media', mitadB: 'triturada' });
    expect(ok.bloqueo).toBeNull();
    expect(ok.resumen).toBe('1 barra → 1 media barra + 1 bolsa de triturada');
    expect(ok.consumo).toBe('Se consumirán 1 EMP-25-SL');
    expect(vistaPreviaDesglose({ productos, cuartos, cuartoId: 'CF-1', barras: 4, mitadA: 'media', mitadB: 'media' }).bloqueo.codigo).toBe('barras_insuficientes');
    expect(vistaPreviaDesglose({ productos, cuartos, cuartoId: 'CF-1', barras: 3, mitadA: 'picada', mitadB: 'triturada' }).bloqueo.codigo).toBe('empaque_insuficiente');
    expect(vistaPreviaDesglose({ productos: productos.filter(p => p.sku !== 'HIB-25K'), cuartos, cuartoId: 'CF-1', barras: 1, mitadA: 'media', mitadB: 'media' }).bloqueo.codigo).toBe('sin_media');
    expect(vistaPreviaDesglose({ productos, cuartos, cuartoId: 'CF-9', barras: 1, mitadA: 'media', mitadB: 'media' }).bloqueo.codigo).toBe('cuarto');
  });
  it('argumentos de los contratos', () => {
    expect(buildPartirArgs({ operacionId: 'u', cuartoId: 'CF-1', barras: 2 }).args).toEqual({ p_operacion_id: 'u', p_cuarto_id: 'CF-1', p_barras: 2 });
    expect(buildPartirArgs({ operacionId: 'u', cuartoId: 'CF-1', barras: 0 }).error).toBeTruthy();
    expect(buildPreparacionMediaArgs({ operacionId: 'u', cuartoId: 'CF-1', salidaSku: 'HIT-25K', medias: 1 }).args).toEqual({ p_operacion_id: 'u', p_salida_sku: 'HIT-25K', p_cuarto_id: 'CF-1', p_medias: 1 });
    expect(buildPreparacionMediaArgs({ operacionId: 'u', cuartoId: 'CF-1', salidaSku: 'HIB-50K', medias: 1 }).error).toBeTruthy();
  });
  it('las filas Partido y Preparacion no cuentan como producción de máquina; solo la barra entera cuenta como barras usadas', () => {
    const partido = { tipo: 'Partido', input_sku: 'HIB-50K', input_kg: 2, sku: 'HIB-25K', cantidad: 4 };
    const prepMedia = { tipo: 'Preparacion', input_sku: 'HIB-25K', input_kg: 1, sku: 'HIT-25K', cantidad: 1 };
    const prepBarra = { tipo: 'Preparacion', input_sku: 'HIB-50K', input_kg: 3, sku: 'HIP-25K', cantidad: 6 };
    expect([partido, prepMedia, prepBarra].every(esFilaDerivada)).toBe(true);
    expect(esFilaDerivada({ tipo: 'Produccion' })).toBe(false);
    expect([partido, prepMedia, prepBarra].map(barrasUsadasFila)).toEqual([2, 0, 3]);
    expect(textoFilaDerivada(partido)).toBe('2 barras → 4 × HIB-25K (partida)');
    expect(textoFilaDerivada(prepMedia)).toBe('1 media barra → 1 × HIT-25K');
  });
  it('la media barra no se ofrece para producir por máquina', () => {
    expect(skusProducibles(productos).map(p => p.sku)).toEqual(['HIB-50K']);
  });
});
