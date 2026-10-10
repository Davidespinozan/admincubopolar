// p0VentaFacturaDireccion.test.js — P0: intención de factura persistida,
// contrato canónico del autocomplete y venta exprés con factura.
import { describe, it, expect } from 'vitest';
import { buildOrdenPayload } from '../data/ordenLogic';
import { buildPlaceSelection, placeSelectionToEntrega } from '../data/direccionLogic';
import { validarVentaExpressFactura } from '../data/ventaExpressLogic';

const ctx = { folio: 'OV-0100', clienteNombre: 'Acme', total: 100, productosStr: '1×HPC-5K' };

describe('requiere_factura se persiste explícitamente', () => {
  it('checkbox true → true', () => {
    expect(buildOrdenPayload({ clienteId: 1, requiereFactura: true }, ctx).requiere_factura).toBe(true);
  });
  it('checkbox false → false', () => {
    expect(buildOrdenPayload({ clienteId: 1, requiereFactura: false }, ctx).requiere_factura).toBe(false);
  });
  it('sin toggle (undefined, admin sin toggleFactura) → false, nunca inferido del RFC', () => {
    expect(buildOrdenPayload({ clienteId: 1 }, ctx).requiere_factura).toBe(false);
    expect(buildOrdenPayload({ clienteId: 1, requiereFactura: 'true' }, ctx).requiere_factura).toBe(false);
    expect(buildOrdenPayload({ clienteId: 1, requiereFactura: null }, ctx).requiere_factura).toBe(false);
  });
});

describe('placeSelectionToEntrega (contrato AddressAutocomplete → modales)', () => {
  const place = {
    addressComponents: [
      { types: ['route'], longText: 'Av. 20 de Noviembre' },
      { types: ['street_number'], longText: '500' },
      { types: ['sublocality'], longText: 'Centro' },
      { types: ['locality'], longText: 'Durango' },
      { types: ['administrative_area_level_1'], longText: 'Durango' },
      { types: ['postal_code'], longText: '34000' },
    ],
    location: { lat: () => 24.0277, lng: () => -104.6532 },
    formattedAddress: 'Av. 20 de Noviembre 500, Centro, 34000 Durango, Dgo., México',
  };

  it('seleccionar dirección → texto, lat y lng correctos (shape de buildPlaceSelection)', () => {
    const selection = buildPlaceSelection(place);
    expect(selection).toHaveProperty('fullAddress');
    expect(selection).toHaveProperty('latitud');
    expect(selection).toHaveProperty('longitud');
    // El shape viejo (formatted/lat/lng) NO existe: los modales no deben leerlo.
    expect(selection).not.toHaveProperty('formatted');
    expect(selection).not.toHaveProperty('lat');

    const entrega = placeSelectionToEntrega(selection);
    expect(entrega).toEqual({
      direccionEntrega: 'Av. 20 de Noviembre 500, Centro, 34000 Durango, Dgo., México',
      latitudEntrega: 24.0277,
      longitudEntrega: -104.6532,
    });
  });

  it('payload → columnas de la orden correctas', () => {
    const entrega = placeSelectionToEntrega(buildPlaceSelection(place));
    const payload = buildOrdenPayload({ clienteId: 1, ...entrega }, ctx);
    expect(payload.direccion_entrega).toBe('Av. 20 de Noviembre 500, Centro, 34000 Durango, Dgo., México');
    expect(payload.latitud_entrega).toBe(24.0277);
    expect(payload.longitud_entrega).toBe(-104.6532);
  });

  it('sin formattedAddress → arma el texto desde components', () => {
    const sel = buildPlaceSelection({ ...place, formattedAddress: '' });
    const entrega = placeSelectionToEntrega(sel);
    expect(entrega.direccionEntrega).toBe('Av. 20 de Noviembre 500, Centro, Durango, Durango, C.P. 34000');
    expect(entrega.latitudEntrega).toBe(24.0277);
  });

  it('sin coordenadas → null, nunca NaN; selección nula → vacío', () => {
    const sel = buildPlaceSelection({ addressComponents: [], formattedAddress: 'X' });
    expect(placeSelectionToEntrega(sel)).toEqual({ direccionEntrega: 'X', latitudEntrega: null, longitudEntrega: null });
    expect(placeSelectionToEntrega(null)).toEqual({ direccionEntrega: '', latitudEntrega: null, longitudEntrega: null });
  });
});

describe('validarVentaExpressFactura', () => {
  const cliNominativo = { id: 7, nombre: 'Acme SA de CV', rfc: 'ACM010101AB1' };
  const cliGenerico = { id: 8, nombre: 'Tiendita', rfc: 'XAXX010101000' };

  it('sin factura → siempre válido (anónima o con cliente)', () => {
    expect(validarVentaExpressFactura({ factura: false, cliente: null })).toBeNull();
    expect(validarVentaExpressFactura({ factura: false, cliente: cliGenerico })).toBeNull();
  });
  it('con factura y cliente nominativo → válido', () => {
    expect(validarVentaExpressFactura({ factura: true, cliente: cliNominativo })).toBeNull();
  });
  it('con factura sin cliente registrado → error (no se pierde en silencio)', () => {
    expect(validarVentaExpressFactura({ factura: true, cliente: null })?.error).toMatch(/cliente registrado/);
    expect(validarVentaExpressFactura({ factura: true, cliente: { id: '' } })?.error).toMatch(/cliente registrado/);
  });
  it('con factura y RFC genérico o vacío → error', () => {
    expect(validarVentaExpressFactura({ factura: true, cliente: cliGenerico })?.error).toMatch(/RFC nominativo/);
    expect(validarVentaExpressFactura({ factura: true, cliente: { id: 9, rfc: '' } })?.error).toMatch(/RFC nominativo/);
  });
});

describe('127: validarClienteNuevoChofer (espejo de crear_cliente_chofer)', () => {
  const ok = { nombre: 'Hielos SA', rfc: 'HSA010101AB1', regimen: '601', usoCfdi: 'G03', cp: '34000', correo: 'fact@hielos.mx' };
  it('acepta datos fiscales completos', async () => {
    const { validarClienteNuevoChofer } = await import('../data/ventaExpressLogic');
    expect(validarClienteNuevoChofer(ok)).toBeNull();
  });
  it.each([
    ['nombre', { nombre: ' ' }],
    ['RFC genérico', { rfc: 'XAXX010101000' }],
    ['RFC mal formado', { rfc: 'ABC' }],
    ['régimen', { regimen: '' }],
    ['uso CFDI', { usoCfdi: '' }],
    ['CP', { cp: '340' }],
    ['correo', { correo: 'sin-arroba' }],
  ])('rechaza %s', async (_t, cambio) => {
    const { validarClienteNuevoChofer } = await import('../data/ventaExpressLogic');
    expect(validarClienteNuevoChofer({ ...ok, ...cambio })?.error).toBeTruthy();
  });
});
