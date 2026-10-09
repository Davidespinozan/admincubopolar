// bloqueA.test.jsx — correcciones del bloque A (2026-10-09): título sin
// duplicar, favicon con el oso, avisos separados (alertas vs notificaciones),
// ventas que esperan ruta y hoja de detalle de venta.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { PageHeader } from '../components/ui/Components';
import DetalleVentaModal, { lineasDeVenta } from '../components/DetalleVentaModal';
import { destinoAlerta, tituloAlerta, claveAlerta, alertasVisibles, leerOcultas, guardarOcultas, alertaEsperanRuta } from '../data/avisosLogic';
import { construirBandeja, ordenesEsperanRuta } from '../data/bandejaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const html = (el) => renderToStaticMarkup(el);

describe('título de pantalla una sola vez', () => {
  it('PageHeader no pinta el título (vive en la barra superior)', () => {
    const h = html(<PageHeader title="Mis actividades" subtitle="Lo que tienes asignado" />);
    expect(h).not.toMatch(/<h1/);
    expect(h).not.toMatch(/>Mis actividades</);
    expect(h).toMatch(/Lo que tienes asignado/);
    expect(h).toMatch(/hidden sm:flex/);
  });
  it('sin acciones ni subtítulo no ocupa espacio', () => {
    expect(html(<PageHeader title="X" />)).toMatch(/class="[^"]*\bhidden\b/);
  });
});

describe('favicon', () => {
  it('pestaña con el oso de Cubo Polar, sin el cuadro "CP" provisional', () => {
    const index = src('../../index.html');
    expect(index).toMatch(/href="\/favicon-32\.png"/);
    expect(index).toMatch(/rel="apple-touch-icon" sizes="180x180" href="\/apple-touch-icon\.png"/);
    expect(index).not.toMatch(/favicon\.svg/);
    for (const f of ['favicon-16.png', 'favicon-32.png', 'favicon-48.png', 'apple-touch-icon.png']) {
      expect(existsSync(fileURLToPath(new URL(`../../public/${f}`, import.meta.url))), f).toBe(true);
    }
  });
});

describe('avisos: alertas vs notificaciones', () => {
  it('cada alerta lleva al módulo donde se resuelve', () => {
    expect(destinoAlerta({ id: 'ruta-pend' })).toBe('rutas');
    expect(destinoAlerta({ id: 'cxc-4' })).toBe('cobros');
    expect(destinoAlerta({ id: 'comp-9' })).toBe('facturacion');
    expect(destinoAlerta({ id: 'prod-min-HPC-5K' })).toBe('produccion');
    expect(destinoAlerta({ id: 12, tipo: 'critica' })).toBe('inventario');
    expect(tituloAlerta({ id: 12, tipo: 'critica' })).toBe('Stock crítico');
    expect(tituloAlerta({ id: 'cxc-1' })).toBe('Cobro vencido');
  });
  it('ocultar hoy: por id + mensaje (si la cifra cambia, vuelve)', () => {
    const a = { id: 3, msg: 'HPC-5K nivel bajo — 640' };
    const b = { id: 3, msg: 'HPC-5K nivel bajo — 500' };
    expect(alertasVisibles([a, b], [claveAlerta(a)])).toEqual([b]);
  });
  it('lo oculto se guarda solo para el día en curso y tolera almacenamiento roto', () => {
    const mem = new Map();
    const st = { get length() { return mem.size; }, key: i => [...mem.keys()][i], getItem: k => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v), removeItem: k => mem.delete(k) };
    guardarOcultas('2026-10-08', ['x'], st);
    guardarOcultas('2026-10-09', ['y', 'y'], st);
    expect(leerOcultas('2026-10-09', st)).toEqual(['y']);
    expect(leerOcultas('2026-10-08', st)).toEqual([]);
    const roto = { getItem() { throw new Error('bloqueado'); }, setItem() { throw new Error('bloqueado'); }, length: 0 };
    expect(leerOcultas('2026-10-09', roto)).toEqual([]);
    expect(() => guardarOcultas('2026-10-09', ['z'], roto)).not.toThrow();
  });
  it('el panel separa "Por resolver" de "Notificaciones" y solo estas se marcan leídas', () => {
    const shell = src('../components/CuboPolarERP.jsx');
    expect(shell).toMatch(/data-testid="avisos-alertas"/);
    expect(shell).toMatch(/data-testid="avisos-notificaciones"/);
    expect(shell).toMatch(/Se quitan solas cuando se resuelven/);
    expect(shell).toMatch(/aria-label="Ocultar hoy"/);
    expect(shell).toMatch(/go\(destinoAlerta\(a\)\)/);
  });
});

