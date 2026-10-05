// produccionResumen.test.js — B3.2: resumen propio de cada módulo del rol
// Producción, derivado SOLO de los datos ya cargados (sin consultas nuevas).
// Las reglas son las que ya usa la vista: "hoy" = fecha.slice(0,10) === día de
// negocio; merma vigente = mermasActivas; tarimas = utils/tarimas.
import { describe, it, expect } from 'vitest';
import { esDelDia, resumenCongeladores, resumenMermas, resumenTransformacion } from '../data/produccionResumenLogic';
import { mermasActivas } from '../data/mermasLogic';
import { tarimasOcupadasEnCuarto } from '../utils/tarimas';
import { n, s } from '../utils/safe';

const HOY = '2026-10-05';
const productos = [
  { sku: 'HPC-5K', tipo: 'Producto Terminado', tarima_size: 100 },
  { sku: 'HPC-25K', tipo: 'Producto Terminado', tarima_size: 20 },
  { sku: 'HIT-25K', tipo: 'Producto Terminado' },            // sin tarima_size: no ocupa tarimas (regla existente)
];
const cuartos = [
  { id: 'CF-1', nombre: 'Cuarto Frío 1', temp: -18, capacidad_tarimas: 20, stock: { 'HPC-5K': 990 } },          // 9.9 tarimas
  { id: 'CF-2', nombre: 'Cuarto Frío 2', temp: -20, capacidad_tarimas: 12, stock: { 'HPC-25K': 100, 'HIT-25K': 90 } }, // 5 tarimas
  { id: 'CF-3', nombre: 'Cuarto Frío 3', temp: -20, capacidad_tarimas: 0, stock: { 'HPC-5K': 10 } },           // sin capacidad configurada
];

describe('esDelDia: misma regla que prodHoy / mermasHoyList', () => {
  it('acepta DATE y timestamps ISO del mismo día; rechaza otro día, vacío o sin hoy', () => {
    expect(esDelDia('2026-10-05', HOY)).toBe(true);
    expect(esDelDia('2026-10-05T23:59:00+00:00', HOY)).toBe(true);
    expect(esDelDia('2026-10-04', HOY)).toBe(false);
    expect(esDelDia('', HOY)).toBe(false);
    expect(esDelDia(null, HOY)).toBe(false);
    expect(esDelDia('2026-10-05', '')).toBe(false);
  });
});

describe('resumenCongeladores: existencia, tarimas ocupadas/libres y cuartos sin capacidad', () => {
  it('suma bolsas de todos los cuartos y tarimas solo de los cuartos con capacidad (como la barra de cada tarjeta)', () => {
    const r = resumenCongeladores(cuartos, productos);
    expect(r.existencia).toBe(990 + 100 + 90 + 10);
    expect(r.congeladores).toBe(3);
    expect(r.conCapacidad).toBe(2);
    expect(r.sinCapacidad).toEqual(['Cuarto Frío 3']);
    expect(r.tarimasOcupadas).toBeCloseTo(9.9 + 5, 6);
    expect(r.tarimasOcupadas).toBeCloseTo(tarimasOcupadasEnCuarto(cuartos[0], productos) + tarimasOcupadasEnCuarto(cuartos[1], productos), 6);
    expect(r.tarimasCapacidad).toBe(32);
    expect(r.tarimasLibres).toBeCloseTo(32 - 14.9, 6);
    expect(r.pct).toBe(Math.round((14.9 / 32) * 100));
    expect(r.color).toBe('emerald');
    expect(r.porCuarto.map(c => c.id)).toEqual(['CF-1', 'CF-2', 'CF-3']);
    expect(r.porCuarto[2]).toMatchObject({ bolsas: 10, ocupadas: 0, capacidad: 0, color: 'slate' });
  });
  it('sin capacidad configurada en ningún cuarto: tarimas "—" (pct y libres null), existencia sigue', () => {
    const r = resumenCongeladores([{ id: 'CF-1', nombre: 'Cuarto Frío 1', stock: { 'HPC-5K': 5 } }], productos);
    expect(r.existencia).toBe(5);
    expect(r.tarimasCapacidad).toBe(0);
    expect(r.pct).toBeNull();
    expect(r.tarimasLibres).toBeNull();
    expect(r.sinCapacidad).toEqual(['Cuarto Frío 1']);
  });
  it('libres nunca negativas (sobreocupación) y tolera stock no-objeto o lista vacía', () => {
    const r = resumenCongeladores([{ id: 'CF-1', nombre: 'A', capacidad_tarimas: 5, stock: { 'HPC-5K': 1000 } }], productos);
    expect(r.tarimasOcupadas).toBe(10);
    expect(r.tarimasLibres).toBe(0);
    expect(r.color).toBe('red');
    expect(resumenCongeladores([{ id: 'X', stock: null }], productos)).toMatchObject({ existencia: 0, congeladores: 1, sinCapacidad: ['X'] });
    expect(resumenCongeladores(undefined, productos)).toMatchObject({ existencia: 0, congeladores: 0, conCapacidad: 0, pct: null, tarimasLibres: null, porCuarto: [] });
  });
});

