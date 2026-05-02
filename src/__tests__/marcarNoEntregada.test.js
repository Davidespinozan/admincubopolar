// marcarNoEntregada.test.js
// Tests para validateMarcarNoEntregada + buildNoEntregaPayload +
// calcReversoChangesNoEntrega + transiciones FSM hacia/desde 'No entregada'.
import { describe, it, expect } from 'vitest';
import {
  validateMarcarNoEntregada,
  buildNoEntregaPayload,
  calcReversoChangesNoEntrega,
  validateTransicionOrden,
  TRANSICIONES_ORDEN,
  MOTIVOS_NO_ENTREGA,
} from '../data/ordenLogic';

// ─── validateMarcarNoEntregada ──────────────────────────────────
describe('validateMarcarNoEntregada', () => {
  it('null cuando estatus = Asignada y motivo no vacío', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Asignada' }, 'Local cerrado');
    expect(r).toBeNull();
  });

  it('null cuando estatus = En ruta y motivo no vacío', () => {
    const r = validateMarcarNoEntregada({ estatus: 'En ruta' }, 'Cliente ausente');
    expect(r).toBeNull();
  });

  it('error si motivo está vacío', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Asignada' }, '');
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si motivo es solo whitespace', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Asignada' }, '   \n\t  ');
    expect(r?.error).toMatch(/motivo/i);
  });

  it('error si estatus es Creada (no salió a ruta)', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Creada' }, 'Local cerrado');
    expect(r?.error).toMatch(/Creada/);
  });

  it('error si estatus es Entregada (ya se cerró)', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Entregada' }, 'Local cerrado');
    expect(r?.error).toMatch(/Entregada/);
  });

  it('error si estatus es Facturada (terminal)', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Facturada' }, 'Local cerrado');
    expect(r?.error).toMatch(/Facturada/);
  });

  it('error si estatus es Cancelada', () => {
    const r = validateMarcarNoEntregada({ estatus: 'Cancelada' }, 'Local cerrado');
    expect(r?.error).toMatch(/Cancelada/);
  });

  it('error si orden es null/undefined', () => {
    const r1 = validateMarcarNoEntregada(null, 'Local cerrado');
    expect(r1?.error).toMatch(/sin estatus/i);
    const r2 = validateMarcarNoEntregada(undefined, 'Local cerrado');
    expect(r2?.error).toMatch(/sin estatus/i);
  });

  it('error si orden tiene estatus vacío', () => {
    const r = validateMarcarNoEntregada({ estatus: '' }, 'Local cerrado');
    expect(r?.error).toMatch(/sin estatus/i);
  });
});

// ─── buildNoEntregaPayload ──────────────────────────────────────
describe('buildNoEntregaPayload', () => {
  const fixedNow = new Date('2026-05-15T18:30:00Z');

  it('shape correcto con reagendar=true', () => {
    const p = buildNoEntregaPayload('Cliente ausente', true, fixedNow);
    expect(p).toEqual({
      estatus: 'No entregada',
      motivo_no_entrega: 'Cliente ausente',
      fecha_no_entrega: '2026-05-15T18:30:00.000Z',
      reagendada: true,
    });
  });

  it('shape correcto con reagendar=false', () => {
    const p = buildNoEntregaPayload('Cliente rechazó pedido', false, fixedNow);
    expect(p.reagendada).toBe(false);
    expect(p.estatus).toBe('No entregada');
  });

  it('reagendar truthy/falsy se normaliza a boolean', () => {
    expect(buildNoEntregaPayload('m', 1, fixedNow).reagendada).toBe(true);
    expect(buildNoEntregaPayload('m', 0, fixedNow).reagendada).toBe(false);
    expect(buildNoEntregaPayload('m', 'sí', fixedNow).reagendada).toBe(true);
    expect(buildNoEntregaPayload('m', '', fixedNow).reagendada).toBe(false);
    expect(buildNoEntregaPayload('m', null, fixedNow).reagendada).toBe(false);
    expect(buildNoEntregaPayload('m', undefined, fixedNow).reagendada).toBe(false);
  });

  it('motivo se trimea', () => {
    const p = buildNoEntregaPayload('   Local cerrado   ', false, fixedNow);
    expect(p.motivo_no_entrega).toBe('Local cerrado');
  });

  it('motivo null/undefined se convierte a string vacío', () => {
    const p1 = buildNoEntregaPayload(null, false, fixedNow);
    expect(p1.motivo_no_entrega).toBe('');
    const p2 = buildNoEntregaPayload(undefined, false, fixedNow);
    expect(p2.motivo_no_entrega).toBe('');
  });

  it('usa Date actual si no se inyecta uno', () => {
    const p = buildNoEntregaPayload('m', false);
    // formato ISO válido
    expect(p.fecha_no_entrega).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });
});

