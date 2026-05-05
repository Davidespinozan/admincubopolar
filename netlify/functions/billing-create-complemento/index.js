// billing-create-complemento
// Genera un CFDI tipo "P" (Complemento de Pago / REP) en Facturama
// cuando se cobra una cuenta por cobrar de una venta a crédito (PPD).
//
// SAT requirement: toda venta con MetodoPago=PPD debe tener un
// Complemento de Pago cuando se recibe el cobro.

import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { resolveRegimeCode } from '../_lib/invoiceLogic.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';

// CP fallback solo si configuracion_empresa.codigo_postal no se capturó.
// Tanda 4 🔴-6: ahora se lee de configuracion_empresa.
const FALLBACK_ISSUER_ZIP = '34186';

const PAYMENT_FORM_MAP = {
  'Efectivo': '01',
  'Transferencia': '03',
  'Transferencia SPEI': '03',
  'Tarjeta': '04',
  'Tarjeta (terminal)': '04',
  'QR / Link de pago': '03',
  'Crédito': '99',
};

const buildComplementoPayload = ({ orden, cliente, monto, metodoPago, saldoAntes, saldoDespues, pagoNum, issuerZip }) => {
  // Receiver — same as original invoice
  const rfc = cliente?.rfc?.toUpperCase() || 'XAXX010101000';
  // Tanda 4 🔴-10: resolveRegimeCode acepta tanto códigos directos
  // (formato moderno post-mig 060) como strings legacy.
  const fiscalRegime = resolveRegimeCode(cliente?.regimen);
  const expeditionPlace = String(issuerZip || FALLBACK_ISSUER_ZIP);

  // Hielo: IVA tasa 0% — el monto completo es base
  const montoNum = Number(monto);
  const base = montoNum;
  const iva  = 0;

  const paymentDate = new Date().toISOString().replace('Z', '');

  return {
    CfdiType: 'P',
    Currency: 'XXX',        // Requerido por SAT para el CFDI del complemento
    ExpeditionPlace: expeditionPlace,
    Receiver: {
      Rfc: rfc,
      Name: cliente?.nombre || orden.cliente_nombre || 'PUBLICO EN GENERAL',
      FiscalRegime: fiscalRegime,
      CfdiUse: 'CP01',      // Uso exclusivo para complementos de pago
      TaxZipCode: cliente?.cp || expeditionPlace,
    },
    Payments: [
      {
        Date: paymentDate,
        PaymentForm: PAYMENT_FORM_MAP[metodoPago] || '01',
        Currency: 'MXN',
        Amount: montoNum,
        RelatedDocuments: [
          {
            TaxObject: '02',
            Uuid: orden.facturama_uuid,
            Currency: 'MXN',
            PaymentMethod: 'PPD',
            PartialityNumber: pagoNum,
            PreviousBalanceAmount: Number(saldoAntes),
            AmountWithIVA: montoNum,
            ImpSaldoInsoluto: Number(saldoDespues),
            Taxes: [
              {
                Name: 'IVA',
                Rate: 0.0,
                Base: base,
                Total: 0,
                IsRetention: false,
              },
            ],
          },
        ],
      },
    ],
  };
};

