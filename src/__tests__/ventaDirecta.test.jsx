// ventaDirecta.test.jsx — OL-02C: integración de la venta directa con el
// contrato atómico completar_venta_directa (109). Lógica pura, acción del
// store (auditoría estática, convención del repo), componente de origen
// físico y vistas de Ventas y Admin. El servidor es la autoridad.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  esElegibleVentaDirecta, modoVentaDirecta, lineasOrden, cuartosParaSku, planLinea, planVentaDirecta, validarLinea, validarVentaDirecta,
  construirAsignacion, repartosIniciales, totalPagadoOrden, linkPagadoCompleto, claveVentaDirecta, buildCompletarVentaDirectaArgs,
  mensajeErrorVentaDirecta, METODOS_CONTADO, METODO_CREDITO, METODO_LINK,
} from '../data/ventaDirectaLogic';
import { resolverOperacion } from '../data/produccionAtomicaLogic';
import VentaDirectaOrigen from '../components/VentaDirectaOrigen';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
const CUARTOS = [
  { id: 'CF-2', nombre: 'Cuarto Frío 2', stock: { 'HPC-5K': 20, 'HPC-25K': 100 } },
  { id: 'CF-1', nombre: 'Cuarto Frío 1', stock: { 'HPC-5K': 990 } },
  { id: 'CF-3', nombre: 'Cuarto Frío 3', stock: { 'HIT-25K': 6, 'HPC-25K': 0 } },
  { id: 'CF-4', nombre: 'Cuarto Frío 4', stock: { 'HIT-25K': 5 } },
];

describe('ventaDirectaLogic: elegibilidad y modo', () => {
  it('solo Creada o Asignada SIN ruta', () => {
    expect(esElegibleVentaDirecta({ estatus: 'Creada', ruta_id: null })).toBe(true);
    expect(esElegibleVentaDirecta({ estatus: 'Asignada', ruta_id: null })).toBe(true);
    expect(esElegibleVentaDirecta({ estatus: 'Asignada', ruta_id: 7 })).toBe(false);
    expect(esElegibleVentaDirecta({ estatus: 'Creada', rutaId: 7 })).toBe(false);
    for (const estatus of ['Entregada', 'Facturada', 'Cancelada', 'No entregada', 'En ruta']) expect(esElegibleVentaDirecta({ estatus, ruta_id: null })).toBe(false);
    expect(esElegibleVentaDirecta(null)).toBe(false);
  });
  it('método → modo: contado / crédito; el link NO es un modo de cobro (se genera aparte)', () => {
    expect(METODOS_CONTADO).toEqual(['Efectivo', 'Transferencia SPEI', 'Tarjeta (terminal)']);
    for (const m of METODOS_CONTADO) expect(modoVentaDirecta(m)).toBe('contado');
    expect(modoVentaDirecta(METODO_CREDITO)).toBe('credito');
    expect(modoVentaDirecta(METODO_LINK)).toBeNull();
    expect(modoVentaDirecta('Transferencia')).toBeNull();
  });
});

