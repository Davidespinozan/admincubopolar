// e8ReportesTiendas.test.jsx — Tiendas E8: reportes por establecimiento y consolidados.
// Reglas de pantalla (periodo, selector, comprobaciones de cuadre, diferencia de caja) y garantías
// del código: solo lectura por contrato, solo Admin, y nada de esto llega a las pantallas del cajero.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  sumarDias, rangoReportePorOmision, validarRangoReporte, opcionesEstablecimiento, TIPO_ESTABLECIMIENTO, consolidadoCuadra, unidadesCuadran, textoDiferencia,
  clasificarErrorPos,
} from '../data/posLogic';
import { ReportesTiendasPanel } from '../components/views/ReportesTiendasPanel';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const EST = [{ id: 7, nombre: 'Tienda Norte', tipo: 'tienda', activo: false }, { id: 1, nombre: 'CEDIS', tipo: 'cedis', activo: true }, { id: 3, nombre: 'Tienda Fábrica', tipo: 'tienda_fabrica', activo: true }];
const fila = (id, o = {}) => ({ id, nombre: `E${id}`, tipo: 'tienda', ventas: 0, unidades: 0, bruto: 0, devoluciones: 0, neto: 0, cobrado: 0, ...o });

describe('E8: periodo del reporte', () => {
  it('por omisión son los últimos 7 días de negocio, terminando hoy (cruza mes y año sin depender de la zona del navegador)', () => {
    expect(rangoReportePorOmision('2026-10-13')).toEqual({ desde: '2026-10-07', hasta: '2026-10-13' });
    expect(rangoReportePorOmision('2027-01-02')).toEqual({ desde: '2026-12-27', hasta: '2027-01-02' });
    expect(sumarDias('2028-03-01', -1)).toBe('2028-02-29');
  });
  it('valida igual que el servidor: dos fechas, en orden, máximo 400 días', () => {
    expect(validarRangoReporte('2026-10-01', '2026-10-01')).toEqual({ desde: '2026-10-01', hasta: '2026-10-01' });
    expect(validarRangoReporte('', '2026-10-01').error).toMatch(/Elige/);
    expect(validarRangoReporte('2026-10-02', '2026-10-01').error).toMatch(/posterior/);
    expect(validarRangoReporte('2025-01-01', '2026-10-01').error).toMatch(/400/);
    expect(validarRangoReporte('2026-10-01', sumarDias('2026-10-01', 400)).error).toBeUndefined();
  });
  it('el rechazo del servidor por periodo tiene mensaje propio', () => {
    expect(clasificarErrorPos({ code: '22023', details: '{"codigo":"RANGO_INVALIDO"}', message: 'x' }).mensaje).toMatch(/periodo|fecha/i);
  });
});