const postToFacturama = async (payload) => {
  const config = getFacturamaConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const response = await fetch(`${config.baseUrl}/3/cfdis`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${credentials}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const raw = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401) throw new Error('Credenciales de Facturama incorrectas (401)');
    // 🟡 I1 Tanda 4: traducir errores de Facturama. Detail crudo se
    // preserva en err.facturamaDetail/Raw para auditoría.
    const friendly = translateFacturamaError(raw, response.status);
    const detail = JSON.stringify(raw?.ModelState || raw);
    const err = new Error(friendly);
    err.facturamaDetail = detail;
    err.facturamaRaw = raw;
    throw err;
  }

  return raw;
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;

  try {
    const auth = await getAuthenticatedProfile(event);
    if (auth.errorResponse) return auth.errorResponse;

    if (!['Admin', 'Ventas'].includes(auth.profile.rol)) {
      return badRequest('Tu rol no puede generar complementos de pago');
    }

    body = await readJsonBody(event);
    const { cxcId, monto, metodoPago, saldoAntes, saldoDespues } = body;

    if (!cxcId || !monto) return badRequest('cxcId y monto son requeridos');

    const supabase = getSupabaseAdmin();

    // Obtener CxC y su orden asociada
    const { data: cxc, error: cxcErr } = await supabase
      .from('cuentas_por_cobrar')
      .select('id, orden_id, cliente_id')
      .eq('id', cxcId)
      .single();
    if (cxcErr || !cxc) return badRequest('Cuenta por cobrar no encontrada');

    // Verificar que la orden tiene factura PPD timbrada con UUID
    const { data: orden, error: ordErr } = await supabase
      .from('ordenes')
      .select('id, folio, cliente_id, cliente_nombre, facturama_id, facturama_uuid, metodo_pago')
      .eq('id', cxc.orden_id)
      .single();
    if (ordErr || !orden) return badRequest('Orden asociada no encontrada');

    if (!orden.facturama_uuid) {
      // No hay CFDI timbrado o no tiene UUID guardado — no se puede generar complemento
      return ok({ skipped: true, reason: 'La orden no tiene CFDI timbrado con UUID' });
    }

    // Idempotency check
    const { data: existingAttempt } = await supabase
      .from('invoice_attempts')
      .select('id, status, response_payload')
      .eq('orden_id', orden.id)
      .eq('provider', 'facturama-complemento')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingAttempt?.status === 'success') {
      return ok({ ...existingAttempt.response_payload, cached: true });
    }

    // Obtener cliente para el receptor del CFDI + CP del emisor
    // (Tanda 4 🔴-6: configuracion_empresa.codigo_postal en lugar de
    // ISSUER_ZIP_CODE hardcoded).
    const [
      { data: cliente },
      { data: configEmpresa },
    ] = await Promise.all([
      cxc.cliente_id
        ? supabase.from('clientes').select('nombre, rfc, regimen, cp').eq('id', cxc.cliente_id).single()
        : Promise.resolve({ data: null }),
      supabase.from('configuracion_empresa').select('codigo_postal').eq('id', 1).maybeSingle(),
    ]);
    const issuerZip = configEmpresa?.codigo_postal || FALLBACK_ISSUER_ZIP;

    // Número de parcialidad: contar pagos previos a esta CxC
    const { count: pagosAnteriores } = await supabase
      .from('pagos')
      .select('id', { count: 'exact', head: true })
      .eq('cxc_id', cxcId);
    const pagoNum = (pagosAnteriores || 0) + 1;

    const payload = buildComplementoPayload({
      orden,
      cliente,
      monto,
      metodoPago: metodoPago || 'Efectivo',
      saldoAntes: saldoAntes ?? monto,
      saldoDespues: saldoDespues ?? 0,
      pagoNum,
      issuerZip,
    });

    const complemento = await postToFacturama(payload);

    await insertInvoiceAttempt({
      orden_id: orden.id,
      provider: 'facturama-complemento',
      provider_reference: complemento.Id || complemento.Uuid || `complemento-${cxcId}`,
      status: 'success',
      request_payload: payload,
      response_payload: complemento,
    });

    return ok({ complemento });
  } catch (error) {
    if (body?.cxcId) {
      try {
        await insertInvoiceAttempt({
          orden_id: null,
          provider: 'facturama',
          provider_reference: `complemento-cxc-${body.cxcId}`,
          status: 'error',
          request_payload: body,
          response_payload: {
            message: error.message,
            facturamaDetail: error.facturamaDetail,
            facturamaRaw: error.facturamaRaw,
          },
        });
      } catch {}
    }
    return serverError(error.message || 'No se pudo generar el complemento de pago', error.message);
  }
};