describe('resumenMermas: solo mermas vigentes de hoy; última = id mayor', () => {
  const mermas = [
    { id: 31, fecha: HOY, sku: 'HPC-5K', cantidad: '12', causa: 'Bolsa rota', origen: 'Cuarto Frío 1', estatus: 'Activa' },
    { id: 29, fecha: HOY, sku: 'HPC-25K', cantidad: 3, causa: 'Mal sellado', origen: 'Cuarto Frío 2' },               // sin estatus = activa (caché previa a 072)
    { id: 33, fecha: HOY, sku: 'HPC-5K', cantidad: 50, causa: 'Otro', origen: 'Cuarto Frío 1', estatus: 'Revertida' }, // revertida: fuera
    { id: 40, fecha: '2026-10-04', sku: 'HPC-5K', cantidad: 8, causa: 'Bolsa rota', origen: 'Cuarto Frío 1', estatus: 'Activa' }, // ayer: fuera
  ];
  it('bolsas y registros de hoy coinciden con la fórmula de la vista (mermasActivas + fecha de hoy)', () => {
    const r = resumenMermas(mermas, HOY);
    const esperado = mermasActivas(mermas).filter(m => s(m.fecha).slice(0, 10) === HOY);
    expect(r.registrosHoy).toBe(esperado.length);
    expect(r.registrosHoy).toBe(2);
    expect(r.mermaHoy).toBe(esperado.reduce((t, m) => t + n(m.cantidad), 0));
    expect(r.mermaHoy).toBe(15);
    expect(r.ultima).toEqual({ id: 31, sku: 'HPC-5K', cantidad: 12, causa: 'Bolsa rota', origen: 'Cuarto Frío 1' });
  });
  it('sin mermas hoy: ceros y última null; entrada inválida tolerada', () => {
    expect(resumenMermas(mermas, '2026-10-06')).toEqual({ mermaHoy: 0, registrosHoy: 0, ultima: null });
    expect(resumenMermas(undefined, HOY)).toEqual({ mermaHoy: 0, registrosHoy: 0, ultima: null });
    expect(resumenMermas([{ id: 1, fecha: HOY, sku: 'X', cantidad: 2 }], HOY).ultima).toEqual({ id: 1, sku: 'X', cantidad: 2, causa: '', origen: '' });
  });
});

describe('resumenTransformacion: filas tipo Transformacion; hoy en kg guardados; última del historial', () => {
  const produccion = [
    { id: 90, fecha: HOY, tipo: 'Produccion', sku: 'HPC-5K', cantidad: 500 },                                                       // producción: fuera
    { id: 91, fecha: HOY, tipo: 'Transformacion', folio: 'TR-011', sku: 'HT-TRITURADO', input_sku: 'BH-50K', input_kg: '100', output_kg: 85, merma_kg: 15, rendimiento: 85 },
    { id: 88, fecha: HOY, tipo: 'Transformacion', folio: 'TR-010', sku: 'HT-TRITURADO', input_sku: 'BH-50K', input_kg: 50.5, output_kg: 40, merma_kg: 10.5, rendimiento: 79.21 },
    { id: 70, fecha: '2026-10-01', tipo: 'Transformacion', folio: 'TR-009', sku: 'HT-TRITURADO', input_sku: 'BH-50K', input_kg: 200, output_kg: 150 },
  ];
  it('cuenta y suma solo las de hoy; historial completo; última por id mayor', () => {
    const r = resumenTransformacion(produccion, HOY);
    expect(r.transformacionesHoy).toBe(2);
    expect(r.entradaKg).toBeCloseTo(150.5, 6);
    expect(r.salidaKg).toBe(125);
    expect(r.historial).toBe(3);
    expect(r.ultima).toEqual({ id: 91, folio: 'TR-011', fecha: HOY, inputKg: 100, inputSku: 'BH-50K', outputKg: 85, outputSku: 'HT-TRITURADO' });
    expect(r).not.toHaveProperty('rendimiento');   // sin rendimiento ni merma agregados: no se inventan
  });
  it('sin transformaciones hoy: ceros pero la última del historial sigue; sin filas: null', () => {
    const r = resumenTransformacion(produccion, '2026-10-06');
    expect(r).toMatchObject({ transformacionesHoy: 0, entradaKg: 0, salidaKg: 0, historial: 3 });
    expect(r.ultima.folio).toBe('TR-011');
    expect(resumenTransformacion([], HOY)).toEqual({ transformacionesHoy: 0, entradaKg: 0, salidaKg: 0, historial: 0, ultima: null });
    expect(resumenTransformacion(null, HOY).ultima).toBeNull();
    expect(resumenTransformacion([{ id: 5, tipo: 'Transformacion', fecha: HOY, input_kg: 1, output_kg: 1 }], HOY).ultima.folio).toBe('5');
  });
});
