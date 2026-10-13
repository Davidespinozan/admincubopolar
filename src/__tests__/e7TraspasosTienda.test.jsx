// e7TraspasosTienda.test.jsx — Tiendas E7: tiendas remotas y traspasos con tránsito.
// Reglas de pantalla (dirección del traspaso, recepción por producto, incidencias, permisos por
// tipo de tienda) y garantías del código: solo contratos, recepción aparte del punto de venta.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  TIPOS_TIENDA, permisosEnTienda, ESTADOS_TRASPASO, textoTraspaso, accionesTraspaso, construirTraspaso, construirRecepcion, clasificarErrorPos, CEDIS_ID,
} from '../data/posLogic';
import { navParaRol, idsModulos, idsVistas, MODULO_POS_RECEPCION } from '../data/navRolLogic';
import { TraspasosPanel, FilaTraspaso, RecepcionTraspaso } from '../components/views/TraspasosPanel';
import PosRecepcionView from '../components/PosRecepcionView';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const OP = '11111111-2222-4333-8444-555555555555';
const T = (o = {}) => ({ traspaso_id: 9, folio: 'TR-0009', estado: 'en_transito', incidencia: false, incidencia_cerrada: false, responsable: 'Luis',
  origen: { id: 1, nombre: 'CEDIS', cuarto_id: 'CF-1' }, destino: { id: 7, nombre: 'Tienda Norte', cuarto_id: 'CF-T1' },
  lineas: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', cantidad: 10, despachada: 10, recibida: null, danada: null, faltante: null },
    { sku: 'HPC-25K', nombre: 'Cubos 25 kg', cantidad: 4, despachada: 4, recibida: null, danada: null, faltante: null }], ...o });

describe('E7: tiendas remotas', () => {
  it('dos tipos de tienda; el CEDIS no es una opción', () => {
    expect(TIPOS_TIENDA.map(t => t.id)).toEqual(['tienda_fabrica', 'tienda']);
  });
  it('en una tienda remota NADIE vende ni traspasa directo con el CEDIS; recibir es del personal de la tienda', () => {
    for (const rol of ['Ventas', 'Producción', 'Admin']) {
      const p = permisosEnTienda(rol, 'tienda');
      expect(p.vende).toBe(false);
      expect(p.traspasa).toBe(false);
    }
    expect(permisosEnTienda('Ventas', 'tienda')).toEqual({ asignable: true, vende: false, traspasa: false, recibe: true });
    expect(permisosEnTienda('Ventas', 'tienda_fabrica')).toEqual({ asignable: true, vende: true, traspasa: false, recibe: true });
    expect(permisosEnTienda('Producción', 'tienda_fabrica')).toEqual({ asignable: true, vende: false, traspasa: true, recibe: false });
    expect(permisosEnTienda('Admin', 'tienda_fabrica').recibe).toBe(false);
    expect(permisosEnTienda('Chofer', 'tienda')).toEqual({ asignable: false, vende: false, traspasa: false, recibe: false });
  });
  it('la pantalla de configuración manda el tipo al crear y trata recibir como un permiso aparte', () => {
    const t = sinComentarios(src('../components/views/TiendaConfigPanel.jsx'));
    expect(t).toMatch(/guardarEstablecimiento\(\{ clave: normalizarClave\(nueva\.clave\), nombre: nueva\.nombre, tipo: nueva\.tipo \}\)/);
    expect(t).toMatch(/definirRecepcionTienda\(\{ establecimientoId: sel, usuarioId: p\.usuario_id, recibe: valor \}\)/);
    expect(t).toMatch(/permisosEnTienda\(p\.rol, tienda\.tipo\)/);
    expect(t).toMatch(/El tipo no se cambia después/);
  });
});

