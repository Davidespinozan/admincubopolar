// devoluciones.test.js
// Tests para validateDevolucion + calcDevolucionChanges + calcAjustePago +
// calcTotalDevolucion. Lógica pura sin Supabase.
import { describe, it, expect } from 'vitest';
import {
  validateDevolucion,
  calcDevolucionChanges,
  calcAjustePago,
  calcTotalDevolucion,
  TIPOS_REEMBOLSO,
  ESTATUS_DEVOLVIBLES,
} from '../data/devolucionesLogic';

const lineasOriginales = [
  { sku: 'HC-25K', cantidad: 10, precio_unitario: 50 },
  { sku: 'HC-5K',  cantidad: 20, precio_unitario: 12 },
];

const baseOk = {
  orden: { estatus: 'Entregada', metodo_pago: 'Efectivo', total: 740, tiene_devolucion: false, folio: 'OV-100' },
  items: [{ sku: 'HC-25K', cantidad: 2 }],
  lineasOriginales,
  motivo: 'Hielo derretido',
  tipoReembolso: 'Efectivo',
  cuartoDestino: 'CF-1',
};

// ─── validateDevolucion ────────────────────────────────────────
describe('validateDevolucion', () => {
  it('null cuando todo es válido (Entregada, items, motivo, tipo, cuarto)', () => {
    expect(validateDevolucion(baseOk)).toBeNull();
  });

  it('null también para Facturada', () => {
    const out = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: 'Facturada' } });
    expect(out).toBeNull();
  });

  it('error si estatus es Creada', () => {
    const r = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: 'Creada' } });
    expect(r?.error).toMatch(/Entregadas o Facturadas/);
  });

  it('error si estatus es Asignada', () => {
    const r = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: 'Asignada' } });
    expect(r?.error).toMatch(/Entregadas o Facturadas/);
  });

  it('error si estatus es Cancelada', () => {
    const r = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, estatus: 'Cancelada' } });
    expect(r?.error).toMatch(/Entregadas o Facturadas/);
  });

  it('error si la orden ya tiene devolucion (snake)', () => {
    const r = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, tiene_devolucion: true } });
    expect(r?.error).toMatch(/ya tiene una devolución/i);
  });

  it('error si la orden ya tiene devolucion (camel)', () => {
    const r = validateDevolucion({ ...baseOk, orden: { ...baseOk.orden, tieneDevolucion: true } });
    expect(r?.error).toMatch(/ya tiene una devolución/i);
  });

  it('error si items vacío', () => {
    const r = validateDevolucion({ ...baseOk, items: [] });
    expect(r?.error).toMatch(/al menos un producto/i);
  });

  it('error si items no es array', () => {
    const r = validateDevolucion({ ...baseOk, items: null });
    expect(r?.error).toMatch(/al menos un producto/i);
  });

  it('error si motivo vacío', () => {
    const r = validateDevolucion({ ...baseOk, motivo: '' });
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si motivo es solo whitespace', () => {
    const r = validateDevolucion({ ...baseOk, motivo: '   \n\t' });
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si tipoReembolso no está en la lista', () => {
    const r = validateDevolucion({ ...baseOk, tipoReembolso: 'PayPal' });
    expect(r?.error).toMatch(/tipo de reembolso/i);
  });

  it('error si cuartoDestino vacío', () => {
    const r = validateDevolucion({ ...baseOk, cuartoDestino: '' });
    expect(r?.error).toMatch(/cuarto frío/i);
  });

  it('error si cantidad excede lo originalmente entregado', () => {
    const r = validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-25K', cantidad: 15 }], // original = 10
    });
    expect(r?.error).toMatch(/HC-25K.*máximo 10/);
  });

  it('error si SKU del item no estaba en la orden', () => {
    const r = validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-FAKE', cantidad: 1 }],
    });
    expect(r?.error).toMatch(/HC-FAKE.*no estaba/);
  });

  it('error si item sin SKU', () => {
    const r = validateDevolucion({
      ...baseOk,
      items: [{ cantidad: 1 }],
    });
    expect(r?.error).toMatch(/sin SKU/i);
  });

  it('error si item con cantidad 0', () => {
    const r = validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-25K', cantidad: 0 }],
    });
    expect(r?.error).toMatch(/cantidad inválida/i);
  });

  it('error si item con cantidad negativa', () => {
    const r = validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-25K', cantidad: -3 }],
    });
    expect(r?.error).toMatch(/cantidad inválida/i);
  });

  it('acepta devolución parcial (cantidad < original)', () => {
    expect(validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-25K', cantidad: 1 }, { sku: 'HC-5K', cantidad: 5 }],
    })).toBeNull();
  });

  it('acepta devolución completa (cantidad === original)', () => {
    expect(validateDevolucion({
      ...baseOk,
      items: [{ sku: 'HC-25K', cantidad: 10 }],
    })).toBeNull();
  });
});