describe('ventaDirectaLogic: líneas y existencia física por cuarto', () => {
  it('líneas desde orden_lineas (preciosSnapshot) o, si faltan, desde el texto de productos; agregadas por SKU', () => {
    expect(lineasOrden({ preciosSnapshot: [{ sku: 'HPC-5K', qty: 10 }, { sku: 'HPC-25K', qty: 4 }, { sku: 'HPC-5K', qty: 2 }] }))
      .toEqual([{ sku: 'HPC-25K', cantidad: 4 }, { sku: 'HPC-5K', cantidad: 12 }]);
    expect(lineasOrden({ productos: '10×HPC-5K, 4×HPC-25K' })).toEqual([{ sku: 'HPC-25K', cantidad: 4 }, { sku: 'HPC-5K', cantidad: 10 }]);
    expect(lineasOrden({})).toEqual([]);
  });
  it('solo los cuartos con existencia de ESE SKU (de cuartos_frios.stock); nunca productos.stock', () => {
    expect(cuartosParaSku(CUARTOS, 'HPC-25K')).toEqual([{ id: 'CF-2', nombre: 'Cuarto Frío 2', disponible: 100 }]);
    expect(cuartosParaSku(CUARTOS, 'HPC-5K').map(c => c.id)).toEqual(['CF-1', 'CF-2']);
    expect(cuartosParaSku(CUARTOS, 'NADA')).toEqual([]);
    expect(sinComentarios(src('../data/ventaDirectaLogic.js')).replace(/^\s*\/\/.*$|\/\*[\s\S]*?\*\//gm, '')).not.toMatch(/productos\.stock|productos\b.*\.stock/);
  });
  it('un solo cuarto cubre → preselección; varios → elegir (sin preselección); ninguno solo → dividir; total corto → insuficiente; sin SKU → sin existencia', () => {
    const uno = planLinea({ sku: 'HPC-25K', cantidad: 10 }, CUARTOS);
    expect(uno.caso).toBe('uno'); expect(uno.reparto).toEqual({ 'CF-2': 10 });
    const varios = planLinea({ sku: 'HPC-5K', cantidad: 10 }, CUARTOS);
    expect(varios.caso).toBe('elegir'); expect(varios.reparto).toEqual({});
    const unoDeDos = planLinea({ sku: 'HPC-5K', cantidad: 500 }, CUARTOS);   // solo CF-1 cubre 500 (CF-2 tiene 20)
    expect(unoDeDos.caso).toBe('uno'); expect(unoDeDos.reparto).toEqual({ 'CF-1': 500 });
    const dividir = planLinea({ sku: 'HIT-25K', cantidad: 10 }, CUARTOS);
    expect(dividir.caso).toBe('dividir'); expect(dividir.reparto).toEqual({}); expect(dividir.total).toBe(11);
    expect(planLinea({ sku: 'HIT-25K', cantidad: 12 }, CUARTOS).caso).toBe('insuficiente');
    expect(planLinea({ sku: 'NADA', cantidad: 1 }, CUARTOS).caso).toBe('sin_existencia');
  });
});

describe('ventaDirectaLogic: reparto y asignación explícita', () => {
  const dividir = planLinea({ sku: 'HIT-25K', cantidad: 10 }, CUARTOS);
  it('exacto ok; menos o más que lo pedido, negativos, decimales o más que lo disponible: no se envía', () => {
    expect(validarLinea(dividir, { 'CF-3': '6', 'CF-4': '4' })).toEqual({ asignado: 10, ok: true, error: null });
    expect(validarLinea(dividir, { 'CF-3': '6', 'CF-4': '3' })).toMatchObject({ ok: false, error: 'Faltan 1' });
    expect(validarLinea(dividir, { 'CF-3': '6', 'CF-4': '5' })).toMatchObject({ ok: false, error: 'Sobran 1' });
    expect(validarLinea(dividir, { 'CF-3': '7', 'CF-4': '3' })).toMatchObject({ ok: false, error: 'Cuarto Frío 3 solo tiene 6' });
    expect(validarLinea(dividir, { 'CF-3': '-1' }).ok).toBe(false);
    expect(validarLinea(dividir, { 'CF-3': '2.5' }).ok).toBe(false);
    expect(validarLinea(dividir, { 'CF-1': '10' })).toMatchObject({ ok: false });   // CF-1 no tiene HIT-25K
    expect(validarLinea(planLinea({ sku: 'HIT-25K', cantidad: 12 }, CUARTOS), { 'CF-3': '6', 'CF-4': '5' })).toMatchObject({ ok: false });
  });
  it('asignación explícita {sku, cuarto_id, cantidad} con cantidades > 0, ordenada; nada se rellena solo', () => {
    const planes = planVentaDirecta({ preciosSnapshot: [{ sku: 'HIT-25K', qty: 10 }, { sku: 'HPC-25K', qty: 10 }] }, CUARTOS);
    const rep = { ...repartosIniciales(planes), 'HIT-25K': { 'CF-4': '4', 'CF-3': '6', 'CF-1': '' } };
    expect(validarVentaDirecta(planes, rep)).toEqual({ ok: true, errores: {} });
    expect(construirAsignacion(planes, rep)).toEqual([
      { sku: 'HIT-25K', cuarto_id: 'CF-3', cantidad: 6 }, { sku: 'HIT-25K', cuarto_id: 'CF-4', cantidad: 4 }, { sku: 'HPC-25K', cuarto_id: 'CF-2', cantidad: 10 },
    ]);
    const sinElegir = repartosIniciales(planes);   // HIT-25K (dividir) queda vacío
    expect(validarVentaDirecta(planes, sinElegir)).toMatchObject({ ok: false, errores: { 'HIT-25K': 'Faltan 10' } });
    expect(validarVentaDirecta([], {})).toMatchObject({ ok: false });
  });
});

describe('ventaDirectaLogic: link pagado, argumentos, huella y mensajes', () => {
  it('"Entregar pedido pagado" solo con pagos cargados que cubren el total y orden elegible', () => {
    const o = { id: 5, estatus: 'Creada', ruta_id: null, total: 100 };
    expect(totalPagadoOrden(o, [{ ordenId: 5, monto: 60 }, { orden_id: 5, monto: 40 }, { ordenId: 6, monto: 999 }])).toBe(100);
    expect(linkPagadoCompleto(o, [{ ordenId: 5, monto: 100 }])).toBe(true);
    expect(linkPagadoCompleto(o, [{ ordenId: 5, monto: 99.99 }])).toBe(false);
    expect(linkPagadoCompleto(o, [])).toBe(false);
    expect(linkPagadoCompleto({ ...o, ruta_id: 3 }, [{ ordenId: 5, monto: 100 }])).toBe(false);
    expect(linkPagadoCompleto({ ...o, estatus: 'Entregada' }, [{ ordenId: 5, monto: 100 }])).toBe(false);
    expect(linkPagadoCompleto({ ...o, total: 0 }, [])).toBe(false);
  });
  it('argumentos del RPC con la firma de 109; el par modo/método se valida antes de enviar', () => {
    const asig = [{ sku: 'HPC-5K', cuarto_id: 'CF-1', cantidad: 10 }];
    expect(buildCompletarVentaDirectaArgs({ operacionId: 'u-1', ordenId: '12', modo: 'contado', metodo: 'Transferencia SPEI', asignacion: asig, referencia: ' 123456 ', folioNota: '' }))
      .toEqual({ args: { p_operacion_id: 'u-1', p_orden_id: 12, p_modo: 'contado', p_metodo: 'Transferencia SPEI', p_asignacion: asig, p_referencia: '123456', p_folio_nota: null } });
    expect(buildCompletarVentaDirectaArgs({ operacionId: 'u', ordenId: 1, modo: 'credito', metodo: 'Crédito (fiado)', asignacion: asig }).args.p_modo).toBe('credito');
    expect(buildCompletarVentaDirectaArgs({ operacionId: 'u', ordenId: 1, modo: 'pagado_link', metodo: 'QR / Link de pago', asignacion: asig }).args.p_metodo).toBe('QR / Link de pago');
    expect(buildCompletarVentaDirectaArgs({ operacionId: 'u', ordenId: 1, modo: 'contado', metodo: 'Crédito (fiado)', asignacion: asig }).error).toBeTruthy();
    expect(buildCompletarVentaDirectaArgs({ operacionId: 'u', ordenId: 1, modo: 'contado', metodo: 'Efectivo', asignacion: [] }).error).toBeTruthy();
    expect(buildCompletarVentaDirectaArgs({ ordenId: 1, modo: 'contado', metodo: 'Efectivo', asignacion: asig }).error).toBeTruthy();
  });
  it('mismo intento → mismo UUID (reintento = replay); datos distintos → UUID nuevo', () => {
    const base = { ordenId: 1, modo: 'contado', metodo: 'Efectivo', referencia: '', folioNota: '', asignacion: [{ sku: 'A', cuarto_id: 'CF-1', cantidad: 2 }] };
    let n = 0; const gen = () => `id-${++n}`;
    const a = resolverOperacion(null, claveVentaDirecta(base), gen);
    expect(resolverOperacion(a, claveVentaDirecta({ ...base }), gen)).toBe(a);
    expect(resolverOperacion(a, claveVentaDirecta({ ...base, asignacion: [{ sku: 'A', cuarto_id: 'CF-2', cantidad: 2 }] }), gen).id).toBe('id-2');
    expect(resolverOperacion(a, claveVentaDirecta({ ...base, metodo: 'Tarjeta (terminal)' }), gen).id).not.toBe(a.id);
  });
  it('mensajes: ruta, existencia, link pendiente, ya no pendiente, otro intento; el texto del servidor manda en lo demás', () => {
    expect(mensajeErrorVentaDirecta({ message: 'completar_venta_directa: la orden OV-1 tiene ruta; la entrega y el cobro son del chofer' })).toMatch(/chofer/);
    expect(mensajeErrorVentaDirecta({ message: 'Stock insuficiente para A en cuarto CF-1: disponible=1, requerido=2' })).toMatch(/La existencia cambió: Stock insuficiente para A en cuarto CF-1/);
    expect(mensajeErrorVentaDirecta({ message: 'completar_venta_directa: el link de pago de OV-1 no cubre el total (pendiente 5)' })).toMatch(/aún no cubre/);
    expect(mensajeErrorVentaDirecta({ message: 'completar_venta_directa: la orden OV-1 está Entregada (se requiere Creada o Asignada sin ruta)' })).toMatch(/ya no está pendiente/);
    expect(mensajeErrorVentaDirecta({ message: 'stock: operacion_id ya usado con otros datos (x)' })).toMatch(/otros datos/);
    expect(mensajeErrorVentaDirecta({ message: 'Excede límite de crédito. Disponible: 10' })).toBe('Excede límite de crédito. Disponible: 10');
  });
});

describe('OL-02C: acción del store completarVentaDirecta', () => {
  const store = src('../data/supaStore.js');
  const i = store.indexOf('      completarVentaDirecta: async');
  const bloque = store.slice(i, store.indexOf('\n      deleteOrden: async', i));
  it('un solo RPC (completar_venta_directa) con los argumentos construidos; nada más en este camino', () => {
    expect(i).toBeGreaterThan(-1);
    expect(bloque).toMatch(/const guard = requireRol\(\['Admin', 'Ventas'\]\);/);
    expect(bloque).toMatch(/buildCompletarVentaDirectaArgs\(\{ \.\.\.payload, operacionId: payload\.operacionId \|\| nuevoOperacionId\(\) \}\)/);
    expect(bloque.match(/supabase\.rpc\('([a-z_]+)'/g)).toEqual(["supabase.rpc('completar_venta_directa'"]);
    expect(bloque).toMatch(/supabase\.rpc\('completar_venta_directa', built\.args\)/);
    expect(bloque).not.toMatch(/updateOrdenEstatus|registrar_pago_orden|crear_cxc_orden|salida_cuarto_manual|stock_mov|from\('ordenes'\)|from\('pagos'\)|from\('cuartos_frios'\)/);
  });
  it('error del servidor → {error} con el mensaje traducido; éxito → {data, replay}; nunca inventa éxito', () => {
    expect(bloque).toMatch(/if \(error\) \{[\s\S]*mensajeErrorVentaDirecta\(error\)[\s\S]*return \{ error: msg \};/);
    expect(bloque).toMatch(/rf\(\);\s*return \{ data, replay: data\?\.replay === true \};/);
    expect(bloque).toMatch(/catch \(e\) \{[\s\S]*return \{ error: e\?\.message \|\| 'Error inesperado' \};/);
  });
  it('el camino del chofer conserva su acción (updateOrdenEstatus sigue existiendo)', () => {
    expect(store).toMatch(/ {6}updateOrdenEstatus: async \(id, nuevoEst, metodoPago = null, extra = \{\}\) => \{/);
    expect(src('../components/ChoferView.jsx')).toMatch(/await actions\.updateOrdenEstatus\(entregaModal\.id, "Entregada", cobroMetodo, \{ folioNota: folioNota \|\| null \}\)/);
  });
});

describe('OL-02C: useVentaDirecta y origen físico', () => {
  const comp = sinComentarios(src('../components/VentaDirectaOrigen.jsx'));
  it('un intento = un UUID (resolverOperacion); se limpia solo tras éxito o al cerrar; sin doble envío', () => {
    expect(comp).toMatch(/const op = resolverOperacion\(opRef\.current, claveVentaDirecta\(\{ ordenId: orden\.id, modo, metodo, referencia, folioNota, asignacion \}\)\);/);
    expect(comp).toMatch(/if \(!orden \|\| enVuelo\.current\) return \{ error: 'en_curso' \};/);
    expect(comp).toMatch(/if \(!r \|\| r\.error\) return r \|\| \{ error: 'sin_respuesta' \};\s*opRef\.current = null;/);
    expect(comp).toMatch(/actions\.completarVentaDirecta\(\{ operacionId: op\.id, ordenId: orden\.id, modo, metodo, asignacion, referencia, folioNota \}\)/);
    expect((comp.match(/actions\.\w+/g) || [])).toEqual(['actions.completarVentaDirecta']);
  });
  const venta = (orden, repartos) => {
    const planes = planVentaDirecta(orden, CUARTOS);
    return { planes, repartos: repartos ?? repartosIniciales(planes), setCantidad: () => {}, todoDe: () => {} };
  };
  it('un cuarto: preseleccionado y completo; solo cuartos con ese SKU', () => {
    const h = renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'HPC-25K', qty: 10 }] })} />);
    expect(h).toMatch(/Origen físico/);
    expect(h).toMatch(/HPC-25K<\/span> · 10 bolsas/);
    expect(h).toMatch(/Asignado: 10 \/ 10/);
    expect(h).toMatch(/Cuarto Frío 2/);
    expect(h).not.toMatch(/Cuarto Frío 1|Cuarto Frío 3|Cuarto Frío 4/);
    expect(h).toMatch(/value="10"/);
  });
  it('varios cuartos: pide elegir, sin preselección; dividir: pide repartir; insuficiente y sin existencia: avisan', () => {
    expect(renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'HPC-5K', qty: 10 }] })} />)).toMatch(/Asignado: 0 \/ 10[\s\S]*Varios cuartos alcanzan: elige de cuál sale/);
    expect(renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'HIT-25K', qty: 10 }] })} />)).toMatch(/Ningún cuarto alcanza solo: reparte entre cuartos/);
    expect(renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'HIT-25K', qty: 12 }] })} />)).toMatch(/Existencia insuficiente: hay 11 de 12/);
    expect(renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'NADA', qty: 1 }] })} />)).toMatch(/No hay NADA en ningún cuarto/);
  });
  it('reparto multicuarto visible: Asignado 10 / 10 con 6 + 4', () => {
    const h = renderToStaticMarkup(<VentaDirectaOrigen venta={venta({ preciosSnapshot: [{ sku: 'HIT-25K', qty: 10 }] }, { 'HIT-25K': { 'CF-3': '6', 'CF-4': '4' } })} />);
    expect(h).toMatch(/Asignado: 10 \/ 10/);
    expect(h).toMatch(/value="6"[\s\S]*value="4"/);
  });
});

