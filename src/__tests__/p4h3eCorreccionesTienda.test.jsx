// p4h3eCorreccionesTienda.test.jsx — P4-H3E: interfaz de correcciones autorizadas del inventario de tiendas (mig 153).
// La autoridad está en la base (suite 153 y c153); aquí: roles de la pantalla, solicitud, autorización, ejecución,
// cancelación, historial, idempotencia del frontend y que solo se usan los cinco contratos con sus parámetros reales.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  perfilCorrecciones, accionesFila, cuartosDeTienda, tiendasConCongelador, existenciaDe, compararCorreccion, validarSolicitud,
  buildSolicitarArgs, buildDecisionArgs, buildEjecutarArgs, buildCancelarArgs, buildConsultaArgs, clasificarErrorCorreccion,
  filtrarCorrecciones, resumenEstados, estadoDe, crearEnviadorCorrecciones, claveSolicitud, claveEjecucion,
  MENSAJE_CONTEO_OBSOLETO, ESTADOS_CORRECCION,
} from '../data/correccionesTiendaLogic';
import CorreccionesTienda from '../components/CorreccionesTienda';
import { InventarioView } from '../components/views/InventarioView';
import { fmtDateTime } from '../utils/safe';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
// Firmas y códigos de los contratos de 153 (CLOSED PROD, SHA-256 5f6dfc9f…1699), copiados del archivo de la migración. La
// rama publicada no lleva los archivos SQL de 151–153 (viven en la rama de trabajo): si el archivo está, se comprueba además
// que estas constantes coinciden con él.
const RUTA153 = fileURLToPath(new URL('../../supabase/153_correcciones_inventario_tienda.sql', import.meta.url));
const SQL153 = existsSync(RUTA153) ? readFileSync(RUTA153, 'utf8') : null;
const FIRMAS_153 = {
  solicitar_correccion_tienda: ['p_operacion_id', 'p_cuarto_id', 'p_sku', 'p_existencia_vista', 'p_existencia_propuesta', 'p_motivo'],
  autorizar_correccion_tienda: ['p_operacion_id', 'p_correccion_id', 'p_decision', 'p_nota'],
  ejecutar_correccion_tienda: ['p_operacion_id', 'p_correccion_id'],
  cancelar_correccion_tienda: ['p_operacion_id', 'p_correccion_id', 'p_motivo'],
  correcciones_tienda_consulta: ['p_establecimiento_id', 'p_limite'],
};
const CODIGOS_153 = ['AUTOAUTORIZACION', 'AUTORIZACION_VENCIDA', 'AUTORIZADOR_NO_EJECUTA', 'CANTIDAD_INVALIDA', 'CONTEO_OBSOLETO', 'CORRECCION_ABIERTA',
  'CORRECCION_NO_EXISTE', 'CUARTO_NO_ES_DE_TIENDA', 'CUARTO_NO_PERTENECE', 'DECISION_INVALIDA', 'ESTADO_INVALIDO', 'MOTIVO_REQUERIDO', 'NO_AUTORIZADA',
  'NO_AUTORIZADO', 'OPERACION_REQUERIDA', 'OPERACION_REUSADA', 'SIN_DIFERENCIA', 'SKU_NO_VALIDO', 'SOLO_ADMINISTRACION', 'SOLO_DUENO', 'YA_EJECUTADA'];

const ADMIN = { id: 10, rol: 'Admin', nombre: 'Admin Uno' };
const ADMIN2 = { id: 13, rol: 'Admin', nombre: 'Admin Dos' };
const DUENO = { id: 45, rol: 'Admin', es_dueno: true, nombre: 'Santiago' };
const OTROS = [{ id: 11, rol: 'Ventas' }, { id: 14, rol: 'Chofer' }, { id: 15, rol: 'Producción' }, { id: 16, rol: 'Facturación' }, { id: 17, rol: '' }, null];