// ─── calcReversoChangesNoEntrega ────────────────────────────────
describe('calcReversoChangesNoEntrega', () => {
  const cuartos = [
    { id: 'CF-1', stock: { 'HC-25K': 30 } },
    { id: 'CF-2', stock: {} },
  ];

  it('genera change positivo por cada línea con cantidad > 0', () => {
    const lineas = [
      { sku: 'HC-25K', cantidad: 5 },
      { sku: 'HC-5K', cantidad: 10 },
    ];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Chofer Juan', 'OV-100');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({
      cuarto_id: 'CF-1',
      sku: 'HC-25K',
      delta: 5,
      tipo: 'Devolución no entregada',
      origen: 'No entregada OV-100',
      usuario: 'Chofer Juan',
    });
    expect(changes[1]).toMatchObject({
      cuarto_id: 'CF-1',
      sku: 'HC-5K',
      delta: 10,
    });
  });

  it('todos los deltas son POSITIVOS (es entrada al cuarto)', () => {
    const lineas = [
      { sku: 'HC-25K', cantidad: 5 },
      { sku: 'HC-5K', cantidad: 10 },
    ];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Chofer', 'OV-101');
    for (const c of changes) expect(c.delta).toBeGreaterThan(0);
  });

  it('ignora líneas con cantidad <= 0', () => {
    const lineas = [
      { sku: 'HC-25K', cantidad: 0 },
      { sku: 'HC-5K', cantidad: -3 },
      { sku: 'HC-10K', cantidad: 4 },
    ];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Chofer', 'OV-102');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('HC-10K');
  });

  it('ignora líneas con SKU vacío', () => {
    const lineas = [
      { sku: '', cantidad: 5 },
      { sku: null, cantidad: 5 },
      { sku: 'HC-25K', cantidad: 5 },
    ];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Chofer', 'OV-103');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('HC-25K');
  });

  it('cuartos vacíos → 0 changes (caller debe manejar el caso)', () => {
    const lineas = [{ sku: 'HC-25K', cantidad: 5 }];
    const { changes } = calcReversoChangesNoEntrega(lineas, [], 'Chofer', 'OV-104');
    expect(changes).toEqual([]);
  });

  it('cuartos null/undefined → 0 changes', () => {
    const lineas = [{ sku: 'HC-25K', cantidad: 5 }];
    expect(calcReversoChangesNoEntrega(lineas, null, 'Chofer', 'OV').changes).toEqual([]);
    expect(calcReversoChangesNoEntrega(lineas, undefined, 'Chofer', 'OV').changes).toEqual([]);
  });

  it('lineas null/undefined → 0 changes', () => {
    expect(calcReversoChangesNoEntrega(null, cuartos, 'Chofer', 'OV').changes).toEqual([]);
    expect(calcReversoChangesNoEntrega(undefined, cuartos, 'Chofer', 'OV').changes).toEqual([]);
  });

  it('todas las líneas van al primer cuarto activo (FIFO inverso)', () => {
    const lineas = [
      { sku: 'HC-25K', cantidad: 5 },
      { sku: 'HC-5K', cantidad: 10 },
      { sku: 'HC-10K', cantidad: 3 },
    ];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Chofer', 'OV-105');
    for (const c of changes) expect(c.cuarto_id).toBe('CF-1');
  });

  it('usuario default "Chofer" si no se pasa', () => {
    const lineas = [{ sku: 'HC-25K', cantidad: 5 }];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, null, 'OV-106');
    expect(changes[0].usuario).toBe('Chofer');
  });

  it('origen default "No entregada orden" si no se pasa ref', () => {
    const lineas = [{ sku: 'HC-25K', cantidad: 5 }];
    const { changes } = calcReversoChangesNoEntrega(lineas, cuartos, 'Admin', null);
    expect(changes[0].origen).toBe('No entregada orden');
  });
});

// ─── FSM TRANSICIONES_ORDEN con 'No entregada' ──────────────────
describe('TRANSICIONES_ORDEN incluye No entregada', () => {
  it('Asignada → No entregada permitido', () => {
    expect(validateTransicionOrden('Asignada', 'No entregada')).toBeNull();
  });

  it('En ruta → No entregada permitido', () => {
    expect(validateTransicionOrden('En ruta', 'No entregada')).toBeNull();
  });

  it('Creada → No entregada bloqueado (orden no salió)', () => {
    const r = validateTransicionOrden('Creada', 'No entregada');
    expect(r?.error).toMatch(/Creada.*No entregada/);
  });

  it('Entregada → No entregada bloqueado', () => {
    const r = validateTransicionOrden('Entregada', 'No entregada');
    expect(r?.error).toMatch(/Entregada.*No entregada/);
  });

  it('No entregada es terminal: No entregada → Asignada bloqueado', () => {
    const r = validateTransicionOrden('No entregada', 'Asignada');
    expect(r?.error).toMatch(/No entregada.*Asignada/);
  });

  it('No entregada es terminal: No entregada → Entregada bloqueado', () => {
    const r = validateTransicionOrden('No entregada', 'Entregada');
    expect(r?.error).toMatch(/No entregada.*Entregada/);
  });

  it('No entregada → No entregada (no-op idempotente)', () => {
    expect(validateTransicionOrden('No entregada', 'No entregada')).toBeNull();
  });

  it('TRANSICIONES_ORDEN["No entregada"] === [] (terminal)', () => {
    expect(TRANSICIONES_ORDEN['No entregada']).toEqual([]);
  });

  it('Asignada incluye No entregada en su lista', () => {
    expect(TRANSICIONES_ORDEN['Asignada']).toContain('No entregada');
  });

  it('En ruta incluye No entregada en su lista', () => {
    expect(TRANSICIONES_ORDEN['En ruta']).toContain('No entregada');
  });
});

// ─── MOTIVOS_NO_ENTREGA ─────────────────────────────────────────
describe('MOTIVOS_NO_ENTREGA', () => {
  it('contiene los motivos canónicos del plan', () => {
    expect(MOTIVOS_NO_ENTREGA).toContain('Local cerrado');
    expect(MOTIVOS_NO_ENTREGA).toContain('Cliente ausente');
    expect(MOTIVOS_NO_ENTREGA).toContain('Cliente rechazó pedido');
    expect(MOTIVOS_NO_ENTREGA).toContain('Sin acceso al lugar');
  });

  it('última opción es "Otro" para captura libre', () => {
    expect(MOTIVOS_NO_ENTREGA[MOTIVOS_NO_ENTREGA.length - 1]).toBe('Otro');
  });
});
