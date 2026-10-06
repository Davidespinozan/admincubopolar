// complementoLogic.js — OL-04: estado del complemento de pago POR PAGO (lectura).
//
// Fuente: los renglones de `pagos` (ligados a la CxC de la orden) y las
// operaciones de `cfdi_operaciones` (migración 113). Es solo un modelo de
// lectura para la interfaz con las mismas reglas que reservar_complemento_cfdi;
// la autoridad final es la reserva en la base (que revalida todo con la orden
// bloqueada). No consulta nada ni escribe.
//
// Así los pagos registrados por cualquier camino (cobro de CxC, webhook del
// link, cierre de ruta → abonar_cxc) aparecen como pendientes de complemento
// sin acoplar esos flujos al proveedor; y un pago anterior a la factura se
// vuelve emitible cuando existe la factura PPD vigente (conserva su fecha).
import { n } from '../utils/safe';

export const ESTADO_COMPLEMENTO = Object.freeze({
  EMITIDO: 'emitido',
  EMITIBLE: 'emitible',
  EN_PROCESO: 'en_proceso',
  REQUIERE_CONCILIACION: 'requiere_conciliacion',
  ESPERA_ANTERIOR: 'espera_anterior',
  BLOQUEADO: 'bloqueado',
  NO_ELEGIBLE: 'no_elegible',
});

const ACTIVOS = new Set(['en_curso', 'incierta', 'cancelacion_pendiente', 'revision']);
const id = (v) => (v === null || v === undefined ? '' : String(v));
const campo = (o, camel, snake) => (o ? (o[camel] ?? o[snake]) : undefined);

/** Cómo se emitió el CFDI vigente de la orden (PPD / PUE) según su operación de emisión; null si no hay registro. */
export function metodoSatDeOrden(orden, operaciones) {
  const uuid = campo(orden, 'facturamaUuid', 'facturama_uuid');
  if (!uuid) return null;
  const em = (operaciones || []).find(o => campo(o, 'tipo', 'tipo') === 'emision' && campo(o, 'estado', 'estado') === 'exitosa'
    && id(campo(o, 'cfdiUuid', 'cfdi_uuid')) === id(uuid));
  return em ? (campo(em, 'cfdiMetodoPago', 'cfdi_metodo_pago') || null) : null;
}

/**
 * Pagos de la CxC de la orden con su estado de complemento, en orden de
 * registro (= parcialidad 1, 2, 3…).
 * @returns {{ aplica: boolean, motivo: string|null, pagos: Array<{ pago, parcialidad, estado, motivo, cfdiUuid }> }}
 */
export function estadoComplementosOrden(orden, pagos, operaciones) {
  const ordenId = id(campo(orden, 'id', 'id'));
  const ops = (operaciones || []).filter(o => id(campo(o, 'ordenId', 'orden_id')) === ordenId);
  const propios = (pagos || [])
    .filter(p => p && campo(p, 'cxcId', 'cxc_id') != null && id(campo(p, 'ordenId', 'orden_id')) === ordenId)
    .sort((a, b) => n(a.id) - n(b.id));
  const uuid = campo(orden, 'facturamaUuid', 'facturama_uuid');
  const vigente = !!uuid && !campo(orden, 'cfdiCanceladoAt', 'cfdi_cancelado_at') && campo(orden, 'estatus', 'estatus') === 'Facturada';
  const metodo = vigente ? metodoSatDeOrden(orden, ops) : null;
  const motivoOrden = !vigente ? 'Sin factura vigente: se podrá emitir cuando exista la factura PPD'
    : metodo === 'PUE' ? 'Factura PUE: no lleva complemento'
    : metodo !== 'PPD' ? 'Modo fiscal de la factura no registrado: requiere revisión'
    : null;
  const activa = ops.find(o => ACTIVOS.has(campo(o, 'estado', 'estado')));
  let anteriorPendiente = false;
  const filas = propios.map((pago, i) => {
    const parcialidad = i + 1;
    const delPago = ops.filter(o => campo(o, 'tipo', 'tipo') === 'complemento' && id(campo(o, 'pagoId', 'pago_id')) === id(pago.id));
    const ok = delPago.find(o => campo(o, 'estado', 'estado') === 'exitosa' && id(campo(o, 'relacionadoUuid', 'relacionado_uuid')) === id(uuid));
    let estado; let motivo = null;
    if (motivoOrden) { estado = ESTADO_COMPLEMENTO.NO_ELEGIBLE; motivo = motivoOrden; }
    else if (ok) estado = ESTADO_COMPLEMENTO.EMITIDO;
    else if (activa && campo(activa, 'tipo', 'tipo') === 'complemento' && id(campo(activa, 'pagoId', 'pago_id')) === id(pago.id)) {
      estado = campo(activa, 'estado', 'estado') === 'en_curso' ? ESTADO_COMPLEMENTO.EN_PROCESO : ESTADO_COMPLEMENTO.REQUIERE_CONCILIACION;
    } else if (activa) { estado = ESTADO_COMPLEMENTO.BLOQUEADO; motivo = 'Hay otra operación CFDI en curso o sin resolver para esta orden'; }
    else if (anteriorPendiente) { estado = ESTADO_COMPLEMENTO.ESPERA_ANTERIOR; motivo = 'Primero se emite la parcialidad anterior'; }
    else estado = ESTADO_COMPLEMENTO.EMITIBLE;
    if (estado !== ESTADO_COMPLEMENTO.EMITIDO) anteriorPendiente = true;
    return { pago, parcialidad, estado, motivo, cfdiUuid: ok ? campo(ok, 'cfdiUuid', 'cfdi_uuid') : null };
  });
  return { aplica: propios.length > 0, motivo: motivoOrden, pagos: filas };
}

/** ¿La orden tiene algún pago que requiera atención fiscal (emitible o por conciliar)? */
export function complementoPendienteOrden(orden, pagos, operaciones) {
  return estadoComplementosOrden(orden, pagos, operaciones).pagos
    .some(f => f.estado === ESTADO_COMPLEMENTO.EMITIBLE || f.estado === ESTADO_COMPLEMENTO.REQUIERE_CONCILIACION);
}