// ─── calcDevolucionChanges ─────────────────────────────────────
describe('calcDevolucionChanges', () => {
  it('genera change por cada item con delta POSITIVO', () => {
    const items = [{ sku: 'HC-25K', cantidad: 5 }, { sku: 'HC-5K', cantidad: 3 }];
    const { changes } = calcDevolucionChanges(items, 'CF-1', 'Admin', 'OV-100');
    expect(changes).toHaveLength(2);
    for (const c of changes) expect(c.delta).toBeGreaterThan(0);
  });

  it('shape correcto del change', () => {
    const items = [{ sku: 'HC-25K', cantidad: 5 }];
    const { changes } = calcDevolucionChanges(items, 'CF-2', 'David', 'OV-200');
    expect(changes[0]).toEqual({
      cuarto_id: 'CF-2',
      sku: 'HC-25K',
      delta: 5,
      tipo: 'Devolución cliente',
      origen: 'Devolución OV-200',
      usuario: 'David',
    });
  });

  it('ignora items con cantidad <= 0', () => {
    const items = [
      { sku: 'A', cantidad: 0 },
      { sku: 'B', cantidad: -2 },
      { sku: 'C', cantidad: 3 },
    ];
    const { changes } = calcDevolucionChanges(items, 'CF-1', 'Admin', 'OV');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('C');
  });

  it('ignora items sin SKU', () => {
    const items = [{ cantidad: 5 }, { sku: 'A', cantidad: 3 }];
    const { changes } = calcDevolucionChanges(items, 'CF-1', 'Admin', 'OV');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('A');
  });

  it('cuartoDestino vacío → 0 changes', () => {
    const items = [{ sku: 'A', cantidad: 5 }];
    expect(calcDevolucionChanges(items, '', 'Admin', 'OV').changes).toEqual([]);
    expect(calcDevolucionChanges(items, null, 'Admin', 'OV').changes).toEqual([]);
  });

  it('items null/undefined → 0 changes', () => {
    expect(calcDevolucionChanges(null, 'CF-1', 'Admin', 'OV').changes).toEqual([]);
    expect(calcDevolucionChanges(undefined, 'CF-1', 'Admin', 'OV').changes).toEqual([]);
  });

  it('default usuario "Admin" si no se pasa', () => {
    const { changes } = calcDevolucionChanges([{ sku: 'A', cantidad: 1 }], 'CF-1', null, 'OV');
    expect(changes[0].usuario).toBe('Admin');
  });

  it('default origen "Devolución orden" si no se pasa ref', () => {
    const { changes } = calcDevolucionChanges([{ sku: 'A', cantidad: 1 }], 'CF-1', 'Admin', null);
    expect(changes[0].origen).toBe('Devolución orden');
  });
});

