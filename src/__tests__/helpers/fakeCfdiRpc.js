// fakeCfdiRpc.js — DOBLE de prueba en memoria de los contratos CFDI de la
// migración 111 (reservar_operacion_cfdi / finalizar_operacion_cfdi) para las
// pruebas de las Netlify Functions SIN base de datos. Reproduce las reglas
// observables (una operación activa por orden, elegibilidad, dueño, estados y
// movimiento de la orden). La semántica real se prueba en Postgres: suites
// 111/112 y la integración de handlers del runner local.
const ACTIVOS = new Set(['en_curso', 'incierta', 'cancelacion_pendiente', 'revision']);
const CODIGO = { en_curso: 'OPERACION_EN_CURSO', incierta: 'OPERACION_INCIERTA', cancelacion_pendiente: 'CANCELACION_PENDIENTE', revision: 'OPERACION_EN_REVISION' };
const err = (code, message) => ({ data: null, error: { code, message } });
let seq = 0;

export function makeCfdiRpc({ fallarFinalizar = 0 } = {}) {
  let fallas = fallarFinalizar;
  const reservar = (a, db) => {
    db.cfdi_operaciones = db.cfdi_operaciones || [];
    const actor = (db.usuarios || []).find(u => String(u.id) === String(a.p_actor_id));
    if (!actor || actor.estatus !== 'Activo' || !['Admin', 'Facturación', 'Ventas'].includes(actor.rol)) return err('42501', 'actor no autorizado');
    const o = (db.ordenes || []).find(x => String(x.id) === String(a.p_orden_id));
    if (!o) return err('22023', 'orden no existe');
    if (actor.rol === 'Ventas' && String(o.vendedor_id) !== String(actor.id)) return err('42501', 'Ventas solo factura sus propias órdenes');
    const ops = db.cfdi_operaciones.filter(x => String(x.orden_id) === String(o.id));
    for (const x of ops) if (x.estado === 'en_curso' && x.lease_hasta < Date.now()) x.estado = 'incierta';
    const act = ops.find(x => ACTIVOS.has(x.estado));
    if (act) return { data: { ok: false, operacion_id: act.id, estado: act.estado, codigo: CODIGO[act.estado] }, error: null };
    const vigente = o.facturama_uuid && !o.cfdi_cancelado_at;
    if (a.p_tipo === 'emision') {
      if (vigente) return { data: { ok: false, codigo: 'CFDI_VIGENTE', facturama_uuid: o.facturama_uuid, facturama_folio: o.facturama_folio }, error: null };
      if (o.estatus !== 'Entregada') return { data: { ok: false, codigo: 'ESTATUS_NO_FACTURABLE', estatus: o.estatus }, error: null };
    } else {
      if (!o.facturama_uuid || !o.facturama_id) return { data: { ok: false, codigo: 'SIN_CFDI' }, error: null };
      if (o.cfdi_cancelado_at) return { data: { ok: false, codigo: 'YA_CANCELADA' }, error: null };
      if (o.estatus !== 'Facturada') return { data: { ok: false, codigo: 'ESTATUS_NO_CANCELABLE', estatus: o.estatus }, error: null };
    }
    const generacion = 1 + ops.filter(x => x.tipo === 'cancelacion' && x.estado === 'exitosa').length;
    const op = { id: `op-${++seq}`, orden_id: o.id, tipo: a.p_tipo, generacion, estado: 'en_curso', payload_hash: a.p_payload_hash,
      lease_hasta: Date.now() + 1000 * Math.min(Math.max(a.p_lease_segundos || 120, 30), 900), actor: actor.nombre,
      motivo: a.p_motivo || null, uuid_sustituto: a.p_uuid_sustituto || null,
      proveedor_id: a.p_tipo === 'cancelacion' ? o.facturama_id : null, cfdi_uuid: a.p_tipo === 'cancelacion' ? o.facturama_uuid : null, detalle: {} };
    db.cfdi_operaciones.push(op);
    return { data: { ok: true, operacion_id: op.id, tipo: op.tipo, generacion, estado: 'en_curso', facturama_id: op.proveedor_id, facturama_uuid: op.cfdi_uuid }, error: null };
  };
  const finalizar = (a, db) => {
    if (fallas > 0) { fallas -= 1; return err('08006', 'conexión perdida (doble de prueba)'); }
    const op = (db.cfdi_operaciones || []).find(x => x.id === a.p_operacion_id);
    if (!op) return err('22023', 'operación no existe');
    if (!['en_curso', 'incierta'].includes(op.estado)) return err('55000', `la operación ya está ${op.estado}`);
    const o = db.ordenes.find(x => String(x.id) === String(op.orden_id));
    const d = a.p_datos || {};
    const fin = (estado) => { op.estado = estado; return { data: { ok: estado === 'exitosa', operacion_id: op.id, estado, orden_estatus: o.estatus }, error: null }; };
    switch (a.p_resultado) {
      case 'emitida':
        op.proveedor_id = d.proveedor_id; op.cfdi_uuid = d.cfdi_uuid;
        if (o.estatus === 'Entregada' && !(o.facturama_uuid && !o.cfdi_cancelado_at)) {
          Object.assign(o, { estatus: 'Facturada', facturama_id: d.proveedor_id, facturama_folio: d.folio || null, facturama_uuid: d.cfdi_uuid,
            cfdi_cancelado_at: null, cfdi_cancelado_motivo: null, cfdi_cancelado_motivo_detalle: null, cfdi_cancelado_uuid_sustituto: null, cfdi_cancelado_por: null });
          return fin('exitosa');
        }
        return fin('revision');
      case 'cancelada':
        if (o.estatus === 'Facturada' && o.facturama_uuid === op.cfdi_uuid && !o.cfdi_cancelado_at) {
          Object.assign(o, { estatus: 'Entregada', cfdi_cancelado_at: new Date().toISOString(), cfdi_cancelado_motivo: op.motivo,
            cfdi_cancelado_motivo_detalle: d.motivo_detalle || null, cfdi_cancelado_uuid_sustituto: op.uuid_sustituto, cfdi_cancelado_por: d.cancelado_por || op.actor });
          return fin('exitosa');
        }
        return fin('revision');
      case 'cancelacion_solicitada': return fin('cancelacion_pendiente');
      case 'cancelacion_rechazada': case 'fallida': return fin('fallida');
      case 'incierta': op.proveedor_id = d.proveedor_id || op.proveedor_id; return fin('incierta');
      default: return err('22023', 'resultado inválido');
    }
  };
  return { reservar_operacion_cfdi: reservar, finalizar_operacion_cfdi: finalizar };
}
