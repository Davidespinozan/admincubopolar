// t5cConteoEmpaques.test.jsx — T5-C (mig 140): conteo físico de empaques.
// La autoridad vive en la base (suite 140 y concurrencia C140); aquí se prueba la lógica pura,
// lo que muestra la pantalla y que el frontend solo usa los contratos (sin escritura REST).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  piezasDe, compararConteo, motivoNoConfirmar, buildRegistrarConteoArgs, codigoConteo, mensajeErrorConteo, filaEmpaque, filaMovimiento,
} from '../data/conteoEmpaqueLogic';
import ConteoEmpaques, { CuerpoConteo } from '../components/ConteoEmpaques';
import { AlmacenBolsasView } from '../components/views/AlmacenBolsasView';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');
const EMP = { sku: 'EMP-5', nombre: 'Bolsa empaque 5kg', unidad: 'piezas', existencia: 9000, costo_unitario: 0.85, usado_por: 2, revision: 41,
  ultimo_movimiento: { id: 41, fecha: '2026-10-10T18:00:00Z', tipo: 'Salida', cantidad: 120, origen: 'Producción', usuario: 'Admin Uno' } };
const OP = '11111111-1111-4111-8111-111111111111';

describe('cantidad contada', () => {
  it('acepta enteros de 0 en adelante, con separadores de miles', () => {
    expect(piezasDe('8450')).toBe(8450);
    expect(piezasDe(' 8,450 ')).toBe(8450);
    expect(piezasDe('8 450')).toBe(8450);
    expect(piezasDe('0')).toBe(0);
  });
  it('rechaza vacío, negativos, decimales, texto y cantidades absurdas', () => {
    for (const v of ['', ' ', '-5', '8.5', '1e3', 'mil', '12a', null, undefined, '99999999999']) expect(piezasDe(v)).toBeNull();
  });
});

describe('comparación con lo registrado', () => {
  it('igual: válido, diferencia 0, se guarda como conteo sin diferencia', () => {
    const c = compararConteo(9000, '9000');
    expect(c).toMatchObject({ valido: true, tipo: 'igual', conteo: 9000, diferencia: 0 });
  });
  it('faltante: válido, dice de cuánto a cuánto baja', () => {
    const c = compararConteo(9000, '8450');
    expect(c).toMatchObject({ valido: true, tipo: 'faltante', conteo: 8450, diferencia: -550 });
    expect(c.mensaje).toContain('Faltan 550');
    expect(c.mensaje).toContain('9,000');
    expect(c.mensaje).toContain('8,450');
  });
  it('conteo en cero es un faltante válido', () => {
    expect(compararConteo(9000, '0')).toMatchObject({ valido: true, tipo: 'faltante', conteo: 0, diferencia: -9000 });
  });
  it('sobrante: NO se puede aplicar; manda a compra recibida', () => {
    const c = compararConteo(9000, '9100');
    expect(c).toMatchObject({ valido: false, tipo: 'sobrante', diferencia: 100 });
    expect(c.mensaje).toContain('compra recibida');
  });
  it('vacío e inválido no son válidos', () => {
    expect(compararConteo(9000, '')).toMatchObject({ valido: false, tipo: 'vacio' });
    expect(compararConteo(9000, '-1')).toMatchObject({ valido: false, tipo: 'invalido' });
    expect(compararConteo(9000, '10.5')).toMatchObject({ valido: false, tipo: 'invalido' });
  });
});

describe('qué falta para confirmar', () => {
  const ok = compararConteo(9000, '8450');
  it('exige cantidad válida, motivo y confirmación explícita, en ese orden', () => {
    expect(motivoNoConfirmar({ comparacion: compararConteo(9000, ''), motivo: 'apertura', confirmado: true })).toMatch(/cuántas piezas/);
    expect(motivoNoConfirmar({ comparacion: compararConteo(9000, '9100'), motivo: 'apertura', confirmado: true })).toMatch(/Sobran/);
    expect(motivoNoConfirmar({ comparacion: ok, motivo: '  ab ', confirmado: true })).toMatch(/motivo/);
    expect(motivoNoConfirmar({ comparacion: ok, motivo: 'Conteo de apertura', confirmado: false })).toMatch(/casilla/);
    expect(motivoNoConfirmar({ comparacion: ok, motivo: 'Conteo de apertura', confirmado: true })).toBeNull();
  });
  it('un conteo sin diferencia también pide motivo y confirmación (nunca se aplica solo)', () => {
    const igual = compararConteo(9000, '9000');
    expect(motivoNoConfirmar({ comparacion: igual, motivo: '', confirmado: true })).toMatch(/motivo/);
    expect(motivoNoConfirmar({ comparacion: igual, motivo: 'Conteo semanal', confirmado: false })).toMatch(/casilla/);
  });
});

