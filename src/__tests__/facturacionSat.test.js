// facturacionSat.test.js — Tanda 4 facturación SAT.
// Cubre helpers puros: isValidRfc/isRfcExtranjero/isRfcPublicoGeneral
// (PASO 1), buildCfdiReceiver (XEXX vs XAXX), resolveRegimeCode
// (PASO 2), translateFacturamaError (PASO 5), y catálogo de regímenes.
import { describe, it, expect } from 'vitest';
import {
  isValidRfc,
  isRfcExtranjero,
  isRfcPublicoGeneral,
  buildCfdiReceiver,
  resolveRegimeCode,
} from '../../netlify/functions/_lib/invoiceLogic';
import { translateFacturamaError } from '../../netlify/functions/_lib/translateFacturama';
import {
  REGIMENES_FISCALES_SAT,
  REGIMENES_OPTIONS,
  esCodigoRegimenValido,
  regimenPorCodigo,
} from '../data/sat/regimenesFiscales';

// ─── isValidRfc / isRfcExtranjero / isRfcPublicoGeneral ────────
describe('isValidRfc', () => {
  it('rechaza XEXX (extranjero genérico)', () => {
    expect(isValidRfc('XEXX010101000')).toBe(false);
  });

  it('rechaza XAXX (público general)', () => {
    expect(isValidRfc('XAXX010101000')).toBe(false);
  });

  it('acepta RFC nominativo persona moral', () => {
    expect(isValidRfc('CPO920301AB0')).toBe(true);
  });

  it('rechaza string vacío / null', () => {
    expect(isValidRfc('')).toBe(false);
    expect(isValidRfc(null)).toBe(false);
    expect(isValidRfc(undefined)).toBe(false);
  });
});

describe('isRfcExtranjero', () => {
  it('true solo para XEXX exacto', () => {
    expect(isRfcExtranjero('XEXX010101000')).toBe(true);
    expect(isRfcExtranjero('xexx010101000')).toBe(true); // case insensitive
    expect(isRfcExtranjero('  XEXX010101000  ')).toBe(true); // trim
  });

  it('false para XAXX', () => {
    expect(isRfcExtranjero('XAXX010101000')).toBe(false);
  });

  it('false para nominativo', () => {
    expect(isRfcExtranjero('CPO920301AB0')).toBe(false);
  });

  it('false para null/vacío', () => {
    expect(isRfcExtranjero(null)).toBe(false);
    expect(isRfcExtranjero('')).toBe(false);
  });
});

describe('isRfcPublicoGeneral', () => {
  it('true solo para XAXX', () => {
    expect(isRfcPublicoGeneral('XAXX010101000')).toBe(true);
  });

  it('false para XEXX', () => {
    expect(isRfcPublicoGeneral('XEXX010101000')).toBe(false);
  });
});

