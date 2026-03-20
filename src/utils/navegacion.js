// navegacion.js — genera el link correcto para abrir la app nativa de Maps
// iOS: abre Google Maps app si está instalada, Apple Maps como fallback
// Android: abre Google Maps app directamente
// Web: fallback a Google Maps en navegador

/**
 * Genera la URL de navegación más apropiada para el dispositivo.
 * @param {number} lat
 * @param {number} lng
 * @returns {string}
 */
export function navUrl(lat, lng) {
  const dest = `${lat},${lng}`;
  const ua = navigator.userAgent || '';

  if (/iPad|iPhone|iPod/.test(ua)) {
    // iOS — intenta abrir Google Maps app, si no está usa Apple Maps
    return `comgooglemaps://?daddr=${dest}&directionsmode=driving`;
  }

  if (/Android/.test(ua)) {
    // Android — abre Google Maps app directamente (siempre instalada)
    return `google.navigation:q=${dest}&mode=d`;
  }

  // Desktop / otros — Google Maps web
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=driving`;
}

/**
 * En iOS, si Google Maps no está instalada, navUrl falla silenciosamente.
 * Este fallback abre Apple Maps como respaldo.
 */
export function navUrlFallback(lat, lng) {
  return `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`;
}

/**
 * Abre navegación manejando el fallback de iOS automáticamente.
 * En iOS: intenta Google Maps, después de 500ms si no abrió → Apple Maps
 */
export function abrirNavegacion(lat, lng) {
  const ua = navigator.userAgent || '';

  if (/iPad|iPhone|iPod/.test(ua)) {
    // Intentar abrir Google Maps app
    window.location.href = navUrl(lat, lng);
    // Si no se abrió en 500ms (app no instalada), usar Apple Maps
    setTimeout(() => {
      window.location.href = navUrlFallback(lat, lng);
    }, 500);
    return;
  }

  window.location.href = navUrl(lat, lng);
}