describe('E7: crear un traspaso', () => {
  const base = { operacionId: OP, direccion: 'abasto', tiendaId: 7, cuartoCedis: 'CF-1', cuartoTienda: 'CF-T1', lineas: [{ sku: 'HPC-5K', cantidad: '10' }], responsable: '  Luis   Pérez ' };
  it('abasto: del CEDIS a la tienda', () => {
    expect(construirTraspaso(base).args).toEqual({ p_operacion_id: OP, p_origen_establecimiento_id: CEDIS_ID, p_destino_establecimiento_id: 7, p_cuarto_origen: 'CF-1', p_cuarto_destino: 'CF-T1',
      p_items: [{ sku: 'HPC-5K', cantidad: 10 }], p_responsable: 'Luis Pérez', p_notas: null });
  });
  it('devolución: de la tienda al CEDIS (se invierten origen y destino)', () => {
    const { args } = construirTraspaso({ ...base, direccion: 'devolucion' });
    expect(args).toMatchObject({ p_origen_establecimiento_id: 7, p_destino_establecimiento_id: CEDIS_ID, p_cuarto_origen: 'CF-T1', p_cuarto_destino: 'CF-1' });
  });
  it('siempre hay un extremo en el CEDIS: no existe tienda ↔ tienda', () => {
    for (const d of ['abasto', 'devolucion']) {
      const { args } = construirTraspaso({ ...base, direccion: d });
      expect([args.p_origen_establecimiento_id, args.p_destino_establecimiento_id]).toContain(CEDIS_ID);
      expect(args.p_origen_establecimiento_id).not.toBe(args.p_destino_establecimiento_id);
    }
    expect(construirTraspaso({ ...base, direccion: 'entre_tiendas' }).error).toBeTruthy();
  });
  it('validaciones: tienda, cuartos, productos, cantidades, repetidos y responsable', () => {
    expect(construirTraspaso({ ...base, tiendaId: null }).error).toMatch(/tienda/i);
    expect(construirTraspaso({ ...base, cuartoCedis: '' }).error).toMatch(/CEDIS/);
    expect(construirTraspaso({ ...base, cuartoTienda: '' }).error).toMatch(/congelador/);
    expect(construirTraspaso({ ...base, lineas: [] }).error).toMatch(/producto/);
    expect(construirTraspaso({ ...base, lineas: [{ sku: '', cantidad: '' }] }).error).toMatch(/producto/);
    for (const c of ['0', '-1', '1.5', 'x']) expect(construirTraspaso({ ...base, lineas: [{ sku: 'A', cantidad: c }] }).error).toBeTruthy();
    expect(construirTraspaso({ ...base, lineas: [{ sku: 'A', cantidad: '1' }, { sku: 'A', cantidad: '2' }] }).error).toMatch(/repetido/);
    expect(construirTraspaso({ ...base, responsable: ' a ' }).error).toMatch(/transporta/);
  });
  it('un traspaso no lleva precios, clientes, rutas ni forma de pago', () => {
    expect(JSON.stringify(construirTraspaso(base).args)).not.toMatch(/precio|cliente|ruta|metodo|total|credito/i);
  });
});

