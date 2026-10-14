// p4h2cCongeladorTienda.test.jsx — P4-H2C: Inventario no ofrece eliminar el congelador de una tienda.
// La autoridad es el servidor (migración 151, CUARTO_DE_TIENDA); aquí se prueba que la interfaz lo refleje,
// que el handler no llegue al DELETE y que el rechazo del servidor se muestre con un mensaje claro.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  pertenenciaCuarto, puedeOfrecerEliminarCuarto, esErrorCuartoDeTienda, ESTABLECIMIENTO_CEDIS, MENSAJE_CUARTO_DE_TIENDA, MENSAJE_CUARTO_SIN_PERTENENCIA,
} from '../data/stockContratosLogic';
import { InventarioView } from '../components/views/InventarioView';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const C = (o) => ({ id: 'X', nombre: 'Cuarto', temp: -10, capacidad: 100, capacidad_tarimas: 0, stock: {}, ...o });

describe('P4-H2C: pertenencia del cuarto por su establecimiento (no por nombre ni clave)', () => {
  it('el CEDIS es el establecimiento 1 (contrato de 143)', () => {
    expect(ESTABLECIMIENTO_CEDIS).toBe(1);
    expect(pertenenciaCuarto(C({ establecimiento_id: 1 }))).toBe('cedis');
    expect(pertenenciaCuarto(C({ establecimiento_id: '1' }))).toBe('cedis');
  });
  it('[A][B][C][D][E][F] un cuarto de tienda nunca se ofrece para eliminar: activa o inactiva, interruptor encendido o apagado, vacío o con historia', () => {
    for (const extra of [{}, { tienda_activa: true }, { tienda_activa: false }, { interruptor: true }, { interruptor: false }, { stock: {} }, { stock: { 'HPC-5K': 3 } }, { con_historia: true }]) {
      const cf = C({ establecimiento_id: 2, ...extra });
      expect(pertenenciaCuarto(cf)).toBe('tienda');
      expect(puedeOfrecerEliminarCuarto(cf)).toBe(false);
    }
    expect(puedeOfrecerEliminarCuarto(C({ establecimiento_id: 7 }))).toBe(false);
  });
  it('no se guía por el nombre ni por la clave: un cuarto "CF-9" de una tienda no es del CEDIS, y "Congelador Matriz" del CEDIS sí lo es', () => {
    expect(puedeOfrecerEliminarCuarto(C({ id: 'CF-9', nombre: 'Cuarto Frío 9', establecimiento_id: 2 }))).toBe(false);
    expect(puedeOfrecerEliminarCuarto(C({ id: 'CONG-MATRIZ-01', nombre: 'Congelador Matriz', establecimiento_id: 1 }))).toBe(true);
  });
  it('[G] cuarto del CEDIS: se sigue ofreciendo (las reglas de existencia e historia las aplica el servidor como antes)', () => {
    expect(puedeOfrecerEliminarCuarto(C({ id: 'CF-1', establecimiento_id: 1 }))).toBe(true);
  });
  it('[H] sin dato de pertenencia NO se asume CEDIS', () => {
    for (const v of [undefined, null, '', 'abc', 0, -1, 1.5]) {
      expect(pertenenciaCuarto(C({ establecimiento_id: v }))).toBe('desconocido');
      expect(puedeOfrecerEliminarCuarto(C({ establecimiento_id: v }))).toBe(false);
    }
    expect(puedeOfrecerEliminarCuarto(null)).toBe(false);
    expect(MENSAJE_CUARTO_SIN_PERTENENCIA).toMatch(/no se elimina/);
  });
});

describe('P4-H2C: error del servidor CUARTO_DE_TIENDA', () => {
  it('[J] se reconoce por su código (DETAIL de la migración 151) y no por el texto', () => {
    expect(esErrorCuartoDeTienda({ code: '42501', message: 'cuartos_frios: el cuarto CONG-MATRIZ-01 es el congelador…', details: '{"codigo":"CUARTO_DE_TIENDA","cuarto_id":"CONG-MATRIZ-01","establecimiento_id":2}' })).toBe(true);
    expect(esErrorCuartoDeTienda({ code: '42501', message: 'permission denied for table cuartos_frios', details: null })).toBe(false);
    expect(esErrorCuartoDeTienda({ code: '23503', details: 'Key (id)=(CF-1) is still referenced' })).toBe(false);
    expect(esErrorCuartoDeTienda(null)).toBe(false);
    expect(MENSAJE_CUARTO_DE_TIENDA).toBe('Este congelador pertenece a una tienda y no puede eliminarse.');
  });
});

