// ol04Complementos.test.js — OL-04: complemento de pago POR PAGO.
// Pruebas puras (cuerpo, payload armado por el servidor, modelo de lectura por
// pago) y de fuente (ningún llamador manda cifras fiscales). La reserva real,
// la concurrencia y el handler contra Postgres se prueban en el runner local
// (suite 113 y "OL-04 COMPLEMENTOS ↔ POSTGRES REAL").
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { validarCuerpoComplemento, buildComplementoPayload } from '../../netlify/functions/billing-create-complemento/index.js';
import { estadoComplementosOrden, complementoPendienteOrden, metodoSatDeOrden, ESTADO_COMPLEMENTO as E } from '../data/complementoLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('OL-04 cuerpo: solo el identificador del pago', () => {
  it('pagoId entero positivo; montos, saldos, método, cxcId o CFDI del cliente → 400', () => {
    expect(validarCuerpoComplemento({ pagoId: 7 })).toEqual({ ok: true, pagoId: 7 });
    expect(validarCuerpoComplemento({ pagoId: '7' })).toEqual({ ok: true, pagoId: 7 });
    for (const k of ['monto', 'metodoPago', 'saldoAntes', 'saldoDespues', 'cxcId', 'facturamaPayload']) {
      expect(validarCuerpoComplemento({ pagoId: 7, [k]: 1 }), k).toMatchObject({ ok: false, status: 400, code: 'CAMPOS_FISCALES_NO_PERMITIDOS' });
    }
    for (const v of [undefined, 0, -1, 1.5, 'x', null]) expect(validarCuerpoComplemento({ pagoId: v }).code).toBe('PAGO_REQUERIDO');
  });
});

describe('OL-04 payload tipo P (guía oficial de Facturama) desde la reserva', () => {
  const reserva = { serie: 'CP', folio: 'P501G1', fecha_cfdi: '2026-10-06T10:00:00', fecha_pago: '2026-10-01', forma_pago: '03', importe_pagado: 120,
    relacionado_uuid: 'UUID-I1', parcialidad: 2, saldo_anterior: 200, saldo_insoluto: 80 };
  const p = buildComplementoPayload({ reserva, cliente: { nombre: 'C SA', rfc: 'AAA010101AAA', regimen: '601', cp: '34000' }, ordenNombre: 'C', issuerZip: '34186' });
  it('nodo general: CfdiType P, sin Currency / PaymentMethod / PaymentForm; CfdiUse CP01; Folio + Date fijos de la reserva', () => {
    expect(p).toMatchObject({ NameId: '14', Serie: 'CP', Folio: 'P501G1', Date: '2026-10-06T10:00:00', CfdiType: 'P', ExpeditionPlace: '34186' });
    expect(p).not.toHaveProperty('Currency');
    expect(p).not.toHaveProperty('PaymentMethod');
    expect(p).not.toHaveProperty('PaymentForm');
    expect(p.Receiver).toEqual({ Rfc: 'AAA010101AAA', Name: 'C SA', FiscalRegime: '601', CfdiUse: 'CP01', TaxZipCode: '34000' });
    expect(p).not.toHaveProperty('Payments');           // va dentro de "Complemento"
  });
  it('Complemento.Payments / RelatedDocuments con AmountPaid y saldos de la reserva (no del cliente)', () => {
    expect(p.Complemento.Payments).toEqual([{
      Date: '2026-10-01', PaymentForm: '03', Currency: 'MXN', Amount: 120,
      RelatedDocuments: [{ Uuid: 'UUID-I1', PartialityNumber: 2, Currency: 'MXN', PreviousBalanceAmount: 200, AmountPaid: 120, ImpSaldoInsoluto: 80,
        TaxObject: '02', Taxes: [{ Name: 'IVA', Rate: 0, Total: 0, Base: 120, IsRetention: false }] }],
    }]);
  });
});