describe('E7: recibir (o registrar el retorno)', () => {
  it('todo llegó bien: sin incidencia y sin nota obligatoria', () => {
    const r = construirRecepcion(T(), { 'HPC-5K': { recibida: '10' }, 'HPC-25K': { recibida: '4', danada: '' } }, '');
    expect(r).toMatchObject({ incidencia: false, notas: null, items: [{ sku: 'HPC-5K', recibida: 10, danada: 0 }, { sku: 'HPC-25K', recibida: 4, danada: 0 }] });
  });
  it('recepción parcial: dañados y faltantes son incidencia y exigen decir qué pasó', () => {
    const capturas = { 'HPC-5K': { recibida: '7', danada: '2' }, 'HPC-25K': { recibida: '4' } };
    const sin = construirRecepcion(T(), capturas, '');
    expect(sin.error).toMatch(/qué pasó/);
    expect(sin.incidencia).toBe(true);
    const con = construirRecepcion(T(), capturas, 'Dos bolsas rotas y falta una');
    expect(con.error).toBeUndefined();
    expect(con.resumen).toEqual([{ sku: 'HPC-5K', recibida: 7, danada: 2, faltante: 1 }, { sku: 'HPC-25K', recibida: 4, danada: 0, faltante: 0 }]);
    expect(con.items).toEqual([{ sku: 'HPC-5K', recibida: 7, danada: 2 }, { sku: 'HPC-25K', recibida: 4, danada: 0 }]);
  });
  it('lo que no se captura NO se da por recibido', () => {
    expect(construirRecepcion(T(), { 'HPC-5K': { recibida: '10' } }, '').error).toMatch(/Cubos 25 kg/);
    expect(construirRecepcion(T(), {}, '').error).toMatch(/Captura cuánto llegó/);
    expect(construirRecepcion(T(), null, '').items).toBeUndefined();
  });
  it('no puede llegar más de lo despachado; cantidades enteras, 0 o más', () => {
    expect(construirRecepcion(T(), { 'HPC-5K': { recibida: '9', danada: '2' }, 'HPC-25K': { recibida: '4' } }, 'nota larga').error).toMatch(/se despacharon 10/);
    for (const v of ['-1', '1.5', 'x']) expect(construirRecepcion(T(), { 'HPC-5K': { recibida: v }, 'HPC-25K': { recibida: '4' } }, '').error).toBeTruthy();
    expect(construirRecepcion(T(), { 'HPC-5K': { recibida: '0' }, 'HPC-25K': { recibida: '0' } }, 'No llegó nada: se extravió').resumen.map(x => x.faltante)).toEqual([10, 4]);
  });
  it('la recepción manda solo sku, recibida y dañada: el faltante lo calcula el servidor', () => {
    const r = construirRecepcion(T(), { 'HPC-5K': { recibida: '7', danada: '2' }, 'HPC-25K': { recibida: '4' } }, 'Dos bolsas rotas y falta una');
    for (const i of r.items) expect(Object.keys(i).sort()).toEqual(['danada', 'recibida', 'sku']);
  });
});

