// Tanda 4 de la revisión del 2026-10-10: cola sin señal del chofer, estatus de ruta
// editado a mano y pagos por link que quedaron en revisión.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  MAX_INTENTOS, TIPOS_MUTACION, encolar, marcarIntento, mutacionesFallidas, mutacionesPendientes, parseCola,
  esFalloDeRed, textoError, reactivar,
} from '../data/colaOfflineLogic';
import { pagosEnRevision, codigoRevision } from '../data/pagosRevisionLogic';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

describe('cola sin señal del chofer', () => {
  const cola0 = () => encolar(encolar([], TIPOS_MUTACION.ENTREGA, { ordenId: 1, metodoPago: 'Efectivo' }, 1000), TIPOS_MUTACION.NO_ENTREGA, { ordenId: 2 }, 1001);
  const fallar = (cola, id, veces, motivo) => { let c = cola; for (let i = 0; i < veces; i++) c = marcarIntento(c, id, motivo); return c; };

  it('un fallo de red no es un rechazo (no gasta intentos)', () => {
    for (const m of ['Failed to fetch', 'NetworkError when attempting to fetch resource.', 'Load failed', 'fetch failed', 'timeout', 'Sin conexión']) {
      expect(esFalloDeRed({ error: m })).toBe(true);
      expect(esFalloDeRed(new Error(m))).toBe(true);
    }
    expect(esFalloDeRed({ error: 'La orden OV-0012 está Cancelada' })).toBe(false);
    expect(esFalloDeRed({ message: 'permission denied', code: '42501' })).toBe(false);
    expect(esFalloDeRed({ error: 'cualquier cosa' }, false)).toBe(true); // el teléfono dice que no hay red
  });
  it('lee el texto del error en cualquiera de sus formas', () => {
    expect(textoError({ error: 'a' })).toBe('a');
    expect(textoError({ error: { message: 'b' } })).toBe('b');
    expect(textoError(new Error('c'))).toBe('c');
    expect(textoError('d')).toBe('d');
    expect(textoError(null)).toBe('');
  });
  it('el rechazo guarda su motivo; al agotar intentos queda fallida, visible y fuera de las pendientes', () => {
    const c0 = cola0();
    const c = fallar(c0, c0[0].id, MAX_INTENTOS, 'La orden está Cancelada');
    expect(mutacionesFallidas(c)).toHaveLength(1);
    expect(mutacionesFallidas(c)[0]).toMatchObject({ ultimoError: 'La orden está Cancelada', intentos: MAX_INTENTOS });
    expect(mutacionesPendientes(c).map(m => m.payload.ordenId)).toEqual([2]);
    // Sobrevive a recargar la app (se guarda en el teléfono con su motivo).
    expect(parseCola(JSON.stringify(c))[0].ultimoError).toBe('La orden está Cancelada');
  });
  it('reintentar devuelve una fallida (o todas) a la espera, sin perder su operacion_id', () => {
    const c0 = cola0();
    let c = fallar(c0, c0[0].id, MAX_INTENTOS, 'x');
    c = fallar(c, c0[1].id, MAX_INTENTOS, 'y');
    const una = reactivar(c, c0[0].id);
    expect(mutacionesFallidas(una).map(m => m.payload.ordenId)).toEqual([2]);
    expect(una[0].payload.operacionId).toBe(c0[0].payload.operacionId);
    expect(mutacionesFallidas(reactivar(c))).toHaveLength(0);
    // No toca a las que siguen en espera.
    const parcial = marcarIntento(c0, c0[0].id, 'z');
    expect(reactivar(parcial)[0].intentos).toBe(1);
  });
  it('el hook no cuenta intentos por red, expone las fallidas y la ruta no se cierra con ellas', () => {
    const hook = leer('../data/useColaOffline.js');
    expect(hook).toMatch(/if \(esFalloDeRed\(err, enLinea\)\) break;/);
    expect(hook).toMatch(/marcarIntento\(colaRef\.current, m\.id, textoError\(err\)\)/);
    expect(hook).toMatch(/fallidasActuales, reintentarFallidas, descartar, limpiar/);
    const vista = leer('../components/ChoferView.jsx');
    expect(vista).toMatch(/if \(fallidasCola\(\)\.length > 0\) \{/);
    expect(vista).toMatch(/data-testid="cola-fallidas"/);
    expect(vista).toMatch(/Motivo: \{f\.ultimoError\}/);
    expect(vista).not.toMatch(/sin poder sincronizar — avisa al admin/);
  });
});

describe('estatus de la ruta', () => {
  it('ya no se cambia a mano al editar (una ruta en "Completada" quedaba atorada)', () => {
    const vista = leer('../components/views/RutasView.jsx');
    expect(vista).not.toMatch(/<FormSelect label="Estatus"/);
    const editar = vista.slice(vista.indexOf('actions.updateRuta(editingRuta.id'), vista.indexOf('clientesAsignados,', vista.indexOf('actions.updateRuta(editingRuta.id')));
    expect(editar).not.toMatch(/estatus/);
    const store = leer('../data/supaStore.js');
    const accion = store.slice(store.indexOf('updateRuta: async'), store.indexOf("log('Editar', 'Rutas'"));
    expect(accion).not.toMatch(/update\.estatus/);
  });
});

describe('pagos por link en revisión', () => {
  const ordenes = [{ id: 7, folio: 'OV-0007', cliente: 'Tienda Sol', total: 350 }];
  const intents = [
    { id: 1, orden_id: 7, provider: 'stripe', provider_reference: 'cs_1', status: 'review:amount_mismatch', amount: 300, updated_at: '2026-10-09T10:00:00Z' },
    { id: 2, orden_id: 9, provider: 'mercadopago', provider_reference: 'mp_2', status: 'review:orden_no_cobrable', amount: 120, updated_at: '2026-10-10T10:00:00Z' },
    { id: 3, orden_id: 7, provider: 'stripe', provider_reference: 'cs_3', status: 'review:status_not_paid', amount: 350, updated_at: '2026-10-10T11:00:00Z' },
    { id: 4, orden_id: 7, provider: 'stripe', provider_reference: 'cs_4', status: 'paid', amount: 350, updated_at: '2026-10-10T12:00:00Z' },
    { id: 5, orden_id: 7, provider: 'stripe', provider_reference: 'cs_5', status: 'pending', amount: 350 },
  ];
  it('código de revisión', () => {
    expect(codigoRevision('review:amount_mismatch')).toBe('amount_mismatch');
    expect(codigoRevision('paid')).toBeNull();
    expect(codigoRevision(null)).toBeNull();
  });
  it('lista solo los pagos que SÍ se cobraron y no se registraron, el más reciente primero', () => {
    const r = pagosEnRevision(intents, ordenes);
    expect(r.map(p => p.id)).toEqual([2, 1]);
    expect(r[1]).toMatchObject({ folio: 'OV-0007', cliente: 'Tienda Sol', monto: 300, totalVenta: 350, proveedor: 'Stripe', referencia: 'cs_1' });
    expect(r[1].motivo).toMatch(/importe distinto/);
    expect(r[1].queHacer).toMatch(/Registra ese cobro a mano/);
    expect(r[0]).toMatchObject({ folio: 'Venta #9', proveedor: 'Mercado Pago', totalVenta: null });
    expect(r[0].motivo).toMatch(/cancelada/);
  });
  it('código desconocido: se muestra igual, con un texto genérico', () => {
    const r = pagosEnRevision([{ id: 9, orden_id: null, provider: 'x', provider_reference: 'r', status: 'review:raro', amount: '10.5' }], []);
    expect(r[0]).toMatchObject({ folio: 'Sin venta', monto: 10.5 });
    expect(r[0].motivo).toMatch(/raro/);
    expect(pagosEnRevision(null, null)).toEqual([]);
  });
  it('Por cobrar los muestra (lectura de Admin y Facturación)', () => {
    const vista = leer('../components/views/CobrosView.jsx');
    expect(vista).toMatch(/data-testid="pagos-en-revision"/);
    expect(vista).toMatch(/actions\.pagosLinkEnRevision\?\.\(\)/);
    const store = leer('../data/supaStore.js');
    expect(store).toMatch(/pagosLinkEnRevision: async \(\) => \{\s*const guard = requireRol\(\['Admin', 'Facturación'\]\);/);
    expect(store).toMatch(/\.like\('status', 'review:%'\)/);
  });
});
