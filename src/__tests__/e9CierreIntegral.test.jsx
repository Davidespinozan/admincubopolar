// e9CierreIntegral.test.jsx — Tiendas E9: conciliación de reembolsos en pantalla y el rechazo del
// último cajero tal como lo ve Administración. El comportamiento del servidor está en la suite 150.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { textoConciliacionReembolso, MEDIO_REEMBOLSO } from '../data/posLogic';
import { mensajeErrorUsuario } from '../data/usuariosLogic';
import { ReportesTiendasPanel } from '../components/views/ReportesTiendasPanel';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const REN = (o = {}) => ({ correccion_id: 1, tienda: 'Tienda Fábrica', folio: 'OV-0101', dia_venta: '2026-10-10', dia_devolucion: '2026-10-10', total_devuelto: 90,
  egreso_contable: { id: 5, fecha: '2026-10-10', monto: 90 }, monto: 90, medio: 'electronico', estado: 'registrado', dia_ejecucion: null, dias_pendiente: 3, ...o });
const R = (reembolsos) => ({
  ventas: { por_establecimiento: [], consolidado: { ventas: 0, unidades: 0, bruto: 0, devoluciones: 0, neto: 0, cobrado: 0 } },
  cajas: { turnos: [], por_caja: [], resumen: {} }, inventario: { por_establecimiento: [], por_cuarto: [], en_transito: {} },
  abastecimiento: { traspasos: {}, unidades: { despachadas: 0, recibidas_correctamente: 0, retornadas: 0, danadas: 0, faltantes: 0, en_transito: 0 }, contable: {} }, reembolsos });

describe('E9: reembolsos — hecho contable aparte del dinero entregado', () => {
  it('tres medios de entrega, con nombre legible', () => {
    expect(Object.keys(MEDIO_REEMBOLSO)).toEqual(['efectivo_caja', 'efectivo_administracion', 'electronico']);
  });
  it('el estado dice si el dinero YA salió y cuándo; un pendiente viejo se marca en rojo', () => {
    expect(textoConciliacionReembolso(REN({ estado: 'ejecutado', dia_ejecucion: '2026-10-13' }))).toEqual({ tono: 'ok', texto: 'Entregado el 2026-10-13' });
    expect(textoConciliacionReembolso(REN({ dias_pendiente: 3 }))).toEqual({ tono: 'error', texto: 'Pendiente desde hace 3 días' });
    expect(textoConciliacionReembolso(REN({ dias_pendiente: 1 }))).toEqual({ tono: 'aviso', texto: 'Pendiente desde hace 1 día' });
    expect(textoConciliacionReembolso(REN({ dias_pendiente: 0 })).texto).toBe('Pendiente (registrado hoy)');
    expect(textoConciliacionReembolso(REN({ monto: 0, estado: 'sin_reembolso' })).texto).toBe('Sin reembolso');
    expect(textoConciliacionReembolso(null).tono).toBe('neutro');
  });
  it('la sección Cajas muestra el egreso contable y el dinero entregado como cifras distintas, y cada devolución con sus dos fechas', () => {
    const html = renderToStaticMarkup(<ReportesTiendasPanel actions={{}} establecimientos={[]} seccionInicial="cajas" inicial={R({
      resumen: { egreso_contable_en_periodo: 180, dinero_entregado_en_periodo: 60, entregado_desde_caja: 60, entregado_por_administracion: 0, entregado_electronico: 0, pendientes_al_corte: 2, pendiente_al_corte: 120, pendiente_electronico_al_corte: 90 },
      reembolsos: [REN(), REN({ correccion_id: 2, folio: 'OV-0102', monto: 60, total_devuelto: 60, medio: 'efectivo_caja', estado: 'ejecutado', dia_ejecucion: '2026-10-11', egreso_contable: { id: 6, fecha: '2026-10-10', monto: 60 } })],
      inconsistencias: [] })} />);
    for (const s of ['Egreso contable del periodo', '$180.00', 'Dinero entregado en el periodo', 'Pendiente al corte', '$120.00', 'Electrónico pendiente', 'OV-0101', 'Tarjeta o transferencia',
      'Pendiente desde hace 3 días', 'Efectivo de la caja', 'Entregado el 2026-10-11', 'Son dos fechas distintas']) expect(html).toContain(s);
    expect(html).not.toContain('reportes-reembolsos-inconsistencias');
  });
  it('si el egreso contable no coincide con el reembolso, la pantalla lo avisa en vez de conciliar a ciegas', () => {
    const html = renderToStaticMarkup(<ReportesTiendasPanel actions={{}} establecimientos={[]} seccionInicial="cajas" inicial={R({ resumen: {}, reembolsos: [], inconsistencias: [{ correccion_id: 9, folio: 'OV-0109', problema: 'reembolso sin egreso contable' }] })} />);
    expect(html).toContain('reportes-reembolsos-inconsistencias');
    expect(html).toContain('OV-0109');
  });
  it('el store pide la conciliación junto con los demás reportes, detrás de requireAdmin; el cajero no la conoce', () => {
    const store = src('../data/supaStore.js');
    const cuerpo = store.slice(store.indexOf('reportesTiendas: async'), store.indexOf('reportesTiendas: async') + 1800);
    expect(cuerpo).toContain("'reporte_reembolsos_tiendas'");
    expect(cuerpo).toMatch(/requireAdmin\(\)/);
    for (const f of ['../components/PosTiendaView.jsx', '../components/PosTurnoView.jsx', '../components/PosRecepcionView.jsx']) expect(sinComentarios(src(f))).not.toMatch(/reporte_reembolsos|textoConciliacionReembolso|egreso_contable/);
  });
});

describe('E9: último cajero de una tienda activa', () => {
  it('el rechazo del servidor llega a Administración con su texto completo (qué tienda y qué hacer)', () => {
    const m = mensajeErrorUsuario({ code: '22023', details: '{"codigo":"ULTIMO_CAJERO","establecimiento_id":3}',
      message: 'Ana López es el último cajero de la tienda activa "Tienda Fábrica": asigna antes a otro cajero o desactiva la tienda' });
    expect(m).toMatch(/último cajero/);
    expect(m).toMatch(/asigna antes a otro cajero o desactiva la tienda/);
  });
  it('la pantalla de usuarios no decide esta regla: la baja sigue yendo por guardar_usuario y la respuesta es del servidor', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/supabase\.rpc\('guardar_usuario'/);
    expect(store).not.toMatch(/from\('usuarios'\)\s*\.(update|delete|insert)/);
  });
});