describe('E7: estados y acciones', () => {
  it('cada estado se dice claro; una incidencia abierta resalta', () => {
    expect(textoTraspaso(T({ estado: 'pendiente' })).texto).toBe('Pendiente de despachar');
    expect(textoTraspaso(T()).texto).toBe('En tránsito');
    expect(textoTraspaso(T({ estado: 'recibido' }))).toEqual({ tono: 'ok', texto: 'Recibido' });
    expect(textoTraspaso(T({ estado: 'recibido', incidencia: true }))).toEqual({ tono: 'error', texto: 'Recibido · con incidencia' });
    expect(textoTraspaso(T({ estado: 'recibido', incidencia: true, incidencia_cerrada: true }))).toEqual({ tono: 'ok', texto: 'Recibido · incidencia cerrada' });
    expect(textoTraspaso(T({ estado: 'retornado' })).texto).toBe('Regresó al origen');
    expect(textoTraspaso(T({ estado: 'cancelado' })).texto).toBe('Cancelado');
    expect(ESTADOS_TRASPASO.map(e => e.id)).toEqual(['pendiente', 'en_transito', 'recibido', 'incidencias', 'retornado', 'cancelado']);
  });
  it('pendiente: despachar o cancelar. En tránsito: recibir o retorno; NUNCA cancelar', () => {
    expect(accionesTraspaso(T({ estado: 'pendiente' }), { admin: true })).toEqual({ despachar: true, cancelar: true, recibir: false, retornar: false, cerrarIncidencia: false });
    expect(accionesTraspaso(T(), { admin: true })).toEqual({ despachar: false, cancelar: false, recibir: true, retornar: true, cerrarIncidencia: false });
    for (const e of ['recibido', 'retornado', 'cancelado']) {
      const a = accionesTraspaso(T({ estado: e }), { admin: true });
      expect(a.despachar || a.cancelar || a.recibir || a.retornar).toBe(false);
    }
    expect(accionesTraspaso(T({ estado: 'recibido', incidencia: true }), { admin: true }).cerrarIncidencia).toBe(true);
    expect(accionesTraspaso(T({ estado: 'recibido', incidencia: true, incidencia_cerrada: true }), { admin: true }).cerrarIncidencia).toBe(false);
  });
  it('el personal de la tienda solo puede recibir (y solo con permiso): nunca despachar, cancelar, retornar ni cerrar incidencias', () => {
    expect(accionesTraspaso(T(), { puedeRecibir: true })).toEqual({ despachar: false, cancelar: false, recibir: true, retornar: false, cerrarIncidencia: false });
    expect(accionesTraspaso(T(), { puedeRecibir: false }).recibir).toBe(false);
    expect(accionesTraspaso(T({ estado: 'pendiente' }), { puedeRecibir: true })).toEqual({ despachar: false, cancelar: false, recibir: false, retornar: false, cerrarIncidencia: false });
    expect(accionesTraspaso(T({ estado: 'recibido', incidencia: true }), { puedeRecibir: true }).cerrarIncidencia).toBe(false);
  });
  it('los códigos nuevos tienen texto propio', () => {
    for (const c of ['TIPO_INVALIDO', 'ULTIMO_CAJERO', 'RESPONSABLE_REQUERIDO', 'CANTIDAD_INVALIDA', 'TRASPASO_NO_VALIDO', 'TRASPASO_YA_DESPACHADO', 'TRASPASO_NO_EN_TRANSITO', 'TRASPASO_EN_TRANSITO',
      'TRASPASO_CERRADO', 'RECEPCION_INCOMPLETA', 'RECEPCION_EXCEDE', 'NOTA_INCIDENCIA_REQUERIDA', 'SIN_INCIDENCIA']) {
      const r = clasificarErrorPos({ code: '22023', message: 'contrato: detalle interno', details: JSON.stringify({ codigo: c }) });
      expect(r).toMatchObject({ incierto: false, codigo: c });
      expect(r.mensaje).not.toMatch(/detalle interno|No se pudo completar/);
    }
    expect(clasificarErrorPos({ code: '22023', details: JSON.stringify({ codigo: 'TRASPASO_EN_TRANSITO' }) }).mensaje).toMatch(/retorno al origen/);
    expect(clasificarErrorPos({ code: '22023', details: JSON.stringify({ codigo: 'ULTIMO_CAJERO' }) }).mensaje).toMatch(/último cajero/);
  });
});

