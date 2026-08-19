// cronAlertasLogic.test.js — crons de alertas (Tanda 21):
// cartera vencida y rutas atoradas.
import { describe, it, expect } from 'vitest';
import {
  buildNotifCxcVencidas,
  buildNotifRutasAtoradas,
  fechaHoyMx,
  filtrarCxcVencidas,
  filtrarRutasAtoradas,
} from '../data/cronAlertasLogic';

const HOY = '2026-08-19';

describe('fechaHoyMx', () => {
  it('formatea como YYYY-MM-DD', () => {
    expect(fechaHoyMx(new Date('2026-08-19T18:00:00Z'))).toBe('2026-08-19');
  });

  it('cruza medianoche UTC: 03:00 UTC sigue siendo el día anterior en CDMX', () => {
    // CDMX es UTC-6 → 2026-08-19 03:00 UTC = 2026-08-18 21:00 CDMX
    expect(fechaHoyMx(new Date('2026-08-19T03:00:00Z'))).toBe('2026-08-18');
  });

  it('13:00 UTC (hora del cron) ya es el día en curso en CDMX', () => {
    expect(fechaHoyMx(new Date('2026-08-19T13:00:00Z'))).toBe('2026-08-19');
  });
});

describe('filtrarCxcVencidas', () => {
  const base = { estatus: 'Pendiente', saldo_pendiente: 500, cliente_id: 1 };

  it('incluye cuentas cobrables con vencimiento anterior a hoy', () => {
    const cuentas = [
      { ...base, id: 1, fecha_vencimiento: '2026-08-10' },
      { ...base, id: 2, estatus: 'Parcial', fecha_vencimiento: '2026-08-18' },
      { ...base, id: 3, estatus: 'Vencida', fecha_vencimiento: '2026-07-01' },
    ];
    expect(filtrarCxcVencidas(cuentas, HOY).map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it('excluye la que vence HOY (vencida = estrictamente antes de hoy)', () => {
    expect(filtrarCxcVencidas([{ ...base, fecha_vencimiento: HOY }], HOY)).toEqual([]);
  });

  it('excluye pagadas aunque tengan fecha vencida', () => {
    const cuentas = [{ ...base, estatus: 'Pagada', fecha_vencimiento: '2026-01-01' }];
    expect(filtrarCxcVencidas(cuentas, HOY)).toEqual([]);
  });

  it('excluye saldo cero o negativo', () => {
    const cuentas = [
      { ...base, saldo_pendiente: 0, fecha_vencimiento: '2026-01-01' },
      { ...base, saldo_pendiente: -50, fecha_vencimiento: '2026-01-01' },
    ];
    expect(filtrarCxcVencidas(cuentas, HOY)).toEqual([]);
  });

  it('excluye CxC sin fecha_vencimiento (no puede estar vencida)', () => {
    expect(filtrarCxcVencidas([{ ...base, fecha_vencimiento: null }], HOY)).toEqual([]);
  });

  it('tolera timestamps completos recortando a YYYY-MM-DD', () => {
    const cuentas = [{ ...base, fecha_vencimiento: '2026-08-18T00:00:00+00:00' }];
    expect(filtrarCxcVencidas(cuentas, HOY)).toHaveLength(1);
  });

  it('tolera lista null/undefined y filas null', () => {
    expect(filtrarCxcVencidas(null, HOY)).toEqual([]);
    expect(filtrarCxcVencidas([null, undefined], HOY)).toEqual([]);
  });
});

describe('buildNotifCxcVencidas', () => {
  it('null cuando no hay vencidas (no se inserta notificación vacía)', () => {
    expect(buildNotifCxcVencidas([], HOY)).toBeNull();
    expect(buildNotifCxcVencidas(null, HOY)).toBeNull();
  });

  it('suma el total y cuenta clientes únicos', () => {
    const notif = buildNotifCxcVencidas(
      [
        { cliente_id: 1, saldo_pendiente: 1000 },
        { cliente_id: 1, saldo_pendiente: 500 },
        { cliente_id: 2, saldo_pendiente: 250.5 },
      ],
      HOY
    );
    expect(notif.tipo).toBe('alerta');
    expect(notif.titulo).toBe('Cartera vencida');
    expect(notif.mensaje).toContain('3 cuentas vencidas');
    expect(notif.mensaje).toContain('2 clientes');
    expect(notif.mensaje).toContain('1,750.50');
  });

  it('usa singular con una sola cuenta de un solo cliente', () => {
    const notif = buildNotifCxcVencidas([{ cliente_id: 7, saldo_pendiente: 300 }], HOY);
    expect(notif.mensaje).toContain('1 cuenta vencida');
    expect(notif.mensaje).toContain('1 cliente');
  });

  it('la referencia es la llave de dedup diaria', () => {
    const notif = buildNotifCxcVencidas([{ cliente_id: 1, saldo_pendiente: 1 }], HOY);
    expect(notif.referencia).toBe('cron-cxc:2026-08-19');
  });
});

describe('filtrarRutasAtoradas', () => {
  it('incluye rutas de días anteriores en estatus no terminal', () => {
    const rutas = [
      { id: 1, estatus: 'En progreso', fecha: '2026-08-18' },
      { id: 2, estatus: 'Cargada', fecha: '2026-08-15' },
      { id: 3, estatus: 'Pendiente firma', fecha: '2026-08-17' },
    ];
    expect(filtrarRutasAtoradas(rutas, HOY).map((r) => r.id)).toEqual([1, 2, 3]);
  });

  it('excluye rutas de HOY aunque sigan abiertas (todavía no están atoradas)', () => {
    expect(filtrarRutasAtoradas([{ estatus: 'En progreso', fecha: HOY }], HOY)).toEqual([]);
  });

  it('excluye estados terminales: Cerrada, Cancelada, Completada', () => {
    const rutas = [
      { estatus: 'Cerrada', fecha: '2026-08-18' },
      { estatus: 'Cancelada', fecha: '2026-08-18' },
      { estatus: 'Completada', fecha: '2026-08-18' },
    ];
    expect(filtrarRutasAtoradas(rutas, HOY)).toEqual([]);
  });

  it('excluye rutas sin fecha', () => {
    expect(filtrarRutasAtoradas([{ estatus: 'En progreso', fecha: null }], HOY)).toEqual([]);
  });

  it('tolera lista null y filas null', () => {
    expect(filtrarRutasAtoradas(null, HOY)).toEqual([]);
    expect(filtrarRutasAtoradas([null], HOY)).toEqual([]);
  });
});

describe('buildNotifRutasAtoradas', () => {
  it('null sin rutas atoradas', () => {
    expect(buildNotifRutasAtoradas([], HOY)).toBeNull();
    expect(buildNotifRutasAtoradas(null, HOY)).toBeNull();
  });

  it('nombra la ruta por folio, con fallback a nombre y a #id', () => {
    const notif = buildNotifRutasAtoradas(
      [
        { id: 1, folio: 'RT-0001', nombre: 'Centro' },
        { id: 2, folio: null, nombre: 'Norte' },
        { id: 3, folio: null, nombre: null },
      ],
      HOY
    );
    expect(notif.mensaje).toContain('RT-0001');
    expect(notif.mensaje).toContain('Norte');
    expect(notif.mensaje).toContain('#3');
  });

  it('lista máximo 3 y resume el resto', () => {
    const rutas = [1, 2, 3, 4, 5].map((id) => ({ id, folio: `RT-${id}` }));
    const notif = buildNotifRutasAtoradas(rutas, HOY);
    expect(notif.mensaje).toContain('5 rutas de días anteriores siguen abiertas');
    expect(notif.mensaje).toContain('y 2 más');
    expect(notif.mensaje).not.toContain('RT-4');
  });

  it('singular con una sola ruta', () => {
    const notif = buildNotifRutasAtoradas([{ id: 1, folio: 'RT-9' }], HOY);
    expect(notif.mensaje).toContain('1 ruta de días anteriores sigue abierta');
  });

  it('la referencia es la llave de dedup diaria', () => {
    const notif = buildNotifRutasAtoradas([{ id: 1 }], HOY);
    expect(notif.referencia).toBe('cron-rutas:2026-08-19');
  });
});
