// mejorasMenores.test.js — Tanda 6: helpers puros.
// Cubre precioParaCliente, filtrarPreciosEsp, validarCobroTransferencia,
// traducirErrorCamionRutaActiva.
import { describe, it, expect } from 'vitest';
import {
  precioParaCliente,
  filtrarPreciosEsp,
  validarCobroTransferencia,
  traducirErrorCamionRutaActiva,
} from '../data/mejorasMenoresLogic';

// ─── precioParaCliente ───────────────────────────────────────
describe('precioParaCliente', () => {
  const productos = [
    { sku: 'HC-25K', precio: 90 },
    { sku: 'HC-5K', precio: 30 },
  ];
  const preciosEsp = [
    { clienteId: 7, sku: 'HC-25K', precio: 80 },
    { cliente_id: 9, sku: 'HC-5K', precio: 25 }, // snake_case shape
  ];

  it('retorna precio especial cuando existe match cliente+sku', () => {
    expect(precioParaCliente(7, 'HC-25K', productos, preciosEsp)).toBe(80);
  });

  it('acepta cliente_id (snake_case) en preciosEsp', () => {
    expect(precioParaCliente(9, 'HC-5K', productos, preciosEsp)).toBe(25);
  });

  it('retorna precio público si no hay precio especial para ese cliente', () => {
    expect(precioParaCliente(99, 'HC-25K', productos, preciosEsp)).toBe(90);
  });

  it('retorna precio público si clienteId es null', () => {
    expect(precioParaCliente(null, 'HC-25K', productos, preciosEsp)).toBe(90);
  });

  it('retorna 0 si SKU no existe', () => {
    expect(precioParaCliente(7, 'NO-EXISTE', productos, preciosEsp)).toBe(0);
  });

  it('retorna 0 si SKU vacío', () => {
    expect(precioParaCliente(7, '', productos, preciosEsp)).toBe(0);
    expect(precioParaCliente(7, null, productos, preciosEsp)).toBe(0);
  });

  it('compara IDs como strings (tolera mismatch number/string)', () => {
    expect(precioParaCliente('7', 'HC-25K', productos, preciosEsp)).toBe(80);
  });

  it('retorna 0 cuando no hay productos ni preciosEsp', () => {
    expect(precioParaCliente(7, 'HC-25K')).toBe(0);
  });
});

// ─── filtrarPreciosEsp ───────────────────────────────────────
describe('filtrarPreciosEsp', () => {
  const precios = [
    { id: 1, clienteId: 1, clienteNom: 'Hotel Plaza',  sku: 'HC-25K', precio: 80 },
    { id: 2, clienteId: 2, clienteNom: 'Restaurante La Mesa', sku: 'HC-25K', precio: 70 },
    { id: 3, clienteId: 1, clienteNom: 'Hotel Plaza',  sku: 'HC-5K',  precio: 28 },
    { id: 4, clienteId: 3, clienteNom: 'Cafetería El Sol', sku: 'HIB-1', precio: 95 },
  ];
  const precioBaseMap = { 'HC-25K': 90, 'HC-5K': 30, 'HIB-1': 100 };
  // 'HC-25K' base 90 → 80=11.1% desc, 70=22.2% desc
  // 'HC-5K'  base 30 → 28=6.6% desc
  // 'HIB-1'  base 100 → 95=5% desc

  it('sin filtros devuelve todos', () => {
    expect(filtrarPreciosEsp({ precios, precioBaseMap })).toHaveLength(4);
  });

  it('filterSku excluye SKUs distintos', () => {
    const r = filtrarPreciosEsp({ precios, filterSku: 'HC-25K', precioBaseMap });
    expect(r).toHaveLength(2);
    expect(r.map(x => x.id)).toEqual([1, 2]);
  });

  it('filterClienteId excluye otros clientes', () => {
    const r = filtrarPreciosEsp({ precios, filterClienteId: '1', precioBaseMap });
    expect(r).toHaveLength(2);
    expect(r.map(x => x.id).sort()).toEqual([1, 3]);
  });

  it('search por cliente (case-insensitive con normalizeStr custom)', () => {
    const norm = (x) => String(x || '').toLowerCase();
    const r = filtrarPreciosEsp({ precios, search: 'PLAZA', normalizeStr: norm, precioBaseMap });
    expect(r.map(x => x.id).sort()).toEqual([1, 3]);
  });

  it('search por SKU', () => {
    const r = filtrarPreciosEsp({ precios, search: 'HIB', precioBaseMap });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(4);
  });

  it('soloDescuentoMayor=true deja solo > 10%', () => {
    const r = filtrarPreciosEsp({ precios, soloDescuentoMayor: true, precioBaseMap });
    // HC-25K@80 (11.1%) y HC-25K@70 (22.2%) pasan, los demás no.
    expect(r).toHaveLength(2);
    expect(r.map(x => x.id).sort()).toEqual([1, 2]);
  });

  it('combinación: search + filterSku + soloDescuentoMayor', () => {
    const r = filtrarPreciosEsp({
      precios,
      search: 'plaza',
      filterSku: 'HC-25K',
      soloDescuentoMayor: true,
      precioBaseMap,
    });
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe(1);
  });

  it('search vacío no filtra', () => {
    expect(filtrarPreciosEsp({ precios, search: '   ', precioBaseMap })).toHaveLength(4);
  });

  it('retorna [] si no hay matches', () => {
    expect(filtrarPreciosEsp({ precios, search: 'xyz-no-existe', precioBaseMap })).toHaveLength(0);
  });

  it('precios vacío retorna []', () => {
    expect(filtrarPreciosEsp({})).toEqual([]);
  });
});