describe('argumentos del contrato', () => {
  it('manda la existencia y la revisión que la pantalla mostraba', () => {
    const r = buildRegistrarConteoArgs({ operacionId: OP, sku: ' EMP-5 ', existencia: 9000, revision: 41, conteo: 8450, motivo: '  Conteo de apertura ' });
    expect(r.args).toEqual({ p_operacion_id: OP, p_sku: 'EMP-5', p_existencia_vista: 9000, p_revision_vista: 41, p_conteo: 8450, p_motivo: 'Conteo de apertura' });
  });
  it('empaque sin movimientos: revisión 0; conteo 0 es válido', () => {
    const r = buildRegistrarConteoArgs({ operacionId: OP, sku: 'EMP-25-SL', existencia: 0, revision: undefined, conteo: 0, motivo: 'Conteo de apertura' });
    expect(r.args).toMatchObject({ p_revision_vista: 0, p_conteo: 0, p_existencia_vista: 0 });
  });
  it('genera una operación si no viene (un UUID)', () => {
    const r = buildRegistrarConteoArgs({ sku: 'EMP-5', existencia: 10, revision: 1, conteo: 5, motivo: 'Conteo semanal' });
    expect(r.args.p_operacion_id).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('no arma la llamada sin empaque, con cantidad inválida, sin existencia o sin motivo', () => {
    expect(buildRegistrarConteoArgs({ sku: '', existencia: 1, conteo: 1, motivo: 'motivo' }).error).toBeTruthy();
    for (const conteo of [-1, 1.5, '1.5', '', null, NaN]) expect(buildRegistrarConteoArgs({ sku: 'EMP-5', existencia: 1, conteo, motivo: 'motivo' }).error).toBeTruthy();
    expect(buildRegistrarConteoArgs({ sku: 'EMP-5', existencia: undefined, conteo: 1, motivo: 'motivo' }).error).toBeTruthy();
    expect(buildRegistrarConteoArgs({ sku: 'EMP-5', existencia: 1, conteo: 1, motivo: 'abc' }).error).toBeTruthy();
  });
});

describe('rechazos del servidor', () => {
  it('lee el código del detalle', () => {
    expect(codigoConteo({ details: '{"codigo":"CONTEO_OBSOLETO","existencia":8900}' })).toMatchObject({ codigo: 'CONTEO_OBSOLETO', existencia: 8900 });
    expect(codigoConteo({ details: 'texto' })).toBeNull();
    expect(codigoConteo(null)).toBeNull();
  });
  it('traduce permisos, operación repetida y red; respeta el texto del servidor', () => {
    expect(mensajeErrorConteo({ code: '42501', message: 'No autorizado' })).toMatch(/Solo Administración/);
    expect(mensajeErrorConteo({ message: 'operacion_id ya usado con otra solicitud' })).toMatch(/otra cantidad/);
    expect(mensajeErrorConteo({ message: 'TypeError: Failed to fetch' })).toMatch(/no se aplicará dos veces/);
    expect(mensajeErrorConteo({ message: 'La existencia de EMP-5 cambió mientras contabas' })).toBe('La existencia de EMP-5 cambió mientras contabas');
    expect(mensajeErrorConteo({})).toMatch(/No se aplicó ningún cambio/);
  });
});

describe('filas', () => {
  it('fila de empaque: existencia, revisión, costo y último movimiento', () => {
    expect(filaEmpaque(EMP)).toMatchObject({ sku: 'EMP-5', existencia: 9000, revision: 41, costo: 0.85, usadoPor: 2, unidad: 'piezas', ultimo: { tipo: 'Salida', cantidad: 120 } });
    expect(filaEmpaque({ sku: 'X', nombre: 'Nueva', existencia: 0, revision: 0, costo_unitario: null, ultimo_movimiento: null })).toMatchObject({ costo: null, ultimo: null, revision: 0 });
  });
  it('movimientos: clasifica sin inventar existencias', () => {
    expect(filaMovimiento({ id: 1, tipo: 'Salida', cantidad: 550, origen: 'Ajuste manual: Conteo físico: apertura', usuario: 'Santiago', existencia_anterior: 9000, existencia_resultante: 8450 }))
      .toMatchObject({ clase: 'Conteo físico', detalle: 'apertura', entrada: false, anterior: 9000, resultante: 8450, responsable: 'Santiago' });
    expect(filaMovimiento({ id: 2, tipo: 'Salida', cantidad: 5, origen: 'Ajuste manual: bolsas rotas' })).toMatchObject({ clase: 'Ajuste', detalle: 'bolsas rotas', anterior: null });
    expect(filaMovimiento({ id: 3, tipo: 'Entrada', cantidad: 1000, origen: 'Recepción de compra' })).toMatchObject({ clase: 'Compra recibida', entrada: true, resultante: null });
    expect(filaMovimiento({ id: 4, tipo: 'Salida', cantidad: 10, origen: 'Producción' }).clase).toBe('Producción');
  });
});

describe('pantalla', () => {
  it('la sección Empaques lista SKU, nombre, existencia, unidad, costo, último movimiento y las dos acciones', () => {
    const html = renderToStaticMarkup(<ConteoEmpaques actions={{}} inicial={[EMP]} />);
    for (const t of ['Empaques', 'EMP-5', 'Bolsa empaque 5kg', '9,000', 'piezas', '$0.85', 'Existencia registrada', 'Costo unitario', 'Último movimiento', 'Ver historial', 'Registrar conteo']) expect(html).toContain(t);
  });
  it('sin empaques lo dice; mientras carga no muestra ceros', () => {
    expect(renderToStaticMarkup(<ConteoEmpaques actions={{}} inicial={[]} />)).toContain('No hay empaques dados de alta');
    const cargando = renderToStaticMarkup(<ConteoEmpaques actions={{}} />);
    expect(cargando).toContain('Cargando empaques');
    expect(cargando).not.toContain('Registrar conteo');
  });
  const dialogo = (texto, extra = {}) => {
    const conteo = { emp: filaEmpaque(EMP), texto, motivo: '', confirmado: false, ...extra };
    const comp = compararConteo(conteo.emp.existencia, texto);
    return renderToStaticMarkup(<CuerpoConteo conteo={conteo} comp={comp} falta={motivoNoConfirmar({ comparacion: comp, motivo: conteo.motivo, confirmado: conteo.confirmado })} errConteo={extra.err || null} onCambio={() => {}} />);
  };
  it('el diálogo muestra SKU, existencia registrada, diferencia, motivo y confirmación', () => {
    const html = dialogo('8450');
    for (const t of ['EMP-5', '9,000', 'Cantidad contada', 'Diferencia: −550 piezas', 'Motivo (obligatorio)', 'Confirmo que conté 8,450 piezas']) expect(html).toContain(t);
  });
  it('sobrante: explica compra recibida y la casilla queda deshabilitada', () => {
    const html = dialogo('9100');
    expect(html).toContain('Diferencia: +100 piezas');
    expect(html).toContain('compra recibida');
    expect(html).toMatch(/type="checkbox"[^>]*disabled/);
  });
  it('conteo igual: diferencia 0 y aviso de que se guarda sin diferencia', () => {
    const html = dialogo('9000');
    expect(html).toContain('Diferencia: 0 piezas');
    expect(html).toContain('coincide');
  });
  it('muestra el rechazo del servidor', () => {
    expect(dialogo('8450', { err: 'La existencia cambió mientras contabas' })).toContain('La existencia cambió mientras contabas');
  });
  const DATA = { productos: [{ id: 1, sku: 'EMP-5', nombre: 'Bolsa empaque 5kg', tipo: 'Empaque', stock: 9000 }], inventarioMov: [], produccion: [] };
  it('solo Administración ve la sección de conteo', () => {
    expect(renderToStaticMarkup(<AlmacenBolsasView data={DATA} actions={{}} user={{ rol: 'Admin' }} />)).toContain('data-testid="conteo-empaques"');
    for (const rol of ['Almacén Bolsas', 'Producción', 'Ventas', 'Chofer', 'Facturación', 'Empleado', 'Sin asignar', undefined]) {
      const html = renderToStaticMarkup(<AlmacenBolsasView data={DATA} actions={{}} user={{ rol }} />);
      expect(html).not.toContain('conteo-empaques');
      expect(html).not.toContain('Costo unitario');
    }
  });
});

describe('el frontend solo usa los contratos', () => {
  const store = leer('../data/supaStore.js');
  const comp = leer('../components/ConteoEmpaques.jsx');
  it('las tres acciones van por RPC y exigen Admin', () => {
    for (const rpc of ['empaques_para_conteo', 'registrar_conteo_empaque', 'historial_empaque']) expect(store).toContain(`supabase.rpc('${rpc}'`);
    for (const accion of ['empaquesParaConteo', 'registrarConteoEmpaque', 'historialEmpaque']) {
      const i = store.indexOf(`${accion}: async`);
      expect(i).toBeGreaterThan(0);
      expect(store.slice(i, i + 260)).toContain("requireRol(['Admin'])");
    }
  });
  it('la pantalla no escribe por REST ni calcula la existencia nueva por su cuenta', () => {
    expect(comp).not.toMatch(/supabase|\.from\(|\.update\(|\.insert\(/);
    expect(comp).toContain('registrarConteoEmpaque');
    expect(comp).toContain('revision: conteo.emp.revision');
    expect(comp).toContain('existencia: conteo.emp.existencia');
  });
  it('tras un rechazo por datos viejos recarga y pide confirmar de nuevo con otra operación', () => {
    const i = comp.indexOf('r?.obsoleto');
    const bloque = comp.slice(i, i + 700);
    expect(bloque).toContain('await cargar()');
    expect(bloque).toContain('confirmado: false');
    expect(bloque).toContain('nuevoOperacionId()');
  });
});
