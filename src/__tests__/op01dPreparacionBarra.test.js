// op01dPreparacionBarra.test.js — OP-01D: modelo de barra de septiembre 2026.
// Pruebas puras (vista previa, bloqueos, argumentos, reversibilidad) y de
// fuente (migración solo de funciones, Máquina Barra, guard de empaque,
// Transformaciones fuera de la operación). El contrato real contra Postgres
// (casos 1–13, concurrencia) corre en el runner local (suite 115).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  BARRA_SKU, SALIDAS_BARRA, BOLSAS_POR_BARRA, MAQUINAS_PRODUCCION, seProduceSinEmpaque, esSoloPreparacion, skusProducibles,
  vistaPreviaPreparacion, clavePreparacion, buildPreparacionArgs, reversibilidadPreparacion, mensajeErrorPreparacion,
} from '../data/preparacionBarraLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '');

const productos = [
  { sku: 'HIB-50K', nombre: 'Barra de hielo ~50 kg', tipo: 'Producto Terminado', empaque_sku: null },
  { sku: 'HIP-25K', nombre: 'Picada de barra (bolsa)', tipo: 'Producto Terminado', empaque_sku: 'EMP-X' },
  { sku: 'HIT-25K', nombre: 'Triturada de barra (bolsa)', tipo: 'Producto Terminado', empaque_sku: null },
  { sku: 'HPC-5K', nombre: 'Purificado Cubos 5 kg', tipo: 'Producto Terminado', empaque_sku: 'EMP-5' },
  { sku: 'EMP-X', nombre: 'Bolsa X', tipo: 'Empaque', stock: 10 },
];
const cuartos = [{ id: 'CF-1', nombre: 'Cuarto 1', stock: { 'HIB-50K': 5 } }];
const vp = (o) => vistaPreviaPreparacion({ productos, cuartos, cuartoId: 'CF-1', salidaSku: 'HIP-25K', ...o });

describe('OP-01D modelo: 1 barra física = 1 unidad; preparar = 2 bolsas por barra', () => {
  it('constantes del modelo', () => {
    expect(BARRA_SKU).toBe('HIB-50K');
    expect(SALIDAS_BARRA).toEqual(['HIP-25K', 'HIT-25K']);
    expect(BOLSAS_POR_BARRA).toBe(2);
    expect(MAQUINAS_PRODUCCION).toEqual(['Máquina 30', 'Máquina 20', 'Máquina 15', 'Máquina Barra']);
  });
  it('solo la barra se produce sin empaque; las bolsas de barra solo nacen de preparar', () => {
    expect(seProduceSinEmpaque('HIB-50K')).toBe(true);
    expect(seProduceSinEmpaque('HPC-5K')).toBe(false);
    expect(seProduceSinEmpaque('HIP-25K')).toBe(false);
    expect(esSoloPreparacion('HIP-25K') && esSoloPreparacion('HIT-25K')).toBe(true);
    expect(skusProducibles(productos).map(p => p.sku)).toEqual(['HIB-50K', 'HPC-5K']);
  });
});

describe('OP-01D vista previa antes de confirmar', () => {
  it('"3 barras → 6 bolsas de Picada" y el empaque CONFIGURADO en la salida (no uno fijo)', () => {
    const v = vp({ barras: 3 });
    expect(v.resumen).toBe('3 barras → 6 bolsas de Picada de barra (bolsa)');
    expect(v.consumo).toBe('Se consumirán 6 empaques EMP-X');
    expect(v.bloqueo).toBeNull();
    expect(vp({ barras: 1 }).resumen).toBe('1 barra → 2 bolsas de Picada de barra (bolsa)');
    const otro = productos.map(p => (p.sku === 'HIP-25K' ? { ...p, empaque_sku: 'EMP-Y' } : p)).concat([{ sku: 'EMP-Y', tipo: 'Empaque', stock: 99 }]);
    expect(vistaPreviaPreparacion({ productos: otro, cuartos, cuartoId: 'CF-1', salidaSku: 'HIP-25K', barras: 2 }).consumo).toBe('Se consumirán 4 empaques EMP-Y');
  });
  it('bloqueos: sin empaque configurado, empaque insuficiente, barras insuficientes, cantidad no entera', () => {
    expect(vp({ salidaSku: 'HIT-25K', barras: 1 }).bloqueo.codigo).toBe('sin_empaque');
    expect(vp({ salidaSku: 'HIT-25K', barras: 1 }).bloqueo.mensaje).toMatch(/no tiene empaque configurado/);
    expect(vp({ barras: 6 }).bloqueo.codigo).toBe('empaque_insuficiente');      // 12 > 10
    const pocas = [{ id: 'CF-1', stock: { 'HIB-50K': 2 } }];
    expect(vistaPreviaPreparacion({ productos, cuartos: pocas, cuartoId: 'CF-1', salidaSku: 'HIP-25K', barras: 3 }).bloqueo.codigo).toBe('barras_insuficientes');
    for (const b of [0, -1, 1.5, '', 'x']) expect(vp({ barras: b }).bloqueo.codigo, String(b)).toBe('barras');
    expect(vp({ salidaSku: 'HPC-5K', barras: 1 }).bloqueo.codigo).toBe('salida');
  });
});

