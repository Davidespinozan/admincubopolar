import { badRequest, json, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { getAuthenticatedProfile } from '../_lib/auth.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';
import { buildCfdiReceiver } from '../_lib/invoiceLogic.js';
import { translateFacturamaError } from '../_lib/translateFacturama.js';
import { withSentry } from '../_lib/sentry.js';
import {
  autorizarOrdenFacturacion, precondicionTimbrado, rolPuedeFacturar, updateCondicionalOk, validarCuerpoTimbrado,
} from '../_lib/facturacionGuard.js';

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

// OL-03A: la orden se lee primero (autorización y precondiciones) y su
// contexto fiscal (cliente, líneas, configuración) solo si puede timbrarse.
const getOrden = async ({ supabase, ordenId, folio }) => {
  let query = supabase
    .from('ordenes')
    .select('id, folio, cliente_id, cliente_nombre, productos, total, metodo_pago, estatus, vendedor_id, ruta_id, facturama_id, facturama_uuid, facturama_folio, cfdi_cancelado_at');

  query = ordenId ? query.eq('id', ordenId) : query.eq('folio', folio);

  const { data: orden, error: ordenError } = await query.single();
  if (ordenError || !orden) return null;
  return orden;
};

const getOrderContext = async ({ supabase, orden }) => {
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

const createFacturamaInvoice = async (payload, { fetchImpl, getConfig }) => {
  const config = getConfig();
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

  const response = await fetchImpl(`${config.baseUrl}/3/cfdis`, {
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

// OL-03A — orden de las comprobaciones. TODO lo siguiente ocurre ANTES de
// contactar al proveedor; un rechazo no llama a Facturama ni escribe la orden:
//   1. autenticación (JWT + perfil activo, identidad canónica);
//   2. rol (Admin, Facturación, Ventas);
//   3. cuerpo: sin CFDI armado por el cliente; ordenId o folio;
//   4. la orden existe;
//   5. dueño: Ventas solo su orden (vendedor_id); Admin/Facturación, toda la empresa;
//   6. CFDI vigente → respuesta idempotente existente (alreadyInvoiced), sin proveedor;
//   7. estatus = 'Entregada' (cumplimiento físico; el pago no se exige: crédito = PPD);
//   8. contexto fiscal derivado por el servidor (líneas, cliente, catálogo, CP).
// Tras el timbrado: UPDATE condicional Entregada → Facturada, verificado. Si la
// orden cambió mientras se timbraba, NO se declara éxito (el CFDI queda en
// invoice_attempts con su UUID para revisión; no se cancela automáticamente).
export const createHandler = ({
  getSupabase = getSupabaseAdmin,
  fetchImpl = (...args) => fetch(...args),
  getConfig = getFacturamaConfig,
} = {}) => async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;
  let supabase = null;
  let ordenRef = null;

  // P0.1 se conserva: sin configuración del servidor → 503 explícito (falla cerrada).
  try {
    supabase = getSupabase();
  } catch (configErr) {
    console.error('[billing-create-invoice] configuración ausente:', configErr?.message);
    return json(503, { error: 'Autenticación no configurada en el servidor (faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)', code: 'AUTH_NOT_CONFIGURED' });
  }

  try {
    const auth = await getAuthenticatedProfile(event, { supabase });
    if (auth.errorResponse) return auth.errorResponse;

    if (!rolPuedeFacturar(auth.profile)) {
      return badRequest('Tu rol no puede timbrar facturas');
    }

    body = await readJsonBody(event);
    const cuerpo = validarCuerpoTimbrado(body);
    if (!cuerpo.ok) return json(cuerpo.status, { error: cuerpo.error, code: cuerpo.code });

    const orden = await getOrden({ supabase, ordenId: cuerpo.ordenId, folio: cuerpo.folio });
    if (!orden) return badRequest('Orden no encontrada');

    const permiso = autorizarOrdenFacturacion(auth.profile, orden);
    if (!permiso.ok) return json(permiso.status, { error: permiso.error, code: permiso.code });
    ordenRef = orden;

    const pre = precondicionTimbrado(orden);
    if (!pre.ok) return json(pre.status, { error: pre.error, code: pre.code });

    // 🔴-Tanda5 idempotency: si la orden ya tiene CFDI vigente (UUID
    // poblado y NO cancelado), evitamos un re-stamp accidental que
    // generaría un segundo CFDI duplicado en SAT.
    if (pre.accion === 'ya_timbrada') {
      return ok({
        alreadyInvoiced: true,
        ordenId: orden.id,
        folio: orden.folio,
        facturamaUuid: orden.facturama_uuid,
        facturamaFolio: orden.facturama_folio,
      });
    }

    const { cliente, lineas, issuerZip } = await getOrderContext({ supabase, orden });
    const proveedor = { fetchImpl, getConfig };

    let payload = buildFacturamaPayload({ orden, cliente, lineas, issuerZip });

    let invoice;
    try {
      invoice = await createFacturamaInvoice(payload, proveedor);
    } catch (firstErr) {
      // If RFC was rejected, retry as público general
      const isRfcError = firstErr.message && firstErr.message.includes('RFC');
      if (isRfcError && payload.Receiver?.Rfc !== 'XAXX010101000') {
        payload = buildFacturamaPayload({ orden, cliente: null, lineas, issuerZip });
        invoice = await createFacturamaInvoice(payload, proveedor);
      } else {
        throw firstErr;
      }
    }

    // OL-03A: la orden se marca Facturada SOLO si sigue Entregada (el estado
    // que se validó antes del proveedor). Primero la
    // orden (es el candado de idempotencia: un reintento ve el CFDI vigente),
    // después la bitácora. Si la re-facturación viene de un CFDI cancelado se
    // limpian sus anotaciones para que el nuevo timbre sea el vigente.
    const upd = await supabase
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
      .eq('id', orden.id)
      .eq('estatus', 'Entregada')
      .select('id');
    const actualizada = updateCondicionalOk(upd, orden.id);

    try {
      await insertInvoiceAttempt({
        orden_id: orden.id,
        provider: 'facturama',
        provider_reference: invoice.Id || invoice.Folio || String(orden.id),
        status: actualizada ? 'success' : 'review:orden_no_actualizada',
        request_payload: payload,
        response_payload: invoice,
      }, supabase);
    } catch (logErr) {
      console.error('[billing-create-invoice] bitácora falló:', logErr?.message || logErr);
    }

    if (!actualizada) {
      const uuid = invoice.Uuid || invoice.uuid || invoice.Id || null;
      return json(409, {
        error: `CFDI timbrado (${uuid}) pero la orden ${orden.folio} cambió de estado mientras se timbraba; no se marcó Facturada. Revísalo en Facturación antes de reintentar.`,
        code: 'ORDEN_CAMBIO_TRAS_TIMBRAR',
        facturamaUuid: uuid,
        details: upd?.error?.message || null,
      });
    }

    return ok({ invoice });
  } catch (error) {
    if (ordenRef && supabase) {
      try {
        await insertInvoiceAttempt({
          orden_id: ordenRef.id,
          provider: 'facturama',
          provider_reference: ordenRef.folio || null,
          status: 'error',
          request_payload: { ordenId: body?.ordenId || null, folio: body?.folio || null },
          response_payload: {
            message: error.message,
            // 🟡 I1: preservamos el ModelState crudo para diagnóstico
            // posterior. El usuario solo ve error.message (traducido).
            facturamaDetail: error.facturamaDetail,
            facturamaRaw: error.facturamaRaw,
          },
        }, supabase);
      } catch {}
    }
    return serverError(error.message || 'Could not create invoice', error.message);
  }
};

export const handler = withSentry(createHandler());
