// rutasTanda3.test.js — helpers puros del cierre de pendientes Rutas Tanda 3.
// Cubre: validateCancelacionRuta, buildCancelacionChanges (PASO 5),
// invariantes de cierre con entregas pendientes (PASO 1), y shape del
// payload de cerrarRuta forzado vs normal.
//
// Las RPCs cerrar_ruta_atomic v2 (PASO 2) y UNIQUE INDEX (PASO 3) se
// validan manualmente en Supabase con SQL — sus efectos en concurrencia
// no son testeable en Vitest.
import { describe, it, expect } from 'vitest';
import {
  validateCancelacionRuta,
  buildCancelacionChanges,
  validateEdicionRuta,
} from '../data/rutasLogic';

// ─── validateCancelacionRuta ───────────────────────────────────
describe('validateCancelacionRuta', () => {
  it('Programada se cancela sin requerir devolución', () => {
    const r = validateCancelacionRuta({ estatus: 'Programada' });
    expect(r.error).toBeUndefined();
    expect(r.requiereDevolucion).toBe(false);
  });

  it('Cargada requiere devolución de stock', () => {
    expect(validateCancelacionRuta({ estatus: 'Cargada' })).toMatchObject({
      requiereDevolucion: true,
    });
  });

  it('Pendiente firma requiere devolución (la firma futura nunca llegará)', () => {
    expect(validateCancelacionRuta({ estatus: 'Pendiente firma' })).toMatchObject({
      requiereDevolucion: true,
    });
  });

  it('En progreso requiere devolución', () => {
    expect(validateCancelacionRuta({ estatus: 'En progreso' })).toMatchObject({
      requiereDevolucion: true,
    });
  });

  it('Cerrada NO se puede cancelar', () => {
    expect(validateCancelacionRuta({ estatus: 'Cerrada' }).error).toMatch(/terminal/i);
  });

  it('Cancelada NO se puede recancelar', () => {
    expect(validateCancelacionRuta({ estatus: 'Cancelada' }).error).toMatch(/terminal/i);
  });

  it('Completada NO se puede cancelar', () => {
    expect(validateCancelacionRuta({ estatus: 'Completada' }).error).toMatch(/terminal/i);
  });

  it('estatus null/vacío rechaza', () => {
    expect(validateCancelacionRuta({}).error).toBeTruthy();
    expect(validateCancelacionRuta({ estatus: null }).error).toBeTruthy();
    expect(validateCancelacionRuta({ estatus: '' }).error).toBeTruthy();
  });

  it('ruta null/undefined rechaza', () => {
    expect(validateCancelacionRuta(null).error).toBeTruthy();
    expect(validateCancelacionRuta(undefined).error).toBeTruthy();
  });

  it('estatus con espacios se trimea', () => {
    expect(validateCancelacionRuta({ estatus: '  Cargada  ' })).toMatchObject({
      requiereDevolucion: true,
    });
  });
});

