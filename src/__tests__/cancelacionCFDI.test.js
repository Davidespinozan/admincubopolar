// cancelacionCFDI.test.js — Tanda 5: cancelación de CFDI con motivos SAT.
// Cubre helpers puros: isFacturable / isFacturada (FSM con cancelación),
// validateCancelacionCFDI (motivos 01-04 + uuidSustituto), buildAnotacion-
// CancelacionCFDI (UPDATE payload), y el catálogo motivosCancelacionCFDI.
import { describe, it, expect } from 'vitest';
import {
  isFacturable,
  isFacturada,
  validateCancelacionCFDI,
  buildAnotacionCancelacionCFDI,
} from '../data/ordenLogic';
import {
  MOTIVOS_CANCELACION_CFDI,
  MOTIVOS_OPTIONS,
  esMotivoCancelacionValido,
  motivoPorCodigo,
  requiereUuidSustituto,
} from '../data/sat/motivosCancelacionCFDI';

// ─── isFacturable ────────────────────────────────────────────
describe('isFacturable', () => {
  const base = { estatus: 'Entregada', requiere_factura: true, facturama_uuid: null, cfdi_cancelado_at: null };

  it('Entregada + requiere_factura + sin UUID → true', () => {
    expect(isFacturable(base)).toBe(true);
  });

  it('requiere_factura=false → false (toggle off)', () => {
    expect(isFacturable({ ...base, requiere_factura: false })).toBe(false);
  });

  it('estatus distinto a Entregada → false', () => {
    expect(isFacturable({ ...base, estatus: 'Creada' })).toBe(false);
    expect(isFacturable({ ...base, estatus: 'Asignada' })).toBe(false);
    expect(isFacturable({ ...base, estatus: 'Facturada' })).toBe(false);
    expect(isFacturable({ ...base, estatus: 'Cancelada' })).toBe(false);
  });

  it('con UUID vigente (sin cancelar) → false', () => {
    expect(isFacturable({ ...base, facturama_uuid: 'abc-123', cfdi_cancelado_at: null })).toBe(false);
  });

  it('con UUID y CFDI cancelado → true (re-timbrado permitido)', () => {
    expect(isFacturable({
      ...base,
      facturama_uuid: 'abc-123',
      cfdi_cancelado_at: '2026-05-05T10:00:00Z',
    })).toBe(true);
  });

  it('null/undefined → false (no crashea)', () => {
    expect(isFacturable(null)).toBe(false);
    expect(isFacturable(undefined)).toBe(false);
  });
});

// ─── isFacturada ─────────────────────────────────────────────
describe('isFacturada', () => {
  it('con UUID y sin cancelar → true', () => {
    expect(isFacturada({ facturama_uuid: 'abc', cfdi_cancelado_at: null })).toBe(true);
  });

  it('sin UUID → false', () => {
    expect(isFacturada({ facturama_uuid: null })).toBe(false);
    expect(isFacturada({})).toBe(false);
  });

  it('con UUID pero cancelado → false', () => {
    expect(isFacturada({ facturama_uuid: 'abc', cfdi_cancelado_at: '2026-05-05T10:00:00Z' })).toBe(false);
  });

  it('null/undefined → false', () => {
    expect(isFacturada(null)).toBe(false);
    expect(isFacturada(undefined)).toBe(false);
  });
});

// ─── validateCancelacionCFDI ─────────────────────────────────
describe('validateCancelacionCFDI', () => {
  const ordenFacturada = { facturama_uuid: 'uuid-vigente', cfdi_cancelado_at: null };

  it('orden sin CFDI vigente → error', () => {
    expect(validateCancelacionCFDI({ orden: { facturama_uuid: null }, motivo: '02' }))
      .toEqual({ error: 'Esta orden no tiene un CFDI vigente que cancelar' });
  });

  it('orden con CFDI ya cancelado → error', () => {
    expect(validateCancelacionCFDI({
      orden: { facturama_uuid: 'abc', cfdi_cancelado_at: '2026-01-01T00:00:00Z' },
      motivo: '02',
    })).toEqual({ error: 'Esta orden no tiene un CFDI vigente que cancelar' });
  });

  it('motivo inválido → error', () => {
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '99' }))
      .toEqual({ error: 'Motivo SAT inválido (debe ser 01, 02, 03 o 04)' });
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '' }))
      .toEqual({ error: 'Motivo SAT inválido (debe ser 01, 02, 03 o 04)' });
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: null }))
      .toEqual({ error: 'Motivo SAT inválido (debe ser 01, 02, 03 o 04)' });
  });

  it('motivos 02/03/04 sin uuidSustituto → ok', () => {
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '02' })).toBeNull();
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '03' })).toBeNull();
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '04' })).toBeNull();
  });

  it('motivo 01 requiere uuidSustituto', () => {
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '01' }))
      .toEqual({ error: 'El motivo 01 requiere el UUID del CFDI que sustituye al cancelado' });
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '01', uuidSustituto: '' }))
      .toEqual({ error: 'El motivo 01 requiere el UUID del CFDI que sustituye al cancelado' });
    expect(validateCancelacionCFDI({ orden: ordenFacturada, motivo: '01', uuidSustituto: '   ' }))
      .toEqual({ error: 'El motivo 01 requiere el UUID del CFDI que sustituye al cancelado' });
  });

  it('motivo 01 con uuidSustituto válido → ok', () => {
    expect(validateCancelacionCFDI({
      orden: ordenFacturada,
      motivo: '01',
      uuidSustituto: '12345678-1234-1234-1234-123456789012',
    })).toBeNull();
  });
});

