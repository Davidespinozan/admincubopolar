// marcarNoEntregada.test.js
// Tests para validateMarcarNoEntregada + buildNoEntregaPayload +
// calcReversoChangesNoEntrega + transiciones FSM hacia/desde 'No entregada'.
import { describe, it, expect } from 'vitest';
import {
  validateMarcarNoEntregada,
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
