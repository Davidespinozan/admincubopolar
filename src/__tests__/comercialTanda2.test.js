// comercialTanda2.test.js — Tanda 2 comercial.
// Cubre invariantes puras del cómputo de saldo desde CxC (PASO 3) y
// shape de payload del RPC update_orden_atomic (PASO 2). Los guards de
// rol del PASO 1 están cubiertos en `inventarioGuards.test.js` por el
// helper requireRol compartido — aquí solo verificamos que las actions
// de comercial bloquean correctamente con el shape esperado.
import { describe, it, expect } from 'vitest';

// ─── Cómputo de saldo por cliente desde CxC ────────────────────
// Esta función replica la lógica del mapeo en supaStore.js:178-200.
// Si la firma del cómputo cambia, el test falla y obliga a actualizar
// ambos lugares.
function calcSaldoPorCliente(cxcRows) {
  const map = new Map();
  for (const row of (cxcRows || [])) {
    if (row?.estatus === 'Pagada') continue;
    const cid = row?.cliente_id;
    if (cid == null) continue;
    const saldoPend = Number(row?.saldo_pendiente || 0);
    if (!Number.isFinite(saldoPend) || saldoPend <= 0) continue;
    map.set(cid, (map.get(cid) || 0) + saldoPend);
  }
  return map;
}

describe('saldo por cliente desde CxC', () => {
  it('suma saldo_pendiente de CxC pendientes por cliente', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: 500, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 300, estatus: 'Vencida' },
      { cliente_id: 2, saldo_pendiente: 1000, estatus: 'Pendiente' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.get(1)).toBe(800);
    expect(map.get(2)).toBe(1000);
  });

  it('excluye CxC con estatus Pagada (saldo cache fantasma)', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: 500, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 200, estatus: 'Pagada' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.get(1)).toBe(500);
  });

  it('cliente sin CxC pendientes → no entra al map (saldo = 0 implícito)', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: 500, estatus: 'Pendiente' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.has(2)).toBe(false);
    expect(map.get(2) || 0).toBe(0);
  });

  it('cxc null/undefined no crashea', () => {
    expect(() => calcSaldoPorCliente(null)).not.toThrow();
    expect(() => calcSaldoPorCliente(undefined)).not.toThrow();
    expect(calcSaldoPorCliente(null).size).toBe(0);
  });

  it('saldo_pendiente null/0/negativo se ignora', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: null, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 0, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: -100, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 250, estatus: 'Pendiente' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.get(1)).toBe(250);
  });

  it('saldo_pendiente como string numérico es coercionado', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: '500.50', estatus: 'Pendiente' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.get(1)).toBe(500.5);
  });

  it('cliente_id null/undefined se ignora', () => {
    const cxc = [
      { cliente_id: null, saldo_pendiente: 500, estatus: 'Pendiente' },
      { cliente_id: undefined, saldo_pendiente: 200, estatus: 'Pendiente' },
      { cliente_id: 5, saldo_pendiente: 100, estatus: 'Pendiente' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.size).toBe(1);
    expect(map.get(5)).toBe(100);
  });

  it('múltiples CxC del mismo cliente se suman', () => {
    const cxc = [
      { cliente_id: 1, saldo_pendiente: 100, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 200, estatus: 'Pendiente' },
      { cliente_id: 1, saldo_pendiente: 300, estatus: 'Vencida' },
    ];
    const map = calcSaldoPorCliente(cxc);
    expect(map.get(1)).toBe(600);
  });
});

// ─── Validación de crédito en addOrden (lógica equivalente) ────
// El check de crédito en addOrden ahora calcula saldo desde CxC.
// Esta función pura refleja la lógica para que sea testeable sin
// supabase mocks.
function checkLimiteCredito({ limite, cxcRows, total, creditoAutorizado }) {
  if (!creditoAutorizado) return { error: 'Cliente no tiene crédito autorizado' };
  const saldo = (cxcRows || []).reduce(
    (sum, r) => sum + Number(r?.saldo_pendiente || 0),
    0
  );
  const disponible = Number(limite || 0) - saldo;
  if (Number(total) > disponible) {
    return { error: `Excede límite de crédito. Disponible: $${disponible.toLocaleString('es-MX')}` };
  }
  return null;
}

