// devoluciones.test.js — 104: devolución de cliente por contrato.
// La lógica del cliente solo valida la captura (UX), muestra la vista previa y
// arma los parámetros (SKU + cantidad). Todo lo autoritativo vive en
// registrar_devolucion (suite SQL 104).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  validateDevolucion, calcTotalDevolucion, buildRegistrarDevolucionArgs, claveDevolucion, esVentaCredito, mensajeErrorDevolucion,
  TIPOS_REEMBOLSO, ESTATUS_DEVOLVIBLES, DISPOSICIONES,
} from '../data/devolucionesLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const lineasOriginales = [
  { sku: 'A', cantidad: 10, precio_unitario: 20 },
  { sku: 'B', cantidad: 5, precio_unitario: 30 },
];
const baseOk = {
  orden: { estatus: 'Entregada', metodo_pago: 'Efectivo', tipo_cobro: 'Contado', tiene_devolucion: false },
  items: [{ sku: 'A', cantidad: 3 }, { sku: 'B', cantidad: 1 }],
  lineasOriginales, motivo: 'Hielo derretido', tipoReembolso: 'Efectivo', disposicion: 'Reintegrar', cuartoDestino: 'CF-1',
};

describe('validateDevolucion (UX)', () => {
  it('devolución parcial válida', () => { expect(validateDevolucion(baseOk)).toBeNull(); });
  it('solo Entregada/Facturada y una por orden', () => {
    expect(validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: 'Facturada' } })).toBeNull();
    for (const est of ['Creada', 'Asignada', 'Cancelada']) expect(validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: est } }).error).toMatch(/Entregadas o Facturadas/);
    expect(validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, tiene_devolucion: true } }).error).toMatch(/ya tiene/);
  });
  it('partidas: cantidad entera ≤ entregado, SKU de la orden, sin repetir', () => {
    expect(validateDevolucion({ ...baseOk, items: [{ sku: 'A', cantidad: 11 }] }).error).toMatch(/máximo 10/);
    expect(validateDevolucion({ ...baseOk, items: [{ sku: 'C', cantidad: 1 }] }).error).toMatch(/no estaba/);
    expect(validateDevolucion({ ...baseOk, items: [{ sku: 'A', cantidad: 1.5 }] }).error).toMatch(/inválida/);
    expect(validateDevolucion({ ...baseOk, items: [{ sku: 'A', cantidad: 1 }, { sku: 'A', cantidad: 1 }] }).error).toMatch(/repetido/);
  });
  it('reposición bloqueada; nota de crédito solo a crédito', () => {
    expect(validateDevolucion({ ...baseOk, tipoReembolso: 'Reposicion' }).error).toMatch(/reposición/i);
    expect(validateDevolucion({ ...baseOk, tipoReembolso: 'Nota credito' }).error).toMatch(/solo en ventas a crédito/);
    expect(validateDevolucion({ ...baseOk, tipoReembolso: 'Nota credito', orden: { ...baseOk.orden, tipo_cobro: 'Credito', metodo_pago: 'Crédito' } })).toBeNull();
  });
  it('merma no requiere cuarto; reintegrar sí', () => {
    expect(validateDevolucion({ ...baseOk, disposicion: 'Merma', cuartoDestino: '' })).toBeNull();
    expect(validateDevolucion({ ...baseOk, cuartoDestino: '' }).error).toMatch(/cuarto/);
  });
});

describe('vista previa y parámetros', () => {
  it('vista previa 3×20 + 1×30 = 90 (el servidor recalcula)', () => {
    expect(calcTotalDevolucion(baseOk.items, lineasOriginales)).toBe(90);
  });
  it('solo SKU y cantidad viajan al contrato (sin precio, total, cliente ni montos)', () => {
    const r = buildRegistrarDevolucionArgs({ operacionId: 'u', ordenId: 7, items: [{ sku: 'A', cantidad: 3, precio_unitario: 999, subtotal: 5000 }],
      tipoReembolso: 'Efectivo', disposicion: 'Reintegrar', cuartoDestino: 'CF-1', motivo: ' mal sabor ' });
    expect(r.args).toEqual({ p_operacion_id: 'u', p_orden_id: 7, p_items: [{ sku: 'A', cantidad: 3 }], p_tipo_reembolso: 'Efectivo',
      p_disposicion: 'Reintegrar', p_cuarto_id: 'CF-1', p_motivo: 'mal sabor', p_notas: null });
    expect(buildRegistrarDevolucionArgs({ operacionId: 'u', ordenId: 7, items: [{ sku: 'A', cantidad: 3 }], disposicion: 'Merma', cuartoDestino: 'CF-1' }).args.p_cuarto_id).toBeNull();
    expect(buildRegistrarDevolucionArgs({ ordenId: 7, items: [{ sku: 'A', cantidad: 3 }] }).error).toBeTruthy();
  });
  it('mismo intento → misma clave (orden de partidas indiferente)', () => {
    const a = { ordenId: 7, items: [{ sku: 'B', cantidad: 1 }, { sku: 'A', cantidad: 3 }], tipoReembolso: 'Efectivo', disposicion: 'Reintegrar', cuartoDestino: 'CF-1', motivo: 'x' };
    expect(claveDevolucion(a)).toBe(claveDevolucion({ ...a, items: [{ sku: 'A', cantidad: 3 }, { sku: 'B', cantidad: 1 }] }));
    expect(claveDevolucion(a)).not.toBe(claveDevolucion({ ...a, disposicion: 'Merma' }));
  });
  it('constantes y detección de crédito', () => {
    expect(TIPOS_REEMBOLSO).toEqual(['Efectivo', 'Nota credito']);
    expect(ESTATUS_DEVOLVIBLES).toEqual(['Entregada', 'Facturada']);
    expect(DISPOSICIONES.map(d => d.value)).toEqual(['Reintegrar', 'Merma']);
    expect(esVentaCredito({ tipo_cobro: 'Credito' })).toBe(true);
    expect(esVentaCredito({ metodoPago: 'Efectivo', tipoCobro: 'Contado' })).toBe(false);
    expect(mensajeErrorDevolucion({ message: 'La orden OV-1 ya tiene una devolución registrada (una por orden)' })).toMatch(/una por orden/);
  });
});

describe('104: el frontend usa el contrato', () => {
  it('modal sin Reposición, con disposición y UUID por intento', () => {
    const m = src('../components/DevolucionModal.jsx');
    expect(m).toMatch(/resolverOperacion\(opRef\.current, claveDevolucion\(datos\)\)/);
    expect(m).toMatch(/DISPOSICIONES\.map/);
    expect(m).not.toMatch(/'Reposicion'/);
    expect(m).not.toMatch(/precio_unitario: l\.precio_unitario \}\)/);
  });
  it('la vista muestra la nota fiscal pendiente', () => {
    expect(src('../components/views/DevolucionesView.jsx')).toMatch(/NOTA DE CRÉDITO FISCAL PENDIENTE/);
  });
});
