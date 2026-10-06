// billing-create-complemento
// Genera un CFDI tipo "P" (Complemento de Pago 2.0) en Facturama para UN pago
// de una cuenta por cobrar de una venta facturada PPD.
//
// OL-04: la operación es "complemento del pago X". El cliente manda SOLO el
// identificador del pago; el servidor toma todo dato fiscal de la base:
//   pagos.monto / saldo_antes / saldo_despues / fecha / método (→ forma SAT),
//   CFDI relacionado vigente (UUID de la orden), parcialidad, receptor y CP.
// Orden de las comprobaciones (todas ANTES del proveedor):
//   1. autenticación; 2. rol (Admin, Facturación, Ventas);
//   3. cuerpo: pagoId; los montos / saldos / método del cliente se rechazan;
//   4. el pago y su orden existen; 5. dueño (Ventas: solo su orden);
//   6. reservar_complemento_cfdi (migración 113, service role): bloquea la orden,
//      revalida actor y dueño, CFDI vigente emitido PPD, coherencia del pago,
//      parcialidades anteriores ya complementadas; devuelve el complemento ya
//      emitido de ese pago sin llamar al proveedor; una operación activa o sin
//      resolver de la orden bloquea (la segunda solicitud no cruza la frontera).
// Después: Facturama (tiempo límite, fuera de toda transacción) y
// finalizar_operacion_cfdi. Un resultado desconocido queda 'incierta' y
// bloquea todo reintento hasta conciliarlo. Nada de esto toca la orden, el
// pago, la CxC ni la contabilidad.
//
// Contrato de Facturama (guía oficial "Complemento de pago" y "Idempotencia de
// Facturas", facturama.mx/docs): POST /3/cfdis; CfdiType "P"; sin Currency,
// PaymentMethod ni PaymentForm en el nodo general; Receiver.CfdiUse "CP01";
// "Complemento": { "Payments": [{ Date, PaymentForm, Currency, Amount,
// RelatedDocuments: [{ Uuid, PartialityNumber, Currency, PreviousBalanceAmount,
// AmountPaid, ImpSaldoInsoluto, TaxObject, Taxes }] }] }; Folio + Date fijos
// por operación (Facturama identifica la operación por esa combinación).

import { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { buildCfdiReceiver } from '../_lib/invoiceLogic.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';
import { withSentry } from '../_lib/sentry.js';
import { autorizarOrdenFacturacion, rolPuedeFacturar } from '../_lib/facturacionGuard.js';
import { clasificarEmision, huellaPayload, llamarProveedor, respuestaReservaRechazada } from '../_lib/cfdiOperacion.js';

const FALLBACK_ISSUER_ZIP = '34186';
const PROVEEDOR_TIMEOUT_MS = 8000;
const LEASE_SEGUNDOS = 120;
// Campos fiscales que el cliente ya NO puede mandar (antes eran autoridad).
const CAMPOS_FISCALES_CLIENTE = ['monto', 'metodoPago', 'saldoAntes', 'saldoDespues', 'cxcId', 'facturamaPayload'];

/** Valida el cuerpo: solo `pagoId` (entero positivo). */
export function validarCuerpoComplemento(body) {
  const b = body && typeof body === 'object' ? body : {};
  const ajenos = CAMPOS_FISCALES_CLIENTE.filter(k => Object.prototype.hasOwnProperty.call(b, k));
  if (ajenos.length) {
    return { ok: false, status: 400, code: 'CAMPOS_FISCALES_NO_PERMITIDOS', error: `El complemento se arma con los datos del pago registrado; no se aceptan ${ajenos.join(', ')}` };
  }
  const id = Number(b.pagoId);
  if (!Number.isInteger(id) || id <= 0) return { ok: false, status: 400, code: 'PAGO_REQUERIDO', error: 'pagoId es requerido' };
  return { ok: true, pagoId: id };
}

/** CFDI tipo P desde la reserva (datos fiscales de la base) y el receptor del cliente. */
export function buildComplementoPayload({ reserva, cliente, ordenNombre, issuerZip }) {
  const expeditionPlace = String(issuerZip || FALLBACK_ISSUER_ZIP);
  const receptor = buildCfdiReceiver(cliente ? { ...cliente } : null, expeditionPlace);
  const importe = Number(reserva.importe_pagado);
  return {
    NameId: '14',
    Serie: reserva.serie,
    Folio: reserva.folio,
    Date: reserva.fecha_cfdi,
    CfdiType: 'P',
    ExpeditionPlace: expeditionPlace,
    Receiver: {
      Rfc: receptor.rfc,
      Name: receptor.name === 'CLIENTE' ? (ordenNombre || receptor.name) : receptor.name,
      FiscalRegime: receptor.fiscalRegime,
      CfdiUse: 'CP01',
      TaxZipCode: receptor.zipCode,
    },
    Complemento: {
      Payments: [
        {
          Date: reserva.fecha_pago,
          PaymentForm: reserva.forma_pago,
          Currency: 'MXN',
          Amount: importe,
          RelatedDocuments: [
            {
              Uuid: reserva.relacionado_uuid,
              PartialityNumber: Number(reserva.parcialidad),
              Currency: 'MXN',
              PreviousBalanceAmount: Number(reserva.saldo_anterior),
              AmountPaid: importe,
              ImpSaldoInsoluto: Number(reserva.saldo_insoluto),
              // Hielo: los conceptos de la factura son objeto de impuesto con IVA 0% (Art. 2-A LIVA).
              TaxObject: '02',
              Taxes: [{ Name: 'IVA', Rate: 0.0, Total: 0, Base: importe, IsRetention: false }],
            },
          ],
        },
      ],
    },
  };
}

const registrarIntento = async (supabase, intento) => {
  try {
    await insertInvoiceAttempt(intento, supabase);
  } catch (logErr) {
    console.error('[billing-create-complemento] bitácora falló:', logErr?.message || logErr);
  }
};

const NO_ELEGIBLE = {
  PAGO_SIN_CXC: 'El pago no pertenece a una cuenta por cobrar: no lleva complemento.',
  PAGO_SIN_ORDEN: 'El pago no está ligado a una orden.',
  SIN_CFDI_VIGENTE: 'La orden no tiene una factura vigente; el complemento se podrá emitir cuando la tenga.',
  MODO_FISCAL_NO_REGISTRADO: 'No hay registro de cómo se emitió la factura (PPD/PUE); requiere revisión en Facturación.',
  CFDI_PUE: 'La factura se emitió PUE (pago en una exhibición): no lleva complemento de pago.',
  DATOS_PAGO_INCONSISTENTES: 'Los saldos registrados del pago no cuadran; requiere revisión antes de emitir.',
  FORMA_PAGO_NO_DETERMINABLE: 'El método del pago no corresponde a una forma de pago SAT; requiere revisión.',
  COMPLEMENTO_ANTERIOR_PENDIENTE: 'Primero se emite el complemento de la parcialidad anterior.',
};

export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchImpl = (...args) => fetch(...args),
  getConfig = getFacturamaConfig,
  timeoutMs = Number(process.env.FACTURAMA_TIMEOUT_MS) || PROVEEDOR_TIMEOUT_MS,
  leaseSegundos = Number(process.env.CFDI_LEASE_SEGUNDOS) || LEASE_SEGUNDOS,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let supabase = null;
  let operacion = null;
  let ordenId = null;

  try {
    supabase = getSupabase();
  } catch (configErr) {
    console.error('[billing-create-complemento] configuración ausente:', configErr?.message);
    return json(503, { error: 'Autenticación no configurada en el servidor (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', code: 'AUTH_NOT_CONFIGURED' });
  }

  try {
    const auth = await getAuthenticatedProfile(event, { supabase });
    if (auth.errorResponse) return auth.errorResponse;
    if (!rolPuedeFacturar(auth.profile)) return badRequest('Tu rol no puede generar complementos de pago');

    const cuerpo = validarCuerpoComplemento(await readJsonBody(event));
    if (!cuerpo.ok) return json(cuerpo.status, { error: cuerpo.error, code: cuerpo.code });

    const { data: pago } = await supabase.from('pagos').select('id, cxc_id, orden_id').eq('id', cuerpo.pagoId).maybeSingle();
    if (!pago) return badRequest('Pago no encontrado');
    let oid = pago.orden_id;
    if (!oid && pago.cxc_id) {
      const { data: cxc } = await supabase.from('cuentas_por_cobrar').select('orden_id').eq('id', pago.cxc_id).maybeSingle();
      oid = cxc?.orden_id || null;
    }
    if (!oid) return json(409, { error: NO_ELEGIBLE.PAGO_SIN_ORDEN, code: 'PAGO_SIN_ORDEN' });
    const { data: orden } = await supabase.from('ordenes').select('id, folio, vendedor_id, cliente_id, cliente_nombre').eq('id', oid).maybeSingle();
    if (!orden) return badRequest('Orden asociada no encontrada');
    ordenId = orden.id;

    const permiso = autorizarOrdenFacturacion(auth.profile, orden);
    if (!permiso.ok) return json(permiso.status, { error: permiso.error, code: permiso.code });

    // Reserva (transacción corta; revalida todo con la orden bloqueada).
    const res = await supabase.rpc('reservar_complemento_cfdi', { p_pago_id: pago.id, p_actor_id: auth.profile.id, p_lease_segundos: leaseSegundos });
    if (res.error) {
      if (res.error.code === '42501') return json(403, { error: 'Solo puedes emitir complementos de tus propias órdenes', code: 'ORDEN_AJENA' });
      return serverError('No se pudo reservar el complemento; no se contactó a Facturama. Reintenta.', res.error.message);
    }
    const reserva = res.data || {};
    if (!reserva.ok) {
      if (reserva.codigo === 'COMPLEMENTO_EMITIDO') {
        return ok({ alreadyIssued: true, pagoId: pago.id, complementoUuid: reserva.cfdi_uuid, proveedorId: reserva.proveedor_id, parcialidad: reserva.parcialidad, operacionId: reserva.operacion_id });
      }
      if (NO_ELEGIBLE[reserva.codigo]) {
        return json(409, { error: NO_ELEGIBLE[reserva.codigo], code: reserva.codigo, pagoPendiente: reserva.pago_pendiente || null });
      }
      const r = respuestaReservaRechazada(reserva);
      return json(r.status, r.body);
    }
    operacion = reserva.operacion_id;

    const [{ data: cliente }, { data: configEmpresa }] = await Promise.all([
      reserva.cliente_id
        ? supabase.from('clientes').select('nombre, rfc, regimen, uso_cfdi, cp').eq('id', reserva.cliente_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('configuracion_empresa').select('codigo_postal').eq('id', 1).maybeSingle(),
    ]);
    const payload = buildComplementoPayload({ reserva, cliente, ordenNombre: orden.cliente_nombre, issuerZip: configEmpresa?.codigo_postal });

    const config = getConfig();
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
    const respuesta = await llamarProveedor(fetchImpl, `${config.baseUrl}/3/cfdis`, {
      method: 'POST',
      headers: { authorization: `Basic ${credentials}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }, timeoutMs);
    const clase = clasificarEmision(respuesta);
    const datos = { ...clase.datos, detalle: { ...(clase.datos.detalle || {}), payload_hash: huellaPayload(payload) } };
    const fin = await supabase.rpc('finalizar_operacion_cfdi', { p_operacion_id: operacion, p_resultado: clase.resultado, p_datos: datos });
    const uuid = datos.cfdi_uuid || null;

    await registrarIntento(supabase, {
      orden_id: orden.id,
      provider: 'facturama-complemento',
      provider_reference: datos.proveedor_id || operacion,
      status: fin.error ? 'review:finalizacion_pendiente'
        : clase.resultado === 'emitida' ? (fin.data?.estado === 'exitosa' ? 'success' : 'review:complemento')
        : clase.resultado === 'fallida' ? 'error' : 'uncertain',
      request_payload: payload,
      response_payload: { operacion_id: operacion, pago_id: pago.id, http: respuesta.status ?? null, raw: respuesta.raw ?? null, error: respuesta.error ?? null },
    });

    if (fin.error) {
      return json(502, {
        error: `${clase.resultado === 'emitida' ? `Complemento timbrado (${uuid})` : 'Respuesta de Facturama recibida'} pero no se pudo registrar en la base; quedó pendiente de conciliación. No reintentes.`,
        code: 'FINALIZACION_PENDIENTE', operacionId: operacion, complementoUuid: uuid, details: fin.error.message,
      });
    }
    if (clase.resultado === 'emitida') {
      if (fin.data?.estado !== 'exitosa') {
        return json(409, { error: `Complemento timbrado (${uuid}) pero quedó en revisión.`, code: 'COMPLEMENTO_EN_REVISION', operacionId: operacion, complementoUuid: uuid });
      }
      return ok({ complemento: respuesta.raw, pagoId: pago.id, complementoUuid: uuid, parcialidad: reserva.parcialidad, operacionId: operacion });
    }
    if (clase.resultado === 'fallida') {
      const msg = respuesta.status === 401 ? 'Credenciales de Facturama incorrectas (401)' : translateFacturamaError(respuesta.raw || {}, respuesta.status);
      return json(422, { error: msg, code: 'PROVEEDOR_RECHAZO', operacionId: operacion });
    }
    return json(502, {
      error: 'No se pudo confirmar con Facturama si el complemento se timbró. Quedó pendiente de conciliación; no reintentes hasta revisarlo.',
      code: 'RESULTADO_INCIERTO', operacionId: operacion,
    });
  } catch (error) {
    if (ordenId && supabase) {
      await registrarIntento(supabase, {
        orden_id: ordenId, provider: 'facturama-complemento', provider_reference: operacion,
        status: operacion ? 'uncertain' : 'error', request_payload: {}, response_payload: { message: error.message, operacion_id: operacion },
      });
    }
    return serverError(error.message || 'No se pudo generar el complemento de pago', error.message);
  }
};

export const handler = withSentry(createHandler());
