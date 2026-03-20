import { methodNotAllowed, ok, readJsonBody, serverError, badRequest } from '../_lib/http.js';
import { canAccessOrden, getAuthenticatedProfile } from '../_lib/auth.js';
import { getFacturamaConfig } from '../_lib/providers.js';
import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

/**
 * When an order is paid in the ERP, update the payment status in Facturama
 * so both systems stay in sync.
 */
export const handler = async (event) => {
  if (event.httpMethod !== 'POST') return methodNotAllowed(['POST']);

  try {
    const auth = await getAuthenticatedProfile(event);
    if (auth.errorResponse) return auth.errorResponse;

    const { ordenId } = await readJsonBody(event);
    if (!ordenId) return badRequest('ordenId is required');

    const supabase = getSupabaseAdmin();
    const { data: orden, error: ordenErr } = await supabase
      .from('ordenes')
      .select('id, facturama_id, estatus, total, vendedor_id, ruta_id')
      .eq('id', ordenId)
      .single();

    if (ordenErr || !orden) return badRequest('Orden no encontrada');
    if (!(await canAccessOrden({ profile: auth.profile, orden, supabase }))) {
      return badRequest('No tienes permiso para sincronizar esta orden');
    }
    if (!orden.facturama_id) return ok({ synced: false, reason: 'No Facturama invoice linked' });

    // Update payment status in Facturama
    const config = getFacturamaConfig();
    const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');

    const response = await fetch(
      `${config.baseUrl}/api/Cfdi/SetPaymentStatus/${orden.facturama_id}/paid`,
      {
        method: 'PUT',
        headers: {
          authorization: `Basic ${credentials}`,
          'content-type': 'application/json',
        },
      }
    );

    if (!response.ok) {
      const raw = await response.json().catch(() => ({}));
      return ok({
        synced: false,
        reason: raw?.Message || `Facturama HTTP ${response.status}`,
      });
    }

    return ok({ synced: true });
  } catch (error) {
    return serverError('Error syncing payment', error.message);
  }
};
