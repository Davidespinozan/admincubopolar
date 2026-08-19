// bandejaLogic.test.js — "Mi bandeja" centro de pendientes (Tanda 24).
import { describe, it, expect } from 'vitest';
import { construirBandeja, contarUrgentes } from '../data/bandejaLogic';

const HOY = '2026-08-19';

const buscar = (tareas, id) => tareas.find(t => t.id === id);

describe('construirBandeja — vacía', () => {
  it('sin datos → sin tareas (todo al día)', () => {
    expect(construirBandeja({}, HOY)).toEqual([]);
    expect(construirBandeja(null, HOY)).toEqual([]);
  });
});

describe('firmas pendientes', () => {
  it('detecta rutas en Pendiente firma y enruta a rutas', () => {
    const t = buscar(construirBandeja({ rutas: [{ estatus: 'Pendiente firma' }] }, HOY), 'firmas');
    expect(t).toBeTruthy();
    expect(t.prioridad).toBe('alta');
    expect(t.modulo).toBe('rutas');
    expect(t.count).toBe(1);
    expect(t.titulo).toContain('1 carga espera firma');
  });

  it('ignora rutas en otros estados', () => {
    const tareas = construirBandeja({ rutas: [{ estatus: 'En progreso', fecha: HOY }] }, HOY);
    expect(buscar(tareas, 'firmas')).toBeUndefined();
  });
});

describe('rutas atoradas', () => {
  it('ruta de ayer no terminal → urgente, nombra el folio', () => {
    const t = buscar(construirBandeja({
      rutas: [{ estatus: 'En progreso', fecha: '2026-08-18', folio: 'RT-7' }],
    }, HOY), 'rutas-atoradas');
    expect(t.prioridad).toBe('alta');
    expect(t.detalle).toContain('RT-7');
  });

  it('ruta de hoy abierta y rutas cerradas de ayer NO cuentan', () => {
    const tareas = construirBandeja({
      rutas: [
        { estatus: 'En progreso', fecha: HOY },
        { estatus: 'Cerrada', fecha: '2026-08-10' },
        { estatus: 'Cancelada', fecha: '2026-08-10' },
      ],
    }, HOY);
    expect(buscar(tareas, 'rutas-atoradas')).toBeUndefined();
  });
});

describe('cartera vencida', () => {
  it('suma el total y es urgente (campos camelCase del store)', () => {
    const t = buscar(construirBandeja({
      cuentasPorCobrar: [
        { estatus: 'Pendiente', saldoPendiente: 1000, fechaVencimiento: '2026-08-01' },
        { estatus: 'Parcial', saldoPendiente: 500.5, fechaVencimiento: '2026-08-10' },
      ],
    }, HOY), 'cxc-vencidas');
    expect(t.prioridad).toBe('alta');
    expect(t.modulo).toBe('cobros');
    expect(t.titulo).toContain('1,500.50');
    expect(t.count).toBe(2);
  });

  it('excluye pagadas, saldo 0, sin vencimiento y las que vencen hoy', () => {
    const tareas = construirBandeja({
      cuentasPorCobrar: [
        { estatus: 'Pagada', saldoPendiente: 100, fechaVencimiento: '2026-01-01' },
        { estatus: 'Pendiente', saldoPendiente: 0, fechaVencimiento: '2026-01-01' },
        { estatus: 'Pendiente', saldoPendiente: 100, fechaVencimiento: null },
        { estatus: 'Pendiente', saldoPendiente: 100, fechaVencimiento: HOY },
      ],
    }, HOY);
    expect(buscar(tareas, 'cxc-vencidas')).toBeUndefined();
  });
});

describe('cortes con diferencia', () => {
  it('solo cortes de HOY con diferencia distinta de cero', () => {
    const tareas = construirBandeja({
      cierresDiarios: [
        { fecha: HOY, diferencia: -150 },
        { fecha: HOY, diferencia: 0 },
        { fecha: '2026-08-18', diferencia: -999 },
      ],
    }, HOY);
    const t = buscar(tareas, 'cierres-diferencia');
    expect(t.count).toBe(1);
    expect(t.modulo).toBe('conciliacion');
  });
});

describe('alertas de stock', () => {
  it('separa crítico (urgente) de accionable (media) y excluye cxc-/comp-', () => {
    const tareas = construirBandeja({
      alertas: [
        { id: 1, tipo: 'critica', msg: 'HC-5K bajo mínimo' },
        { id: 'prod-min-HC25', tipo: 'accionable', msg: 'Producir 100' },
        { id: 'cxc-9', tipo: 'critica', msg: 'CxC vencida' },
        { id: 'comp-3', tipo: 'accionable', msg: 'Complemento pendiente' },
      ],
    }, HOY);
    expect(buscar(tareas, 'stock-critico').count).toBe(1);
    expect(buscar(tareas, 'stock-critico').prioridad).toBe('alta');
    expect(buscar(tareas, 'stock-bajo').count).toBe(1);
    expect(buscar(tareas, 'stock-bajo').prioridad).toBe('media');
    // el comp- va a su propia tarea, no a stock
    expect(buscar(tareas, 'complementos-ppd').count).toBe(1);
  });
});

describe('pendientes comerciales y fiscales', () => {
  it('ventas Creadas sin ruta → media, enruta a rutas', () => {
    const t = buscar(construirBandeja({
      ordenes: [{ estatus: 'Creada' }, { estatus: 'Entregada' }, { estatus: 'Asignada' }],
    }, HOY), 'ordenes-sin-ruta');
    expect(t.count).toBe(1);
    expect(t.prioridad).toBe('media');
    expect(t.modulo).toBe('rutas');
  });

  it('facturación pendiente y leads nuevos', () => {
    const tareas = construirBandeja({
      facturacionPendiente: [{ id: 1 }, { id: 2 }],
      leads: [{ estatus: 'Nuevo' }, { estatus: 'Contactado' }, { estatus: 'Descartado' }],
    }, HOY);
    expect(buscar(tareas, 'por-facturar').count).toBe(2);
    expect(buscar(tareas, 'por-facturar').modulo).toBe('facturacion');
    expect(buscar(tareas, 'leads-nuevos').count).toBe(1);
    expect(buscar(tareas, 'leads-nuevos').modulo).toBe('leads');
  });
});

describe('orden y conteo', () => {
  it('las urgentes van siempre antes que las de prioridad media', () => {
    const tareas = construirBandeja({
      leads: [{ estatus: 'Nuevo' }],                              // media
      rutas: [{ estatus: 'Pendiente firma' }],                    // alta
      ordenes: [{ estatus: 'Creada' }],                           // media
      cuentasPorCobrar: [{ estatus: 'Pendiente', saldoPendiente: 9, fechaVencimiento: '2026-01-01' }], // alta
    }, HOY);
    const prioridades = tareas.map(t => t.prioridad);
    const primeraMedia = prioridades.indexOf('media');
    expect(prioridades.slice(0, primeraMedia)).toEqual(Array(primeraMedia).fill('alta'));
    expect(prioridades.slice(primeraMedia)).not.toContain('alta');
  });

  it('contarUrgentes cuenta solo prioridad alta', () => {
    const tareas = construirBandeja({
      rutas: [{ estatus: 'Pendiente firma' }],
      leads: [{ estatus: 'Nuevo' }],
    }, HOY);
    expect(contarUrgentes(tareas)).toBe(1);
    expect(contarUrgentes([])).toBe(0);
    expect(contarUrgentes(null)).toBe(0);
  });
});
