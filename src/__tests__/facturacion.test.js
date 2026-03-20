// facturacion.test.js — lógica de facturación CFDI / Facturama
import { describe, it, expect } from 'vitest';
import {
  isValidRfc,
  resolveRegimeCode,
  isPPD,
  calcIVA,
  buildCfdiItem,
  PAYMENT_FORM_MAP,
  PAYMENT_METHOD_MAP,
} from '../../netlify/functions/_lib/invoiceLogic';

// ─── isValidRfc ───────────────────────────────────────────────
describe('isValidRfc', () => {
  it('acepta RFC de persona moral válido', () => {
    expect(isValidRfc('CPO920301AB0')).toBe(true);   // 3 letras + fecha + 3 alfanum
  });

  it('acepta RFC de persona física válido', () => {
    expect(isValidRfc('HEGG560427MLD')).toBe(true);  // 4 letras + fecha + 3 alfanum
  });

  it('acepta RFC en minúsculas (normaliza)', () => {
    expect(isValidRfc('cpo920301ab0')).toBe(true);
  });

  it('rechaza RFC genérico XAXX010101000 (público en general)', () => {
    expect(isValidRfc('XAXX010101000')).toBe(false);
  });

  it('rechaza RFC genérico XEXX010101000 (extranjero)', () => {
    expect(isValidRfc('XEXX010101000')).toBe(false);
  });

  it('rechaza null', () => {
    expect(isValidRfc(null)).toBe(false);
  });

  it('rechaza string vacío', () => {
    expect(isValidRfc('')).toBe(false);
  });

  it('rechaza RFC demasiado corto', () => {
    expect(isValidRfc('CPO920')).toBe(false);
  });

  it('rechaza RFC con caracteres especiales', () => {
    expect(isValidRfc('CPO92030!AB0')).toBe(false);
  });

  it('acepta RFC con Ñ (válido en México)', () => {
    // El SAT permite Ñ y & en RFC — deben aceptarse
    expect(isValidRfc('ÑOÑO920301AB0')).toBe(true);
    expect(isValidRfc('XÑXX010101AB0')).toBe(true); // no es RFC genérico conocido
  });
});

// ─── resolveRegimeCode ────────────────────────────────────────
describe('resolveRegimeCode', () => {
  it('mapea "Régimen General" → 601', () => {
    expect(resolveRegimeCode('Régimen General')).toBe('601');
  });

  it('mapea "Régimen Simplificado de Confianza" → 626', () => {
    expect(resolveRegimeCode('Régimen Simplificado de Confianza')).toBe('626');
  });

  it('pasa-a-través código de 3 dígitos numéricos', () => {
    expect(resolveRegimeCode('612')).toBe('612');
  });

  it('devuelve 616 como fallback para régimen desconocido', () => {
    expect(resolveRegimeCode('Régimen Inventado')).toBe('616');
  });

  it('devuelve 616 para null/undefined', () => {
    expect(resolveRegimeCode(null)).toBe('616');
    expect(resolveRegimeCode('')).toBe('616');
  });
});

// ─── isPPD ────────────────────────────────────────────────────
describe('isPPD', () => {
  it('Crédito → PPD', () => {
    expect(isPPD('Crédito')).toBe(true);
  });

  it('Crédito (fiado) → PPD', () => {
    expect(isPPD('Crédito (fiado)')).toBe(true);
  });

  it('Efectivo → PUE (no PPD)', () => {
    expect(isPPD('Efectivo')).toBe(false);
  });

  it('Transferencia → PUE (no PPD)', () => {
    expect(isPPD('Transferencia')).toBe(false);
  });

  it('undefined → PUE (no PPD)', () => {
    expect(isPPD(undefined)).toBe(false);
  });
});

// ─── calcIVA ──────────────────────────────────────────────────
describe('calcIVA', () => {
  it('calcula 16% de IVA correctamente', () => {
    expect(calcIVA(1000)).toBe(160);
  });

  it('redondea a 2 decimales (sin drift de float)', () => {
    // 86.21 × 0.16 = 13.7936 → 13.79
    expect(calcIVA(86.21)).toBe(13.79);
  });

  it('devuelve 0 para subtotal 0', () => {
    expect(calcIVA(0)).toBe(0);
  });
});

// ─── buildCfdiItem ────────────────────────────────────────────
describe('buildCfdiItem', () => {
  const catalog = {
    'HC-5K': { code: '50202302', name: 'BOLSA CUBO POLAR 5KG' },
  };

  const linea = {
    sku: 'HC-5K',
    cantidad: 10,
    precio_unit: 50,
    subtotal: 500,
    nombre_producto: 'Bolsa de hielo 5kg',
  };

  it('calcula Total = Subtotal + IVA', () => {
    const item = buildCfdiItem(linea, catalog);
    expect(item.Total).toBe(580); // 500 + 80
  });

  it('incluye IVA 16% en Taxes', () => {
    const item = buildCfdiItem(linea, catalog);
    expect(item.Taxes[0].Rate).toBe(0.16);
    expect(item.Taxes[0].Total).toBe(80);
    expect(item.Taxes[0].Base).toBe(500);
  });

  it('usa código de catálogo del SKU', () => {
    const item = buildCfdiItem(linea, catalog);
    expect(item.ProductCode).toBe('50202302');
  });

  it('usa código genérico 50202302 si SKU no está en catálogo', () => {
    const item = buildCfdiItem({ ...linea, sku: 'SKU-NUEVO' }, catalog);
    expect(item.ProductCode).toBe('50202302');
  });

  it('coloca TaxObject "02" (con impuestos)', () => {
    expect(buildCfdiItem(linea, catalog).TaxObject).toBe('02');
  });

  it('usa UnitCode H87 (pieza)', () => {
    expect(buildCfdiItem(linea, catalog).UnitCode).toBe('H87');
  });

  it('usa nombre del producto sobre el del catálogo', () => {
    const item = buildCfdiItem(linea, catalog);
    expect(item.Description).toBe('Bolsa de hielo 5kg');
  });

  it('fallback al nombre del catálogo si no hay nombre_producto', () => {
    const item = buildCfdiItem({ ...linea, nombre_producto: undefined }, catalog);
    expect(item.Description).toBe('BOLSA CUBO POLAR 5KG');
  });
});

// ─── PAYMENT_FORM_MAP ─────────────────────────────────────────
describe('PAYMENT_FORM_MAP', () => {
  it('Efectivo → 01', () => expect(PAYMENT_FORM_MAP['Efectivo']).toBe('01'));
  it('Transferencia → 03', () => expect(PAYMENT_FORM_MAP['Transferencia']).toBe('03'));
  it('Transferencia SPEI → 03', () => expect(PAYMENT_FORM_MAP['Transferencia SPEI']).toBe('03'));
  it('Tarjeta → 04', () => expect(PAYMENT_FORM_MAP['Tarjeta']).toBe('04'));
  it('Crédito → 99 (no definido en SAT)', () => expect(PAYMENT_FORM_MAP['Crédito']).toBe('99'));
});