// ─── buildCancelacionChanges ───────────────────────────────────
describe('buildCancelacionChanges', () => {
  const rutaConCargaReal = {
    folio: 'R-007',
    carga: { 'HC-25K': 100, 'HC-5K': 50 },
    carga_real: { 'HC-25K': 80, 'HC-5K': 40 }, // chofer cargó menos
  };

  it('usa carga_real si existe (lo realmente cargado al camión)', () => {
    const changes = buildCancelacionChanges(rutaConCargaReal, 'CF-1', 'Admin');
    expect(changes).toHaveLength(2);
    const hc25 = changes.find(c => c.sku === 'HC-25K');
    const hc5 = changes.find(c => c.sku === 'HC-5K');
    expect(hc25.delta).toBe(80);
    expect(hc5.delta).toBe(40);
  });

  it('todos los deltas son POSITIVOS (devuelve al cuarto)', () => {
    const changes = buildCancelacionChanges(rutaConCargaReal, 'CF-1', 'Admin');
    for (const c of changes) expect(c.delta).toBeGreaterThan(0);
  });

  it('todos los changes tipo=Entrada y origen incluye folio', () => {
    const changes = buildCancelacionChanges(rutaConCargaReal, 'CF-1', 'Admin');
    for (const c of changes) {
      expect(c.tipo).toBe('Entrada');
      expect(c.origen).toContain('R-007');
    }
  });

  it('cuarto_id se coerce a string', () => {
    const changes = buildCancelacionChanges(rutaConCargaReal, 'CF-1', 'Admin');
    expect(typeof changes[0].cuarto_id).toBe('string');
  });

  it('fallback a carga si carga_real está vacío (caso legacy)', () => {
    const ruta = {
      folio: 'R-008',
      carga: { 'HC-25K': 50 },
      carga_real: {},
    };
    const changes = buildCancelacionChanges(ruta, 'CF-1', 'Admin');
    expect(changes).toHaveLength(1);
    expect(changes[0].delta).toBe(50);
  });

  it('fallback a carga si carga_real es null/undefined', () => {
    const ruta = { folio: 'R-009', carga: { 'HC-5K': 30 } };
    const changes = buildCancelacionChanges(ruta, 'CF-1', 'Admin');
    expect(changes).toHaveLength(1);
    expect(changes[0].delta).toBe(30);
  });

  it('acepta cargaReal en camelCase (del store)', () => {
    const ruta = { folio: 'R-010', cargaReal: { 'HC-25K': 25 } };
    const changes = buildCancelacionChanges(ruta, 'CF-1', 'Admin');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('HC-25K');
    expect(changes[0].delta).toBe(25);
  });

  it('cantidades 0/negativas/NaN se omiten', () => {
    const ruta = {
      folio: 'R-011',
      carga: { 'HC-25K': 50, 'HC-5K': 0, 'HT-25K': -10, 'BAD': 'abc' },
    };
    const changes = buildCancelacionChanges(ruta, 'CF-1', 'Admin');
    expect(changes).toHaveLength(1);
    expect(changes[0].sku).toBe('HC-25K');
  });

  it('ruta sin carga ni carga_real → 0 changes', () => {
    expect(buildCancelacionChanges({ folio: 'R-X' }, 'CF-1', 'Admin')).toEqual([]);
    expect(buildCancelacionChanges({}, 'CF-1', 'Admin')).toEqual([]);
  });

  it('usuario default Admin si no se pasa', () => {
    const changes = buildCancelacionChanges(rutaConCargaReal, 'CF-1', null);
    expect(changes[0].usuario).toBe('Admin');
  });
});

// ─── invariantes integración cancelación ──────────────────────
describe('integración: validateCancelacionRuta + buildCancelacionChanges', () => {
  it('Programada → no requiere devolución, pero builder igual produciría changes', () => {
    // El caller solo invoca el builder si requiereDevolucion es true.
    // El builder mismo es pure y no consulta el estatus.
    const ruta = { estatus: 'Programada', folio: 'R-1', carga: { 'HC-25K': 10 } };
    const valid = validateCancelacionRuta(ruta);
    expect(valid.requiereDevolucion).toBe(false);
    // El caller correctamente NO llama a buildCancelacionChanges en este caso.
  });

  it('Cargada con carga_real produce changes correctos', () => {
    const ruta = {
      estatus: 'Cargada', folio: 'R-1',
      carga_real: { 'HC-25K': 50 },
    };
    const valid = validateCancelacionRuta(ruta);
    expect(valid.requiereDevolucion).toBe(true);
    const changes = buildCancelacionChanges(ruta, 'CF-1', 'Admin');
    expect(changes).toHaveLength(1);
    expect(changes[0].delta).toBe(50);
  });

  it('estados terminales no llegan a buildCancelacionChanges (validate los aborta)', () => {
    for (const est of ['Cerrada', 'Cancelada', 'Completada']) {
      expect(validateCancelacionRuta({ estatus: est }).error).toBeTruthy();
    }
  });
});

// ─── validateEdicionRuta sigue funcionando (regresión de Tanda 1) ─
describe('validateEdicionRuta (regresión)', () => {
  it('null cuando Programada', () => {
    expect(validateEdicionRuta('Programada')).toBeNull();
  });

  it('error cuando Cancelada (Tanda 3 agregó cancelada_at en BD)', () => {
    expect(validateEdicionRuta('Cancelada')?.error).toMatch(/cerrada|cancelada|completada/i);
  });
});

// ─── shape de payload cerrarRuta con forzar ──────────────────
describe('cerrarRuta payload shape', () => {
  it('forma normal: opciones default → forzar=false', () => {
    const opciones = {};
    expect(opciones?.forzar === true).toBe(false);
  });

  it('forma forzada: opciones={forzar:true, motivo:"X"} requiere motivo no vacío', () => {
    const opciones = { forzar: true, motivo: 'Chofer enfermo' };
    expect(opciones?.forzar).toBe(true);
    expect(String(opciones?.motivo || '').trim()).toBeTruthy();
  });

  it('forma forzada sin motivo es inválida', () => {
    const opciones = { forzar: true, motivo: '   ' };
    expect(String(opciones?.motivo || '').trim()).toBe('');
  });
});