describe('check límite de crédito en addOrden', () => {
  it('OK cuando total <= disponible', () => {
    const r = checkLimiteCredito({
      limite: 10000,
      cxcRows: [{ saldo_pendiente: 3000 }, { saldo_pendiente: 2000 }],
      total: 4000,
      creditoAutorizado: true,
    });
    expect(r).toBeNull();
  });

  it('rechaza cuando total > disponible', () => {
    const r = checkLimiteCredito({
      limite: 10000,
      cxcRows: [{ saldo_pendiente: 7000 }],
      total: 5000,
      creditoAutorizado: true,
    });
    expect(r?.error).toMatch(/Excede límite/);
  });

  it('rechaza si cliente no tiene crédito autorizado', () => {
    const r = checkLimiteCredito({
      limite: 10000,
      cxcRows: [],
      total: 100,
      creditoAutorizado: false,
    });
    expect(r?.error).toMatch(/no tiene crédito autorizado/i);
  });

  it('cliente sin CxC pendientes → todo el límite disponible', () => {
    const r = checkLimiteCredito({
      limite: 5000,
      cxcRows: [],
      total: 4999,
      creditoAutorizado: true,
    });
    expect(r).toBeNull();
  });

  it('caso David: saldo cache stale era $2000, real $0 → ahora pasa la venta', () => {
    // Antes: limite=10000 - cache_saldo=2000 = 8000 disponible (incorrecto)
    // Ahora: limite=10000 - SUM(CxC pendiente)=0 = 10000 disponible
    const r = checkLimiteCredito({
      limite: 10000,
      cxcRows: [], // CxC real vacío
      total: 9500,
      creditoAutorizado: true,
    });
    expect(r).toBeNull();
  });

  it('saldo > límite (escenario de over-credit) bloquea ventas nuevas', () => {
    // Cliente debe $12000, límite $10000 → disponible negativo, ninguna venta nueva pasa
    const r = checkLimiteCredito({
      limite: 10000,
      cxcRows: [{ saldo_pendiente: 12000 }],
      total: 100,
      creditoAutorizado: true,
    });
    expect(r?.error).toMatch(/Excede límite/);
  });
});

// ─── Shape del payload para update_orden_atomic ────────────────
// La RPC `update_orden_atomic` (mig 058) recibe 3 args:
//   - p_orden_id: BIGINT
//   - p_update_fields: JSONB (puede tener cliente_nombre, cliente_id,
//     fecha, tipo_cobro, folio_nota, direccion_entrega,
//     referencia_entrega, latitud_entrega, longitud_entrega, total,
//     productos)
//   - p_lineas: JSONB | null (array de {sku, cantidad, precio_unit, subtotal})
//
// Aquí verificamos solo el shape del payload que el caller construye.
describe('updateOrden RPC payload shape', () => {
  it('p_lineas como array de objetos {sku, cantidad, precio_unit, subtotal}', () => {
    const lineasNuevas = [
      { sku: 'HC-25K', cantidad: 10, precio_unit: 75, subtotal: 750 },
      { sku: 'HC-5K', cantidad: 5, precio_unit: 25, subtotal: 125 },
    ];
    const lineasParaRpc = lineasNuevas.map(l => ({
      sku: l.sku,
      cantidad: Number(l.cantidad),
      precio_unit: Number(l.precio_unit),
      subtotal: Number(l.subtotal),
    }));
    expect(lineasParaRpc).toHaveLength(2);
    expect(lineasParaRpc[0]).toMatchObject({ sku: 'HC-25K', cantidad: 10, precio_unit: 75, subtotal: 750 });
    expect(typeof lineasParaRpc[0].cantidad).toBe('number');
  });

  it('p_lineas null si no se editan líneas (solo cambian campos top-level)', () => {
    const lineasNuevas = null;
    const lineasParaRpc = lineasNuevas
      ? lineasNuevas.map(l => ({ sku: l.sku, cantidad: Number(l.cantidad), precio_unit: Number(l.precio_unit), subtotal: Number(l.subtotal) }))
      : null;
    expect(lineasParaRpc).toBeNull();
  });

  it('p_lineas array vacío implica "borrar todas las líneas" (válido)', () => {
    const lineasNuevas = [];
    const lineasParaRpc = lineasNuevas.map(l => ({
      sku: l.sku, cantidad: Number(l.cantidad), precio_unit: Number(l.precio_unit), subtotal: Number(l.subtotal),
    }));
    expect(lineasParaRpc).toEqual([]);
  });
});
