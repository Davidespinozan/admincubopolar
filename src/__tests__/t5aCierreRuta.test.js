// T5-A (mig 138): una ruta ya no puede quedar imposible de cerrar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  detalleRechazo, esRechazoDeCarga, faltanteEnCamion, mensajeNoCabe, mensajeRechazoServidor,
  puedeAgregarPedidos, etapaDeRuta, avisoSinCubrir, resumenDiagnostico, buildRevertirEntregaArgs,
} from '../data/recuperacionRutaLogic';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

describe('rechazos del servidor', () => {
  const err = (d) => ({ message: 'No se puede entregar OV-0012: la carga del camión no alcanza.', code: '22023', details: JSON.stringify(d) });
  it('lee el detalle estructurado y reconoce el rechazo por carga', () => {
    const e = err({ codigo: 'CARGA_INSUFICIENTE', orden_id: 12, faltantes: [{ sku: 'HPC-5K', pedido: 5, disponible: 0 }] });
    expect(detalleRechazo(e)).toMatchObject({ codigo: 'CARGA_INSUFICIENTE', orden_id: 12 });
    expect(esRechazoDeCarga(e)).toBe(true);
    expect(esRechazoDeCarga(err({ codigo: 'RUTA_CERRADA' }))).toBe(true);
    expect(esRechazoDeCarga(err({ codigo: 'RUTA_CON_CARGA' }))).toBe(false);
  });
  it('tolera errores sin detalle, con texto libre o JSON de otro contrato', () => {
    expect(detalleRechazo(null)).toEqual({});
    expect(detalleRechazo({ message: 'x' })).toEqual({});
    expect(detalleRechazo({ details: 'no es json' })).toEqual({});
    expect(detalleRechazo({ details: '{"faltante":{"A":1}}' })).toEqual({}); // el de 087: sin `codigo`
    expect(esRechazoDeCarga({ message: 'Failed to fetch' })).toBe(false);
  });
  it('el mensaje del servidor se muestra sin prefijo técnico', () => {
    expect(mensajeRechazoServidor({ message: 'revertir_entrega_ruta: no autorizado' })).toBe('no autorizado');
    expect(mensajeRechazoServidor({ message: 'La ruta R-1 ya tiene su carga capturada: no se le agregan pedidos.' })).toMatch(/^La ruta R-1 ya tiene/);
    expect(mensajeRechazoServidor(null, 'x')).toBe('x');
  });
});

