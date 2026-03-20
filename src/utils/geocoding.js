/**
 * Geocoding con Nominatim (OpenStreetMap) — gratis, sin API key.
 * Límite: 1 req/seg. Más que suficiente para guardar clientes.
 */

/**
 * Convierte una dirección a coordenadas lat/lng usando Nominatim.
 * @param {string} direccion - "Calle 1 #123, Colonia Centro, Durango"
 * @returns {Promise<{lat: number, lng: number, formatted: string} | null>}
 */
export async function geocodeDireccion(direccion) {
  if (!direccion?.trim()) return null;

  try {
    const url = new URL('https://nominatim.openstreetmap.org/search');
    url.searchParams.set('q', direccion);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '1');
    url.searchParams.set('countrycodes', 'mx');

    const res = await fetch(url.toString(), {
      headers: { 'Accept-Language': 'es', 'User-Agent': 'CuboPolarERP/1.0' },
      signal: AbortSignal.timeout(6000),
    });
    const data = await res.json();

    if (data.length > 0) {
      return {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        formatted: data[0].display_name,
      };
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Construir dirección completa para geocoding
 */
export function buildDireccion(cliente) {
  const partes = [
    cliente.calle,
    cliente.colonia,
    cliente.ciudad || 'Hermosillo',
    cliente.estado || 'Sonora',
    cliente.codigo_postal || cliente.cp,
  ].filter(Boolean);
  return partes.join(', ');
}

/**
 * Generar link de Google Maps para navegación
 * @param {number} lat - Latitud
 * @param {number} lng - Longitud
 * @param {string} label - Nombre del lugar (opcional)
 * @returns {string} URL de Google Maps
 */
export function googleMapsLink(lat, lng, label = '') {
  if (lat && lng) {
    // Link directo a navegación
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  }
  // Fallback: búsqueda por nombre
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`;
}

/**
 * Generar link de Google Maps para múltiples paradas (ruta completa)
 * @param {Array<{lat: number, lng: number}>} paradas - Lista de coordenadas
 * @returns {string} URL de Google Maps con waypoints
 */
export function googleMapsRutaLink(paradas) {
  if (!paradas || paradas.length === 0) return '';
  
  // La primera es origen, la última destino, el resto waypoints
  const origin = paradas[0];
  const destination = paradas[paradas.length - 1];
  
  let url = `https://www.google.com/maps/dir/?api=1`;
  url += `&origin=${origin.lat},${origin.lng}`;
  url += `&destination=${destination.lat},${destination.lng}`;
  
  if (paradas.length > 2) {
    const waypoints = paradas.slice(1, -1)
      .map(p => `${p.lat},${p.lng}`)
      .join('|');
    url += `&waypoints=${encodeURIComponent(waypoints)}`;
  }
  
  url += '&travelmode=driving';
  return url;
}

/**
 * Calcular distancia en km entre dos puntos (fórmula Haversine)
 * @param {number} lat1 
 * @param {number} lng1 
 * @param {number} lat2 
 * @param {number} lng2 
 * @returns {number} Distancia en km
 */
export function distanciaKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Radio de la Tierra en km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Agrupar clientes por zona basado en proximidad
 * @param {Array} clientes - Lista de clientes con lat/lng
 * @param {number} radioKm - Radio máximo para considerar "cercanos" (default 3km)
 * @returns {Object} Mapa de zonas con clientes
 */
export function agruparPorProximidad(clientes, radioKm = 3) {
  const clientesConCoords = clientes.filter(c => c.latitud && c.longitud);
  const grupos = {};
  const asignados = new Set();

  for (const cliente of clientesConCoords) {
    if (asignados.has(cliente.id)) continue;
    
    // Usar zona existente o crear nueva basada en colonia
    const zona = cliente.zona || cliente.colonia || `Zona ${Object.keys(grupos).length + 1}`;
    
    if (!grupos[zona]) grupos[zona] = [];
    grupos[zona].push(cliente);
    asignados.add(cliente.id);

    // Buscar clientes cercanos sin zona
    for (const otro of clientesConCoords) {
      if (asignados.has(otro.id)) continue;
      const dist = distanciaKm(cliente.latitud, cliente.longitud, otro.latitud, otro.longitud);
      if (dist <= radioKm) {
        grupos[zona].push(otro);
        asignados.add(otro.id);
      }
    }
  }

  return grupos;
}

/**
 * Sugerir orden óptimo de visitas (greedy nearest neighbor)
 * @param {Array} clientes - Lista con lat/lng
 * @param {Object} origen - {lat, lng} punto de partida (fábrica)
 * @returns {Array} Clientes ordenados por proximidad secuencial
 */
export function ordenarPorProximidad(clientes, origen = { lat: 29.0892, lng: -110.9611 }) {
  const clientesConCoords = clientes.filter(c => c.latitud && c.longitud);
  if (clientesConCoords.length === 0) return clientes; // Sin cambios si no hay coords

  const ordenados = [];
  const pendientes = [...clientesConCoords];
  let actual = origen;

  while (pendientes.length > 0) {
    // Encontrar el más cercano
    let minDist = Infinity;
    let minIdx = 0;
    
    for (let i = 0; i < pendientes.length; i++) {
      const dist = distanciaKm(actual.lat, actual.lng, pendientes[i].latitud, pendientes[i].longitud);
      if (dist < minDist) {
        minDist = dist;
        minIdx = i;
      }
    }
    
    const siguiente = pendientes.splice(minIdx, 1)[0];
    ordenados.push(siguiente);
    actual = { lat: siguiente.latitud, lng: siguiente.longitud };
  }

  // Agregar clientes sin coordenadas al final
  const sinCoords = clientes.filter(c => !c.latitud || !c.longitud);
  return [...ordenados, ...sinCoords];
}

/**
 * Definir zonas predeterminadas para Hermosillo
 */
export const ZONAS_HERMOSILLO = [
  'Centro',
  'Norte',
  'Sur', 
  'Oriente',
  'Poniente',
  'Industrial',
  'Periférico Norte',
  'Periférico Sur',
];

/**
 * Sugerir zona basada en colonia conocida (mapeo manual para Hermosillo)
 * Se puede expandir con más colonias
 */
const COLONIAS_ZONA = {
  // Centro
  'centro': 'Centro',
  'centenario': 'Centro',
  'pitic': 'Centro',
  // Norte
  'las granjas': 'Norte',
  'country club': 'Norte',
  'villa de seris': 'Norte',
  // Sur
  'villa verde': 'Sur',
  'real del arco': 'Sur',
  'los naranjos': 'Sur',
  // Industrial
  'parque industrial': 'Industrial',
  'zona industrial': 'Industrial',
};

export function sugerirZona(colonia) {
  if (!colonia) return null;
  const key = colonia.toLowerCase().trim();
  return COLONIAS_ZONA[key] || null;
}
