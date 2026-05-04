// direccionForm.test.js — helpers puros de captura de dirección estructurada.
// Cubre parseAddressComponents (Google Places New + legacy), validateDireccion
// (numero_exterior obligatorio), formatDireccion (string legible), y
// buildPlaceSelection (shape final que emite AddressAutocomplete.onSelect).
import { describe, it, expect } from 'vitest';
import {
  parseAddressComponents,
  validateDireccion,
  formatDireccion,
  buildPlaceSelection,
} from '../data/direccionLogic';

// ─── parseAddressComponents ────────────────────────────────────
describe('parseAddressComponents', () => {
  // Google Places (New API) usa longText/types
  const completeNew = [
    { types: ['street_number'], longText: '123' },
    { types: ['route'], longText: 'Av. Revolución' },
    { types: ['sublocality_level_1', 'sublocality'], longText: 'Centro' },
    { types: ['locality'], longText: 'Culiacán' },
    { types: ['administrative_area_level_1'], longText: 'Sinaloa' },
    { types: ['postal_code'], longText: '80000' },
  ];

  it('parsea address_components completo (formato New API)', () => {
    const r = parseAddressComponents(completeNew);
    expect(r).toEqual({
      calle: 'Av. Revolución',
      numero_exterior: '123',
      numero_interior: null,
      colonia: 'Centro',
      ciudad: 'Culiacán',
      estado: 'Sinaloa',
      codigo_postal: '80000',
    });
  });

  it('parsea formato legacy (long_name)', () => {
    const legacy = [
      { types: ['route'], long_name: 'Av. Patria' },
      { types: ['street_number'], long_name: '456' },
      { types: ['locality'], long_name: 'Guadalajara' },
    ];
    const r = parseAddressComponents(legacy);
    expect(r.calle).toBe('Av. Patria');
    expect(r.numero_exterior).toBe('456');
    expect(r.ciudad).toBe('Guadalajara');
  });

  it('numero_exterior null cuando Google NO trae street_number', () => {
    const sinNumero = completeNew.filter(c => !c.types.includes('street_number'));
    const r = parseAddressComponents(sinNumero);
    expect(r.numero_exterior).toBeNull();
    expect(r.calle).toBe('Av. Revolución');
  });

  it('numero_interior siempre null (Google nunca lo emite)', () => {
    expect(parseAddressComponents(completeNew).numero_interior).toBeNull();
  });

  it('colonia fallback: sublocality_level_1 → sublocality → neighborhood', () => {
    const conNeighborhood = [
      { types: ['route'], longText: 'C' },
      { types: ['neighborhood'], longText: 'Las Quintas' },
    ];
    expect(parseAddressComponents(conNeighborhood).colonia).toBe('Las Quintas');
  });

  it('ciudad fallback: locality → administrative_area_level_2', () => {
    const conAdmin2 = [
      { types: ['route'], longText: 'C' },
      { types: ['administrative_area_level_2'], longText: 'Municipio X' },
    ];
    expect(parseAddressComponents(conAdmin2).ciudad).toBe('Municipio X');
  });

  it('campos null cuando faltan en components', () => {
    const r = parseAddressComponents([]);
    expect(r.calle).toBeNull();
    expect(r.numero_exterior).toBeNull();
    expect(r.colonia).toBeNull();
    expect(r.ciudad).toBeNull();
    expect(r.estado).toBeNull();
    expect(r.codigo_postal).toBeNull();
  });

  it('argumento null/undefined no crashea', () => {
    expect(() => parseAddressComponents(null)).not.toThrow();
    expect(() => parseAddressComponents(undefined)).not.toThrow();
    expect(parseAddressComponents(null).calle).toBeNull();
  });

  it('component sin types no crashea', () => {
    const malformed = [
      { types: ['route'], longText: 'C' },
      { longText: 'sin types' },
      null,
    ];
    expect(() => parseAddressComponents(malformed)).not.toThrow();
    expect(parseAddressComponents(malformed).calle).toBe('C');
  });
});

// ─── validateDireccion ─────────────────────────────────────────
describe('validateDireccion', () => {
  it('null cuando numero_exterior está presente', () => {
    expect(validateDireccion({ numero_exterior: '123' })).toBeNull();
  });

  it('error cuando numero_exterior vacío', () => {
    const r = validateDireccion({ numero_exterior: '' });
    expect(r?.error).toMatch(/exterior/i);
  });

  it('error cuando numero_exterior es solo espacios', () => {
    expect(validateDireccion({ numero_exterior: '   ' })?.error).toMatch(/exterior/i);
  });

  it('error cuando numero_exterior null/undefined', () => {
    expect(validateDireccion({ numero_exterior: null })?.error).toBeTruthy();
    expect(validateDireccion({ numero_exterior: undefined })?.error).toBeTruthy();
    expect(validateDireccion({})?.error).toBeTruthy();
  });

  it('error cuando dir es null/no-objeto', () => {
    expect(validateDireccion(null)?.error).toBeTruthy();
    expect(validateDireccion(undefined)?.error).toBeTruthy();
    expect(validateDireccion('string')?.error).toBeTruthy();
  });

  it('acepta numero_exterior numérico (común en forms web)', () => {
    expect(validateDireccion({ numero_exterior: 123 })).toBeNull();
  });

  it('acepta numero_exterior con letras (Av. 5 de Mayo Local A)', () => {
    expect(validateDireccion({ numero_exterior: '15-A' })).toBeNull();
    expect(validateDireccion({ numero_exterior: 'S/N' })).toBeNull();
  });
});

