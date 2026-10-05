// ventasCobro.test.js — OL-01A: qué cobro muestra Ventas y cuándo puede
// declarar éxito. Contención: el ciclo de vida y los contratos no cambian.
import { describe, it, expect, vi } from 'vitest';
import { tieneRutaAsignada, accionesCobroVentas, esExitoStore, ejecutarMutacion } from '../data/ventasCobroLogic';
import { validateTransicionOrden } from '../data/ordenLogic';

describe('tieneRutaAsignada', () => {
  it('ruta_id o rutaId reales; null, undefined o vacío no cuentan', () => {
    expect(tieneRutaAsignada({ ruta_id: 7 })).toBe(true);
    expect(tieneRutaAsignada({ rutaId: '7' })).toBe(true);
    expect(tieneRutaAsignada({ ruta_id: 0 })).toBe(true);
    expect(tieneRutaAsignada({ ruta_id: null })).toBe(false);
    expect(tieneRutaAsignada({})).toBe(false);
    expect(tieneRutaAsignada({ ruta_id: '' })).toBe(false);
    expect(tieneRutaAsignada(null)).toBe(false);
  });
});

describe('accionesCobroVentas: contención por estatus y ruta', () => {
  it('Creada: Cobrar (diálogo existente) y Enviar a ruta', () => {
    expect(accionesCobroVentas({ estatus: 'Creada', ruta_id: null })).toEqual({ cobrar: true, enviarARuta: true, cobrarEntrega: false, enRutaDelChofer: false });
  });
  it('Asignada sin ruta: conserva Cobrar entrega (contrato existente; pendiente OL-02)', () => {
    expect(accionesCobroVentas({ estatus: 'Asignada', ruta_id: null })).toEqual({ cobrar: false, enviarARuta: false, cobrarEntrega: true, enRutaDelChofer: false });
  });
  it('Asignada con ruta: ningún cobro del vendedor; la cobra el chofer', () => {
    expect(accionesCobroVentas({ estatus: 'Asignada', ruta_id: 12 })).toEqual({ cobrar: false, enviarARuta: false, cobrarEntrega: false, enRutaDelChofer: true });
    expect(accionesCobroVentas({ estatus: 'Asignada', rutaId: 12 }).cobrarEntrega).toBe(false);
  });
  it('otros estatus: sin acciones de cobro', () => {
    for (const estatus of ['Entregada', 'Facturada', 'Cancelada', 'No entregada', 'En ruta', '', undefined]) {
      expect(accionesCobroVentas({ estatus, ruta_id: null })).toEqual({ cobrar: false, enviarARuta: false, cobrarEntrega: false, enRutaDelChofer: false });
    }
  });
  it('el ciclo de vida no cambia: Creada → Entregada sigue rechazada; Asignada → Entregada permitida', () => {
    expect(validateTransicionOrden('Creada', 'Entregada')?.error).toMatch(/Creada.*Entregada/);
    expect(validateTransicionOrden('Asignada', 'Entregada')).toBeNull();
  });
});

describe('ejecutarMutacion: éxito solo con resultado confirmado', () => {
  it('error devuelto por el store: sin onExito (sin toast de éxito ni cierre)', async () => {
    const onExito = vi.fn();
    for (const err of [{ error: 'No se puede pasar de Creada a Entregada' }, { message: 'RLS' }, new Error('x'), 'error', true, 0, false]) {
      const r = await ejecutarMutacion(async () => err, { onExito });
      expect(r).toEqual({ ok: false, error: err });
    }
    expect(onExito).not.toHaveBeenCalled();
  });
  it('éxito (undefined/null): onExito una vez, con la misma llamada al store', async () => {
    const accion = vi.fn(async () => undefined);
    const onExito = vi.fn();
    expect(await ejecutarMutacion(() => accion(5, 'Entregada', 'Efectivo'), { onExito })).toEqual({ ok: true });
    expect(accion).toHaveBeenCalledWith(5, 'Entregada', 'Efectivo');
    expect(onExito).toHaveBeenCalledTimes(1);
    expect((await ejecutarMutacion(async () => null)).ok).toBe(true);
  });
  it('excepción: se propaga sin onExito (la vista muestra su error de conexión)', async () => {
    const onExito = vi.fn();
    await expect(ejecutarMutacion(async () => { throw new Error('red'); }, { onExito })).rejects.toThrow('red');
    expect(onExito).not.toHaveBeenCalled();
  });
  it('esExitoStore', () => {
    expect(esExitoStore(undefined)).toBe(true);
    expect(esExitoStore(null)).toBe(true);
    expect(esExitoStore({ error: 'x' })).toBe(false);
  });
});
