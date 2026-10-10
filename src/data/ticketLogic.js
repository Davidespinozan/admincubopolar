// ticketLogic.js — lógica pura del Chofer para (1) el ticket de la entrega que
// se manda al cliente y (2) el mapa de la parada DENTRO de la app.
// El ticket es la nota pública firmada (netlify/functions/recibo): aquí solo se
// arma el mensaje y el enlace de WhatsApp.

const texto = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();
const pesos = (x) => `$${(Number(x) || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Mensaje que acompaña al link del ticket. */
export function mensajeTicket({ empresa, cliente, folio, total, pago, url } = {}) {
  const quien = texto(empresa) || 'Cubo Polar';
  const saludo = texto(cliente) ? `Hola ${texto(cliente)}, ` : 'Hola, ';
  const detalle = [texto(folio) && `folio ${texto(folio)}`, Number(total) > 0 && pesos(total), texto(pago)].filter(Boolean).join(' · ');
  return `${saludo}gracias por tu compra en ${quien}.${detalle ? ` Tu ticket (${detalle}):` : ' Tu ticket:'}\n${texto(url)}`;
}

/** Enlace de WhatsApp: al teléfono del cliente (10 dígitos, México) o para elegir contacto. */
export function enlaceWhatsApp(telefono, mensaje) {
  const tel = String(telefono ?? '').replace(/\D/g, '').slice(-10);
  const q = `?text=${encodeURIComponent(String(mensaje ?? ''))}`;
  return tel.length === 10 ? `https://wa.me/52${tel}${q}` : `https://wa.me/${q}`;
}

const coordenada = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
/** ¿La parada tiene coordenadas utilizables? */
export function tieneCoordenadas(parada) {
  const lat = coordenada(parada?.latitud);
  const lng = coordenada(parada?.longitud);
  return Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
}

/**
 * URL del mapa embebido de una parada (se muestra dentro de la app, sin salir):
 * por coordenadas si las hay; si no, por la dirección escrita. null si no hay nada.
 */
export function urlMapaParada(parada) {
  const destino = tieneCoordenadas(parada) ? `${Number(parada.latitud)},${Number(parada.longitud)}` : texto(parada?.direccion);
  if (!destino) return null;
  return `https://maps.google.com/maps?q=${encodeURIComponent(destino)}&z=16&output=embed`;
}

/** Enlace para abrir la navegación paso a paso en la app de mapas (eso sí sale de la app). */
export function urlNavegacionParada(parada) {
  const destino = tieneCoordenadas(parada) ? `${Number(parada.latitud)},${Number(parada.longitud)}` : texto(parada?.direccion);
  return destino ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destino)}` : null;
}