describe('E8: selector y comprobaciones', () => {
  it('el selector ofrece el consolidado y cada establecimiento; el CEDIS son las ventas centrales', () => {
    const o = opcionesEstablecimiento(EST);
    expect(o.map(x => x.value)).toEqual(['', '1', '3', '7']);
    expect(o[0].label).toMatch(/Consolidado/);
    expect(o[1].label).toMatch(/ventas centrales/);
    expect(o[3].label).toMatch(/inactiva/);
    expect(opcionesEstablecimiento(null)).toHaveLength(1);
    expect(Object.keys(TIPO_ESTABLECIMIENTO)).toEqual(['cedis', 'tienda_fabrica', 'tienda']);
  });
  it('el consolidado debe ser la suma exacta de los establecimientos (sin doble conteo)', () => {
    const por = [fila(1, { ventas: 2, unidades: 10, bruto: 310.1, devoluciones: 31, neto: 279.1, cobrado: 310.1 }), fila(3, { ventas: 1, unidades: 3, bruto: 93.2, neto: 93.2, cobrado: 93.2 })];
    const ok = { por_establecimiento: por, consolidado: { ventas: 3, unidades: 13, bruto: 403.3, devoluciones: 31, neto: 372.3, cobrado: 403.3 } };
    expect(consolidadoCuadra(ok)).toBe(true);
    expect(consolidadoCuadra({ ...ok, consolidado: { ...ok.consolidado, bruto: 496.5 } })).toBe(false);
    expect(consolidadoCuadra({ por_establecimiento: por })).toBe(false);
  });
  it('unidades de traspaso: despachadas = recibidas + retornadas + dañadas + faltantes + en tránsito', () => {
    expect(unidadesCuadran({ despachadas: 20, recibidas_correctamente: 12, retornadas: 3, danadas: 2, faltantes: 1, en_transito: 2 })).toBe(true);
    expect(unidadesCuadran({ despachadas: 20, recibidas_correctamente: 12, retornadas: 3, danadas: 2, faltantes: 1, en_transito: 0 })).toBe(false);
    expect(unidadesCuadran(null)).toBe(false);
  });
  it('la diferencia de caja solo existe en un turno cerrado', () => {
    expect(textoDiferencia({ estado: 'abierto', diferencia: null })).toEqual({ tono: 'neutro', texto: 'Turno abierto' });
    expect(textoDiferencia({ estado: 'cerrado', diferencia: 0 }).texto).toBe('Cuadró');
    expect(textoDiferencia({ estado: 'cerrado', diferencia: -5 })).toMatchObject({ tono: 'error' });
    expect(textoDiferencia({ estado: 'cerrado', diferencia: -5 }).texto).toMatch(/Faltaron.*5/);
    expect(textoDiferencia({ estado: 'cerrado', diferencia: 12.5 }).texto).toMatch(/Sobraron.*12\.50/);
  });
});

