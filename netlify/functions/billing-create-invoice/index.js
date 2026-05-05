import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { buildCfdiReceiver } from '../_lib/invoiceLogic.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';

const ROLES_PERMITIDOS = new Set(['Admin', 'Facturación', 'Ventas']);

const PAYMENT_FORM_MAP = {
  'Efectivo': '01',
  'Transferencia': '03',
  'Transferencia SPEI': '03',
  'Tarjeta': '04',
  'Tarjeta (terminal)': '04',
  'QR / Link de pago': '99',
  'Crédito': '99',
  'Crédito (fiado)': '99',
};

const PAYMENT_METHOD_MAP = {
  'Crédito': 'PPD',
  'Crédito (fiado)': 'PPD',
};

// Defaults SAT cuando productos.clave_prod_serv/clave_unidad están NULL.
// Backfill por mig 060: hielo→50202302, empaques→24121800. Si quedan
// productos sin clave (catálogo nuevo), el backend fallback aquí pero
// loggea warning para que admin actualice el producto.
const DEFAULT_PROD_SERV_CODE = '50202302';
const DEFAULT_UNIT_CODE = 'H87'; // pieza

// CP fallback solo si configuracion_empresa.codigo_postal no está
// capturado. UX: la UI Configuración pide CP obligatorio.
const FALLBACK_ISSUER_ZIP = '34186';

const buildFacturamaPayload = ({ orden, cliente, lineas, issuerZip }) => {
  const metodoPago = orden.metodo_pago || 'Efectivo';
  const paymentForm = PAYMENT_FORM_MAP[metodoPago] || '99';
  const paymentMethod = PAYMENT_METHOD_MAP[metodoPago] || 'PUE';

  const expeditionPlace = String(issuerZip || FALLBACK_ISSUER_ZIP);

  // 🔴-8 Tanda 4: distinguir XEXX (extranjero) de XAXX (público general
  // nacional). Lógica centralizada en invoiceLogic.buildCfdiReceiver.
  const receiver = buildCfdiReceiver(cliente, expeditionPlace);

  const items = (lineas || []).map((linea) => {
    const unitPrice = Number(linea.precio_unit || 0);
    const quantity = Number(linea.cantidad || 0);
    const subtotal = Number(linea.subtotal || unitPrice * quantity);

    // 🔴-7 Tanda 4: clave SAT viene del producto (mig 060), no de
    // un PRODUCT_CATALOG hardcoded. Fallback silencioso al default
    // del catálogo SAT genérico para hielo si null.
    const claveProdServ = linea.clave_prod_serv || DEFAULT_PROD_SERV_CODE;
    const claveUnidad = linea.clave_unidad || DEFAULT_UNIT_CODE;

    return {
      ProductCode: claveProdServ,
      IdentificationNumber: linea.sku,
      Description: linea.nombre_producto || linea.sku,
      Unit: 'Pieza',
      UnitCode: claveUnidad,
      UnitPrice: unitPrice,
      Quantity: quantity,
      Subtotal: subtotal,
      TaxObject: '02',
      Taxes: [
        {
          Name: 'IVA',
          Rate: 0.0,
          Total: 0,
          Base: subtotal,
          IsRetention: false,
        },
      ],
      Total: subtotal, // IVA tasa 0% (Art. 2-A LIVA — hielo)
    };
  });

  const now = new Date();
  const currentMonth = String(now.getMonth() + 1).padStart(2, '0');
  const currentYear = String(now.getFullYear());

  const cfdi = {
    CfdiType: 'I',
    PaymentForm: paymentForm,
    PaymentMethod: paymentMethod,
    Currency: 'MXN',
    ExpeditionPlace: expeditionPlace,
    Receiver: {
      Rfc: receiver.rfc,
      Name: receiver.name,
      FiscalRegime: receiver.fiscalRegime,
      CfdiUse: receiver.cfdiUse,
      TaxZipCode: receiver.zipCode,
      Email: receiver.email,
    },
    Items: items,
  };

  // GlobalInformation solo aplica al XAXX (público general nacional).
  // Para XEXX el SAT no la requiere/permite.
  if (receiver.isPublicoGeneral) {
    cfdi.GlobalInformation = {
      Periodicity: '04',
      Months: currentMonth,
      Year: currentYear,
    };
  }

  return cfdi;
};

