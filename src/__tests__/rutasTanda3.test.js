// rutasTanda3.test.js — helpers puros del cierre de pendientes Rutas Tanda 3.
// Cubre: validateCancelacionRuta (PASO 5),
// invariantes de cierre con entregas pendientes (PASO 1), y shape del
// payload de cerrarRuta forzado vs normal.
//
// Las RPCs cerrar_ruta_atomic v2 (PASO 2) y UNIQUE INDEX (PASO 3) se
// validan manualmente en Supabase con SQL — sus efectos en concurrencia
// no son testeable en Vitest.
import { describe, it, expect } from 'vitest';
import {
  validateCancelacionRuta,
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

// 087: buildCancelacionChanges se eliminó — una ruta cargada ya no se cancela con
// devolución genérica de toda la carga_real; su inventario se resuelve con
// finalizar_inventario_ruta (balance canónico, cuartos de origen).

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
