// notaHtml.js — render de la nota de venta pública (Tanda 28).
// Builder puro y testeable: recibe datos ya consultados y devuelve la
// página HTML completa (self-contained, imprimible, mobile-first).
// La consulta y la verificación del token viven en functions/recibo.

const esc = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const money = (v) =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(Number(v) || 0);

const fecha = (v) => {
  if (!v) return '';
  const d = new Date(String(v).length === 10 ? `${v}T12:00:00` : v);
  return Number.isNaN(d.getTime())
    ? String(v)
    : d.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' });
};

/**
 * @param {object} p
 * @param {object} p.empresa fila de configuracion_empresa (snake_case)
 * @param {object} p.orden fila de ordenes (snake_case)
 * @param {Array<object>} p.lineas filas de orden_lineas
 * @param {object|null} p.cliente fila de clientes
 * @param {string} p.letras importe en letras ya calculado
 * @returns {string} documento HTML completo
 */
export function buildNotaHtml({ empresa, orden, lineas, cliente, letras }) {
  const emp = empresa || {};
  const o = orden || {};
  const filas = (lineas || []).map(l => `
        <tr>
          <td class="num">${esc(l.cantidad)}</td>
          <td>${esc(l.sku)}</td>
          <td class="num">${esc(money(l.precio_unit))}</td>
          <td class="num">${esc(money(l.subtotal))}</td>
        </tr>`).join('');

  const pagada = ['Entregada', 'Facturada'].includes(String(o.estatus || ''));

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Nota ${esc(o.folio || o.id)} — ${esc(emp.razon_social || 'CuboPolar')}</title>
<style>
  * { box-sizing: border-box; margin: 0; }
  body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; background: #eef4f6; color: #16232c; padding: 16px; }
  .nota { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #d9e2e6; border-radius: 16px; padding: 24px; }
  header { display: flex; justify-content: space-between; gap: 12px; border-bottom: 2px solid #16232c; padding-bottom: 14px; margin-bottom: 14px; flex-wrap: wrap; }
  h1 { font-size: 18px; }
  .fiscal { font-size: 12px; color: #5a6b7a; margin-top: 2px; }
  .folio { text-align: right; }
  .folio strong { font-size: 16px; }
  .meta { display: flex; justify-content: space-between; gap: 12px; flex-wrap: wrap; font-size: 13px; margin-bottom: 14px; }
  .meta p + p { margin-top: 2px; }
  .etiqueta { font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5a6b7a; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-bottom: 14px; }
  th { text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .06em; color: #5a6b7a; border-bottom: 1px solid #d9e2e6; padding: 6px 8px; }
  td { padding: 8px; border-bottom: 1px solid #eef2f4; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  th.num { text-align: right; }
  .total { display: flex; justify-content: flex-end; align-items: baseline; gap: 10px; font-size: 15px; }
  .total strong { font-size: 22px; }
  .letras { font-size: 12px; color: #5a6b7a; text-align: right; margin-top: 4px; }
  .estado { display: inline-block; margin-top: 12px; padding: 4px 12px; border-radius: 999px; font-size: 12px; font-weight: 700; }
  .estado.pagada { background: #e2f6ec; color: #1d7a4c; }
  .estado.pendiente { background: #fdf1e0; color: #a05a17; }
  footer { margin-top: 18px; border-top: 1px solid #d9e2e6; padding-top: 10px; font-size: 11px; color: #5a6b7a; }
  @media print { body { background: #fff; padding: 0; } .nota { border: none; } }
</style>
</head>
<body>
  <div class="nota">
    <header>
      <div>
        <h1>${esc(emp.razon_social || 'Cubo Polar')}</h1>
        <p class="fiscal">RFC ${esc(emp.rfc || '')}${emp.telefono ? ` · Tel. ${esc(emp.telefono)}` : ''}</p>
        ${emp.direccion_fiscal ? `<p class="fiscal">${esc(emp.direccion_fiscal)}</p>` : ''}
      </div>
      <div class="folio">
        <p class="etiqueta">Nota de venta</p>
        <strong>${esc(o.folio || `#${o.id}`)}</strong>
        ${o.folio_nota ? `<p class="fiscal">Nota física: ${esc(o.folio_nota)}</p>` : ''}
      </div>
    </header>
    <div class="meta">
      <div>
        <p class="etiqueta">Cliente</p>
        <p><strong>${esc(cliente?.nombre || o.cliente_nombre || 'Público en general')}</strong></p>
      </div>
      <div>
        <p class="etiqueta">Fecha</p>
        <p>${esc(fecha(o.fecha || o.created_at))}</p>
        ${o.metodo_pago ? `<p class="fiscal">Pago: ${esc(o.metodo_pago)}</p>` : ''}
      </div>
    </div>
    <table>
      <thead><tr><th class="num">Cant.</th><th>Producto</th><th class="num">P. unit.</th><th class="num">Importe</th></tr></thead>
      <tbody>${filas || '<tr><td colspan="4">Sin partidas</td></tr>'}</tbody>
    </table>
    <div class="total"><span>Total</span><strong>${esc(money(o.total))}</strong></div>
    <p class="letras">${esc(letras || '')}</p>
    <span class="estado ${pagada ? 'pagada' : 'pendiente'}">${pagada ? '✓ Entregada' : String(o.estatus || 'Pendiente')}</span>
    <footer>Documento informativo — no es comprobante fiscal (CFDI). Generado por CuboPolar ERP.</footer>
  </div>
</body>
</html>`;
}
