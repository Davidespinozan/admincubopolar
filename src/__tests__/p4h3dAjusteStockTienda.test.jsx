// p4h3dAjusteStockTienda.test.jsx — P4-H3D: Inventario central no ofrece "Ajustar stock" para el congelador de una
// tienda (ni para un cuarto de pertenencia desconocida), y el handler no envía un ajuste central sobre ellos aunque el
// diálogo haya quedado abierto. La autoridad sigue siendo el servidor (guarda de 152, INVENTARIO_DE_TIENDA).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  pertenenciaCuarto, puedeOfrecerAjusteCentral, validarAjusteCentral, esErrorInventarioDeTienda,
  MENSAJE_AJUSTE_CUARTO_DE_TIENDA, MENSAJE_AJUSTE_SIN_PERTENENCIA, MENSAJE_AJUSTE_CUARTO_CAMBIO, puedeOfrecerEliminarCuarto,
} from '../data/stockContratosLogic';
import { InventarioView } from '../components/views/InventarioView';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const C = (o) => ({ id: 'X', nombre: 'Cuarto', temp: -10, capacidad: 100, capacidad_tarimas: 0, stock: {}, ...o });
const AJUSTAR = /aria-label="Ajustar stock del cuarto frío"/g;

describe('P4-H3D: quién ofrece el ajuste central (pertenencia por el establecimiento real)', () => {
  it('[1] cuarto del CEDIS confirmado: se ofrece', () => {
    expect(puedeOfrecerAjusteCentral(C({ id: 'CF-1', establecimiento_id: 1 }))).toBe(true);
    expect(puedeOfrecerAjusteCentral(C({ id: 'CF-1', establecimiento_id: '1' }))).toBe(true);
  });
  it('[2][5][6] congelador de tienda: nunca, esté la tienda activa o inactiva, el interruptor encendido o apagado, vacío o con existencia', () => {
    for (const extra of [{}, { tienda_activa: true }, { tienda_activa: false }, { interruptor: true }, { interruptor: false }, { stock: { 'HPC-5K': 30 } }]) {
      expect(puedeOfrecerAjusteCentral(C({ establecimiento_id: 2, ...extra }))).toBe(false);
    }
    expect(puedeOfrecerAjusteCentral(C({ establecimiento_id: 7 }))).toBe(false);
  });
  it('[7] pertenencia desconocida: no se ofrece (fail-closed)', () => {
    for (const v of [undefined, null, '', 'abc', 0, -1, 1.5]) expect(puedeOfrecerAjusteCentral(C({ establecimiento_id: v }))).toBe(false);
    expect(puedeOfrecerAjusteCentral(null)).toBe(false);
  });
  it('no se guía por nombre, clave ni prefijo: "CF-9" de una tienda no se ajusta y "Congelador Matriz" del CEDIS sí', () => {
    expect(puedeOfrecerAjusteCentral(C({ id: 'CF-9', nombre: 'Cuarto Frío 9', establecimiento_id: 2 }))).toBe(false);
    expect(puedeOfrecerAjusteCentral(C({ id: 'CONG-MATRIZ-01', nombre: 'Congelador Matriz', establecimiento_id: 1 }))).toBe(true);
  });
  it('[3][4] la regla no depende del rol: la función no recibe ni consulta al usuario (Admin, Dueño o Ventas ven lo mismo)', () => {
    expect(puedeOfrecerAjusteCentral.length).toBe(1);
    const logica = src('../data/stockContratosLogic.js');
    const cuerpo = logica.slice(logica.indexOf('export function puedeOfrecerAjusteCentral'), logica.indexOf('export function validarAjusteCentral'));
    expect(cuerpo).not.toMatch(/rol|Admin|Dueño|es_dueno|habilitad|activo/i);
  });
});

