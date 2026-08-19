// realtimeLogic.test.js — partición del realtime granular (Tanda 23).
import { describe, it, expect } from 'vitest';
import { TABLAS_CORE_RT, TABLAS_SLICE_RT, grupoParaTabla } from '../data/realtimeLogic';

// Las 20 tablas que estaban suscritas ANTES de la Tanda 23. Ninguna
// puede quedar fuera de la partición — perder una suscripción es una
// regresión silenciosa (la vista deja de refrescar en vivo).
const SUSCRITAS_PRE_TANDA23 = [
  'clientes', 'productos', 'ordenes', 'rutas',
  'produccion', 'inventario_mov', 'pagos', 'auditoria',
  'cuartos_frios', 'comodatos', 'leads', 'empleados',
  'movimientos_contables', 'mermas', 'nomina_periodos', 'cuentas_por_cobrar',
  'cuentas_por_pagar', 'costos_fijos', 'devoluciones', 'cierres_diarios',
];

describe('partición core/slice', () => {
  it('es disjunta: ninguna tabla está en ambos grupos', () => {
    const core = new Set(TABLAS_CORE_RT);
    expect(TABLAS_SLICE_RT.filter(t => core.has(t))).toEqual([]);
  });

  it('no tiene duplicados dentro de cada grupo', () => {
    expect(new Set(TABLAS_CORE_RT).size).toBe(TABLAS_CORE_RT.length);
    expect(new Set(TABLAS_SLICE_RT).size).toBe(TABLAS_SLICE_RT.length);
  });

  it('cubre TODAS las tablas suscritas antes de la Tanda 23', () => {
    const faltantes = SUSCRITAS_PRE_TANDA23.filter(t => grupoParaTabla(t) === null);
    expect(faltantes).toEqual([]);
  });

  it('agrega las suscripciones nuevas: notificaciones y chofer_ubicaciones', () => {
    expect(grupoParaTabla('notificaciones')).toBe('slice');
    expect(grupoParaTabla('chofer_ubicaciones')).toBe('slice');
  });

  it('las tablas con joins cruzados en el mapeo son núcleo', () => {
    // CxC alimenta el saldo del cliente; empleados/ordenes alimentan el
    // mapeo de rutas; cuartos_frios alimenta alertas y stock efectivo.
    for (const t of ['clientes', 'ordenes', 'rutas', 'cuentas_por_cobrar', 'cuartos_frios', 'empleados', 'productos']) {
      expect(grupoParaTabla(t)).toBe('core');
    }
  });

  it('las tablas de mapeo plano son slice', () => {
    for (const t of ['produccion', 'pagos', 'auditoria', 'mermas', 'leads', 'devoluciones']) {
      expect(grupoParaTabla(t)).toBe('slice');
    }
  });

  it('tabla desconocida → null (no se suscribe nada por accidente)', () => {
    expect(grupoParaTabla('orden_lineas')).toBeNull();
    expect(grupoParaTabla('')).toBeNull();
  });
});