// ─── formatDireccion ───────────────────────────────────────────
describe('formatDireccion', () => {
  const completa = {
    calle: 'Av. Revolución',
    numero_exterior: '123',
    numero_interior: 'Local 4',
    colonia: 'Centro',
    ciudad: 'Culiacán',
    estado: 'Sinaloa',
    codigo_postal: '80000',
  };

  it('formato completo con todos los campos', () => {
    expect(formatDireccion(completa))
      .toBe('Av. Revolución 123, Int. Local 4, Centro, Culiacán, Sinaloa, C.P. 80000');
  });

  it('omite numero_interior si null/vacío (no muestra "Int.")', () => {
    const sinInterior = { ...completa, numero_interior: null };
    const r = formatDireccion(sinInterior);
    expect(r).not.toContain('Int.');
    expect(r).toContain('Av. Revolución 123');
    expect(r).toContain('Centro');
  });

  it('numero_exterior se concatena con calle (no como campo aparte)', () => {
    expect(formatDireccion(completa)).toContain('Av. Revolución 123,');
  });

  it('omite codigo_postal si null/vacío', () => {
    const sinCP = { ...completa, codigo_postal: '' };
    expect(formatDireccion(sinCP)).not.toContain('C.P.');
  });

  it('omite cualquier campo vacío sin dejar comas dobles', () => {
    const minima = {
      calle: 'Calle Única',
      numero_exterior: '99',
      numero_interior: null,
      colonia: null,
      ciudad: 'Durango',
    };
    expect(formatDireccion(minima)).toBe('Calle Única 99, Durango');
  });

  it('acepta camelCase (numeroExterior, numeroInterior, codigoPostal)', () => {
    const camel = {
      calle: 'Av. X',
      numeroExterior: '5',
      numeroInterior: 'Depto B',
      colonia: 'C',
      ciudad: 'D',
      codigoPostal: '12345',
    };
    expect(formatDireccion(camel)).toBe('Av. X 5, Int. Depto B, C, D, C.P. 12345');
  });

  it('fallback a `cp` legacy si codigo_postal vacío', () => {
    const conCpLegacy = {
      calle: 'C', numero_exterior: '1',
      cp: '80000', // legacy mig 002
    };
    expect(formatDireccion(conCpLegacy)).toContain('C.P. 80000');
  });

  it('null/undefined/no-objeto → string vacío', () => {
    expect(formatDireccion(null)).toBe('');
    expect(formatDireccion(undefined)).toBe('');
    expect(formatDireccion('string')).toBe('');
  });

  it('cliente con calle pero sin numero_exterior muestra solo calle', () => {
    const sinNum = { calle: 'Av. Patria', numero_exterior: '', colonia: 'Centro' };
    const r = formatDireccion(sinNum);
    expect(r).toBe('Av. Patria, Centro');
  });

  it('cliente con numero_exterior pero sin calle muestra solo el número', () => {
    expect(formatDireccion({ numero_exterior: '123', colonia: 'X' }))
      .toBe('123, X');
  });
});

// ─── buildPlaceSelection ───────────────────────────────────────
describe('buildPlaceSelection', () => {
  const place = {
    addressComponents: [
      { types: ['route'], longText: 'Av. X' },
      { types: ['street_number'], longText: '5' },
      { types: ['locality'], longText: 'D' },
    ],
    location: { lat: () => 24.79, lng: () => -107.39 },
    formattedAddress: 'Av. X 5, D, México',
  };

  it('emite shape estructurado completo', () => {
    const r = buildPlaceSelection(place);
    expect(r).toMatchObject({
      fullAddress: 'Av. X 5, D, México',
      latitud: 24.79,
      longitud: -107.39,
    });
    expect(r.components.calle).toBe('Av. X');
    expect(r.components.numero_exterior).toBe('5');
    expect(r.components.ciudad).toBe('D');
  });

  it('location como objeto plano (lat/lng como propiedades)', () => {
    const placePlano = { ...place, location: { lat: 25.0, lng: -100.0 } };
    const r = buildPlaceSelection(placePlano);
    expect(r.latitud).toBe(25.0);
    expect(r.longitud).toBe(-100.0);
  });

  it('place sin location → latitud/longitud null', () => {
    const sinLoc = { addressComponents: [], formattedAddress: 'X' };
    const r = buildPlaceSelection(sinLoc);
    expect(r.latitud).toBeNull();
    expect(r.longitud).toBeNull();
  });

  it('place null/undefined → no crashea', () => {
    expect(() => buildPlaceSelection(null)).not.toThrow();
    expect(() => buildPlaceSelection(undefined)).not.toThrow();
    expect(buildPlaceSelection(null).fullAddress).toBe('');
  });

  it('formato legacy address_components también funciona', () => {
    const legacy = {
      address_components: [
        { types: ['street_number'], long_name: '99' },
        { types: ['route'], long_name: 'Calle Y' },
      ],
      formatted_address: 'Calle Y 99',
    };
    const r = buildPlaceSelection(legacy);
    expect(r.fullAddress).toBe('Calle Y 99');
    expect(r.components.numero_exterior).toBe('99');
    expect(r.components.calle).toBe('Calle Y');
  });
});

// ─── invariantes integración ───────────────────────────────────
describe('integración: validateDireccion + formatDireccion', () => {
  it('una dirección válida formatea sin errores', () => {
    const valida = { calle: 'C', numero_exterior: '1', colonia: 'X' };
    expect(validateDireccion(valida)).toBeNull();
    expect(formatDireccion(valida)).toBeTruthy();
  });

  it('dirección inválida (sin numero_ext) aún se puede formatear', () => {
    // formatDireccion NO valida — solo formatea lo que llega.
    const incompleta = { calle: 'C', colonia: 'X' };
    expect(validateDireccion(incompleta)?.error).toBeTruthy();
    expect(formatDireccion(incompleta)).toBe('C, X');
  });
});