describe('el chofer: una orden que no cabe en lo que trae', () => {
  const restante = { 'HPC-5K': 8, 'HPC-25K': 0 };
  it('cabe: sin faltantes', () => {
    expect(faltanteEnCamion([{ sku: 'HPC-5K', cant: 8 }], restante)).toEqual([]);
    expect(mensajeNoCabe([])).toBeNull();
  });
  it('no cabe: por producto, sumando renglones repetidos; producto no cargado = 0 disponibles', () => {
    const f = faltanteEnCamion([{ sku: 'HPC-5K', cant: 5 }, { sku: 'HPC-5K', cantidad: 4 }, { sku: 'HPC-25K', qty: 2 }, { sku: 'HPT-5K', cant: 1 }], restante);
    expect(f).toEqual([
      { sku: 'HPC-25K', pedido: 2, disponible: 0, falta: 2 },
      { sku: 'HPC-5K', pedido: 9, disponible: 8, falta: 1 },
      { sku: 'HPT-5K', pedido: 1, disponible: 0, falta: 1 },
    ]);
    const m = mensajeNoCabe(f, (sku) => `[${sku}]`);
    expect(m).toMatch(/9 de \[HPC-5K\] \(te quedan 8\)/);
    expect(m).toMatch(/No entregada/);
  });
  it('restante negativo o basura se trata como 0; cantidades inválidas se ignoran', () => {
    expect(faltanteEnCamion([{ sku: 'A', cant: 1 }], { A: -3 })).toEqual([{ sku: 'A', pedido: 1, disponible: 0, falta: 1 }]);
    expect(faltanteEnCamion([{ sku: 'A', cant: 0 }, { sku: '', cant: 5 }], {})).toEqual([]);
    expect(faltanteEnCamion(null, null)).toEqual([]);
  });
  it('la pantalla avisa antes, muestra el motivo del servidor y deja quitar lo que no está en el servidor', () => {
    const src = leer('../components/ChoferView.jsx');
    expect(src).toMatch(/const noCabe = mensajeNoCabe\(faltanteEnCamion\(entregaModal\.items, restante\)/);
    expect(src).toMatch(/if \(noCabe\) \{ showToast\(noCabe, 'error'\); return; \}/);
    expect(src).toMatch(/err\.cargaInsuficiente \?/);
    expect(src).toMatch(/const quitarRechazada = useCallback/);
    expect(src).toMatch(/if \(res\.cargaInsuficiente\) \{/);
    expect(src).toMatch(/data-testid="quitar-express"/);
  });
});

describe('agregar pedidos a una ruta', () => {
  it('solo antes de que tenga carga', () => {
    expect(puedeAgregarPedidos({ estatus: 'Programada' })).toEqual({ ok: true, motivo: null });
    expect(puedeAgregarPedidos({ estatus: 'Pendiente firma' }).ok).toBe(false);
    expect(puedeAgregarPedidos({ estatus: 'Cargada', carga_confirmada_at: '2026-10-10' }).ok).toBe(false);
    expect(puedeAgregarPedidos({ estatus: 'En progreso', cargaConfirmadaAt: '2026-10-10' }).motivo).toMatch(/ya está cargado/);
    expect(puedeAgregarPedidos({ estatus: 'Cerrada' }).ok).toBe(false);
    // Aunque el estatus diga Programada: con carga confirmada no.
    expect(puedeAgregarPedidos({ estatus: 'Programada', carga_confirmada_at: '2026-10-10' }).ok).toBe(false);
  });
  it('Rutas ya distingue "Carga por firmar" y "Camión cargado" de "Programada"', () => {
    expect(etapaDeRuta({ estatus: 'Pendiente firma' }).etiqueta).toBe('Carga por firmar');
    expect(etapaDeRuta({ estatus: 'Cargada' }).etiqueta).toBe('Camión cargado');
    expect(etapaDeRuta({ estatus: 'Programada' })).toBeNull();
    const src = leer('../components/views/RutasView.jsx');
    expect(src).toMatch(/puedeAgregarPedidos\(r\)\.ok\s*\? <button onClick=\{\(\) => asignarOrdenes\(r\)\}/);
  });
  it('avisa cuando la carga autorizada no cubre los pedidos (no sube sola)', () => {
    expect(avisoSinCubrir([{ sku: 'HPC-5K', pedido: 14, autorizado: 12, falta: 2 }])).toMatch(/faltan 2 de HPC-5K.*Editar ruta/);
    expect(avisoSinCubrir([])).toBeNull();
    expect(avisoSinCubrir(undefined)).toBeNull();
    expect(leer('../data/supaStore.js')).toMatch(/const aviso = avisoSinCubrir\(result\?\.sin_cubrir\);/);
  });
});

describe('recuperación de Admin', () => {
  const diag = {
    estatus: 'En progreso', carga_confirmada: true, cierre_financiero: false, consistente: false,
    inventario: [{ sku: 'A', cargado: 10, entregado: 15, merma: 0, devuelto: 0, restante: -5, exceso: 5 }, { sku: 'B', cargado: 6, entregado: 2, merma: 0, devuelto: 0, restante: 4, exceso: 0 }],
    ordenes: [
      { id: 1, folio: 'OV-1', estatus: 'Entregada', lineas: [{ sku: 'B', cantidad: 2 }], cobrado: 0, no_reversible: null },
      { id: 2, folio: 'OV-2', estatus: 'Entregada', lineas: [{ sku: 'A', cantidad: 15 }], cobrado: '450.00', no_reversible: null },
      { id: 3, folio: 'OV-3', estatus: 'Facturada', lineas: [{ sku: 'A', cantidad: 0 }], cobrado: 0, no_reversible: 'Está facturada: primero cancela su CFDI' },
      { id: 4, folio: 'OV-4', estatus: 'Asignada', lineas: [{ sku: 'A', cantidad: 2 }], cobrado: 0 },
      { id: 5, folio: 'OV-5', estatus: 'No entregada', lineas: [] },
    ],
    revertidas: [{ folio: 'OV-9', motivo: 'x', actor: 'Admin' }],
  };
  it('ordena el diagnóstico: las entregas con producto en exceso primero; pendientes aparte', () => {
    const r = resumenDiagnostico(diag);
    expect(r).toMatchObject({ consistente: false, cargaConfirmada: true, abierta: true });
    expect(r.excesos.map(x => x.sku)).toEqual(['A']);
    expect(r.entregadas.map(o => o.folio)).toEqual(['OV-2', 'OV-3', 'OV-1']);
    expect(r.entregadas[0]).toMatchObject({ enExceso: true, reversible: true, cobrado: 450 });
    expect(r.entregadas[1].reversible).toBe(false);
    expect(r.pendientes.map(o => o.folio)).toEqual(['OV-4']);
    expect(r.revertidas).toHaveLength(1);
  });
  it('ruta cerrada o diagnóstico vacío: no ofrece nada', () => {
    expect(resumenDiagnostico({ ...diag, estatus: 'Cerrada' }).abierta).toBe(false);
    expect(resumenDiagnostico(null)).toMatchObject({ consistente: false, entregadas: [], pendientes: [], inventario: [] });
  });
  it('revertir exige orden y motivo; el cobro solo se conserva si se dice explícitamente', () => {
    expect(buildRevertirEntregaArgs({ ordenId: 7, motivo: 'x' }).error).toMatch(/motivo/);
    expect(buildRevertirEntregaArgs({ motivo: 'Marcada por error' }).error).toMatch(/Orden/);
    expect(buildRevertirEntregaArgs({ operacionId: 'op-1', ordenId: '7', motivo: '  Marcada por error ' }).args)
      .toEqual({ p_operacion_id: 'op-1', p_orden_id: 7, p_motivo: 'Marcada por error', p_conservar_cobro: false });
    expect(buildRevertirEntregaArgs({ operacionId: 'op-1', ordenId: 7, motivo: 'Marcada por error', conservarCobro: true }).args.p_conservar_cobro).toBe(true);
    expect(buildRevertirEntregaArgs({ operacionId: 'op-1', ordenId: 7, motivo: 'Marcada por error', conservarCobro: 'sí' }).args.p_conservar_cobro).toBe(false);
  });
  it('store y pantalla: solo Admin, por contrato, y el cobro se reconoce con una casilla', () => {
    const store = leer('../data/supaStore.js');
    expect(store).toMatch(/diagnosticoRuta: async \(rutaId\) => \{\s*const guard = requireAdmin\(\);/);
    expect(store).toMatch(/revertirEntregaRuta: async \(params\) => \{\s*const guard = requireAdmin\(\);/);
    expect(store).toMatch(/rpc\('revertir_entrega_ruta', built\.args\)/);
    const modal = leer('../components/RecuperacionRutaModal.jsx');
    expect(modal).toMatch(/no borra ese cobro/);
    expect(modal).toMatch(/if \(form\.pideCobro && !form\.conservarCobro\)/);
    expect(modal).toMatch(/r\.codigo === 'COBRO_REGISTRADO'/);
    expect(modal).not.toMatch(/supabase/); // la pantalla no escribe: todo pasa por acciones del store
    const rutas = leer('../components/views/RutasView.jsx');
    expect(rutas).toMatch(/Revisar inventario de la ruta/);
  });
});

describe('migración 138', () => {
  const sql = leer('../../supabase/138_recuperacion_cierre_ruta.sql');
  it('la guarda es un disparador sin exención de rol ni de contexto', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.ordenes_guard_carga_ruta()'), sql.indexOf('CREATE TRIGGER trg_ordenes_guard_carga_ruta'));
    expect(fn).not.toMatch(/fin_ctx_activo|service_role|fin_jwt_role|erp_rol_activo/);
    expect(fn).toMatch(/FROM rutas WHERE id = NEW\.ruta_id FOR UPDATE/);
    expect(sql).toMatch(/AFTER UPDATE OF estatus, ruta_id ON public\.ordenes/);
  });
  it('no redefine el balance canónico ni la finalización de 087, ni toca cobros', () => {
    expect(sql).not.toMatch(/FUNCTION (public\.)?(balance_ruta_interno|finalizar_inventario_ruta|registrar_no_entrega|registrar_pago_orden|crear_cxc_orden|abonar_cxc|confirmar_carga_ruta)\(/);
    expect(sql).not.toMatch(/DELETE FROM pagos|UPDATE pagos|INSERT INTO pagos|stock_mov_cuarto\(|INSERT INTO inventario_mov|UPDATE cuartos_frios/);
  });
  it('la reversión deja evidencia y no confía en el cliente para el dinero', () => {
    expect(sql).toMatch(/INSERT INTO ruta_entregas_revertidas \(operacion_id, orden_id, ruta_id, motivo, actor_id, actor, antes\)/);
    expect(sql).toMatch(/'COBRO_REGISTRADO'/);
    expect(sql).toMatch(/v_cxc_res := anular_cxc_orden\(p_orden_id\);/);
  });
});
