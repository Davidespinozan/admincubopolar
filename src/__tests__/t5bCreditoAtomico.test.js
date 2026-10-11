// T5-B (mig 139): una entrega de ruta a crédito nunca queda confirmada sin su cuenta por cobrar.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { motivoNoFiar, esCreditoRechazado, buildEntregarOrdenRutaArgs, detalleRechazo } from '../data/recuperacionRutaLogic';
import { motivoSinCredito } from '../data/choferRutaLogic';

const leer = (ruta) => readFileSync(new URL(ruta, import.meta.url), 'utf8');

describe('regla de crédito (espejo del servidor)', () => {
  const amplio = { nombre: 'Tienda Sol', credito_autorizado: true, limite_credito: 1000, saldo: 0 };
  it('solo aplica al fiado', () => {
    for (const m of ['Efectivo', 'Transferencia', 'Tarjeta', 'QR / Link de pago']) expect(motivoNoFiar({ metodo: m, cliente: null, importe: 999 })).toBeNull();
  });
  it('sin autorización explícita no se fía, aunque tenga límite capturado', () => {
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: { nombre: 'X', credito_autorizado: false, limite_credito: 5000 }, importe: 10 })).toMatch(/X no tiene crédito autorizado/);
    expect(motivoNoFiar({ metodo: 'Crédito (fiado)', cliente: null, importe: 10 })).toMatch(/cliente registrado/);
  });
  it('límite 0 = SIN capacidad (no "ilimitado")', () => {
    const m = motivoNoFiar({ metodo: 'Crédito', cliente: { nombre: 'Cero', credito_autorizado: true, limite_credito: 0, saldo: 0 }, importe: 1 });
    expect(m).toMatch(/su límite es \$0/);
    expect(m).toMatch(/Cobra de otra forma/);
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: { creditoAutorizado: true, limiteCredito: null }, importe: 1 })).toMatch(/límite es \$0/);
  });
  it('límite suficiente, exactamente disponible y excedido', () => {
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: amplio, importe: 120 })).toBeNull();
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: { ...amplio, limite_credito: 300, saldo: 180 }, importe: 120 })).toBeNull();
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: { ...amplio, limite_credito: 300, saldo: 180 }, importe: 120.01 })).toMatch(/le quedan \$120/);
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: { ...amplio, limite_credito: 300, saldo: 400 }, importe: 1 })).toMatch(/le quedan \$0/);
  });
  it('sin señal no se fía: el crédito solo lo aprueba el servidor', () => {
    expect(motivoNoFiar({ metodo: 'Crédito', cliente: amplio, importe: 1, enLinea: false })).toMatch(/Sin señal no se puede fiar/);
    expect(motivoNoFiar({ metodo: 'Efectivo', cliente: amplio, importe: 1, enLinea: false })).toBeNull();
  });
  it('el chofer y Admin usan la misma regla', () => {
    expect(motivoSinCredito({ credito_autorizado: true, limite_credito: 0 }, 5)).toBe(motivoNoFiar({ metodo: 'Crédito', cliente: { credito_autorizado: true, limite_credito: 0 }, importe: 5 }));
    const admin = leer('../components/views/OrdenesView.jsx');
    expect(admin).toMatch(/const sinCredito = motivoNoFiar\(\{ metodo: pagoForm\.metodo, cliente: cliRuta, importe: pagoModal\.total \}\);/);
    const chofer = leer('../components/ChoferView.jsx');
    expect(chofer).toMatch(/motivoNoFiar\(\{ metodo: cobroMetodo, cliente: cli, importe: entregaModal\.totalCalc, enLinea: online \}\)/);
    expect(chofer).toMatch(/motivoNoFiar\(\{ metodo: vForm\.pago, cliente: cliX, importe: subtotal \+ fiadoLocal, enLinea: online \}\)/);
  });
});

