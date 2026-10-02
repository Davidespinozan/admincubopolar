// cuartosInventario.test.js — 102/103: inventario de cuartos por contrato.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildAjusteCuartoArgs, buildMermaCuartoArgs, motivoSalidaManual, claveAjusteCuarto, claveMermaCuarto, MOTIVOS_SALIDA_MANUAL, mensajeErrorStock } from '../data/stockContratosLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('ajuste por conteo físico de un cuarto', () => {
  it('manda la existencia contada (absoluta), sin tipo/referencia/origen', () => {
    const r = buildAjusteCuartoArgs({ operacionId: 'u', cuartoId: 'CF-1', sku: 'X', existencia: '93', motivo: 'Conteo físico semanal' });
    expect(r.args).toEqual({ p_operacion_id: 'u', p_cuarto_id: 'CF-1', p_sku: 'X', p_existencia: 93, p_motivo: 'Conteo físico semanal' });
  });
  it('valida entero ≥ 0, motivo y operación', () => {
    expect(buildAjusteCuartoArgs({ operacionId: 'u', cuartoId: 'CF-1', sku: 'X', existencia: -1, motivo: 'Conteo físico' }).error).toBeTruthy();
    expect(buildAjusteCuartoArgs({ operacionId: 'u', cuartoId: 'CF-1', sku: 'X', existencia: 2.5, motivo: 'Conteo físico' }).error).toBeTruthy();
    expect(buildAjusteCuartoArgs({ operacionId: 'u', cuartoId: 'CF-1', sku: 'X', existencia: 0, motivo: 'ok' }).error).toBeTruthy();
    expect(buildAjusteCuartoArgs({ cuartoId: 'CF-1', sku: 'X', existencia: 0, motivo: 'Conteo físico' }).error).toBeTruthy();
    expect(buildAjusteCuartoArgs({ operacionId: 'u', cuartoId: 'CF-1', sku: 'X', existencia: 0, motivo: 'Conteo físico' }).args.p_existencia).toBe(0);
  });
  it('mismo conteo → misma clave (mismo UUID en reintentos)', () => {
    expect(claveAjusteCuarto({ cuartoId: 'CF-1', sku: 'X', existencia: '93', motivo: ' Conteo ' })).toBe(claveAjusteCuarto({ cuartoId: 'CF-1', sku: 'X', existencia: 93, motivo: 'Conteo' }));
  });
});

describe('merma física en el cuarto elegido', () => {
  it('el cuarto es obligatorio y viaja al contrato', () => {
    expect(buildMermaCuartoArgs({ operacionId: 'u', sku: 'X', cantidad: 10 }).error).toMatch(/cuarto/i);
    const r = buildMermaCuartoArgs({ operacionId: 'u', cuartoId: 'CF-2', sku: 'X', cantidad: '10', causa: 'Bolsa rota', foto: 'a/b.jpg' });
    expect(r.args).toEqual({ p_operacion_id: 'u', p_cuarto_id: 'CF-2', p_sku: 'X', p_cantidad: 10, p_causa: 'Bolsa rota', p_foto: 'a/b.jpg' });
    expect(buildMermaCuartoArgs({ operacionId: 'u', cuartoId: 'CF-2', sku: 'X', cantidad: 1.5 }).error).toBeTruthy();
  });
  it('la clave incluye cuarto y foto', () => {
    expect(claveMermaCuarto({ cuartoId: 'CF-2', sku: 'X', cantidad: 10, causa: 'c', foto: 'f' })).not.toBe(claveMermaCuarto({ cuartoId: 'CF-1', sku: 'X', cantidad: 10, causa: 'c', foto: 'f' }));
  });
});

describe('salida manual: motivos cerrados (103)', () => {
  it('sin "Ajuste físico"; "Otro" exige detalle', () => {
    expect(MOTIVOS_SALIDA_MANUAL).toEqual(['Venta directa', 'Consumo interno', 'Otro']);
    expect(motivoSalidaManual('Venta directa')).toEqual({ motivo: 'Venta directa' });
    expect(motivoSalidaManual('Otro', 'abc').error).toBeTruthy();
    expect(motivoSalidaManual('Otro', 'muestra para cliente')).toEqual({ motivo: 'Otro: muestra para cliente' });
    expect(motivoSalidaManual('Ajuste físico').error).toBeTruthy();
    expect(motivoSalidaManual('Merma').error).toBeTruthy();
  });
  it('mensajes del servidor en español', () => {
    expect(mensajeErrorStock({ message: 'salida_cuarto_manual: motivo no permitido (Venta directa…)' })).toMatch(/Motivo no permitido/);
    expect(mensajeErrorStock({ message: 'El motivo del ajuste es obligatorio (mínimo 5 caracteres)' })).toMatch(/motivo del ajuste/i);
  });
});

describe('102: callers', () => {
  const store = src('../data/supaStore.js');
  const inv = src('../components/views/InventarioView.jsx');
  const prod = src('../components/ProduccionStandaloneView.jsx');
  it('el store ajusta y registra mermas de cuarto por contrato, sin REST de existencia ni kardex', () => {
    expect(store).toMatch(/rpc\('ajustar_existencia_cuarto', built\.args\)/);
    expect(store).toMatch(/rpc\('registrar_merma_cuarto', built\.args\)/);
    expect(store).not.toMatch(/ajustarStockCuarto/);
    expect(store).not.toMatch(/from\('inventario_mov'\)\s*\.insert\(/);
    expect(store).not.toMatch(/from\('cuartos_frios'\)\s*\.update\(\{\s*stock/);
  });
  it('Inventario: un ajuste por SKU con su UUID; Producción: merma con el congelador elegido', () => {
    expect(inv).toMatch(/actions\.ajustarExistenciaCuarto\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(prod).toMatch(/cuartoId: s\(mForm\.congelador\)/);
    expect(prod).toMatch(/cuartoId: s\(form\.destino\)/);
    expect(prod).not.toMatch(/actions\.registrarMerma\(/);
  });
});