// ─── calcAjustePago ────────────────────────────────────────────
describe('calcAjustePago', () => {
  describe('Reposicion', () => {
    it('no toca finanzas', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Efectivo', folio: 'OV' },
        totalDevuelto: 500,
        tipoReembolso: 'Reposicion',
      });
      expect(r.accion).toBe('ninguna');
      expect(r.ajustaCxC).toBe(false);
      expect(r.requiereNotaCredito).toBe(false);
    });

    it('reposicion ignora método de pago original', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Crédito', folio: 'OV' },
        totalDevuelto: 500,
        tipoReembolso: 'Reposicion',
      });
      expect(r.accion).toBe('ninguna');
      expect(r.ajustaCxC).toBe(false);
    });
  });

  describe('Efectivo (contado)', () => {
    it('genera egreso, no toca CxC', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Efectivo', folio: 'OV-100' },
        totalDevuelto: 250,
        tipoReembolso: 'Efectivo',
      });
      expect(r.accion).toBe('egreso');
      expect(r.ajustaCxC).toBe(false);
      expect(r.monto).toBe(250);
      expect(r.conceptoEgreso).toMatch(/OV-100/);
      expect(r.requiereNotaCredito).toBe(false);
    });

    it('Transferencia se trata como contado (no crédito)', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Transferencia', folio: 'OV' },
        totalDevuelto: 100,
        tipoReembolso: 'Efectivo',
      });
      expect(r.ajustaCxC).toBe(false);
    });
  });

  describe('Efectivo sobre venta a crédito', () => {
    it('genera egreso Y reduce CxC (Crédito)', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Crédito', folio: 'OV' },
        totalDevuelto: 200,
        tipoReembolso: 'Efectivo',
      });
      expect(r.accion).toBe('egreso');
      expect(r.ajustaCxC).toBe(true);
    });

    it('detecta "credito" sin acento', () => {
      const r = calcAjustePago({
        orden: { metodo_pago: 'credito', folio: 'OV' },
        totalDevuelto: 200,
        tipoReembolso: 'Efectivo',
      });
      expect(r.ajustaCxC).toBe(true);
    });

    it('detecta "fiado"', () => {
      const r = calcAjustePago({
        orden: { metodo_pago: 'fiado', folio: 'OV' },
        totalDevuelto: 200,
        tipoReembolso: 'Efectivo',
      });
      expect(r.ajustaCxC).toBe(true);
    });
  });

  describe('Nota credito', () => {
    it('marca requiere_nota_credito si la orden estaba Facturada', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Facturada', metodo_pago: 'Efectivo', folio: 'OV' },
        totalDevuelto: 500,
        tipoReembolso: 'Nota credito',
      });
      expect(r.accion).toBe('nota_credito');
      expect(r.requiereNotaCredito).toBe(true);
      expect(r.ajustaCxC).toBe(false);
    });

    it('NO marca requiere_nota_credito si solo estaba Entregada', () => {
      const r = calcAjustePago({
        orden: { estatus: 'Entregada', metodo_pago: 'Efectivo', folio: 'OV' },
        totalDevuelto: 500,
        tipoReembolso: 'Nota credito',
      });
      expect(r.accion).toBe('nota_credito');
      expect(r.requiereNotaCredito).toBe(false);
    });
  });

  describe('shape común', () => {
    it('monto se redondea con centavos()', () => {
      const r = calcAjustePago({
        orden: { metodo_pago: 'Efectivo' },
        totalDevuelto: 100.339999,
        tipoReembolso: 'Efectivo',
      });
      expect(r.monto).toBe(100.34);
    });
  });
});

// ─── calcTotalDevolucion ───────────────────────────────────────
describe('calcTotalDevolucion', () => {
  it('suma cantidad × precio_unitario por item', () => {
    const items = [{ sku: 'HC-25K', cantidad: 2 }];
    const total = calcTotalDevolucion(items, lineasOriginales);
    expect(total).toBe(100); // 2 × 50
  });

  it('suma múltiples items', () => {
    const items = [
      { sku: 'HC-25K', cantidad: 2 }, // 100
      { sku: 'HC-5K',  cantidad: 5 }, // 60
    ];
    expect(calcTotalDevolucion(items, lineasOriginales)).toBe(160);
  });

  it('preferenicia precio_unitario del item si viene', () => {
    const items = [{ sku: 'HC-25K', cantidad: 1, precio_unitario: 60 }];
    expect(calcTotalDevolucion(items, lineasOriginales)).toBe(60);
  });

  it('items con cantidad <= 0 no suman', () => {
    const items = [
      { sku: 'HC-25K', cantidad: 0 },
      { sku: 'HC-5K', cantidad: -2 },
      { sku: 'HC-25K', cantidad: 1 }, // suma
    ];
    expect(calcTotalDevolucion(items, lineasOriginales)).toBe(50);
  });

  it('items vacíos → 0', () => {
    expect(calcTotalDevolucion([], lineasOriginales)).toBe(0);
  });

  it('items null/undefined → 0', () => {
    expect(calcTotalDevolucion(null, lineasOriginales)).toBe(0);
    expect(calcTotalDevolucion(undefined, lineasOriginales)).toBe(0);
  });
});

// ─── Constantes ────────────────────────────────────────────────
describe('constantes exportadas', () => {
  it('TIPOS_REEMBOLSO contiene los 3 tipos', () => {
    expect(TIPOS_REEMBOLSO).toEqual(['Efectivo', 'Nota credito', 'Reposicion']);
  });

  it('ESTATUS_DEVOLVIBLES son Entregada y Facturada', () => {
    expect(ESTATUS_DEVOLVIBLES).toEqual(['Entregada', 'Facturada']);
  });
});