describe('E8: garantías del código', () => {
  const store = src('../data/supaStore.js');
  const panel = sinComentarios(src('../components/views/ReportesTiendasPanel.jsx'));
  it('el store pide los cuatro reportes por contrato, detrás de requireAdmin, con el periodo y el establecimiento', () => {
    expect(store).toMatch(/reportesTiendas: async \(\{ desde, hasta, establecimientoId = null \}\) => \{\s*const guard = requireAdmin\(\);\s*if \(guard\) return guard;/);
    const cuerpo = store.slice(store.indexOf('reportesTiendas: async'), store.indexOf('reportesTiendas: async') + 1600);
    for (const f of ['reporte_ventas_establecimientos', 'reporte_cajas_tiendas', 'reporte_inventario_establecimientos', 'reporte_abastecimiento_tiendas']) expect(cuerpo).toContain(`'${f}'`);
    expect(cuerpo).toContain('p_establecimiento_id');
    expect(cuerpo).not.toMatch(/\.from\(/);
  });
  it('la pantalla no lee tablas ni escribe: solo llama a la acción del store', () => {
    expect(panel).toContain('actions.reportesTiendas(');
    expect(panel).not.toMatch(/supabase|\.from\(|\.rpc\(|\.insert\(|\.update\(|\.delete\(/);
    expect((panel.match(/actions\.\w+/g) || []).every(a => a === 'actions.reportesTiendas')).toBe(true);
  });
  it('Reportes es una pestaña de Tiendas (módulo de Admin)', () => {
    const vista = sinComentarios(src('../components/views/TiendasAdminView.jsx'));
    expect(vista).toContain("{ k: 'reportes', l: 'Reportes' }");
    expect(vista).toContain("tab === 'reportes' && <ReportesTiendasPanel");
  });
  it('las pantallas del cajero y de recepción no conocen los reportes ni el efectivo esperado de un turno abierto', () => {
    for (const f of ['../components/PosTiendaView.jsx', '../components/PosTurnoView.jsx', '../components/PosRecepcionView.jsx']) {
      const t = sinComentarios(src(f));
      expect(t).not.toMatch(/reportesTiendas|ReportesTiendasPanel|reporte_(ventas|cajas|inventario|abastecimiento)/);
    }
  });
  it('la pantalla no pide ni muestra datos sensibles de clientes', () => {
    expect(panel).not.toMatch(/\.(rfc|correo|email|telefono|direccion|cliente\w*)\b/i);
  });
});

describe('E8: pantalla', () => {
  it('se dibuja sin datos: selector, periodo, secciones y estado de carga', () => {
    const html = renderToStaticMarkup(<ReportesTiendasPanel actions={{ reportesTiendas: async () => ({ data: null }) }} establecimientos={EST} />);
    expect(html).toContain('data-testid="reportes-tiendas"');
    expect(html).toContain('Consolidado (todos)');
    expect(html).toContain('Tienda Fábrica');
    for (const s of ['Ventas', 'Cajas', 'Inventario', 'Abastecimiento e incidencias', 'Desde', 'Hasta', 'Cargando reportes']) expect(html).toContain(s);
    expect(html).toContain('hora de Durango');
  });
  const R = {
    ventas: { por_establecimiento: [{ id: 1, clave: 'CEDIS', nombre: 'CEDIS', tipo: 'cedis', activo: true, ventas: 2, unidades: 10, bruto: 310, devoluciones: 31, neto: 279, cobrado: 310, cobrado_por_metodo: { Efectivo: 310 } },
        { id: 3, clave: 'TF', nombre: 'Tienda Fábrica', tipo: 'tienda_fabrica', activo: true, ventas: 1, unidades: 3, bruto: 93, devoluciones: 0, neto: 93, cobrado: 93, cobrado_por_metodo: { Tarjeta: 93 } }],
      por_tipo: { cedis: { ventas: 2, neto: 279 }, tienda_fabrica: { ventas: 1, neto: 93 } }, consolidado: { ventas: 3, unidades: 13, bruto: 403, devoluciones: 31, neto: 372, cobrado: 403 },
      cobrado_por_metodo: { Efectivo: 310, Tarjeta: 93 }, por_dia: [{ fecha: '2026-10-12', establecimiento_id: 3, ventas: 1, bruto: 93 }], por_producto: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', unidades: 13, importe: 403 }],
      por_caja: [{ caja_id: 1, caja: 'Caja 1', establecimiento_id: 3, ventas: 1, bruto: 93 }], por_cajero: [{ cajero_id: 9, cajero: 'Ana', establecimiento_id: 3, ventas: 1, bruto: 93 }] },
    cajas: { turnos: [{ turno_id: 5, establecimiento_id: 3, tienda: 'Tienda Fábrica', caja: 'Caja 1', cajero: 'Ana', estado: 'cerrado', fecha: '2026-10-12', fondo_inicial: 500, ventas: 1, vendido: 93, cobrado_efectivo: 0, efectivo_esperado: 500, efectivo_contado: 495, diferencia: -5, motivo_diferencia: 'Cambio mal dado', reembolsos_pendientes: 31 },
        { turno_id: 6, establecimiento_id: 3, tienda: 'Tienda Fábrica', caja: 'Caja 2', cajero: 'Luis', estado: 'abierto', fecha: '2026-10-13', fondo_inicial: 300, ventas: 0, vendido: 0, cobrado_efectivo: 0, efectivo_esperado: 300, efectivo_contado: null, diferencia: null, reembolsos_pendientes: 0 }],
      por_caja: [{ establecimiento_id: 3, tienda: 'Tienda Fábrica', caja: 'Caja 1', turnos: 1, ventas: 1, vendido: 93, diferencia: -5 }],
      resumen: { turnos: 2, abiertos: 1, cerrados: 1, sobrantes: 0, faltantes: -5, turnos_con_diferencia: 1, reembolsos_registrados: 31, reembolsos_entregados: 0, reembolsos_pendientes: 31 } },
    inventario: { establecimiento_id: null, por_establecimiento: [{ id: 1, nombre: 'CEDIS', tipo: 'cedis', piezas: 100, existencia: { 'HPC-5K': 100 }, en_camino_hacia: {} }, { id: 7, nombre: 'Tienda Norte', tipo: 'tienda', piezas: 8, existencia: { 'HPC-5K': 8 }, en_camino_hacia: { 'HPC-5K': 2 } }],
      por_cuarto: [{ establecimiento_id: 7, cuarto_id: 'CF-T1', cuarto: 'Cuarto tienda', piezas: 8, existencia: { 'HPC-5K': 8 } }], en_transito: { piezas: 2, por_producto: { 'HPC-5K': 2 }, traspasos: [] }, total_piezas: 110 },
    abastecimiento: { traspasos: { despachados: 2, recibidos: 1, retornados: 0, en_transito: 1, incidencias_abiertas: 1, incidencias_cerradas: 0 },
      unidades: { despachadas: 12, recibidas_correctamente: 8, retornadas: 0, danadas: 1, faltantes: 1, en_transito: 2 },
      por_tienda: [{ establecimiento_id: 7, tienda: 'Tienda Norte', traspasos: 2, despachadas: 12, recibidas_correctamente: 8, retornadas: 0, danadas: 1, faltantes: 1, en_transito: 2 }],
      por_producto: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', despachadas: 12, recibidas_correctamente: 8, retornadas: 0, danadas: 1, faltantes: 1, en_transito: 2 }],
      incidencias: [{ traspaso_id: 9, folio: 'TR-0009', establecimiento_id: 7, abierta: true, danadas: 1, faltantes: 1, nota: 'Una bolsa rota', resolucion: null }],
      contable: { merma_registrada: false, valor: null, ingreso_comercial: 0, explicacion: 'Los traspasos no generan venta.' } },
  };
  const dibuja = (seccion, r = R) => renderToStaticMarkup(<ReportesTiendasPanel actions={{}} establecimientos={EST} inicial={r} seccionInicial={seccion} />);
  it('Ventas: consolidado, cada establecimiento por separado, formas de pago; sin aviso de descuadre', () => {
    const html = dibuja('ventas');
    for (const s of ['$403.00', '$372.00', 'CEDIS (ventas centrales)', 'Tienda de fábrica', 'Efectivo', 'Cubos 5 kg', 'Ana', 'no son ventas']) expect(html).toContain(s);
    expect(html).not.toContain('reportes-descuadre');
  });
  it('si el consolidado no fuera la suma de los establecimientos, la pantalla lo dice', () => {
    expect(dibuja('ventas', { ...R, ventas: { ...R.ventas, consolidado: { ...R.ventas.consolidado, bruto: 496 } } })).toContain('reportes-descuadre');
  });
  it('Cajas: faltante con su motivo, turno abierto sin diferencia, reembolsos pendientes aparte de los entregados', () => {
    const html = dibuja('cajas');
    for (const s of ['Faltaron $5.00', 'Cambio mal dado', 'Turno abierto', 'al momento', 'Reembolsos pendientes', 'Reembolsos entregados', '$31.00']) expect(html).toContain(s);
  });
  it('Inventario: cuartos, tránsito aparte y total de la empresa', () => {
    const html = dibuja('inventario');
    for (const s of ['En tránsito', 'Total de la empresa', '110', '108', '8 HPC-5K', '2 HPC-5K', 'Cuarto tienda']) expect(html).toContain(s);
  });
  it('Abastecimiento: piezas (no pesos), incidencia abierta y la nota de que no es venta ni merma contable', () => {
    const html = dibuja('abasto');
    for (const s of ['Piezas, no pesos', 'TR-0009', 'Abierta', 'Una bolsa rota', 'Los traspasos no generan venta.', 'Tienda Norte']) expect(html).toContain(s);
    expect(html).not.toContain('no cuadran');
    expect(html).not.toContain('$');
  });
});
