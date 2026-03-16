import { getSupabaseAdmin } from '../_lib/supabaseAdmin.js';

export const handler = async (event) => {
  const ordenId = event.queryStringParameters?.o;
  if (!ordenId || !/^\d+$/.test(ordenId)) {
    return { statusCode: 400, body: 'Enlace inválido' };
  }

  const supabase = getSupabaseAdmin();
  const { data } = await supabase
    .from('payment_intents')
    .select('checkout_url')
    .eq('orden_id', Number(ordenId))
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!data?.checkout_url) {
    return {
      statusCode: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
      body: '<html><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0"><div style="text-align:center"><h2>Link de pago no encontrado</h2><p>Este enlace ya no es válido o la orden ya fue pagada.</p></div></body></html>',
    };
  }

  return {
    statusCode: 302,
    headers: { Location: data.checkout_url },
  };
};
