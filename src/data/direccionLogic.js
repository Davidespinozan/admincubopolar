// direccionLogic.js — helpers puros para captura de dirección estructurada.
// Aislado de Google Maps API y React para que sea testeable sin DOM.

/**
 * Parsea `address_components` de Google Places (formato `long_name`/`types`)
 * a un shape estructurado. Acepta el formato moderno de la New Places API
 * (`addressComponents` con `longText`/`types`) y el legado (`address_components`
 * con `long_name`/`types`).
 *
 * Devuelve null en cada campo que Google no haya identificado — `numero_exterior`
 * suele faltar en direcciones imprecisas, en cuyo caso el form padre debe pedir
 * que el usuario lo capture manualmente.
 *
 * @param {Array} components - place.addressComponents | place.address_components
 * @returns {{
 *   calle: string|null,
 *   numero_exterior: string|null,
 *   numero_interior: null,
 *   colonia: string|null,
 *   ciudad: string|null,
 *   estado: string|null,
 *   codigo_postal: string|null
 * }}
 */
export function parseAddressComponents(components) {
  const arr = Array.isArray(components) ? components : [];
  const get = (type) => {
    const c = arr.find(comp => Array.isArray(comp?.types) && comp.types.includes(type));
    return c?.longText || c?.long_name || c?.shortText || c?.short_name || null;
  };
  return {
    calle: get('route'),
    numero_exterior: get('street_number'),
    // Google nunca emite número interior; el usuario lo captura aparte.
    numero_interior: null,
    colonia: get('sublocality_level_1') || get('sublocality') || get('neighborhood'),
    ciudad: get('locality') || get('administrative_area_level_2'),
    estado: get('administrative_area_level_1'),
    codigo_postal: get('postal_code'),
  };
}

/**
 * Valida una dirección estructurada antes de guardar. Solo `numero_exterior`
 * es obligatorio (el resto puede heredar de Google o ser opcional según el
 * caso de uso). Otros campos pueden venir vacíos sin romper.
 *
 * @param {{ numero_exterior?: string }} dir
 * @returns {{ error: string }|null}
 */
export function validateDireccion(dir) {
  if (!dir || typeof dir !== 'object') {
    return { error: 'Dirección requerida' };
  }
  const numExt = String(dir.numero_exterior || '').trim();
  if (!numExt) {
    return { error: 'Número exterior es obligatorio' };
  }
  return null;
}

/**
 * Formatea una dirección estructurada a string legible para mostrar al
 * chofer, en CFDI, o en cualquier vista de detalle. Omite los campos
 * vacíos para no producir cosas como ", , Centro, , ".
 *
 * Si llega un objeto con campos camelCase (numeroExterior) los acepta
 * también — varios consumidores leen del store con toCamel.
 *
 * @param {Object} cli - puede ser { calle, numero_exterior, ... } o { calle, numeroExterior, ... }
 * @returns {string}
 */
export function formatDireccion(cli) {
  if (!cli || typeof cli !== 'object') return '';
  const calle = cli.calle || '';
  const numExt = cli.numero_exterior ?? cli.numeroExterior ?? '';
  const numInt = cli.numero_interior ?? cli.numeroInterior ?? '';
  const colonia = cli.colonia || '';
  const ciudad = cli.ciudad || '';
  const estado = cli.estado || '';
  const cp = cli.codigo_postal ?? cli.codigoPostal ?? cli.cp ?? '';

  const calleConNum = [calle, numExt].filter(s => String(s || '').trim()).join(' ');
  const interior = String(numInt || '').trim() ? `Int. ${String(numInt).trim()}` : null;
  const cpFmt = String(cp || '').trim() ? `C.P. ${String(cp).trim()}` : null;

  const parts = [
    calleConNum,
    interior,
    colonia,
    ciudad,
    estado,
    cpFmt,
  ].filter(p => p && String(p).trim());

  return parts.join(', ');
}

/**
 * Construye el shape estructurado que `AddressAutocomplete.onSelect` emite
 * tras seleccionar un lugar de Google. Combina `parseAddressComponents` +
 * coordenadas + dirección formateada por Google.
 *
 * @param {Object} place - resultado de place.fetchFields(...)
 * @returns {{
 *   fullAddress: string,
 *   components: Object,
 *   latitud: number|null,
 *   longitud: number|null
 * }}
 */
export function buildPlaceSelection(place) {
  const components = parseAddressComponents(
    place?.addressComponents || place?.address_components || []
  );
  const lat = typeof place?.location?.lat === 'function'
    ? place.location.lat()
    : (place?.location?.lat ?? null);
  const lng = typeof place?.location?.lng === 'function'
    ? place.location.lng()
    : (place?.location?.lng ?? null);
  return {
    fullAddress: place?.formattedAddress || place?.formatted_address || '',
    components,
    latitud: lat ?? null,
    longitud: lng ?? null,
  };
}