// ─── buildCfdiReceiver ─────────────────────────────────────────
describe('buildCfdiReceiver', () => {
  describe('cliente extranjero (XEXX)', () => {
    it('emite shape correcto con Name fijo y CfdiUse=S01', () => {
      const r = buildCfdiReceiver(
        { rfc: 'XEXX010101000', nombre: 'Tourist Inc', cp: '34186' },
        '34000'
      );
      expect(r).toMatchObject({
        rfc: 'XEXX010101000',
        name: 'PUBLICO EN GENERAL EXTRANJERO',
        fiscalRegime: '616',
        cfdiUse: 'S01',
        isExtranjero: true,
        isPublicoGeneral: false,
      });
    });

    it('usa CP del cliente si lo trae', () => {
      const r = buildCfdiReceiver(
        { rfc: 'XEXX010101000', cp: '99999' },
        '34000'
      );
      expect(r.zipCode).toBe('99999');
    });

    it('cae a issuerZip si cliente sin CP', () => {
      const r = buildCfdiReceiver({ rfc: 'XEXX010101000' }, '34000');
      expect(r.zipCode).toBe('34000');
    });

    it('NO genera GlobalInformation (eso es solo para XAXX)', () => {
      // El caller usa isPublicoGeneral; isExtranjero es true aquí
      const r = buildCfdiReceiver({ rfc: 'XEXX010101000' }, '34000');
      expect(r.isPublicoGeneral).toBe(false);
    });
  });

  describe('cliente nacional con RFC nominativo válido', () => {
    it('usa datos del cliente', () => {
      const r = buildCfdiReceiver(
        {
          rfc: 'CPO920301AB0',
          nombre: 'Empresa S.A. de C.V.',
          regimen: '601',
          uso_cfdi: 'G03',
          cp: '80000',
          correo: 'fact@empresa.com',
        },
        '34000'
      );
      expect(r).toMatchObject({
        rfc: 'CPO920301AB0',
        name: 'Empresa S.A. de C.V.',
        fiscalRegime: '601',
        cfdiUse: 'G03',
        zipCode: '80000',
        email: 'fact@empresa.com',
        isPublicoGeneral: false,
        isExtranjero: false,
      });
    });

    it('uppercase del RFC', () => {
      const r = buildCfdiReceiver({ rfc: 'cpo920301ab0', regimen: '601' }, '34000');
      expect(r.rfc).toBe('CPO920301AB0');
    });

    it('default G03 si uso_cfdi vacío', () => {
      const r = buildCfdiReceiver({ rfc: 'CPO920301AB0' }, '34000');
      expect(r.cfdiUse).toBe('G03');
    });
  });

  describe('cliente nacional sin RFC válido (público general)', () => {
    it('XAXX cuando rfc null', () => {
      const r = buildCfdiReceiver({}, '34000');
      expect(r).toMatchObject({
        rfc: 'XAXX010101000',
        name: 'PUBLICO EN GENERAL',
        fiscalRegime: '616',
        cfdiUse: 'S01',
        isPublicoGeneral: true,
      });
    });

    it('XAXX cuando rfc inválido (formato malo)', () => {
      const r = buildCfdiReceiver({ rfc: 'ABC123' }, '34000');
      expect(r.rfc).toBe('XAXX010101000');
      expect(r.isPublicoGeneral).toBe(true);
    });

    it('XAXX cuando rfc explícitamente XAXX', () => {
      const r = buildCfdiReceiver({ rfc: 'XAXX010101000' }, '34000');
      expect(r.rfc).toBe('XAXX010101000');
      expect(r.isPublicoGeneral).toBe(true);
      expect(r.isExtranjero).toBe(false);
    });
  });

  it('cliente null/undefined → público general nacional (XAXX)', () => {
    expect(buildCfdiReceiver(null, '34000').rfc).toBe('XAXX010101000');
    expect(buildCfdiReceiver(undefined, '34000').rfc).toBe('XAXX010101000');
  });
});

// ─── resolveRegimeCode ─────────────────────────────────────────
describe('resolveRegimeCode', () => {
  it('código SAT válido pasa-through', () => {
    expect(resolveRegimeCode('601')).toBe('601');
    expect(resolveRegimeCode('626')).toBe('626');
    expect(resolveRegimeCode('616')).toBe('616');
  });

  it('código 3 dígitos NO en catálogo → 616', () => {
    expect(resolveRegimeCode('999')).toBe('616');
    expect(resolveRegimeCode('100')).toBe('616');
  });

  it('string legacy "Régimen General" → 601', () => {
    expect(resolveRegimeCode('Régimen General')).toBe('601');
    expect(resolveRegimeCode('General de Ley Personas Morales')).toBe('601');
  });

  it('string legacy "Régimen Simplificado de Confianza" → 626', () => {
    expect(resolveRegimeCode('Régimen Simplificado de Confianza')).toBe('626');
  });

  it('null/vacío/desconocido → 616', () => {
    expect(resolveRegimeCode(null)).toBe('616');
    expect(resolveRegimeCode('')).toBe('616');
    expect(resolveRegimeCode('Régimen Inventado')).toBe('616');
  });

  it('trim de espacios', () => {
    expect(resolveRegimeCode('  601  ')).toBe('601');
  });
});

// ─── catálogo regímenes ────────────────────────────────────────
describe('REGIMENES_FISCALES_SAT', () => {
  it('tiene 19 regímenes (catálogo SAT vigente)', () => {
    expect(REGIMENES_FISCALES_SAT).toHaveLength(19);
  });

  it('todos tienen codigo de 3 dígitos + nombre + tipo', () => {
    for (const r of REGIMENES_FISCALES_SAT) {
      expect(r.codigo).toMatch(/^\d{3}$/);
      expect(typeof r.nombre).toBe('string');
      expect(r.nombre.length).toBeGreaterThan(0);
      expect(['fisica', 'moral', 'ambos']).toContain(r.tipo);
    }
  });

  it('REGIMENES_OPTIONS tiene shape FormSelect (value + label)', () => {
    expect(REGIMENES_OPTIONS).toHaveLength(19);
    for (const o of REGIMENES_OPTIONS) {
      expect(typeof o.value).toBe('string');
      expect(typeof o.label).toBe('string');
      expect(o.label.startsWith(o.value)).toBe(true);
    }
  });

  it('códigos críticos presentes', () => {
    const codigos = REGIMENES_FISCALES_SAT.map(r => r.codigo);
    expect(codigos).toContain('601'); // Persona Moral
    expect(codigos).toContain('612'); // PF Actividades Empresariales
    expect(codigos).toContain('616'); // Sin obligaciones (fallback)
    expect(codigos).toContain('626'); // RESICO
  });

  it('esCodigoRegimenValido reconoce códigos del catálogo', () => {
    expect(esCodigoRegimenValido('601')).toBe(true);
    expect(esCodigoRegimenValido('626')).toBe(true);
    expect(esCodigoRegimenValido('999')).toBe(false);
    expect(esCodigoRegimenValido(null)).toBe(false);
    expect(esCodigoRegimenValido('')).toBe(false);
  });

  it('regimenPorCodigo busca correctamente', () => {
    expect(regimenPorCodigo('601')?.nombre).toContain('Persona');
    expect(regimenPorCodigo('626')?.nombre).toContain('Confianza');
    expect(regimenPorCodigo('999')).toBeNull();
  });
});

