import { useEffect, useRef, useState } from 'react';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Cargador del SDK de Google Maps (singleton)
let loaderPromise = null;
function loadGoogleMaps() {
  if (loaderPromise) return loaderPromise;
  if (!GOOGLE_API_KEY) {
    return Promise.reject(new Error('Falta VITE_GOOGLE_MAPS_API_KEY en .env.local'));
  }
  if (typeof window !== 'undefined' && window.google?.maps?.places) {
    loaderPromise = Promise.resolve();
    return loaderPromise;
  }
  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_API_KEY}&libraries=places&language=es&region=MX`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('No se pudo cargar Google Maps. Verifica tu API key y que Places API esté habilitada.'));
    document.head.appendChild(script);
  });
  return loaderPromise;
}

// Parsear componentes de dirección de Google a campos del form
function parseAddressComponents(place) {
  const get = (type) => {
    const c = place.address_components?.find(comp => comp.types.includes(type));
    return c?.long_name || '';
  };
  const route = get('route');
  const num = get('street_number');
  const calleFinal = num ? `${route} ${num}` : route;

  return {
    calle: calleFinal || '',
    colonia: get('sublocality_level_1') || get('neighborhood') || get('sublocality') || '',
    ciudad: get('locality') || get('administrative_area_level_2') || '',
    estado: get('administrative_area_level_1') || '',
    cp: get('postal_code') || '',
    lat: typeof place.geometry?.location?.lat === 'function' ? place.geometry.location.lat() : null,
    lng: typeof place.geometry?.location?.lng === 'function' ? place.geometry.location.lng() : null,
    formatted: place.formatted_address || '',
  };
}

export default function AddressAutocomplete({ onSelect, placeholder = 'Buscar dirección...' }) {
  const inputRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    loadGoogleMaps()
      .then(() => {
        if (!active || !inputRef.current) return;
        const ac = new window.google.maps.places.Autocomplete(inputRef.current, {
          componentRestrictions: { country: 'mx' },
          fields: ['address_components', 'geometry', 'formatted_address'],
          types: ['address'],
        });
        ac.addListener('place_changed', () => {
          const place = ac.getPlace();
          if (!place.address_components) {
            setError('Selecciona una sugerencia de la lista');
            return;
          }
          onSelect(parseAddressComponents(place));
          setError(null);
        });
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
    return () => { active = false; };
  }, [onSelect]);

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Buscar dirección</label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">🔍</span>
        <input
          ref={inputRef}
          type="text"
          placeholder={loading ? 'Cargando Google Maps…' : placeholder}
          disabled={loading}
          className="min-h-[44px] w-full rounded-[16px] border pl-10 pr-3.5 py-3 text-sm focus:outline-none focus:ring-2 border-slate-200 bg-white/80 focus:border-cyan-600 focus:ring-cyan-50 disabled:opacity-50"
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <p className="text-xs text-slate-400 mt-1">Empieza a escribir y selecciona de la lista. Los campos de abajo se llenarán solos.</p>
    </div>
  );
}