describe('ventas que esperan ruta', () => {
  const ordenes = [
    { id: 1, folio: 'OV-1', estatus: 'Asignada', ruta_id: null },
    { id: 2, folio: 'OV-2', estatus: 'Asignada', ruta_id: 7 },
    { id: 3, folio: 'OV-3', estatus: 'Creada' },
    { id: 4, folio: 'OV-4', estatus: 'Asignada' },
  ];
  it('Asignada sin ruta = Ventas la mandó a reparto y falta la ruta', () => {
    expect(ordenesEsperanRuta(ordenes).map(o => o.id)).toEqual([1, 4]);
  });
  it('alerta de campana con folios, y nada si no hay', () => {
    const a = alertaEsperanRuta(ordenesEsperanRuta(ordenes));
    expect(a).toMatchObject({ id: 'ruta-pend', tipo: 'critica', titulo: '2 ventas esperan ruta' });
    expect(a.msg).toMatch(/OV-1, OV-4/);
    expect(alertaEsperanRuta([])).toBeNull();
    expect(destinoAlerta(a)).toBe('rutas');
  });
  it('en Mi bandeja es urgente; no se cuenta como stock', () => {
    const t = construirBandeja({ ordenes, alertas: [{ id: 'ruta-pend', tipo: 'critica', msg: 'x' }] }, '2026-10-09');
    expect(t.find(x => x.id === 'ordenes-esperan-ruta')).toMatchObject({ prioridad: 'alta', modulo: 'rutas', count: 2 });
    expect(t.find(x => x.id === 'stock-critico')).toBeUndefined();
  });
  it('el store agrega la alerta a la campana', () => {
    expect(src('../data/supaStore.js')).toMatch(/alertaEsperanRuta\(ordenesEsperanRuta\(ord \|\| \[\]\)\)/);
  });
});

describe('detalle de venta', () => {
  const productos = [{ sku: 'HPC-5K', nombre: 'Hielo en Cubos 5 kg' }];
  const orden = { id: 90, folio: 'OV-0090', cliente: 'Abarrotes Doña Lupe', estatus: 'Creada', fecha: '2026-10-09', total: 620,
    ruta: '—', preciosSnapshot: [{ sku: 'HPC-5K', qty: 20, unitPrice: 31, lineTotal: 620 }] };
  it('líneas con nombre, cantidad, precio y subtotal; respaldo desde el texto', () => {
    expect(lineasDeVenta(orden, productos)).toEqual([{ sku: 'HPC-5K', nombre: 'Hielo en Cubos 5 kg', qty: 20, unit: 31, total: 620 }]);
    expect(lineasDeVenta({ productos: '10×HPC-5K, 2×HIB-50K' }, productos).map(l => [l.nombre, l.qty])).toEqual([['Hielo en Cubos 5 kg', 10], ['HIB-50K', 2]]);
  });
  it('muestra productos, pagos, CxC y acciones deshabilitadas con su motivo', () => {
    const data = { productos, pagos: [{ id: 1, ordenId: 90, monto: 100, metodoPago: 'Efectivo', fecha: '2026-10-09' }],
      cuentasPorCobrar: [{ id: 5, ordenId: 90, saldoPendiente: 520, fechaVencimiento: '2026-11-08', estatus: 'Pendiente' }] };
    const h = html(<DetalleVentaModal orden={orden} data={data} onClose={() => {}} acciones={[
      { id: 'editar', label: 'Editar venta', onClick: () => {} },
      { id: 'eliminar', label: 'Eliminar', deshabilitada: true, nota: 'Tiene pagos asociados. Usa Cancelar.', onClick: () => {} },
    ]} />);
    expect(h).toMatch(/data-testid="detalle-venta"/);
    expect(h).toMatch(/Hielo en Cubos 5 kg/);
    expect(h).toMatch(/Crédito: saldo/);
    expect(h).toMatch(/Sin ruta \(mostrador o por asignar\)/);
    expect(h).toMatch(/<button type="button" disabled=""[^>]*data-testid="detalle-accion-eliminar"/);
    expect(h).toMatch(/Tiene pagos asociados\. Usa Cancelar\./);
  });
  it('tocar una venta abre el detalle (Admin y Ventas)', () => {
    expect(src('../components/views/OrdenesView.jsx')).toMatch(/onRowClick=\{row => setDetalle\(row\)\}/);
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/onClick=\{\(\) => setDetalleId\(o\.id\)\}/);
  });
  it('sin glifos de texto como íconos en Ventas', () => {
    expect(src('../components/views/OrdenesView.jsx')).not.toMatch(/⊘/);
  });
});
