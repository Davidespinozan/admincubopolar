// b36VentasWorkspace.test.jsx — B3.6: Ventas es UN espacio de trabajo con
// filtros internos (Pendientes / Hoy / Todas). Solo información y
// presentación: mismas órdenes, mismas acciones por estatus, mismos contratos.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import VentasStandaloneView from '../components/VentasStandaloneView';
import { esPendienteVendedor, esDelChofer, resumenPendientes } from '../data/ventasResumenLogic';
import { accionesCobroVentas } from '../data/ventasCobroLogic';
import { navParaRol, bottomNavParaRol, idsModulos, itemsModulos } from '../data/navRolLogic';
import { diaNegocio } from '../utils/fechas';

const HOY = diaNegocio();
const O = (id, estatus, extra = {}) => ({ id, folio: `OV-${id}`, cliente: `Cliente ${id}`, productos: '2x HPC-5K', total: 100, estatus, ruta_id: null, vendedor_id: 5, fecha: '2026-01-01', ...extra });
const ORDENES = [
  O(1, 'Creada'),                                        // por cobrar
  O(2, 'Asignada'),                                      // enviada a ruta, sin ruta → cobrar entrega
  O(3, 'Asignada', { ruta_id: 7, ruta: 'R-7' }),         // con el chofer
  O(4, 'En ruta', { ruta_id: 7 }),                       // con el chofer
  O(5, 'Entregada', { fecha: HOY }),
  O(6, 'Creada', { fecha: HOY }),                        // pagada por link → por entregar
  O(7, 'Cancelada'),
  O(8, 'Facturada'),
  O(9, 'No entregada', { ruta_id: 7 }),
  O(10, 'Creada', { vendedor_id: 6 }),                   // de otro vendedor
];
const PAGOS = [{ ordenId: 6, monto: 100 }];
const ids = (b) => b.ordenes.map(o => o.id);

describe('B3.6 Pendientes: predicado exacto (mismas reglas que los botones de la tarjeta)', () => {
  it('pendiente = la tarjeta ofrece Cobrar / Cobrar entrega (Creada, o Asignada SIN ruta)', () => {
    const m = Object.fromEntries(ORDENES.map(o => [o.id, esPendienteVendedor(o)]));
    expect(m).toEqual({ 1: true, 2: true, 3: false, 4: false, 5: false, 6: true, 7: false, 8: false, 9: false, 10: true });
    for (const o of ORDENES) {
      const a = accionesCobroVentas(o);
      expect(esPendienteVendedor(o), o.estatus).toBe(a.cobrar || a.cobrarEntrega);
    }
    expect(esPendienteVendedor(null)).toBe(false);
  });
  it('con el chofer (informativo, sin acción del vendedor): Asignada con ruta y En ruta', () => {
    expect(ORDENES.filter(esDelChofer).map(o => o.id)).toEqual([3, 4]);
  });
  it('grupos: por cobrar vs pagadas por link (por entregar); montos = Σ totales guardados', () => {
    const r = resumenPendientes(ORDENES.filter(o => o.vendedor_id === 5), PAGOS);
    expect(ids(r.porCobrar)).toEqual([1, 2]);
    expect(ids(r.pagadasPorEntregar)).toEqual([6]);
    expect(ids(r.conChofer)).toEqual([3, 4]);
    expect(r.porCobrar.monto).toBe(200);
    expect(r.count).toBe(3);
    expect(r.vacio).toBe(false);
    expect(resumenPendientes([], []).vacio).toBe(true);
    expect(resumenPendientes(null, null)).toMatchObject({ count: 0, vacio: true });
  });
});