const C = (o) => ({ nombre: 'Cuarto', temp: -10, capacidad: 100, capacidad_tarimas: 0, stock: {}, ...o });
const CUARTOS = [
  C({ id: 'CF-1', nombre: 'Cuarto Frío 1', establecimiento_id: 1, stock: { 'HPC-5K': 584 } }),
  C({ id: 'CONG-MATRIZ-01', nombre: 'Congelador Matriz', establecimiento_id: 2, stock: { 'HPC-5K': 3 } }),
  C({ id: 'CONG-OTRA', nombre: 'Congelador Otra', establecimiento_id: 3, stock: {} }),
  C({ id: 'CF-SIN', nombre: 'Cuarto sin dato' }),
];
const TIENDAS = [{ id: 2, nombre: 'Cubopolar Matriz', tipo: 'tienda_fabrica', activo: false }, { id: 3, nombre: 'Tienda Otra', tipo: 'tienda_remota', activo: false }];
const PRODUCTOS = [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', tipo: 'Producto Terminado', stock: 0, precio: 31 }];
const FUT = '2099-01-01T00:00:00Z';
const F = (o) => ({ establecimiento_id: 2, cuarto_id: 'CONG-MATRIZ-01', sku: 'HPC-5K', existencia_vista: 3, existencia_propuesta: 5, motivo: 'Conteo físico de apertura', solicitada_at: '2026-10-15T15:00:00Z', ...o });
const FILAS = [
  F({ id: 1, folio: 'CIT-00001', estado: 'solicitada', estado_efectivo: 'solicitada', solicitada_por: 10, solicitada_por_nombre: 'Admin Uno' }),
  F({ id: 2, folio: 'CIT-00002', estado: 'autorizada', estado_efectivo: 'autorizada', solicitada_por: 10, solicitada_por_nombre: 'Admin Uno', decidida_por: 45, decidida_por_nombre: 'Santiago', vence_at: FUT }),
  F({ id: 3, folio: 'CIT-00003', estado: 'ejecutada', estado_efectivo: 'ejecutada', solicitada_por: 10, decidida_por: 45, ejecutada_por: 13, ejecutada_por_nombre: 'Admin Dos', ejecutada_at: '2026-10-15T16:00:00Z', diferencia: 2, kardex_id: 32 }),
  F({ id: 4, folio: 'CIT-00004', estado: 'autorizada', estado_efectivo: 'vencida', solicitada_por: 10, decidida_por: 45, vence_at: '2026-10-01T00:00:00Z' }),
  F({ id: 5, folio: 'CIT-00005', estado: 'solicitada', estado_efectivo: 'solicitada', solicitada_por: 13, solicitada_por_nombre: 'Admin Dos', establecimiento_id: 3, cuarto_id: 'CONG-OTRA', existencia_vista: 0, existencia_propuesta: 4 }),
  F({ id: 6, folio: 'CIT-00006', estado: 'rechazada', estado_efectivo: 'rechazada', solicitada_por: 10, decidida_por: 45 }),
  F({ id: 7, folio: 'CIT-00007', estado: 'cancelada', estado_efectivo: 'cancelada', solicitada_por: 10 }),
];
const DATA = { productos: PRODUCTOS, cuartosFrios: CUARTOS };
const pinta = (usuario) => renderToStaticMarkup(<CorreccionesTienda data={DATA} actions={{}} usuario={usuario} inicial={{ filas: FILAS, tiendas: TIENDAS }} />);
const cuenta = (html, texto) => (html.match(new RegExp(`>${texto}</button>`, 'g')) || []).length;

describe('P4-H3E roles (pantalla; la autoridad es 153)', () => {
  it('[1][5] Administración ve "Solicitar", "Ejecutar" en la autorizada vigente y "Cancelar" solo en lo suyo abierto', () => {
    const h = pinta(ADMIN);
    expect(cuenta(h, 'Solicitar corrección')).toBe(1);
    expect(cuenta(h, 'Ejecutar')).toBe(1);               // CIT-00002
    expect(cuenta(h, 'Autorizar o rechazar')).toBe(0);   // [4]
    expect(cuenta(h, 'Cancelar')).toBe(2);               // CIT-00001 y CIT-00002 (la 5 es de otra persona)
    expect(cuenta(h, 'Cerrar como vencida')).toBe(1);    // CIT-00004
  });
  it('[2][3][6] el Dueño no ve "Solicitar" ni "Ejecutar"; ve "Autorizar o rechazar" en las solicitadas', () => {
    const h = pinta(DUENO);
    expect(cuenta(h, 'Solicitar corrección')).toBe(0);
    expect(cuenta(h, 'Ejecutar')).toBe(0);
    expect(cuenta(h, 'Autorizar o rechazar')).toBe(2);   // CIT-00001 y CIT-00005
    expect(cuenta(h, 'Cancelar')).toBe(3);               // 153: el Dueño cancela cualquiera abierta
  });
  it('[24] el autorizador no ve "Ejecutar" aunque sea Admin sin marca de Dueño en la sesión', () => {
    expect(accionesFila(FILAS[1], perfilCorrecciones({ id: 45, rol: 'Admin' }), 45).ejecutar).toBe(false);
  });
  it('nadie ve decidir su propia solicitud; sin id conocido no se ofrecen acciones que dependen de la persona', () => {
    expect(accionesFila(F({ estado: 'solicitada', solicitada_por: 45 }), perfilCorrecciones(DUENO), 45).decidir).toBe(false);
    const a = accionesFila(FILAS[1], perfilCorrecciones(ADMIN), null);
    expect(a.ejecutar || a.cancelar).toBe(false);
  });
  it('[7][8] Ventas, Ventas Tienda, Chofer, Producción, Facturación y sin rol: ninguna acción ni pantalla', () => {
    for (const u of OTROS) {
      const p = perfilCorrecciones(u);
      expect(p).toMatchObject({ visible: false, puedeSolicitar: false, puedeDecidir: false, puedeEjecutar: false });
      expect(pinta(u)).toBe('');
      for (const f of FILAS) expect(Object.values(accionesFila(f, p, u?.id)).some(Boolean)).toBe(false);
    }
  });
  it('el Dueño se identifica con el mecanismo real (esDueno: es_dueno / esDueno), no solo con el rol Admin', () => {
    expect(perfilCorrecciones({ rol: 'Admin', esDueno: true }).dueno).toBe(true);
    expect(perfilCorrecciones({ rol: 'Admin' }).puedeSolicitar).toBe(true);
    expect(perfilCorrecciones({ rol: 'Ventas', es_dueno: true }).visible).toBe(false);
  });
});

describe('P4-H3E solicitud', () => {
  const base = { tiendaId: 2, cuarto: CUARTOS[1], sku: 'HPC-5K', registrada: 3, contadoTexto: '5', motivo: 'Conteo físico de apertura' };
  it('[9][10] tienda y congelador de esa tienda (por establecimiento_id); el CEDIS y lo desconocido no se listan', () => {
    expect(cuartosDeTienda(CUARTOS, 2).map(c => c.id)).toEqual(['CONG-MATRIZ-01']);
    expect(cuartosDeTienda(CUARTOS, 1)).toEqual([]);
    expect(cuartosDeTienda(CUARTOS, '')).toEqual([]);
    expect(tiendasConCongelador([...TIENDAS, { id: 1, nombre: 'CEDIS', tipo: 'cedis' }, { id: 9, nombre: 'Sin congelador', tipo: 'tienda_remota' }], CUARTOS).map(t => t.id)).toEqual([2, 3]);
    expect(validarSolicitud(base).datos).toEqual({ cuartoId: 'CONG-MATRIZ-01', sku: 'HPC-5K', vista: 3, propuesta: 5, motivo: 'Conteo físico de apertura' });
  });
  it('[11][12] rechaza el CEDIS, la pertenencia desconocida y el congelador de otra tienda (sin nombres ni prefijos)', () => {
    expect(validarSolicitud({ ...base, cuarto: CUARTOS[0], registrada: 584 }).errores.cuarto).toMatch(/CEDIS/);
    expect(validarSolicitud({ ...base, cuarto: CUARTOS[3], registrada: 0 }).errores.cuarto).toMatch(/No se pudo confirmar/);
    expect(validarSolicitud({ ...base, cuarto: CUARTOS[2], registrada: 0 }).errores.cuarto).toMatch(/otra|no es de la tienda/);
    expect(validarSolicitud({ ...base, cuarto: { ...CUARTOS[1], id: 'CF-9' } }).errores).toBeUndefined();
  });
  it('[13][14] diferencia = contada − registrada, positiva o negativa; sin diferencia no se envía', () => {
    expect(compararCorreccion(3, '5')).toMatchObject({ tipo: 'positiva', diferencia: 2, valido: true });
    expect(compararCorreccion(3, '0')).toMatchObject({ tipo: 'negativa', diferencia: -3, valido: true });
    expect(compararCorreccion(3, '3')).toMatchObject({ tipo: 'sin_diferencia', valido: false });
    for (const v of ['-1', '2.5', 'abc']) expect(compararCorreccion(3, v).valido).toBe(false);
  });
  it('[15] motivo obligatorio de al menos 10 caracteres (CHECK de 153)', () => {
    expect(validarSolicitud({ ...base, motivo: 'corto' }).errores.motivo).toMatch(/10/);
  });
  it('la existencia registrada sale del congelador leído en el servidor; si cambió, pide recontar', () => {
    expect(existenciaDe(CUARTOS[1], 'HPC-5K')).toBe(3);
    expect(existenciaDe(CUARTOS[1], 'NO-EXISTE')).toBe(0);
    expect(validarSolicitud({ ...base, registrada: 2 }).errores.registrada).toBe(MENSAJE_CONTEO_OBSOLETO);
  });
  it('[16] doble clic: el segundo envío de la misma solicitud no sale; el contrato se llama una vez', async () => {
    const enviar = crearEnviadorCorrecciones(() => 'op-1');
    let llamadas = 0; let soltar;
    const accion = () => { llamadas++; return new Promise(r => { soltar = r; }); };
    const clave = claveSolicitud(validarSolicitud(base).datos);
    const p1 = enviar(clave, accion);
    const p2 = await enviar(clave, accion);
    expect(p2).toEqual({ ignorado: true });
    soltar({ data: { folio: 'CIT-00008' } });
    expect(await p1).toEqual({ data: { folio: 'CIT-00008' } });
    expect(llamadas).toBe(1);
  });
  it('[17] solicitar no toca inventario: la acción solo llama solicitar_correccion_tienda y no refresca existencias', () => {
    const store = src('../data/supaStore.js');
    const accion = store.slice(store.indexOf('solicitarCorreccionTienda: async'), store.indexOf('decidirCorreccionTienda: async'));
    expect(accion).toContain("corrRpc('solicitar_correccion_tienda', buildSolicitarArgs(d))");
    expect(accion).not.toMatch(/rf\(\)|\.from\(|update|insert/);
  });
});

describe('P4-H3E autorización', () => {
  it('[18][19] el Dueño autoriza o rechaza con autorizar_correccion_tienda(p_operacion_id, p_correccion_id, p_decision, p_nota)', () => {
    expect(buildDecisionArgs({ operacionId: 'op', correccionId: '1', decision: 'autorizar', nota: '' }).args).toEqual({ p_operacion_id: 'op', p_correccion_id: 1, p_decision: 'autorizar', p_nota: null });
    expect(buildDecisionArgs({ operacionId: 'op', correccionId: 1, decision: 'rechazar', nota: ' no cuadra ' }).args.p_nota).toBe('no cuadra');
    expect(buildDecisionArgs({ operacionId: 'op', correccionId: 1, decision: 'aprobar' }).error).toBeTruthy();
  });
  it('[20] Administración no decide: no se le ofrece y el servidor responde SOLO_DUENO con un mensaje claro', () => {
    expect(accionesFila(FILAS[0], perfilCorrecciones(ADMIN2), 13).decidir).toBe(false);
    expect(clasificarErrorCorreccion({ code: '42501', details: '{"codigo":"SOLO_DUENO"}' })).toMatchObject({ incierto: false, codigo: 'SOLO_DUENO' });
  });
  it('[21][22] autorizar no toca inventario y la vigencia es la del servidor (vence_at), nunca calculada en el cliente', () => {
    const store = src('../data/supaStore.js');
    const accion = store.slice(store.indexOf('decidirCorreccionTienda: async'), store.indexOf('ejecutarCorreccionTienda: async'));
    expect(accion).not.toMatch(/rf\(\)|\.from\(/);
    const comp = src('../components/CorreccionesTienda.jsx');
    expect(comp).toContain('r.data?.vence_at');
    for (const s of [src('../data/correccionesTiendaLogic.js'), comp]) expect(s).not.toMatch(/86400|24 \* 60|setHours|setDate\(/);
    const h = pinta(ADMIN);
    expect(h).toContain('>Vence</th>');
    expect(h).toContain(`>${fmtDateTime(FUT)}</td>`); // el vence_at que devolvió el servidor
  });
});

describe('P4-H3E ejecución', () => {
  it('[25] solo se envían la operación y la corrección (sin congelador, SKU, diferencia ni existencia)', () => {
    expect(buildEjecutarArgs({ operacionId: 'op', correccionId: '2', cuartoId: 'X', sku: 'Y', propuesta: 9 })).toEqual({ p_operacion_id: 'op', p_correccion_id: 2 });
  });
  it('[23][24] Administración la ejecuta (no quien autorizó); el Dueño no la tiene', () => {
    expect(accionesFila(FILAS[1], perfilCorrecciones(ADMIN2), 13).ejecutar).toBe(true);
    expect(accionesFila(FILAS[1], perfilCorrecciones(DUENO), 45).ejecutar).toBe(false);
    expect(clasificarErrorCorreccion({ code: '42501', details: '{"codigo":"AUTORIZADOR_NO_EJECUTA"}' }).codigo).toBe('AUTORIZADOR_NO_EJECUTA');
  });
  it('[26][27] tras un error de red el reintento usa la MISMA operación y no hay éxito falso', async () => {
    let n = 0;
    const enviar = crearEnviadorCorrecciones(() => `op-${++n}`);
    const clave = claveEjecucion({ correccionId: 2 });
    const vistos = [];
    const r1 = await enviar(clave, async (op) => { vistos.push(op); return { error: 'Sin conexión', incierto: true }; });
    expect(r1.error).toBeTruthy();
    expect(r1.data).toBeUndefined();
    const r2 = await enviar(clave, async (op) => { vistos.push(op); return { data: { estado: 'ejecutada', replay: true } }; });
    expect(r2.data.replay).toBe(true);
    expect(vistos).toEqual(['op-1', 'op-1']);
    await enviar(clave, async (op) => { vistos.push(op); return { data: {} }; });
    expect(vistos[2]).toBe('op-2'); // un intento NUEVO (tras el éxito) es otra operación
    expect(clasificarErrorCorreccion(new TypeError('Failed to fetch'))).toMatchObject({ incierto: true, codigo: 'SIN_CONEXION' });
    expect(clasificarErrorCorreccion({ message: 'upstream', code: '' })).toMatchObject({ incierto: true });
  });
  it('[28] existencia cambiada → mensaje exacto; [29] autorización vencida → bloquea', () => {
    expect(clasificarErrorCorreccion({ code: '22023', details: '{"codigo":"CONTEO_OBSOLETO","actual":7}' }).mensaje)
      .toBe(`${MENSAJE_CONTEO_OBSOLETO} (Existencia registrada ahora: 7.)`);
    expect(MENSAJE_CONTEO_OBSOLETO).toBe('La existencia cambió desde que se solicitó la corrección. Es necesario realizar un nuevo conteo y generar otra solicitud.');
    expect(clasificarErrorCorreccion({ code: '22023', details: '{"codigo":"AUTORIZACION_VENCIDA"}' }).mensaje).toMatch(/venció/);
    expect(accionesFila(FILAS[3], perfilCorrecciones(ADMIN2), 13).ejecutar).toBe(false);
  });
  it('[30] éxito: el store refresca existencias y kardex; la pantalla recarga el historial y muestra el kardex', () => {
    const store = src('../data/supaStore.js');
    const accion = store.slice(store.indexOf('ejecutarCorreccionTienda: async'), store.indexOf('cancelarCorreccionTienda: async'));
    expect(accion).toContain("corrRpc('ejecutar_correccion_tienda', buildEjecutarArgs(d))");
    expect(accion).toContain('if (r.data) rf();');
    const comp = src('../components/CorreccionesTienda.jsx');
    const ej = comp.slice(comp.indexOf('const enviarEjecucion'), comp.indexOf('// ── Cancelar'));
    expect(ej.indexOf("setDialogo({ tipo: 'resultado'")).toBeGreaterThan(ej.indexOf('if (r?.error)'));
    expect(ej).toContain('cargar();');
    expect(comp).toContain('d.resultado?.kardex_id');
    // antes de abrir la ejecución se relee el historial del servidor (estado vigente)
    const ab = comp.slice(comp.indexOf('const abrirEjecucion'), comp.indexOf('const enviarEjecucion'));
    expect(ab.indexOf('await cargar()')).toBeLessThan(ab.indexOf("setDialogo({ tipo: 'ejecutar'"));
  });
});

describe('P4-H3E historial y cancelación', () => {
  it('[31] el listado usa correcciones_tienda_consulta(p_establecimiento_id, p_limite)', () => {
    expect(buildConsultaArgs({})).toEqual({ p_establecimiento_id: null, p_limite: 200 });
    expect(buildConsultaArgs({ establecimientoId: '2', limite: 50 })).toEqual({ p_establecimiento_id: 2, p_limite: 50 });
    expect(src('../data/supaStore.js')).toContain("corrRpc('correcciones_tienda_consulta', buildConsultaArgs({ establecimientoId, limite }))");
  });
  it('[32] filtros por estado mostrado (vencida efectiva), tienda y día de negocio', () => {
    expect(filtrarCorrecciones(FILAS, { estado: 'vencida' }).map(f => f.id)).toEqual([4]);
    expect(filtrarCorrecciones(FILAS, { estado: 'autorizada' }).map(f => f.id)).toEqual([2]);
    expect(filtrarCorrecciones(FILAS, { tiendaId: '3' }).map(f => f.id)).toEqual([5]);
    expect(filtrarCorrecciones(FILAS, { desde: '2026-10-15', hasta: '2026-10-15' })).toHaveLength(FILAS.length);
    expect(filtrarCorrecciones(FILAS, { desde: '2026-10-16' })).toHaveLength(0);
    expect(resumenEstados(FILAS)).toEqual({ solicitada: 2, autorizada: 1, ejecutada: 1, rechazada: 1, cancelada: 1, vencida: 1 });
    expect(estadoDe({ estado: 'autorizada' })).toBe('autorizada');
  });
  it('[33][34] cancelar usa cancelar_correccion_tienda; nunca se ofrece sobre ejecutada, rechazada o cancelada', () => {
    expect(buildCancelarArgs({ operacionId: 'op', correccionId: '1', motivo: ' ya no aplica ' })).toEqual({ p_operacion_id: 'op', p_correccion_id: 1, p_motivo: 'ya no aplica' });
    for (const f of [FILAS[2], FILAS[5], FILAS[6]]) {
      expect(accionesFila(f, perfilCorrecciones(DUENO), 45).cancelar).toBe(false);
      expect(accionesFila(f, perfilCorrecciones(ADMIN), 10).cancelar).toBe(false);
    }
    expect(src('../data/supaStore.js')).toContain("corrRpc('cancelar_correccion_tienda', buildCancelarArgs(d))");
  });
  it('[35] nadie en el frontend toca la tabla privada (ni REST ni realtime)', () => {
    const archivos = [];
    const recorrer = (dir) => { for (const n of readdirSync(dir)) { const p = join(dir, n); if (statSync(p).isDirectory()) { if (n !== '__tests__') recorrer(p); } else if (/\.(jsx?|tsx?)$/.test(n)) archivos.push(p); } };
    recorrer(fileURLToPath(new URL('../', import.meta.url)));
    expect(archivos.length).toBeGreaterThan(50);
    for (const p of archivos) expect(readFileSync(p, 'utf8')).not.toMatch(/['"`]correcciones_inventario_tienda['"`]/);
  });
  it('estados con texto (no solo color)', () => {
    const h = pinta(ADMIN);
    for (const e of Object.values(ESTADOS_CORRECCION)) expect(h).toContain(`>${e.label}</span>`);
  });
});

describe('P4-H3E contratos reales de 153 (sin nombres inventados)', () => {
  const firmaSql = (fn) => {
    const m = SQL153.match(new RegExp(`FUNCTION public\\.${fn}\\(([^)]*)\\)\\s*RETURNS`));
    return m[1].split(',').map(s => s.trim().split(/\s+/)[0]);
  };
  const firma = (fn) => FIRMAS_153[fn];
  it.skipIf(!SQL153)('las constantes coinciden con el archivo de 153 (cuando el archivo está en el árbol)', () => {
    for (const fn of Object.keys(FIRMAS_153)) expect(firmaSql(fn)).toEqual(FIRMAS_153[fn]);
    const tramo = SQL153.slice(SQL153.indexOf('FUNCTION public.correccion_tienda_exigir_admin'), SQL153.indexOf('FUNCTION public.correcciones_tienda_consulta'));
    expect([...new Set([...tramo.matchAll(/'codigo', '([A-Z_]+)'/g)].map(m => m[1]))].filter(c => c !== 'CORRECCION_INMUTABLE').sort()).toEqual(CODIGOS_153);
  });
  it('los parámetros que arma el frontend son exactamente los de cada contrato', () => {
    expect(Object.keys(buildSolicitarArgs({}))).toEqual(firma('solicitar_correccion_tienda'));
    expect(Object.keys(buildDecisionArgs({ decision: 'autorizar' }).args)).toEqual(firma('autorizar_correccion_tienda'));
    expect(Object.keys(buildEjecutarArgs({}))).toEqual(firma('ejecutar_correccion_tienda'));
    expect(Object.keys(buildCancelarArgs({}))).toEqual(firma('cancelar_correccion_tienda'));
    expect(Object.keys(buildConsultaArgs({}))).toEqual(firma('correcciones_tienda_consulta'));
  });
  it('cada código que los contratos de 153 pueden devolver tiene mensaje propio y no muestra SQL', () => {
    const codigos = CODIGOS_153;
    expect(codigos.length).toBe(21);
    for (const c of codigos) {
      const r = clasificarErrorCorreccion({ code: '22023', message: `solicitar_correccion_tienda: detalle interno ${c}`, details: JSON.stringify({ codigo: c }) });
      expect(r.codigo).toBe(c);
      expect(r.incierto).toBe(false);
      expect(r.mensaje).not.toMatch(/_correccion_|SQL|ERROR/);
    }
  });
  it('el store usa los cinco contratos y la lectura fresca del congelador es solo SELECT', () => {
    const store = src('../data/supaStore.js');
    for (const fn of ['solicitar_correccion_tienda', 'autorizar_correccion_tienda', 'ejecutar_correccion_tienda', 'cancelar_correccion_tienda', 'correcciones_tienda_consulta']) {
      expect(store).toContain(`corrRpc('${fn}'`);
    }
    const leer = store.slice(store.indexOf('leerCongeladorCorreccion: async'), store.indexOf('leerCongeladorCorreccion: async') + 600);
    expect(leer).toContain(".from('cuartos_frios').select('id, nombre, stock, establecimiento_id')");
    expect(leer).not.toMatch(/update|insert|upsert|delete|rpc\(/);
  });
});

describe('P4-H3E regresión e integración en Inventario', () => {
  const data = {
    productos: PRODUCTOS, cuartosFrios: CUARTOS.slice(0, 2), inventarioMov: [], produccion: [], mermas: [], ordenes: [], rutas: [], usuarios: [], umbrales: [],
  };
  it('[36][37][39] Inventario sigue igual: CEDIS conserva "Ajustar stock", la tienda no (H3D) y todo se consulta', () => {
    for (const user of [ADMIN, DUENO, undefined]) {
      const h = renderToStaticMarkup(<InventarioView data={data} actions={{}} user={user} />);
      expect((h.match(/aria-label="Ajustar stock del cuarto frío"/g) || []).length).toBe(1);
      expect(h).toContain('Congelador Matriz');
      expect(h).toContain('Cuarto Frío 1');
    }
  });
  it('[40] la pestaña "Correcciones de tiendas" solo aparece para Administración; los demás ven Inventario como antes', () => {
    expect(renderToStaticMarkup(<InventarioView data={data} actions={{}} user={ADMIN} />)).toContain('>Correcciones de tiendas</button>');
    expect(renderToStaticMarkup(<InventarioView data={data} actions={{}} user={DUENO} />)).toContain('>Correcciones de tiendas</button>');
    for (const u of OTROS) expect(renderToStaticMarkup(<InventarioView data={data} actions={{}} user={u} />)).not.toContain('Correcciones de tiendas');
    expect(src('../components/CuboPolarERP.jsx')).toContain("case 'inventario': return <InventarioView {...vp} user={usuarioRol || user} />;");
  });
  it('[38] el POS y "Ajustar stock" central no usan nada de esta pantalla', () => {
    for (const f of ['../components/PosTiendaView.jsx', '../components/PosTurnoView.jsx', '../components/PosRecepcionView.jsx']) {
      expect(src(f)).not.toMatch(/correccion_tienda|CorreccionesTienda|correccionesTiendaLogic/);
    }
    const store = src('../data/supaStore.js');
    const ajuste = store.slice(store.indexOf('ajustarExistenciaCuarto: async'), store.indexOf('// 093: ajuste manual por contrato del servidor'));
    expect(ajuste).toContain("supabase.rpc('ajustar_existencia_cuarto'");
    expect(ajuste).not.toMatch(/correccion/i);
  });
});
