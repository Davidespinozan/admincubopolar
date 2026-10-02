// stockContratos.test.js — R2 fase 2A: builders de los contratos 084, ciclo
// de vida del operacion_id y auditoría estática del cutover (los cuatro flujos
// vivos usan los contratos; sin RPC genérico ni compensaciones en su camino).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  buildConfirmarCargaArgs, buildNoEntregaArgs, buildSalidaManualArgs, buildTraspasoArgs,
  claveCarga, claveNoEntrega, claveSalida, claveTraspaso, resolverOperacion, nuevoOperacionId,
  interpretarResultadoStock, mensajeErrorStock, esMotivoDeRuta, MOTIVOS_SALIDA_MANUAL,
} from '../data/stockContratosLogic';

const OP = '11111111-1111-4111-8111-111111111111';
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
/** Cuerpo de una acción `nombre: async (...) => {` del store hasta la siguiente acción. */
function accion(store, nombre) {
  const lines = store.split('\n');
  const start = lines.findIndex(l => new RegExp(`^ {6}${nombre}: async`).test(l));
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) if (/^ {6}[a-zA-Z_]+: async|^ {6}\/\/ ── /.test(lines[i])) { end = i; break; }
  return sinComentarios(lines.slice(start, end).join('\n'));
}

describe('builders 084: nombres exactos de parámetros, sin cantidades ni cuartos del cliente', () => {
  it('confirmar_carga_ruta: firma normal', () => {
    const r = buildConfirmarCargaArgs({ operacionId: OP, rutaId: '56', firma: ' data:x ' });
    expect(r.args).toEqual({ p_operacion_id: OP, p_ruta_id: 56, p_firma: 'data:x', p_excepcion: false, p_motivo: null });
  });
  it('confirmar_carga_ruta: excepción con motivo; sin motivo → error; sin firma → error', () => {
    expect(buildConfirmarCargaArgs({ operacionId: OP, rutaId: 56, excepcion: true, motivo: ' sin celular ' }).args)
      .toEqual({ p_operacion_id: OP, p_ruta_id: 56, p_firma: null, p_excepcion: true, p_motivo: 'sin celular' });
    expect(buildConfirmarCargaArgs({ operacionId: OP, rutaId: 56, excepcion: true }).error).toMatch(/Justificación/);
    expect(buildConfirmarCargaArgs({ operacionId: OP, rutaId: 56 }).error).toMatch(/Firma/);
    expect(buildConfirmarCargaArgs({ rutaId: 56, firma: 'x' }).error).toMatch(/operación/);
    expect(buildConfirmarCargaArgs({ operacionId: OP, firma: 'x' }).error).toMatch(/Ruta/);
  });
  it('registrar_no_entrega', () => {
    expect(buildNoEntregaArgs({ operacionId: OP, ordenId: 90, motivo: ' Local cerrado ', reagendar: true }).args)
      .toEqual({ p_operacion_id: OP, p_orden_id: 90, p_motivo: 'Local cerrado', p_reagendar: true });
    expect(buildNoEntregaArgs({ operacionId: OP, ordenId: 90, motivo: '   ' }).error).toMatch(/Motivo/);
    expect(buildNoEntregaArgs({ operacionId: OP, motivo: 'x' }).error).toMatch(/Orden/);
  });
  it('salida_cuarto_manual: motivo obligatorio y nunca de ruta', () => {
    expect(buildSalidaManualArgs({ operacionId: OP, cuartoId: 'CF-1', sku: 'HPC-5K', cantidad: '3', motivo: 'Venta directa' }).args)
      .toEqual({ p_operacion_id: OP, p_cuarto_id: 'CF-1', p_sku: 'HPC-5K', p_cantidad: 3, p_motivo: 'Venta directa' });
    expect(buildSalidaManualArgs({ operacionId: OP, cuartoId: 'CF-1', sku: 'HPC-5K', cantidad: 3, motivo: '' }).error).toMatch(/Motivo/);
    expect(buildSalidaManualArgs({ operacionId: OP, cuartoId: 'CF-1', sku: 'HPC-5K', cantidad: 3, motivo: 'Carga a ruta' }).error).toMatch(/firmar la carga/);
    expect(buildSalidaManualArgs({ operacionId: OP, cuartoId: 'CF-1', sku: 'HPC-5K', cantidad: 0, motivo: 'x' }).error).toMatch(/mayor a 0/);
    expect(buildSalidaManualArgs({ operacionId: OP, cuartoId: 'CF-1', sku: 'HPC-5K', cantidad: 1.5, motivo: 'x' }).error).toMatch(/entero/);
    expect(esMotivoDeRuta('carga A RUTA')).toBe(true);
    expect(MOTIVOS_SALIDA_MANUAL.some(esMotivoDeRuta)).toBe(false);
  });
  it('traspaso_cuartos', () => {
    expect(buildTraspasoArgs({ operacionId: OP, origen: 'CF-1', destino: 'CF-2', sku: 'HPC-5K', cantidad: '4' }).args)
      .toEqual({ p_operacion_id: OP, p_origen: 'CF-1', p_destino: 'CF-2', p_sku: 'HPC-5K', p_cantidad: 4 });
    expect(buildTraspasoArgs({ operacionId: OP, origen: 'CF-1', destino: 'CF-1', sku: 'HPC-5K', cantidad: 4 }).error).toMatch(/diferentes/);
    expect(buildTraspasoArgs({ operacionId: OP, origen: 'CF-1', destino: 'CF-2', sku: '', cantidad: 4 }).error).toMatch(/SKU/);
  });
});