describe('E7: garantías del código', () => {
  const store = src('../data/supaStore.js');
  it('el store llama a los contratos de 148; lo administrativo va detrás de requireAdmin y recibir lo decide el servidor', () => {
    for (const r of ['traspasos_consulta', 'crear_traspaso', 'despachar_traspaso', 'recibir_traspaso', 'cancelar_traspaso', 'retornar_traspaso', 'cerrar_incidencia_traspaso', 'definir_recepcion_tienda']) {
      expect(store).toMatch(new RegExp(`'${r}'`));
    }
    for (const a of ['traspasosConsulta', 'crearTraspaso', 'despacharTraspaso', 'cancelarTraspaso', 'retornarTraspaso', 'cerrarIncidenciaTraspaso', 'definirRecepcionTienda']) {
      expect(store).toMatch(new RegExp(`${a}: async \\([^)]*\\) => \\{ const guard = requireAdmin\\(\\); if \\(guard\\) return guard;`));
    }
    expect(store).toMatch(/guardarEstablecimiento: async \(\{ id = null, clave = null, nombre, tipo = null \}\)/);
  });
  it('nada lee ni escribe las tablas de traspasos por REST', () => {
    for (const f of ['../data/supaStore.js', '../components/views/TraspasosPanel.jsx', '../components/PosRecepcionView.jsx', '../components/views/TiendaConfigPanel.jsx']) {
      expect(src(f)).not.toMatch(/from\(['"](traspasos|traspaso_lineas|traspaso_eventos)['"]\)/);
    }
  });
  it('recibir producto es un módulo APARTE del punto de venta y no usa nada de cobro', () => {
    const nav = navParaRol('Ventas Tienda');
    expect(idsModulos(nav).has(MODULO_POS_RECEPCION.id)).toBe(true);
    for (const r of ['Admin', 'Ventas', 'Chofer', 'Producción', 'Empleado', 'Facturación', 'Almacén Bolsas']) expect(idsVistas(navParaRol(r)).has('pos-recepcion')).toBe(false);
    const rec = sinComentarios(src('../components/PosRecepcionView.jsx'));
    expect([...rec.matchAll(/actions\.([A-Za-z]+)/g)].map(m => m[1]).sort()).toEqual(['posEstado', 'posRecibirTraspaso', 'posTraspasos']);
    expect(rec).not.toMatch(/posVender|posCerrarTurno|posAbrirTurno|pesos\(|METODOS_POS|carrito/);
    const pos = sinComentarios(src('../components/PosTiendaView.jsx'));
    expect(pos).not.toMatch(/traspaso/i);
  });
  it('en la pantalla un traspaso en tránsito no ofrece "Cancelar": ofrece recibir o registrar su retorno', () => {
    const fila = (t, acc) => renderToStaticMarkup(<FilaTraspaso t={t} acciones={acc} onAccion={() => {}} />);
    const enTransito = fila(T(), accionesTraspaso(T(), { admin: true }));
    expect(enTransito).toMatch(/Recibir/);
    expect(enTransito).toMatch(/Regresó al origen/);
    expect(enTransito).not.toMatch(/Cancelar|Despachar/);
    const pendiente = fila(T({ estado: 'pendiente' }), accionesTraspaso(T({ estado: 'pendiente' }), { admin: true }));
    expect(pendiente).toMatch(/Despachar/);
    expect(pendiente).toMatch(/Cancelar/);
    expect(fila(T(), accionesTraspaso(T(), { puedeRecibir: false }))).not.toMatch(/<button/);
  });
  it('la fila cuenta la historia completa: origen, destino, cuartos, transportista y lo que llegó', () => {
    const t = T({ estado: 'recibido', incidencia: true, recibido_por: 'Ana', notas_recepcion: 'Dos rotas',
      lineas: [{ sku: 'HPC-5K', nombre: 'Cubos 5 kg', cantidad: 10, despachada: 10, recibida: 7, danada: 2, faltante: 1 }] });
    const html = renderToStaticMarkup(<FilaTraspaso t={t} acciones={{}} onAccion={() => {}} />);
    for (const x of ['TR-0009', 'CEDIS', 'CF-1', 'Tienda Norte', 'CF-T1', 'Transporta Luis', 'llegó 7, dañado 2, faltó 1', 'Dos rotas', 'con incidencia']) expect(html).toContain(x);
  });
  it('el formulario de recepción muestra lo faltante y lo dañado conforme se captura', () => {
    const html = renderToStaticMarkup(<RecepcionTraspaso traspaso={T()} capturas={{ 'HPC-5K': { recibida: '7', danada: '2' }, 'HPC-25K': { recibida: '4' } }} onCapturas={() => {}} notas="" onNotas={() => {}} />);
    expect(html).toMatch(/Faltan 1\./);
    expect(html).toMatch(/2 dañadas no entran al congelador/);
    expect(html).toMatch(/se despacharon 10/);
  });
  it('las pantallas montan sin datos', () => {
    const acciones = new Proxy({}, { get: () => async () => ({ data: null }) });
    expect(renderToStaticMarkup(<TraspasosPanel data={{}} actions={acciones} tiendas={[]} cuartos={[]} />)).toMatch(/data-testid="traspasos-panel"/);
    expect(renderToStaticMarkup(<PosRecepcionView actions={acciones} />)).toMatch(/data-testid="pos-recepcion"/);
  });
});