describe('OL-02C: Ventas usa el contrato atómico', () => {
  const v = sinComentarios(src('../components/VentasStandaloneView.jsx'));
  const cobro = v.slice(v.indexOf('const confirmarCobro = async'), v.indexOf('const hoy = diaNegocio();'));
  it('contado y crédito: origen explícito y completar_venta_directa; sin Creada → Entregada ni pago aparte', () => {
    expect(v).toMatch(/const venta = useVentaDirecta\(\{ actions, cuartosFrios: data\.cuartosFrios \}\);/);
    expect(v).toMatch(/const modoCobro = pagoModal\?\.entregaPagada \? 'pagado_link' : modoVentaDirecta\(pagoForm\.metodo\);/);
    expect(cobro).toMatch(/if \(!venta\.validacion\.ok\) \{ showToast\('Indica de qué cuarto sale cada producto', 'error'\); return; \}/);
    expect(cobro).toMatch(/const r = await venta\.completar\(/);
    expect(v).not.toMatch(/updateOrdenEstatus\(pagoModal\.id|registrar_pago_orden|crear_cxc_orden|sacarDeCuartoFrio|salida_cuarto_manual/);
    expect(v).toMatch(/\{modoCobro && \(\s*<div className="mb-4"><VentaDirectaOrigen venta=\{venta\} disabled=\{venta\.enviando\} \/><\/div>/);
    expect(v).toMatch(/'Registrar crédito y entregar'/);
    expect(v).toMatch(/'Cobrar y entregar'/);
  });
  it('link sin pagar: solo genera el link (sin origen ni entrega); el texto no dice que la venta se completó', () => {
    const link = cobro.slice(cobro.indexOf('if (!pagoModal.entregaPagada && pagoForm.metodo === "QR / Link de pago")'), cobro.indexOf('if (!modoCobro'));
    expect(link).toMatch(/actions\.crearCheckoutPago\?\.\(pagoModal\.id, checkoutProvider\)/);
    expect(link).not.toMatch(/venta\.completar|updateOrdenEstatus/);
    expect(link).toMatch(/return;\s*\}\s*$/);
    expect(v).toMatch(/El pedido se entrega cuando el pago se confirme\./);
  });
  it('link pagado: "Entregar pedido pagado" solo con pagos cargados que cubren el total → modo pagado_link', () => {
    expect(v).toMatch(/const pagado = linkPagadoCompleto\(o, data\.pagos\);/);
    expect(v).toMatch(/\? <FormBtn success onClick=\{\(\) => cobrar\(o, \{ entregaPagada: true \}\)\}>Entregar pedido pagado<\/FormBtn>/);
    expect(cobro).toMatch(/const metodo = modoCobro === 'pagado_link' \? METODO_LINK : pagoForm\.metodo;/);
    expect(v).toMatch(/'Entregar pedido'/);
  });
  it('fallo: el diálogo queda abierto y sin éxito; éxito: un mensaje y cierre', () => {
    expect(cobro).toMatch(/if \(!r \|\| r\.error\) return;\s*showToast\([\s\S]*?\);\s*cerrarCobro\(\);/);
    expect((cobro.match(/showToast\(/g) || []).length).toBe(7);   // 3 del link + crédito sin cliente + sin origen + éxito + conexión
  });
  it('Asignada con ruta: sigue sin acción del vendedor (OL-01A); Asignada sin ruta usa el mismo diálogo atómico', () => {
    const tarjeta = v.slice(v.indexOf('const tarjetaOrden ='), v.indexOf('const grupoMonto'));
    const etiqueta = tarjeta.slice(tarjeta.indexOf('acc.enRutaDelChofer'));
    expect(etiqueta.slice(0, etiqueta.indexOf('</p>'))).not.toMatch(/onClick|FormBtn|actions\./);
    expect(tarjeta).toMatch(/\{acc\.cobrarEntrega && \(pagado[\s\S]*cobrar\(o\)\} className=[^>]*>Cobrar entrega</);
  });
});

describe('OL-02C: Admin usa el mismo contrato para órdenes sin ruta', () => {
  const a = sinComentarios(src('../components/views/OrdenesView.jsx'));
  const cobro = a.slice(a.indexOf('const confirmarCobro = async'), a.indexOf('const filtered = useMemo'));
  it('sin ruta → venta.completar (mismo hook y acción); con ruta → flujo de ruta existente sin cambio', () => {
    expect(a).toMatch(/const venta = useVentaDirecta\(\{ actions, cuartosFrios: data\.cuartosFrios \}\);/);
    expect(a).toMatch(/const directa = !!pagoModal && esElegibleVentaDirecta\(pagoModal\);/);
    expect(cobro).toMatch(/if \(directa\) \{[\s\S]*const r = await venta\.completar\([\s\S]*return;\s*\}\s*const err = await actions\.updateOrdenEstatus\(pagoModal\.id, "Entregada", pagoForm\.metodo\);/);
    expect(a).toMatch(/\{modoCobro && <div className="mb-2"><VentaDirectaOrigen venta=\{venta\} disabled=\{venta\.enviando\} \/><\/div>\}/);
    expect(a).not.toMatch(/registrar_pago_orden|crear_cxc_orden|salida_cuarto_manual/);
  });
  it('link pagado → "Entregar pagado" (pagado_link); la orden con ruta no gana atajo de venta directa', () => {
    expect(a).toMatch(/linkPagadoCompleto\(r, data\.pagos\)\?"Entregar pagado":"Cobrar entrega"/);
    expect(a).toMatch(/const modoCobro = directa \? \(pagoModal\.entregaPagada \? 'pagado_link' : modoVentaDirecta\(pagoForm\.metodo\)\) : null;/);
    expect(src('../data/ventaDirectaLogic.js')).toMatch(/return \(orden\.estatus === 'Creada' \|\| orden\.estatus === 'Asignada'\) && !tieneRutaAsignada\(orden\);/);
  });
});