const render = ({ filtro, rol = 'Ventas', ordenes = ORDENES } = {}) => renderToStaticMarkup(
  <VentasStandaloneView embedded filtro={filtro} onFiltro={() => {}}
    user={{ id: 5, rol, nombre: 'Vendedor A' }} data={{ ordenes, pagos: PAGOS, clientes: [], cuartosFrios: [], productos: [] }} actions={{}} onLogout={() => {}} />,
);
// folios de las TARJETAS de orden (no del resumen)
const folios = (h) => [...h.matchAll(/font-mono text-xs font-bold text-blue-700">(OV-\d+)</g)].map(m => m[1]);

describe('B3.6 espacio de trabajo renderizado', () => {
  it('un solo control de filtros (tablist) con Pendientes / Hoy / Todas y el seleccionado marcado (aria-selected)', () => {
    const h = render({ filtro: 'pendientes' });
    expect((h.match(/role="tablist"/g) || []).length).toBe(1);
    expect([...h.matchAll(/role="tab" aria-selected="(true|false)"[^>]*>(?:<span[^>]*>.*?<\/span>)?<span class="truncate">([^<]+)</g)].map(m => [m[2], m[1]]))
      .toEqual([['Pendientes', 'true'], ['Hoy', 'false'], ['Todas', 'false']]);
    expect(h).toMatch(/data-testid="ventas-barra"/);
    expect(h).toMatch(/Nueva venta/);
    expect(h).not.toMatch(/data-testid="bottom-nav"/);
  });
  it('Pendientes: solo lo accionable del vendedor (propias), en sus dos grupos; las del chofer como dato', () => {
    const h = render({ filtro: 'pendientes' });
    expect(folios(h)).toEqual(['OV-1', 'OV-2', 'OV-6']);
    expect(h).toMatch(/data-testid="grupo-por-cobrar"/);
    expect(h).toMatch(/data-testid="grupo-pagadas-por-entregar"[\s\S]*Entregar pedido pagado/);
    expect(h).toMatch(/data-testid="pend-chofer"/);
    expect(h).toMatch(/Enviar a ruta/);            // Creada: Cobrar + Enviar a ruta (sin cambio)
    expect(h).toMatch(/Cobrar entrega/);           // Asignada sin ruta (sin cambio)
  });
  it('Hoy: las órdenes del día de negocio (misma regla de fecha)', () => {
    const h = render({ filtro: 'hoy' });
    expect(folios(h)).toEqual(['OV-5', 'OV-6']);
    expect(h).toMatch(/data-testid="resumen-hoy"/);
  });
  it('Todas: todas las del alcance del vendedor, incluidas las del chofer (etiqueta pasiva) y terminales', () => {
    const h = render({ filtro: 'todas' });
    expect(folios(h)).toEqual(['OV-1', 'OV-2', 'OV-3', 'OV-4', 'OV-5', 'OV-6', 'OV-7', 'OV-8', 'OV-9']);
    expect(h).not.toMatch(/OV-10</);              // de otro vendedor: fuera del alcance (sin cambio)
    expect(h).toMatch(/data-testid="orden-en-ruta-chofer"[^>]*>[\s\S]*la cobra el chofer/);
    expect(h).toMatch(/data-testid="resumen-todas"/);
  });
  it('filtro desconocido o ausente → Pendientes (determinista)', () => {
    expect(folios(render({ filtro: 'raro' }))).toEqual(['OV-1', 'OV-2', 'OV-6']);
    expect(folios(render({}))).toEqual(['OV-1', 'OV-2', 'OV-6']);
  });
  it('vacíos coherentes por filtro', () => {
    expect(render({ filtro: 'pendientes', ordenes: [] })).toMatch(/Sin pendientes/);
    expect(render({ filtro: 'hoy', ordenes: [] })).toMatch(/Aún no hay ventas hoy/);
    expect(render({ filtro: 'todas', ordenes: [] })).toMatch(/No has hecho ventas todavía/);
    // solo órdenes con el chofer: Pendientes vacío explica dónde verlas, sin KPIs en $0
    const h = render({ filtro: 'pendientes', ordenes: [O(3, 'Asignada', { ruta_id: 7 })] });
    expect(h).toMatch(/Sin pendientes[\s\S]*las ves en Todas/);
    expect(h).not.toMatch(/\$0\.00/);
  });
  it('Admin en "Ver como Ventas": misma IA, datos sin recorte por vendedor (semántica existente)', () => {
    const h = render({ filtro: 'todas', rol: 'Admin' });
    expect(folios(h)).toContain('OV-10');
    expect((h.match(/role="tablist"/g) || []).length).toBe(1);
  });
});

describe('B3.6 navegación del rol', () => {
  it('Ventas: un destino en el menú; sin barra inferior; los demás roles igual', () => {
    expect(itemsModulos(navParaRol('Ventas')).map(i => i.label)).toEqual(['Ventas']);
    expect(bottomNavParaRol(navParaRol('Ventas'))).toBeNull();
    expect(bottomNavParaRol(navParaRol('Producción')).items).toHaveLength(4);
    expect(bottomNavParaRol(navParaRol('Admin')).items.map(i => i.id)).toEqual(['dashboard', 'bandeja', 'ordenes', 'cobros']);
    expect(idsModulos(navParaRol('Admin')).has('ordenes')).toBe(true);   // la vista de Ventas de Admin no cambia
  });
});