// ─── translateFacturamaError ───────────────────────────────────
describe('translateFacturamaError', () => {
  describe('errores HTTP genéricos', () => {
    it('401 → mensaje de credenciales', () => {
      expect(translateFacturamaError({}, 401)).toMatch(/credenciales/i);
    });

    it('502/503/504 → "Facturama no responde"', () => {
      expect(translateFacturamaError({}, 502)).toMatch(/no responde/i);
      expect(translateFacturamaError({}, 503)).toMatch(/no responde/i);
      expect(translateFacturamaError({}, 504)).toMatch(/no responde/i);
    });
  });

  describe('errores por campo (ModelState)', () => {
    it('Receiver.Rfc → mensaje sobre RFC del cliente', () => {
      const err = { ModelState: { 'Receiver.Rfc': ['Invalid'] } };
      expect(translateFacturamaError(err)).toMatch(/RFC del cliente/i);
    });

    it('Receiver.FiscalRegime → mensaje sobre régimen', () => {
      const err = { ModelState: { 'Receiver.FiscalRegime': ['No coincide'] } };
      expect(translateFacturamaError(err)).toMatch(/régimen fiscal/i);
    });

    it('Receiver.CfdiUse → mensaje sobre uso CFDI', () => {
      const err = { ModelState: { 'Receiver.CfdiUse': ['Invalid'] } };
      expect(translateFacturamaError(err)).toMatch(/uso de cfdi/i);
    });

    it('Receiver.TaxZipCode → mensaje sobre CP cliente', () => {
      const err = { ModelState: { 'Receiver.TaxZipCode': ['Bad'] } };
      expect(translateFacturamaError(err)).toMatch(/código postal del cliente/i);
    });

    it('Issuer.* → mensajes sobre empresa', () => {
      expect(translateFacturamaError({ ModelState: { 'Issuer.Rfc': ['x'] } })).toMatch(/RFC de tu empresa/i);
      expect(translateFacturamaError({ ModelState: { 'ExpeditionPlace': ['x'] } })).toMatch(/código postal de la empresa/i);
    });

    it('PaymentForm → mensaje sobre forma de pago', () => {
      expect(translateFacturamaError({ ModelState: { 'PaymentForm': ['x'] } })).toMatch(/forma de pago/i);
    });

    it('Items.[0].ProductCode → mensaje sobre clave producto SAT', () => {
      const err = { ModelState: { 'Items[0].ProductCode': ['Invalid'] } };
      expect(translateFacturamaError(err)).toMatch(/clave de producto/i);
    });

    it('Items.[1].UnitCode → mensaje sobre clave unidad', () => {
      const err = { ModelState: { 'Items[1].UnitCode': ['Bad'] } };
      expect(translateFacturamaError(err)).toMatch(/clave de unidad/i);
    });

    it('PacIssue → mensaje de reintentar', () => {
      const err = { ModelState: { 'PacIssue': ['Timeout'] } };
      expect(translateFacturamaError(err)).toMatch(/reintenta/i);
    });

    it('certificado vencido → mensaje específico', () => {
      const err = { Message: 'certificado expirado' };
      expect(translateFacturamaError(err)).toMatch(/certificado.*vencido|csd/i);
    });
  });

  describe('fallback', () => {
    it('si no matchea ningún caso conocido, devuelve Message original', () => {
      const err = { Message: 'Some weird error from PAC' };
      expect(translateFacturamaError(err)).toBe('Some weird error from PAC');
    });

    it('sin Message ni ModelState → fallback genérico', () => {
      expect(translateFacturamaError({})).toMatch(/Error al timbrar/i);
      expect(translateFacturamaError(null)).toMatch(/Error al timbrar/i);
    });
  });

  it('no expone JSON crudo del ModelState al usuario', () => {
    const err = { ModelState: { 'Receiver.Rfc': ['SAT-XYZ-123 internal error'] } };
    const result = translateFacturamaError(err);
    expect(result).not.toContain('SAT-XYZ-123');
    expect(result).not.toContain('ModelState');
    expect(result).not.toContain('{');
  });
});