describe('OP-01D petición al servidor', () => {
  it('argumentos exactos; barras enteras ≥ 1; salida permitida', () => {
    expect(buildPreparacionArgs({ operacionId: 'u1', cuartoId: 'CF-1', salidaSku: 'HIT-25K', barras: 3 })).toEqual({
      args: { p_operacion_id: 'u1', p_barra_sku: 'HIB-50K', p_salida_sku: 'HIT-25K', p_cuarto_id: 'CF-1', p_barras: 3 },
    });
    expect(buildPreparacionArgs({ operacionId: 'u1', cuartoId: 'CF-1', salidaSku: 'HIT-25K', barras: 0.5 }).error).toMatch(/barra entera/);
    expect(buildPreparacionArgs({ operacionId: 'u1', cuartoId: 'CF-1', salidaSku: 'HPC-5K', barras: 1 }).error).toBeTruthy();
    expect(buildPreparacionArgs({ cuartoId: 'CF-1', salidaSku: 'HIP-25K', barras: 1 }).error).toBeTruthy();
    expect(clavePreparacion({ cuartoId: 'CF-1', salidaSku: 'HIP-25K', barras: 3 })).toBe(clavePreparacion({ cuartoId: 'CF-1', salidaSku: 'HIP-25K', barras: '3' }));
  });
  it('reversibilidad y mensajes al empleado', () => {
    expect(reversibilidadPreparacion({ tipo: 'Preparacion', estatus: 'Confirmada' }).reversible).toBe(true);
    expect(reversibilidadPreparacion({ tipo: 'Preparacion', estatus: 'Revertida' }).reversible).toBe(false);
    expect(reversibilidadPreparacion({ tipo: 'Produccion', estatus: 'Confirmada' }).reversible).toBe(false);
    expect(mensajeErrorPreparacion({ message: 'Stock insuficiente para HIB-50K en cuarto CF-1' })).toMatch(/barras/);
    expect(mensajeErrorPreparacion({ message: 'Stock insuficiente de EMP-25: disponible=1' })).toMatch(/empaque/);
    expect(mensajeErrorPreparacion({ message: 'registrar_preparacion_barra: HIT-25K no tiene empaque configurado' })).toMatch(/empaque configurado/);
  });
});

describe('OP-01D fuente', () => {
  const m = sinComentarios(src('../../supabase/115_preparacion_barra.sql'));
  it('migración 115: solo funciones (sin tablas, columnas ni restricciones)', () => {
    expect(m).not.toMatch(/CREATE\s+TABLE|ALTER\s+TABLE|ADD\s+COLUMN|ADD\s+CONSTRAINT|DROP\s+TABLE|CREATE\s+(UNIQUE\s+)?INDEX/i);
    expect((m.match(/CREATE OR REPLACE FUNCTION/g) || []).length).toBe(4);
    // OP-01D.1: la producción normal rechaza las bolsas que solo nacen de preparar.
    expect(m).toMatch(/IF v_sku IN \('HIP-25K', 'HIT-25K'\) THEN\s+RAISE EXCEPTION 'registrar_produccion: % solo se obtiene con Preparar desde barra'/);
    expect(m).toMatch(/v_barra <> 'HIB-50K'/);
    expect(m).toMatch(/v_salida NOT IN \('HIP-25K', 'HIT-25K'\)/);
    expect(m).not.toMatch(/EMP-25|EMP-5/);                                   // el empaque sale de la configuración
    expect(m).toMatch(/v_bolsas := p_barras \* 2;/);
    expect(m).toMatch(/pr\.tipo IN \('Produccion', 'Preparacion'\)/);         // conciliación de empaque
    expect(m).not.toMatch(/registrar_transformacion/);                        // no reutiliza el flujo de agosto
  });
  it('Máquina Barra en ambas listas; producción sin empaque solo para la barra; Transformaciones fuera de la operación', () => {
    const planta = src('../components/ProduccionStandaloneView.jsx');
    const admin = src('../components/views/ProduccionView.jsx');
    expect(planta).toMatch(/MAQUINAS_PRODUCCION\.map\(m => \(/);
    expect(admin).toMatch(/<FormSelect label="Máquina" options=\{MAQUINAS_PRODUCCION\}/);
    expect(planta).toMatch(/if \(!bolsaSku && !seProduceSinEmpaque\(form\.sku\)\) \{/);
    expect(planta).toMatch(/skusProducibles\(data\.productos\)/);
    expect(planta).not.toMatch(/addTransformacion|transForm|tab === "trans"/);
    expect(admin).not.toMatch(/addTransformacion|\btForm\b|saveTransformacion|setTModal/);
    expect(src('../data/navRolLogic.js')).toMatch(/alias: \{ "prod-trans": "prod-preparar" \}/);
  });
  it('el store llama a los contratos nuevos', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/supabase\.rpc\('registrar_preparacion_barra', built\.args\)/);
    expect(store).toMatch(/supabase\.rpc\('revertir_preparacion_barra', \{/);
  });
});