describe('P4-H3D: revalidación del handler (diálogo abierto, datos cambiantes)', () => {
  const cedis = C({ id: 'CF-1', establecimiento_id: 1 });
  it('[8] CEDIS confirmado, mismo cuarto y mismo establecimiento: se puede enviar', () => {
    expect(validarAjusteCentral(cedis, { ...cedis, stock: { 'HPC-5K': 9 } })).toBeNull();
  });
  it('[9] congelador de tienda: bloqueado con el mensaje de correcciones autorizadas', () => {
    const tienda = C({ id: 'CONG-1', establecimiento_id: 2 });
    expect(validarAjusteCentral(tienda, tienda)).toBe(MENSAJE_AJUSTE_CUARTO_DE_TIENDA);
    expect(MENSAJE_AJUSTE_CUARTO_DE_TIENDA).toBe('Los ajustes de inventario de tiendas deben realizarse mediante el proceso de correcciones autorizadas.');
  });
  it('[10] pertenencia desconocida: bloqueado', () => {
    const sin = C({ id: 'CF-SIN' });
    expect(validarAjusteCentral(sin, sin)).toBe(MENSAJE_AJUSTE_SIN_PERTENENCIA);
  });
  it('[11] el diálogo es de un cuarto y el dato vigente es de otro: bloqueado (no se ajusta el cuarto equivocado)', () => {
    expect(validarAjusteCentral(cedis, C({ id: 'CF-2', establecimiento_id: 1 }))).toBe(MENSAJE_AJUSTE_CUARTO_CAMBIO);
  });
  it('[12] el cuarto pasó a una tienda (o perdió el dato) con el diálogo abierto: bloqueado', () => {
    expect(validarAjusteCentral(cedis, { ...cedis, establecimiento_id: 2 })).toBe(MENSAJE_AJUSTE_CUARTO_DE_TIENDA);
    expect(validarAjusteCentral(cedis, { ...cedis, establecimiento_id: null })).toBe(MENSAJE_AJUSTE_SIN_PERTENENCIA);
    expect(validarAjusteCentral(C({ id: 'CF-1', establecimiento_id: 2 }), cedis)).toBe(MENSAJE_AJUSTE_CUARTO_DE_TIENDA);
  });
  it('[13] el cuarto ya no está en los datos o no cargó: bloqueado (no se habilita)', () => {
    expect(validarAjusteCentral(cedis, null)).toBe(MENSAJE_AJUSTE_SIN_PERTENENCIA);
    expect(validarAjusteCentral(null, cedis)).toBe(MENSAJE_AJUSTE_SIN_PERTENENCIA);
  });
  it('el rechazo del servidor (152) se reconoce por su código, no por el texto', () => {
    expect(esErrorInventarioDeTienda({ code: '42501', details: '{"codigo":"INVENTARIO_DE_TIENDA","cuarto_id":"CONG-MATRIZ-01","establecimiento":2}' })).toBe(true);
    expect(esErrorInventarioDeTienda({ code: '42501', message: 'El cuarto es de una tienda', details: null })).toBe(false);
    expect(esErrorInventarioDeTienda({ code: '42501', details: '{"codigo":"CUARTO_DE_TIENDA"}' })).toBe(false);
    expect(esErrorInventarioDeTienda(null)).toBe(false);
  });
});