const getOrderContext = async ({ ordenId, folio }) => {
  const supabase = getSupabaseAdmin();

  let query = supabase
    .from('ordenes')
    .select('id, folio, cliente_id, cliente_nombre, productos, total, metodo_pago, estatus, vendedor_id, ruta_id, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at');

  query = ordenId ? query.eq('id', ordenId) : query.eq('folio', folio);

  const { data: orden, error: ordenError } = await query.single();
  if (ordenError || !orden) throw new Error('Orden no encontrada');

  // 🔴-6 Tanda 4: CP del emisor se lee de configuracion_empresa (id=1
  // singleton, mig 044) en lugar del hardcoded ISSUER_ZIP_CODE.
  const [
    { data: cliente },
    { data: lineas, error: lineasError },
    { data: configEmpresa },
  ] = await Promise.all([
    orden.cliente_id
      ? supabase.from('clientes').select('id, nombre, rfc, regimen, uso_cfdi, cp, correo').eq('id', orden.cliente_id).single()
      : Promise.resolve({ data: null }),
    supabase.from('orden_lineas').select('sku, cantidad, precio_unit, subtotal').eq('orden_id', orden.id),
    supabase.from('configuracion_empresa').select('codigo_postal').eq('id', 1).maybeSingle(),
  ]);

  if (lineasError) throw lineasError;
  if (!lineas || lineas.length === 0) throw new Error('La orden no tiene líneas para facturar');

  // Enrich lines con nombre + clave_prod_serv + clave_unidad del producto.
  // 🔴-7 Tanda 4: backend lee del catálogo en lugar de PRODUCT_CATALOG hardcoded.
  const skus = [...new Set(lineas.map((l) => l.sku).filter(Boolean))];
  if (skus.length > 0) {
    const { data: productos } = await supabase
      .from('productos')
      .select('sku, nombre, clave_prod_serv, clave_unidad')
      .in('sku', skus);
    const skuMap = Object.fromEntries((productos || []).map((p) => [p.sku, p]));
    for (const linea of lineas) {
      const prod = skuMap[linea.sku];
      linea.nombre_producto = prod?.nombre || linea.sku;
      linea.clave_prod_serv = prod?.clave_prod_serv || null;
      linea.clave_unidad = prod?.clave_unidad || null;
    }
  }

  const issuerZip = configEmpresa?.codigo_postal || FALLBACK_ISSUER_ZIP;

  return { orden, cliente, lineas, issuerZip };
};

const createFacturamaInvoice = async (payload) => {
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
    // 🟡 I1 Tanda 4: traducir errores de Facturama a mensaje legible
    // antes de lanzar. El detail crudo (JSON ModelState) se conserva
    // en el log de invoice_attempts.response_payload para diagnóstico.
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

    if (!ROLES_PERMITIDOS.has(auth.profile.rol)) {
      return badRequest('Tu rol no puede timbrar facturas');
    }

    body = await readJsonBody(event);
    const { ordenId, folio, facturamaPayload } = body;

    if (!ordenId && !folio) {
      return badRequest('ordenId or folio is required');
    }

    const { orden, cliente, lineas, issuerZip } = await getOrderContext({ ordenId, folio });

    // 🔴-Tanda5 idempotency: si la orden ya tiene CFDI vigente (UUID
    // poblado y NO cancelado), evitamos un re-stamp accidental que
    // generaría un segundo CFDI duplicado en SAT.
    if (orden.facturama_uuid && !orden.cfdi_cancelado_at) {
      return ok({
        alreadyInvoiced: true,
        ordenId: orden.id,
        folio: orden.folio,
        facturamaUuid: orden.facturama_uuid,
        facturamaFolio: orden.facturama_folio,
      });
    }

    let payload = facturamaPayload || buildFacturamaPayload({ orden, cliente, lineas, issuerZip });

    let invoice;
    try {
      invoice = await createFacturamaInvoice(payload);
    } catch (firstErr) {
      // If RFC was rejected, retry as público general
      const isRfcError = firstErr.message && firstErr.message.includes('RFC');
      if (isRfcError && payload.Receiver?.Rfc !== 'XAXX010101000') {
        payload = buildFacturamaPayload({ orden, cliente: null, lineas, issuerZip });
        invoice = await createFacturamaInvoice(payload);
      } else {
        throw firstErr;
      }
    }

    await insertInvoiceAttempt({
      orden_id: orden.id,
      provider: 'facturama',
      provider_reference: invoice.Id || invoice.Folio || String(orden.id),
      status: 'success',
      request_payload: payload,
      response_payload: invoice,
    });

    // Save Facturama reference in the order and mark as Facturada.
    // Si la orden venía de un CFDI cancelado (re-timbrado), limpiamos
    // las anotaciones de cancelación para que el nuevo timbre sea el
    // CFDI vigente (idempotency lock).
    const supabase = getSupabaseAdmin();
    await supabase
      .from('ordenes')
      .update({
        estatus: 'Facturada',
        facturama_id: invoice.Id || null,
        facturama_folio: invoice.Folio || null,
        facturama_uuid: invoice.Uuid || invoice.uuid || null,
        cfdi_cancelado_at: null,
        cfdi_cancelado_motivo: null,
        cfdi_cancelado_motivo_detalle: null,
        cfdi_cancelado_uuid_sustituto: null,
        cfdi_cancelado_por: null,
      })
      .eq('id', orden.id);

    return ok({ invoice });
  } catch (error) {
    if (body?.ordenId || body?.folio) {
      try {
        await insertInvoiceAttempt({
          orden_id: body.ordenId || null,
          provider: 'facturama',
          provider_reference: body.folio || null,
          status: 'error',
          request_payload: body.facturamaPayload || {},
          response_payload: {
            message: error.message,
            // 🟡 I1: preservamos el ModelState crudo para diagnóstico
            // posterior. El usuario solo ve error.message (traducido).
            facturamaDetail: error.facturamaDetail,
            facturamaRaw: error.facturamaRaw,
          },
        });
      } catch {}
    }
    return serverError(error.message || 'Could not create invoice', error.message);
  }
};