describe('P4-H2C: el handler no llega al DELETE de un congelador de tienda', () => {
  const store = src('../data/supaStore.js');
  const cuerpo = store.slice(store.indexOf('deleteCuartoFrio: async'), store.indexOf('// ── CUARTOS FRÍOS — STOCK (JSONB)'));
  it('[I] lee el establecimiento y corta ANTES del DELETE si no es del CEDIS (también sin dato)', () => {
    expect(cuerpo).toContain(".select('id, nombre, stock, establecimiento_id')");
    const corte = cuerpo.indexOf('if (!puedeOfrecerEliminarCuarto(cf))');
    const borrado = cuerpo.indexOf(".delete()");
    expect(corte).toBeGreaterThan(0);
    expect(borrado).toBeGreaterThan(corte);
    expect(cuerpo.slice(corte, borrado)).toMatch(/return \{ error: msg \};/);
    expect(cuerpo).toContain('MENSAJE_CUARTO_SIN_PERTENENCIA');
  });
  it('[J] si el servidor rechaza con CUARTO_DE_TIENDA, muestra el mensaje claro; los demás errores siguen igual', () => {
    expect(cuerpo).toMatch(/esErrorCuartoDeTienda\(error\)\s*\?\s*MENSAJE_CUARTO_DE_TIENDA/);
    expect(cuerpo).toContain("No se puede eliminar — el cuarto tiene movimientos o relaciones asociadas.");
  });
  it('[K] no amplía permisos: eliminar, editar y crear cuartos siguen siendo solo de Admin', () => {
    for (const fn of ['addCuartoFrio', 'updateCuartoFrio', 'deleteCuartoFrio']) {
      const i = store.indexOf(`${fn}: async`);
      expect(store.slice(i, i + 220)).toContain("requireRol(['Admin'])");
    }
  });
});

describe('P4-H2C: Inventario', () => {
  const data = {
    productos: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', tipo: 'Producto Terminado', stock: 0, precio: 31 }],
    cuartosFrios: [
      C({ id: 'CF-1', nombre: 'Cuarto Frío 1', establecimiento_id: 1, stock: { 'HPC-5K': 5 } }),
      C({ id: 'CONG-MATRIZ-01', nombre: 'Congelador Matriz', establecimiento_id: 2 }),
      C({ id: 'CF-SIN', nombre: 'Cuarto sin dato' }),
    ],
    inventarioMov: [], produccion: [], mermas: [], ordenes: [], rutas: [], usuarios: [], umbrales: [],
  };
  it('[A]–[H] la tarjeta del cuarto del CEDIS ofrece "Eliminar"; la del congelador de tienda y la del cuarto sin dato, no', () => {
    const html = renderToStaticMarkup(<InventarioView data={data} actions={{}} />);
    expect(html).toContain('Cuarto Frío 1');
    expect(html).toContain('Congelador Matriz');
    expect((html.match(/aria-label="Eliminar cuarto frío"/g) || []).length).toBe(1);
    expect((html.match(/aria-label="Editar cuarto frío"/g) || []).length).toBe(3);
  });
  it('el botón de la tarjeta y el del diálogo de edición están condicionados por la misma regla', () => {
    const v = src('../components/views/InventarioView.jsx');
    expect(v).toContain('{puedeOfrecerEliminarCuarto(cf) && <button aria-label="Eliminar cuarto frío"');
    expect(v).toContain('cfModal.id && puedeOfrecerEliminarCuarto(cfModal) && <button');
    expect(v).not.toMatch(/MATRIZ|CONG-|startsWith\('CF-|tiendas_habilitadas|habilitada/);
  });
});