describe('P4-H3D: el handler de la vista y la acción del store no envían un ajuste central sobre una tienda', () => {
  const vista = src('../components/views/InventarioView.jsx');
  const store = src('../data/supaStore.js');
  const accion = store.slice(store.indexOf('ajustarExistenciaCuarto: async'), store.indexOf('// 093: ajuste manual por contrato del servidor'));
  it('[Capa A] el botón de la tarjeta está condicionado por la regla; sin heurísticas de nombre, prefijo ni interruptor', () => {
    expect(vista).toContain('{puedeOfrecerAjusteCentral(cf) && <button aria-label="Ajustar stock del cuarto frío"');
    expect(vista).not.toMatch(/MATRIZ|CONG-|startsWith\('CF-|tiendas_habilitadas|habilitada/);
  });
  it('[Capa B] abrir el diálogo y confirmar revalidan contra el cuarto vigente; dentro del ciclo, ANTES de cada envío', () => {
    const abrir = vista.slice(vista.indexOf('const abrirAjusteStock'), vista.indexOf('const confirmarAjusteStock'));
    expect(abrir).toMatch(/validarAjusteCentral\(cf, cuartoVigente\(cf\?\.id\)\)/);
    const confirmar = vista.slice(vista.indexOf('const confirmarAjusteStock'), vista.indexOf('const confirmarAjuste ='));
    const inicial = confirmar.indexOf('validarAjusteCentral(stockModal, cuartoVigente(stockModal.id))');
    const ciclo = confirmar.indexOf('for (const a of ajustes)');
    const enCiclo = confirmar.indexOf('validarAjusteCentral(stockModal, cuartoVigente(stockModal.id))', ciclo);
    const envio = confirmar.indexOf('actions.ajustarExistenciaCuarto');
    expect(inicial).toBeGreaterThan(0);
    expect(ciclo).toBeGreaterThan(inicial);
    expect(enCiclo).toBeGreaterThan(ciclo);
    expect(envio).toBeGreaterThan(enCiclo);
    // los cuartos vigentes se leen de una referencia que se actualiza en cada render (no del dato capturado al abrir)
    expect(vista).toContain('cuartosVigentesRef.current = data.cuartosFrios;');
  });
  it('[9][10][13] la acción del store relee la pertenencia en el servidor y corta ANTES del RPC (tienda, desconocido o error de lectura)', () => {
    const lectura = accion.indexOf(".select('id, establecimiento_id').eq('id', cuartoId).single()");
    const corte = accion.indexOf('if (errCf || !cf || !puedeOfrecerAjusteCentral(cf))');
    const rpc = accion.indexOf("supabase.rpc('ajustar_existencia_cuarto'");
    expect(lectura).toBeGreaterThan(0);
    expect(corte).toBeGreaterThan(lectura);
    expect(rpc).toBeGreaterThan(corte);
    expect(accion.slice(corte, rpc)).toMatch(/return \{ error: msg, message: msg \};/);
    expect(accion).toMatch(/esErrorInventarioDeTienda\(error\) \? MENSAJE_AJUSTE_CUARTO_DE_TIENDA : mensajeErrorStock\(error\)/);
  });
  it('[14][19] no cambia permisos: el ajuste central sigue siendo solo de Admin (Ventas, Chofer, Producción: rechazo de siempre)', () => {
    expect(accion.slice(0, 200)).toContain("requireRol(['Admin'])");
    expect(accion.indexOf("requireRol(['Admin'])")).toBeLessThan(accion.indexOf(".select('id, establecimiento_id')"));
  });
});

describe('P4-H3D: Inventario sigue mostrando y consultando todo', () => {
  const data = {
    productos: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', tipo: 'Producto Terminado', stock: 0, precio: 31 }],
    cuartosFrios: [
      C({ id: 'CF-1', nombre: 'Cuarto Frío 1', establecimiento_id: 1, stock: { 'HPC-5K': 5 } }),
      C({ id: 'CONG-MATRIZ-01', nombre: 'Congelador Matriz', establecimiento_id: 2, stock: { 'HPC-5K': 3 } }),
      C({ id: 'CF-SIN', nombre: 'Cuarto sin dato' }),
    ],
    inventarioMov: [{ id: 1, fecha: '2026-10-15', tipo: 'Entrada', producto: 'HPC-5K', cantidad: 5, origen: 'Producción', usuario: 'x', cuarto_id: 'CF-1' }],
    produccion: [], mermas: [], ordenes: [], rutas: [], usuarios: [], umbrales: [],
  };
  const html = renderToStaticMarkup(<InventarioView data={data} actions={{}} />);
  it('[1][2][7] solo la tarjeta del CEDIS trae "Ajustar stock"; la de la tienda y la del cuarto sin dato, no', () => {
    expect((html.match(AJUSTAR) || []).length).toBe(1);
  });
  it('[15][16] las tres tarjetas se listan y se pueden editar (nombre, temperatura); el congelador de tienda no se oculta', () => {
    for (const nombre of ['Cuarto Frío 1', 'Congelador Matriz', 'Cuarto sin dato']) expect(html).toContain(nombre);
    expect((html.match(/aria-label="Editar cuarto frío"/g) || []).length).toBe(3);
  });
  it('[16] la existencia del congelador de tienda sigue a la vista (consultar no es ajustar)', () => {
    const i = html.indexOf('Congelador Matriz');
    expect(i).toBeGreaterThan(0);
    expect(html.slice(i, i + 4000)).toMatch(/>3</);
  });
  it('[17] el CEDIS conserva su ajuste y P4-H2C (eliminar) sigue igual', () => {
    expect(puedeOfrecerEliminarCuarto(data.cuartosFrios[0])).toBe(true);
    expect((html.match(/aria-label="Eliminar cuarto frío"/g) || []).length).toBe(1);
    expect(pertenenciaCuarto(data.cuartosFrios[1])).toBe('tienda');
  });
});
