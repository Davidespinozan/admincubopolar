import { badRequest, methodNotAllowed, ok, readJsonBody, serverError } from '../_lib/http.js';
import { insertInvoiceAttempt } from '../_lib/persistence.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

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

// Map SKU to Facturama product catalog
const PRODUCT_CATALOG = {
  'HC-5K':  { code: '50202302', name: 'BOLSA CUBO POLAR 5KG' },
  'HC-25K': { code: '50202302', name: 'BOLSA CUBO POLAR 25KG' },
  'HT-25K': { code: '50202302', name: 'BOLSA CUBO POLAR 25KG' },
  'BH-50K': { code: '50202302', name: 'BARRA DE HIELO 50KG' },
};

const ISSUER_ZIP_CODE = '34186';

// Map human-readable regime to SAT code
const REGIME_CODE_MAP = {
  'Régimen General': '601',
  'General de Ley Personas Morales': '601',
  'Personas Físicas con Actividades Empresariales': '612',
  'Régimen Simplificado de Confianza': '626',
  'Sueldos y Salarios': '605',
  'Incorporación Fiscal': '621',
};

// Known generic/test RFCs that should be treated as público general
const GENERIC_RFCS = new Set(['XAXX010101000', 'XEXX010101000']);

const isValidRfc = (rfc) => {
  if (!rfc) return false;
  const upper = rfc.toUpperCase().trim();
  if (GENERIC_RFCS.has(upper)) return false;
  // Basic format check: 3-4 letters + 6 digits + 3 alphanumeric
  return /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(upper);
};

const buildFacturamaPayload = ({ orden, cliente, lineas }) => {
  const metodoPago = orden.metodo_pago || 'Efectivo';
  const paymentForm = PAYMENT_FORM_MAP[metodoPago] || '99';
  const paymentMethod = PAYMENT_METHOD_MAP[metodoPago] || 'PUE';

  // If client has valid RFC, use their data; otherwise default to publico general
  const hasValidRfc = cliente?.rfc && isValidRfc(cliente.rfc);
  const receiverRfc = hasValidRfc ? cliente.rfc.toUpperCase() : 'XAXX010101000';
  const receiverName = hasValidRfc ? (cliente.nombre || orden.cliente_nombre) : 'PUBLICO EN GENERAL';
  const rawRegime = cliente?.regimen || '';
  const receiverFiscalRegime = REGIME_CODE_MAP[rawRegime] || (/^\d{3}$/.test(rawRegime) ? rawRegime : '616');
  const receiverCfdiUse = hasValidRfc ? (cliente?.uso_cfdi || 'G03') : 'S01';
  const receiverZipCode = cliente?.cp || ISSUER_ZIP_CODE;
  const expeditionPlace = ISSUER_ZIP_CODE;

  const items = (lineas || []).map((linea) => {
    const unitPrice = Number(linea.precio_unit || 0);
    const quantity = Number(linea.cantidad || 0);
    const subtotal = Number(linea.subtotal || unitPrice * quantity);
    // Prices in DB are already before tax (precio_unit * qty = subtotal, orden.total = subtotal * 1.16)
    const taxAmount = Number((subtotal * 0.16).toFixed(2));

    const catalog = PRODUCT_CATALOG[linea.sku] || {};
    return {
      ProductCode: catalog.code || '50202302',
      IdentificationNumber: linea.sku,
      Description: linea.nombre_producto || catalog.name || linea.sku,
      Unit: 'Pieza',
      UnitCode: 'H87',
      UnitPrice: unitPrice,
      Quantity: quantity,
      Subtotal: subtotal,
      TaxObject: '02',
      Taxes: [
        {
          Name: 'IVA',
          Rate: 0.16,
          Total: taxAmount,
          Base: subtotal,
          IsRetention: false,
        },
      ],
      Total: Number((subtotal + taxAmount).toFixed(2)),
    };
  });

  const isPublicoGeneral = receiverRfc === 'XAXX010101000';
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
      Rfc: receiverRfc,
      Name: receiverName,
      FiscalRegime: receiverFiscalRegime,
      CfdiUse: receiverCfdiUse,
      TaxZipCode: receiverZipCode,
      Email: cliente?.correo || undefined,
    },
    Items: items,
  };

  if (isPublicoGeneral) {
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
    .select('id, folio, cliente_id, cliente_nombre, productos, total, metodo_pago, estatus, vendedor_id, ruta_id');

  query = ordenId ? query.eq('id', ordenId) : query.eq('folio', folio);

  const { data: orden, error: ordenError } = await query.single();
  if (ordenError || !orden) throw new Error('Orden no encontrada');

  const [{ data: cliente }, { data: lineas, error: lineasError }] = await Promise.all([
    orden.cliente_id
      ? supabase.from('clientes').select('id, nombre, rfc, regimen, uso_cfdi, cp, correo').eq('id', orden.cliente_id).single()
      : Promise.resolve({ data: null }),
    supabase.from('orden_lineas').select('sku, cantidad, precio_unit, subtotal').eq('orden_id', orden.id),
  ]);

  if (lineasError) throw lineasError;
  if (!lineas || lineas.length === 0) throw new Error('La orden no tiene líneas para facturar');

  // Enrich lines with product names from the productos table
  const skus = [...new Set(lineas.map((l) => l.sku).filter(Boolean))];
  if (skus.length > 0) {
    const { data: productos } = await supabase
      .from('productos')
      .select('sku, nombre')
      .in('sku', skus);
    const skuNameMap = Object.fromEntries((productos || []).map((p) => [p.sku, p.nombre]));
    for (const linea of lineas) {
      linea.nombre_producto = skuNameMap[linea.sku] || linea.sku;
    }
  }

  return { orden, cliente, lineas };
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
    const message = raw?.Message || raw?.message || `Facturama HTTP ${response.status}`;
    const detail = JSON.stringify(raw?.ModelState || raw);
    throw new Error(`${message} | ${detail}`);
  }

  return raw;
};

export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  let body = null;

  try {
    body = await readJsonBody(event);
    const { ordenId, folio, facturamaPayload } = body;

    if (!ordenId && !folio) {
      return badRequest('ordenId or folio is required');
    }

    const { orden, cliente, lineas } = await getOrderContext({ ordenId, folio });
    let payload = facturamaPayload || buildFacturamaPayload({ orden, cliente, lineas });

    let invoice;
    try {
      invoice = await createFacturamaInvoice(payload);
    } catch (firstErr) {
      // If RFC was rejected, retry as público general
      const isRfcError = firstErr.message && firstErr.message.includes('RFC');
      if (isRfcError && payload.Receiver?.Rfc !== 'XAXX010101000') {
        payload = buildFacturamaPayload({ orden, cliente: null, lineas });
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

    // Save Facturama reference in the order and mark as Facturada
    const supabase = getSupabaseAdmin();
    await supabase
      .from('ordenes')
      .update({
        estatus: 'Facturada',
        facturama_id: invoice.Id || null,
        facturama_folio: invoice.Folio || null,
        facturama_uuid: invoice.Uuid || invoice.uuid || null,
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
          response_payload: { message: error.message },
        });
      } catch {}
    }
    return serverError(error.message || 'Could not create invoice', error.message);
  }
};