describe('ciclo de vida del operacion_id (mismo patrón que 076)', () => {
  it('mismos datos → mismo UUID en el reintento; datos distintos → UUID nuevo', () => {
    const k1 = claveCarga({ rutaId: 56, excepcion: false });
    const op1 = resolverOperacion(null, k1);
    expect(resolverOperacion(op1, k1)).toBe(op1);
    const op2 = resolverOperacion(op1, claveCarga({ rutaId: 56, excepcion: true, motivo: 'x' }));
    expect(op2.id).not.toBe(op1.id);
    const kn = claveNoEntrega({ ordenId: 90, motivo: 'Local cerrado', reagendar: true });
    expect(claveNoEntrega({ ordenId: 90, motivo: 'Local cerrado', reagendar: false })).not.toBe(kn);
    expect(claveSalida({ cuartoId: 'CF-1', sku: 'A', cantidad: '3', motivo: 'm' })).toBe(claveSalida({ cuartoId: 'CF-1', sku: 'A', cantidad: 3, motivo: 'm' }));
    expect(claveTraspaso({ origen: 'CF-1', destino: 'CF-2', sku: 'A', cantidad: 2 })).not.toBe(claveTraspaso({ origen: 'CF-2', destino: 'CF-1', sku: 'A', cantidad: 2 }));
    expect(nuevoOperacionId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('interpretarResultadoStock conserva el replay del servidor', () => {
    expect(interpretarResultadoStock({ replay: true, folio: 'R-1' })).toMatchObject({ ok: true, replay: true, folio: 'R-1' });
    expect(interpretarResultadoStock(null).replay).toBe(false);
  });
  it('mensajeErrorStock traduce los errores del servidor sin sugerir compensación', () => {
    expect(mensajeErrorStock({ message: 'Stock insuficiente para HPC-5K en cuarto CF-1: disponible=2, requerido=5' })).toMatch(/disponible 2, se requieren 5/);
    expect(mensajeErrorStock({ message: 'Inventario insuficiente para cargar 20 de HPC-5K (faltan 12)' })).toMatch(/faltan 12/);
    expect(mensajeErrorStock({ message: 'stock: operacion_id ya usado con otros datos (carga_ruta: x)' })).toMatch(/otros datos/);
    expect(mensajeErrorStock({ message: 'confirmar_carga_ruta: la ruta R-1 ya tiene carga confirmada' })).toMatch(/ya fue confirmada/);
    expect(mensajeErrorStock({ message: 'salida_cuarto_manual: la carga a ruta se registra al firmar la carga (confirmar_carga_ruta), no como salida manual' })).toMatch(/firmar la carga/);
    expect(mensajeErrorStock({ code: '42501', message: 'x' })).toMatch(/permiso/);
    expect(mensajeErrorStock({ message: 'Failed to fetch' })).toMatch(/no se duplicará/);
  });
});

describe('auditoría estática del cutover (R2 fase 2A)', () => {
  const store = src('../data/supaStore.js');

  it('firmarCarga: un solo rpc confirmar_carga_ruta; sin cálculo de cuartos, sin UPDATE de rutas, sin RPC genérico, sin compensación', () => {
    const b = accion(store, 'firmarCarga');
    expect(b).toMatch(/rpc\(\s*['"]confirmar_carga_ruta['"]/);
    expect(b).not.toMatch(/update_stocks_atomic/);
    expect(b).not.toMatch(/calcularChangesInventario/);
    expect(b).not.toMatch(/from\(\s*['"]rutas['"]\s*\)[\s\S]{0,80}\.update\(/);
    expect(b).not.toMatch(/carga_confirmada_at:\s*null/);
    expect(b).toMatch(/operacionId/);
  });
  it('marcarNoEntregada: un solo rpc registrar_no_entrega; sin RPC genérico, sin reverso, sin UPDATE de ordenes', () => {
    const b = accion(store, 'marcarNoEntregada');
    expect(b).toMatch(/rpc\(\s*['"]registrar_no_entrega['"]/);
    expect(b).not.toMatch(/update_stocks_atomic/);
    expect(b).not.toMatch(/Rollback no entregada|calcReversoChangesNoEntrega/);
    expect(b).not.toMatch(/from\(\s*['"]ordenes['"]\s*\)[\s\S]{0,80}\.update\(/);
    expect(b).toMatch(/opciones\.operacionId/);
  });
  it('sacarDeCuartoFrio y traspasoEntreUbicaciones: contratos 084, sin RPC genérico', () => {
    const sal = accion(store, 'sacarDeCuartoFrio');
    expect(sal).toMatch(/rpc\(\s*['"]salida_cuarto_manual['"]/);
    expect(sal).not.toMatch(/update_stocks_atomic/);
    const tr = accion(store, 'traspasoEntreUbicaciones');
    expect(tr).toMatch(/rpc\(\s*['"]traspaso_cuartos['"]/);
    expect(tr).not.toMatch(/update_stocks_atomic/);
    expect(tr).not.toMatch(/delta:/);
  });
  it('inventario de llamadores restantes de update_stocks_atomic (solo Admin)', () => {
    const lines = store.split('\n');
    let fn = '';
    const callers = new Set();
    for (const l of lines) {
      const m = /^ {6}([a-zA-Z_]+): async/.exec(l);
      if (m) fn = m[1];
      if (/rpc\(\s*['"]update_stocks_atomic['"]/.test(l)) callers.add(fn);
    }
    expect([...callers].sort()).toEqual([
      'registrarDevolucion',       // Admin (requireAdmin); 093: deleteProduccion ya no existe
    ]);
    // 087: cancelarRutaConDevolucion ya no devuelve stock (ruta cargada → cierre canónico)
    expect(accion(store, 'cancelarRutaConDevolucion')).not.toMatch(/update_stocks_atomic|buildCancelacionChanges/);
  });
  it('acciones muertas siguen sin pantalla; flujos vivos migrados en cada pantalla', () => {
    const comps = ['../components/ChoferView.jsx', '../components/BotonFirmasPendientes.jsx', '../components/ProduccionStandaloneView.jsx', '../components/views/InventarioView.jsx', '../components/views/RutasView.jsx', '../components/views/OrdenesView.jsx', '../components/views/ProduccionView.jsx', '../components/BolsasView.jsx', '../components/VentasStandaloneView.jsx', '../components/DevolucionModal.jsx']
      .map(p => sinComentarios(src(p))).join('\n');
    for (const dead of ['confirmarCargaRuta', 'meterACuartoFrio', 'confirmarProduccion']) expect(comps).not.toMatch(new RegExp(`actions\\.${dead}\\b`));
    const chofer = sinComentarios(src('../components/ChoferView.jsx'));
    expect(chofer).toMatch(/firmarCarga\?\.\(miRutaActiva\.id, null, \{[\s\S]{0,200}operacionId: op\.id/);
    expect(chofer).toMatch(/firmarCarga\?\.\(miRutaActiva\.id, firmaBase64, \{ operacionId: op\.id \}\)/);
    expect(chofer).toMatch(/marcarNoEntregada\?\.\(p\.ordenId, p\.motivo, p\.reagendar, \{ operacionId: p\.operacionId \}\)/);
    expect(chofer).toMatch(/TIPOS_MUTACION\.NO_ENTREGA, \{[\s\S]{0,200}operacionId: nuevoOperacionId\(\)/);
    const boton = sinComentarios(src('../components/BotonFirmasPendientes.jsx'));
    expect(boton).toMatch(/firmarCarga\?\.\(rutaSeleccionada\.id, firmaBase64, \{ operacionId: op\.id \}\)/);
    const prod = sinComentarios(src('../components/ProduccionStandaloneView.jsx'));
    expect(prod).toMatch(/sacarDeCuartoFrio\(sacarModal\.cfId, sacarForm\.sku, sacarForm\.cantidad, mot\.motivo, \{ operacionId: op\.id \}\)/);
    expect(prod).toMatch(/registrarMermaCuarto\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(prod).toMatch(/traspasoEntreUbicaciones\(\{ \.\.\.tForm, operacionId: op\.id \}\)/);
    expect(prod).not.toMatch(/Carga a ruta/);
    expect(prod).toMatch(/MOTIVOS_SALIDA_MANUAL/);
    const inv = sinComentarios(src('../components/views/InventarioView.jsx'));
    expect(inv).toMatch(/traspasoEntreUbicaciones\(\{ \.\.\.traspasoForm, operacionId: op\.id \}\)/);
  });
  it('085/087: el cierre no tiene devolución del cliente ni UPDATE directo de la ruta', () => {
    expect(accion(store, 'cerrarRutaCompleta')).toBeNull();
    const prep = accion(store, 'prepararCierreRuta');
    const fin = accion(store, 'finalizarInventarioRuta');
    const adm = accion(store, 'cerrarRuta');
    for (const b of [prep, fin, adm]) {
      expect(b).not.toMatch(/esLegacy|calcDevolucionLegacy|update_stocks_atomic|cerrar_ruta_atomic/);
      expect(b).not.toMatch(/from\('rutas'\)\.update/);
    }
    expect(fin).toMatch(/rpc\('finalizar_inventario_ruta', built\.args\)/);
    expect(adm).toMatch(/finalizarInventarioRuta\(rutaId, conteo/);
    for (const dead of ['confirmarCargaRuta', 'meterACuartoFrio', 'confirmarProduccion', '_registrarCostoProduccion']) expect(accion(store, dead)).toBeNull();
  });
});