// ─── validarCobroTransferencia ───────────────────────────────
describe('validarCobroTransferencia', () => {
  it('Transferencia sin foto → error', () => {
    expect(validarCobroTransferencia({ metodoPago: 'Transferencia', fotoTransf: null }))
      .toEqual({ error: 'Foto del comprobante obligatoria para transferencias' });
    expect(validarCobroTransferencia({ metodoPago: 'Transferencia', fotoTransf: '' }))
      .toEqual({ error: 'Foto del comprobante obligatoria para transferencias' });
    expect(validarCobroTransferencia({ metodoPago: 'Transferencia', fotoTransf: undefined }))
      .toEqual({ error: 'Foto del comprobante obligatoria para transferencias' });
  });

  it('Transferencia con foto → null', () => {
    expect(validarCobroTransferencia({ metodoPago: 'Transferencia', fotoTransf: 'data:image/jpeg;base64,...' })).toBeNull();
  });

  it('Otros métodos no exigen foto', () => {
    expect(validarCobroTransferencia({ metodoPago: 'Efectivo', fotoTransf: null })).toBeNull();
    expect(validarCobroTransferencia({ metodoPago: 'Tarjeta', fotoTransf: null })).toBeNull();
    expect(validarCobroTransferencia({ metodoPago: 'Crédito', fotoTransf: null })).toBeNull();
    expect(validarCobroTransferencia({ metodoPago: 'QR / Link de pago', fotoTransf: null })).toBeNull();
  });

  it('metodoPago vacío → null', () => {
    expect(validarCobroTransferencia({ metodoPago: '', fotoTransf: null })).toBeNull();
    expect(validarCobroTransferencia({ metodoPago: null, fotoTransf: null })).toBeNull();
  });
});

// ─── traducirErrorCamionRutaActiva ───────────────────────────
describe('traducirErrorCamionRutaActiva', () => {
  it('error 23505 con índice idx_camion_ruta_activa → mensaje friendly', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "idx_camion_ruta_activa"' };
    expect(traducirErrorCamionRutaActiva(err)).toBe('Este camión ya está asignado a otra ruta activa');
  });

  it('error 23505 con OTRO índice (chofer) → null', () => {
    const err = { code: '23505', message: 'duplicate key value violates unique constraint "idx_ruta_chofer_activa"' };
    expect(traducirErrorCamionRutaActiva(err)).toBeNull();
  });

  it('error con code distinto → null', () => {
    const err = { code: '23502', message: 'idx_camion_ruta_activa' };
    expect(traducirErrorCamionRutaActiva(err)).toBeNull();
  });

  it('null/undefined → null', () => {
    expect(traducirErrorCamionRutaActiva(null)).toBeNull();
    expect(traducirErrorCamionRutaActiva(undefined)).toBeNull();
  });

  it('error sin message → null', () => {
    expect(traducirErrorCamionRutaActiva({ code: '23505' })).toBeNull();
  });

  it('match case-insensitive', () => {
    const err = { code: '23505', message: 'IDX_CAMION_RUTA_ACTIVA' };
    expect(traducirErrorCamionRutaActiva(err)).toBe('Este camión ya está asignado a otra ruta activa');
  });
});