describe('contrato de entrega', () => {
  it('argumentos: orden y método obligatorios; nota y referencia opcionales', () => {
    expect(buildEntregarOrdenRutaArgs({ metodo: 'Efectivo' }).error).toMatch(/Orden/);
    expect(buildEntregarOrdenRutaArgs({ ordenId: 5 }).error).toMatch(/cobra/);
    expect(buildEntregarOrdenRutaArgs({ operacionId: 'op', ordenId: '5', metodo: ' Crédito ', folioNota: ' N-1 ', referencia: '' }).args)
      .toEqual({ p_operacion_id: 'op', p_orden_id: 5, p_metodo: 'Crédito', p_folio_nota: 'N-1', p_referencia: null });
  });
  it('reconoce el rechazo de crédito del servidor', () => {
    const e = { message: 'No se puede fiar OV-1: Excede límite de crédito. Disponible: 0. No se registró la entrega.', code: '22023', details: JSON.stringify({ codigo: 'CREDITO_RECHAZADO', orden_id: 1 }) };
    expect(esCreditoRechazado(e)).toBe(true);
    expect(detalleRechazo(e).orden_id).toBe(1);
    expect(esCreditoRechazado({ message: 'x', details: JSON.stringify({ codigo: 'CARGA_INSUFICIENTE' }) })).toBe(false);
    expect(esCreditoRechazado({ message: 'Failed to fetch' })).toBe(false);
  });
  it('el store entrega por UN contrato: ya no hay dos escrituras ni "regresar el estatus"', () => {
    const store = leer('../data/supaStore.js');
    expect(store).toMatch(/if \(nuevoEst === 'Entregada'\) return actionsRef\.current\.entregarOrdenRuta\(id, metodoPago, extra\);/);
    expect(store).toMatch(/rpc\('entregar_orden_ruta', built\.args\)/);
    expect(store).not.toMatch(/rpc\('crear_cxc_orden'/);
    expect(store).not.toMatch(/rpc\('registrar_pago_orden'/);
    expect(store).not.toMatch(/No se pudo sincronizar el cobro/);
    expect(store).toMatch(/creditoRechazado: esCreditoRechazado\(error\) \? detalleRechazo\(error\) : undefined/);
  });
  it('la cola sin señal conserva la operación y el fiado no se encola (sin señal no se fía)', () => {
    const chofer = leer('../components/ChoferView.jsx');
    expect(chofer).toMatch(/updateOrdenEstatus\?\.\(p\.ordenId, 'Entregada', p\.metodoPago, \{ folioNota: p\.folioNota \|\| null, operacionId: p\.operacionId \}\)/);
    // El aviso de crédito va ANTES de encolar: con `enLinea: online` un fiado sin señal nunca llega a la cola.
    expect(chofer.indexOf('enLinea: online });\n      if (sinCredito) { showToast(sinCredito')).toBeLessThan(chofer.indexOf('encolarOffline(TIPOS_MUTACION.ENTREGA'));
    expect(chofer).toMatch(/err\.creditoRechazado \?/);
  });
});

describe('migración 139', () => {
  const sql = leer('../../supabase/139_entrega_ruta_atomica.sql');
  it('no cambia la regla de crédito ni los contratos de dinero', () => {
    expect(sql).not.toMatch(/FUNCTION (public\.)?(fin_validar_credito|crear_cxc_orden|registrar_pago_orden|abonar_cxc|cerrar_ruta_financiero|completar_venta_directa)\(/);
    expect(sql).not.toMatch(/UPDATE clientes|INSERT INTO pagos|INSERT INTO cuentas_por_cobrar|DELETE FROM/);
  });
  it('la entrega y el fiado están en la misma función, con candado de ruta primero', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.entregar_orden_ruta'), sql.indexOf('ordenes_guard_credito_entrega() RETURNS TRIGGER'));
    expect(fn.indexOf('FROM rutas WHERE id = v_rid FOR UPDATE')).toBeLessThan(fn.indexOf('FROM ordenes WHERE id = p_orden_id FOR UPDATE'));
    expect(fn.indexOf("SET estatus = 'Entregada'")).toBeLessThan(fn.indexOf('crear_cxc_orden(p_orden_id, 30)'));
    expect(fn).toMatch(/'CREDITO_RECHAZADO'/);
    expect(fn).not.toMatch(/COMMIT|dblink|pg_background/);
  });
  it('la guarda no exime a ningún rol', () => {
    const fn = sql.slice(sql.indexOf('FUNCTION public.ordenes_guard_credito_entrega()'));
    expect(fn).not.toMatch(/service_role|fin_jwt_role|erp_rol_activo|fin_mi_rol_activo/);
    expect(fn).toMatch(/BEFORE UPDATE OF estatus, metodo_pago ON public\.ordenes/);
  });
});