// ─── buildAnotacionCancelacionCFDI ───────────────────────────
describe('buildAnotacionCancelacionCFDI', () => {
  const fixedDate = new Date('2026-05-05T15:30:00Z');

  it('arma payload completo con motivo 02', () => {
    const out = buildAnotacionCancelacionCFDI({
      motivo: '02',
      motivoDetalle: 'Error de captura',
      usuario: 'Karina',
      now: fixedDate,
    });
    expect(out).toEqual({
      estatus: 'Entregada',
      cfdi_cancelado_at: '2026-05-05T15:30:00.000Z',
      cfdi_cancelado_motivo: '02',
      cfdi_cancelado_motivo_detalle: 'Error de captura',
      cfdi_cancelado_uuid_sustituto: null,
      cfdi_cancelado_por: 'Karina',
    });
  });

  it('motivo 01 incluye uuidSustituto', () => {
    const out = buildAnotacionCancelacionCFDI({
      motivo: '01',
      uuidSustituto: 'sub-uuid-aaa',
      usuario: 'David',
      now: fixedDate,
    });
    expect(out.cfdi_cancelado_uuid_sustituto).toBe('sub-uuid-aaa');
    expect(out.cfdi_cancelado_motivo).toBe('01');
  });

  it('motivoDetalle vacío → null (no string vacío)', () => {
    const out = buildAnotacionCancelacionCFDI({ motivo: '03', motivoDetalle: '', usuario: 'X' });
    expect(out.cfdi_cancelado_motivo_detalle).toBeNull();
  });

  it('usuario vacío default a Admin', () => {
    const out = buildAnotacionCancelacionCFDI({ motivo: '03', usuario: null });
    expect(out.cfdi_cancelado_por).toBe('Admin');
  });

  it('siempre revierte estatus a Entregada', () => {
    const out = buildAnotacionCancelacionCFDI({ motivo: '02', usuario: 'X' });
    expect(out.estatus).toBe('Entregada');
  });

  it('trimea espacios en strings', () => {
    const out = buildAnotacionCancelacionCFDI({
      motivo: '  02  ',
      motivoDetalle: '  err  ',
      uuidSustituto: '  sub  ',
      usuario: 'X',
    });
    expect(out.cfdi_cancelado_motivo).toBe('02');
    expect(out.cfdi_cancelado_motivo_detalle).toBe('err');
    expect(out.cfdi_cancelado_uuid_sustituto).toBe('sub');
  });
});

// ─── catálogo MOTIVOS_CANCELACION_CFDI ───────────────────────
describe('MOTIVOS_CANCELACION_CFDI', () => {
  it('contiene los 4 motivos SAT (01, 02, 03, 04)', () => {
    const codigos = MOTIVOS_CANCELACION_CFDI.map(m => m.codigo).sort();
    expect(codigos).toEqual(['01', '02', '03', '04']);
  });

  it('solo el motivo 01 requiere sustituto', () => {
    const conSustituto = MOTIVOS_CANCELACION_CFDI.filter(m => m.requiereSustituto);
    expect(conSustituto).toHaveLength(1);
    expect(conSustituto[0].codigo).toBe('01');
  });

  it('cada motivo tiene nombre y descripción no vacíos', () => {
    for (const m of MOTIVOS_CANCELACION_CFDI) {
      expect(m.nombre).toBeTruthy();
      expect(m.descripcion).toBeTruthy();
    }
  });

  it('MOTIVOS_OPTIONS produce {value, label} por motivo', () => {
    expect(MOTIVOS_OPTIONS).toHaveLength(4);
    expect(MOTIVOS_OPTIONS[0]).toMatchObject({ value: '01' });
    for (const opt of MOTIVOS_OPTIONS) {
      expect(opt.label).toMatch(/^\d{2} — /);
    }
  });
});

// ─── helpers de catálogo ─────────────────────────────────────
describe('motivosCancelacionCFDI helpers', () => {
  it('esMotivoCancelacionValido acepta 01-04 y rechaza el resto', () => {
    expect(esMotivoCancelacionValido('01')).toBe(true);
    expect(esMotivoCancelacionValido('02')).toBe(true);
    expect(esMotivoCancelacionValido('03')).toBe(true);
    expect(esMotivoCancelacionValido('04')).toBe(true);
    expect(esMotivoCancelacionValido('05')).toBe(false);
    expect(esMotivoCancelacionValido('')).toBe(false);
    expect(esMotivoCancelacionValido(null)).toBe(false);
    expect(esMotivoCancelacionValido(undefined)).toBe(false);
  });

  it('esMotivoCancelacionValido trimea espacios', () => {
    expect(esMotivoCancelacionValido('  02  ')).toBe(true);
  });

  it('motivoPorCodigo retorna el motivo o null', () => {
    expect(motivoPorCodigo('01')).toMatchObject({ codigo: '01', requiereSustituto: true });
    expect(motivoPorCodigo('99')).toBeNull();
    expect(motivoPorCodigo(null)).toBeNull();
  });

  it('requiereUuidSustituto solo es true para 01', () => {
    expect(requiereUuidSustituto('01')).toBe(true);
    expect(requiereUuidSustituto('02')).toBe(false);
    expect(requiereUuidSustituto('03')).toBe(false);
    expect(requiereUuidSustituto('04')).toBe(false);
    expect(requiereUuidSustituto('99')).toBe(false);
    expect(requiereUuidSustituto('')).toBe(false);
    expect(requiereUuidSustituto(null)).toBe(false);
  });
});