describe('OL-04 estado del complemento por pago (modelo de lectura)', () => {
  const orden = { id: 9, estatus: 'Facturada', facturama_uuid: 'U-I1', facturama_id: 'F', cfdi_cancelado_at: null };
  const emision = { id: 'e1', ordenId: 9, tipo: 'emision', estado: 'exitosa', cfdiUuid: 'U-I1', cfdiMetodoPago: 'PPD' };
  // pago 11: cobro de CxC; 12: webhook del link (QR); 13: cierre de ruta (abonar_cxc); 14: pago sin CxC (contado)
  const pagos = [
    { id: 13, ordenId: 9, cxcId: 5, monto: 80, fecha: '2026-10-03', metodoPago: 'Efectivo' },
    { id: 11, ordenId: 9, cxcId: 5, monto: 100, fecha: '2026-09-30', metodoPago: 'Efectivo' },
    { id: 12, ordenId: 9, cxcId: 5, monto: 120, fecha: '2026-10-01', metodoPago: 'QR / Link de pago' },
    { id: 14, ordenId: 9, cxcId: null, monto: 10, fecha: '2026-10-01' },
    { id: 21, ordenId: 77, cxcId: 6, monto: 5, fecha: '2026-10-01' },
  ];
  const est = (ops, o = orden) => estadoComplementosOrden(o, pagos, ops).pagos.map(f => [f.pago.id, f.parcialidad, f.estado]);
  it('pagos de la CxC de la orden por cualquier camino (cobro, webhook, ruta), en orden de registro; parcialidad 1, 2, 3', () => {
    expect(est([emision])).toEqual([[11, 1, E.EMITIBLE], [12, 2, E.ESPERA_ANTERIOR], [13, 3, E.ESPERA_ANTERIOR]]);
  });
  it('emitidos, en proceso, por conciliar y bloqueados', () => {
    const c1 = { ordenId: 9, tipo: 'complemento', estado: 'exitosa', pagoId: 11, relacionadoUuid: 'U-I1', cfdiUuid: 'U-C1' };
    expect(est([emision, c1])).toEqual([[11, 1, E.EMITIDO], [12, 2, E.EMITIBLE], [13, 3, E.ESPERA_ANTERIOR]]);
    expect(est([emision, c1, { ordenId: 9, tipo: 'complemento', estado: 'en_curso', pagoId: 12 }])).toEqual([[11, 1, E.EMITIDO], [12, 2, E.EN_PROCESO], [13, 3, E.BLOQUEADO]]);
    expect(est([emision, c1, { ordenId: 9, tipo: 'complemento', estado: 'incierta', pagoId: 12 }])[1][2]).toBe(E.REQUIERE_CONCILIACION);
    expect(est([emision, { ordenId: 9, tipo: 'cancelacion', estado: 'cancelacion_pendiente' }])[0][2]).toBe(E.BLOQUEADO);
    expect(complementoPendienteOrden(orden, pagos, [emision, c1])).toBe(true);
  });
  it('pago anterior a la factura: queda visible como no elegible y se vuelve emitible al existir la factura PPD', () => {
    const sinFactura = { ...orden, estatus: 'Entregada', facturama_uuid: null };
    const r = estadoComplementosOrden(sinFactura, pagos, []);
    expect(r.aplica).toBe(true);
    expect(r.pagos.every(f => f.estado === E.NO_ELEGIBLE && /Sin factura vigente/.test(f.motivo))).toBe(true);
    expect(est([emision])[0][2]).toBe(E.EMITIBLE);
  });
  it('PUE, modo no registrado y CFDI cancelado: no elegibles (no se infiere de ordenes.metodo_pago)', () => {
    expect(est([{ ...emision, cfdiMetodoPago: 'PUE' }]).every(x => x[2] === E.NO_ELEGIBLE)).toBe(true);
    expect(estadoComplementosOrden({ ...orden, metodo_pago: 'Crédito (fiado)' }, pagos, []).motivo).toMatch(/Modo fiscal/);
    expect(est([emision], { ...orden, cfdi_cancelado_at: '2026-10-02' }).every(x => x[2] === E.NO_ELEGIBLE)).toBe(true);
    expect(metodoSatDeOrden(orden, [emision])).toBe('PPD');
    expect(metodoSatDeOrden({ ...orden, facturama_uuid: 'OTRO' }, [emision])).toBeNull();
  });
  it('generación nueva: complementos del CFDI anterior no cuentan', () => {
    const viejo = { ordenId: 9, tipo: 'complemento', estado: 'exitosa', pagoId: 11, relacionadoUuid: 'U-VIEJO' };
    expect(est([emision, viejo])[0]).toEqual([11, 1, E.EMITIBLE]);
  });
  it('sin pagos de CxC: no aplica', () => {
    expect(estadoComplementosOrden({ ...orden, id: 1 }, pagos, [emision]).aplica).toBe(false);
  });
});

describe('OL-04 llamadores: identidad del pago, sin cifras fiscales', () => {
  const store = src('../data/supaStore.js');
  it('cobrarCxC manda solo { pagoId: abono.pago_id }; emitirComplemento manda solo { pagoId }', () => {
    const llamadas = store.match(/backendPost\('billing-create-complemento',[^)]*\)/g) || [];
    expect(llamadas).toEqual(["backendPost('billing-create-complemento', { pagoId })", "backendPost('billing-create-complemento', { pagoId: abono.pago_id })"]);
    expect(store).not.toMatch(/reintentarComplemento/);
    expect(store).not.toMatch(/saldoAntes|saldoDespues/);
  });
  it('el store carga operaciones CFDI y pagos de CxC; alertas por pago', () => {
    expect(store).toMatch(/from\('cfdi_operaciones'\)\.select\('id, orden_id, tipo, generacion, estado, pago_id, relacionado_uuid/);
    expect(store).toMatch(/from\('pagos'\)\.select\('id, orden_id, cxc_id, monto, fecha, metodo_pago, saldo_antes, saldo_despues'\)\.not\('cxc_id', 'is', null\)/);
    expect(store).toMatch(/complementoPendienteOrden\(toCamel\(o\), pagosCxc, opsCfdi\)/);
  });
  it('Facturación: estado y acción POR PAGO', () => {
    const fv = src('../components/views/FacturacionView.jsx');
    expect(fv).toMatch(/<PagosComplemento orden=\{o\} pagos=\{data\.pagosCxc\} operaciones=\{data\.cfdiOperaciones\} onEmitir=\{handleEmitirComplemento\}/);
    expect(fv).toMatch(/onClick=\{\(\) => onEmitir\(f\.pago\.id\)\}/);
    for (const t of ['Emitir complemento', '✓ Complemento emitido', 'En proceso', 'Requiere conciliación', 'No elegible']) expect(fv).toContain(t);
    expect(fv).not.toMatch(/reintentarComplemento|complementosPorOrden/);
  });
  it('el webhook y el cierre de ruta NO llaman al proveedor de complementos', () => {
    expect(src('../../netlify/functions/_lib/persistence.js')).not.toMatch(/complemento|CfdiType|facturama/i);
    expect(src('../../netlify/functions/billing-webhook-stripe/index.js')).not.toMatch(/complemento/i);
    expect(src('../../netlify/functions/billing-webhook-mercadopago/index.js')).not.toMatch(/complemento/i);
  });
  it('la factura registra cómo se emitió (PPD / PUE) para los complementos', () => {
    expect(src('../../netlify/functions/billing-create-invoice/index.js')).toMatch(/const datos = \{ \.\.\.clase\.datos, metodo_pago_sat: payload\.PaymentMethod,/);
  });
});
