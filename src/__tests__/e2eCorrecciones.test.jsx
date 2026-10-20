// e2eCorrecciones.test.jsx — correcciones de los defectos que encontró el E2E del ERP completo (2026-10-20).
// La parte de servidor (pago a proveedor, asientos ligados, CxP con pagos) la prueba la suite SQL 156.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cuentaComoProducido } from '../data/preparacionBarraLogic';
import { cuartosDelCedis } from '../data/stockContratosLogic';
import { idsAsientosLigados, esAsientoProtegido } from '../data/asientosContablesLogic';
import { cifrasResumen } from '../data/resumenRolLogic';
import { pagaMasDiasQueLaSemana } from '../data/nominaLogic';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('"Producido hoy" no cuenta producción revertida ni preparaciones', () => {
  it('cuentaComoProducido', () => {
    expect(cuentaComoProducido({ tipo: 'Produccion', estatus: 'Confirmada' })).toBe(true);
    expect(cuentaComoProducido({ estatus: 'Confirmada' })).toBe(true);
    expect(cuentaComoProducido({ tipo: 'Produccion', estatus: 'Revertida' })).toBe(false);
    expect(cuentaComoProducido({ tipo: 'Preparacion', estatus: 'Confirmada' })).toBe(false);
    expect(cuentaComoProducido({ tipo: 'Partido', estatus: 'Confirmada' })).toBe(false);
  });
  it('las cuatro pantallas usan la misma regla', () => {
    expect(src('../components/ProduccionStandaloneView.jsx').match(/cuentaComoProducido\(p/g).length).toBeGreaterThanOrEqual(1);
    expect(src('../components/ProduccionStandaloneView.jsx')).toContain('!cuentaComoProducido(pr)');
    expect(src('../components/views/AlmacenBolsasView.jsx')).toContain('cuentaComoProducido(p)');
    expect(src('../data/resumenRolLogic.js')).toContain('cuentaComoProducido(x)');
    expect(src('../components/views/ProduccionView.jsx')).toContain("if (s(p.estatus) !== 'Revertida') total += n(p.cantidad);");
  });
  it('resumen del rol Producción: 120 producidas y revertidas + 4 preparadas = 0 producido', () => {
    const hoy = new Date().toISOString().slice(0, 10);
    const r = cifrasResumen(['Producción'], { produccion: [
      { fecha: hoy, tipo: 'Produccion', estatus: 'Revertida', cantidad: 120 },
      { fecha: hoy, tipo: 'Preparacion', estatus: 'Confirmada', cantidad: 4 },
      { fecha: hoy, tipo: 'Produccion', estatus: 'Confirmada', cantidad: 50 },
    ], cuartosFrios: [], productos: [], mermas: [] }, hoy);
    expect(r.find(x => x.label === 'Producido hoy')?.value).toBe('50');
  });
});

describe('El congelador de una tienda no cuenta ni se ofrece en las pantallas centrales', () => {
  const C = [{ id: 'CF-1', establecimiento_id: 1, stock: { 'HPC-5K': 455 } }, { id: 'CONG-1', establecimiento_id: 2, stock: { 'HPC-5K': 50 } }, { id: 'X', stock: {} }];
  it('cuartosDelCedis: solo establecimiento 1 (lo desconocido fuera)', () => {
    expect(cuartosDelCedis(C).map(c => c.id)).toEqual(['CF-1']);
    expect(cuartosDelCedis(null)).toEqual([]);
  });
  it('venta, edición, venta directa, devolución, Producción e Inventario usan cuartosDelCedis', () => {
    expect(src('../components/NuevaVentaModal.jsx')).toContain('stockDisponiblePorSku(cuartosDelCedis(data?.cuartosFrios))');
    expect(src('../components/EditarVentaModal.jsx')).toContain('stockDisponiblePorSku(cuartosDelCedis(data?.cuartosFrios))');
    expect(src('../components/VentaDirectaOrigen.jsx')).toContain('cuartosDelCedis(todos)');
    expect(src('../components/DevolucionModal.jsx')).toContain('cuartosDelCedis(data?.cuartosFrios)');
    const prod = src('../components/ProduccionStandaloneView.jsx');
    expect(prod).toContain('const cuartosCedis = useMemo(() => cuartosDelCedis(data.cuartosFrios), [data.cuartosFrios]);');
    expect((prod.match(/data\.cuartosFrios/g) || []).length).toBe(2); // solo en la línea de cuartosCedis
    const inv = src('../components/views/InventarioView.jsx');
    expect(inv).toContain('for (const cf of cuartosDelCedis(data.cuartosFrios))');
    expect(inv).toContain('const cfOptions = useMemo(() => cuartosDelCedis(data.cuartosFrios).map');
  });
});

describe('Movimientos: asientos ligados y categoría del ingreso', () => {
  it('idsAsientosLigados reúne pagos a proveedor, nómina, devoluciones y costos', () => {
    const ids = idsAsientosLigados({ pagosProveedores: [{ movimientoId: 1 }], nominaPeriodos: [{ movimientoId: 2 }, { movimientoId: null }],
      devoluciones: [{ egresoId: 3 }], costosHistorial: [{ movimiento_id: 4 }] });
    expect([...ids].sort()).toEqual(['1', '2', '3', '4']);
    expect(esAsientoProtegido({ id: 2, tipo: 'Egreso', categoria: 'Nómina' }, ids)).toBe(true);
    expect(esAsientoProtegido({ id: 9, tipo: 'Egreso', categoria: 'Renta' }, ids)).toBe(false);
    expect(esAsientoProtegido({ id: 9, referencia: 'PROD-1' }, ids)).toBe(true);
  });
  it('la pantalla marca como "Sistema" los ligados y el ingreso nuevo arranca en una categoría de ingreso', () => {
    const v = src('../components/views/ContabilidadView.jsx');
    expect(v).toContain('esAsientoProtegido(m, ligados)');
    expect(v).toContain('categoria: tipo === "Ingreso" ? "Otro ingreso" : "Proveedores"');
  });
});

describe('Chofer: referencia de transferencia, iniciar ruta, mermas pendientes', () => {
  const c = src('../components/ChoferView.jsx');
  it('la referencia llega al contrato con señal, en la cola sin señal y al sincronizar', () => {
    expect(c).toContain('{ folioNota: folioNota || null, referencia: s(cobroRef).trim() || null }');
    expect(c).toContain('referencia: s(cobroRef).trim() || null, // E2E');
    expect(c.match(/referencia: p\.referencia \|\| null, operacionId: p\.operacionId/g).length).toBe(2);
  });
  it('"Iniciar ruta" no pasa a "En ruta" si el servidor no la cambió', () => {
    const i = c.indexOf("const err = await actions.updateRutaEstatus(miRutaActiva.id, 'En progreso');");
    expect(i).toBeGreaterThan(0);
    expect(c.indexOf('return;', i)).toBeLessThan(c.indexOf("setStep('ruta');", i));
  });
  it('no se cierra la ruta con mermas sin registrar; guardar mermas no rompe sin espacio', () => {
    expect(c).toContain('mermasSinRegistrar > 0 || Object.keys(difConteo.faltante)');
    expect(c).toContain("try { localStorage.setItem('mermas_ruta_' + miRutaActiva.id, JSON.stringify(updated)); }");
  });
});

describe('Pantallas que decían éxito aunque fallara', () => {
  it('Autorizar ruta: éxito solo con la ruta creada (id); si fallan las órdenes no se duplica la ruta', () => {
    const v = src('../components/views/RutasView.jsx');
    expect(v).toContain("err = result?.id ? null : (result || new Error('No se pudo crear la ruta'));");
    expect(v).not.toContain('err = result instanceof Error ? result : null;');
    expect(v).toContain('creada, pero no se asignaron las órdenes');
  });
  it('folio de ruta: ya no hay R-013 fijo cuando falla la secuencia', () => {
    const st = src('../data/supaStore.js');
    expect(st).not.toContain('seq || 13');
    expect(st).toContain("if (errSeq || !seq)");
  });
  it('Por pagar: eliminar revisa el error; costos y cuartos también', () => {
    expect(src('../components/views/CuentasPorPagarView.jsx')).toContain('const err = await actions.deleteCuentaPorPagar(modal.id);\n            if (err) return;');
    const co = src('../components/views/CostosView.jsx');
    expect((co.match(/if \(fallo\(/g) || []).length).toBe(5);
    expect(src('../components/views/InventarioView.jsx')).toContain('const r = cfModal === "new" ? await actions.addCuartoFrio(payload) : await actions.updateCuartoFrio(cfModal.id, payload);');
  });
  it('aplicar costo: si falla el historial, se retira el egreso (sin egresos huérfanos)', () => {
    const st = src('../data/supaStore.js');
    expect((st.match(/if \(movimiento\?\.id\) await supabase\.from\('movimientos_contables'\)\.delete\(\)\.eq\('id', movimiento\.id\);/g) || []).length).toBe(2);
  });
  it('Editar venta: el precio ya no es un campo editable que se descarta', () => {
    const e = src('../components/EditarVentaModal.jsx');
    expect(e).not.toMatch(/onChange=\{e => updateLine\(i, 'precio'/);
    expect(e).toContain('Precio unitario (lo pone el sistema)');
  });
  it('pagar nómina: sin renglón de auditoría duplicado del cliente', () => {
    const st = src('../data/supaStore.js');
    expect(st).not.toContain("log('Pagar', 'Nómina'");
  });
  it('mapas: no se inicializan dos veces sobre el mismo contenedor', () => {
    for (const f of ['../components/ui/MapaRuta.jsx', '../components/ui/MapaPedidos.jsx']) {
      const m = src(f);
      expect(m).toContain('if (cancelado || !mapRef.current || mapInst.current || mapRef.current._leaflet_id) return;');
      expect(m).toContain('cancelado = true;');
    }
  });
});

describe('Nómina: más días que la semana se confirma, no se bloquea', () => {
  it('pagaMasDiasQueLaSemana', () => {
    expect(pagaMasDiasQueLaSemana({ diasPagados: 6, conSeptimo: true })).toBe(false);
    expect(pagaMasDiasQueLaSemana({ diasPagados: 7, conSeptimo: false })).toBe(false);
    expect(pagaMasDiasQueLaSemana({ diasPagados: 7, conSeptimo: true })).toBe(true);
    expect(pagaMasDiasQueLaSemana({ diasPagados: '0', conSeptimo: true })).toBe(false);
  });
  it('el recibo no se guarda con 8 días sin confirmar el descanso trabajado', () => {
    const v = src('../components/views/NominaView.jsx');
    expect(v).toContain('disabled={!sucio || prev.excede || (masDias && !descansoConfirmado)}');
    expect(v).toContain('Confirmo que trabajó su día de descanso y se le paga aparte.');
  });
});
