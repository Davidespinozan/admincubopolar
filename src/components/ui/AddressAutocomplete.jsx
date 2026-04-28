import { useEffect, useRef, useState } from 'react';

const GOOGLE_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Cargador del SDK de Google Maps usando el bootstrap oficial (importLibrary)
let loaderPromise = null;
function loadGoogleMaps() {
  if (loaderPromise) return loaderPromise;
  if (!GOOGLE_API_KEY) {
    return Promise.reject(new Error('Falta VITE_GOOGLE_MAPS_API_KEY en .env.local'));
  }

  // Si ya está cargado, solo importar places
  if (typeof window !== 'undefined' && window.google?.maps?.importLibrary) {
    loaderPromise = window.google.maps.importLibrary('places');
    return loaderPromise;
  }

  // Bootstrap inline oficial de Google (configura importLibrary)
  loaderPromise = new Promise((resolve, reject) => {
    try {
      ((g) => {
        // eslint-disable-next-line
        var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window;
        b = b[c] || (b[c] = {});
        var d = b.maps || (b.maps = {}), r = new Set(), e = new URLSearchParams(),
            u = () => h || (h = new Promise(async (f, n) => {
              await (a = m.createElement("script"));
              e.set("libraries", [...r] + "");
              for (k in g) e.set(k.replace(/[A-Z]/g, (t) => "_" + t[0].toLowerCase()), g[k]);
              e.set("callback", c + ".maps." + q);
              a.src = `https://maps.${c}apis.com/maps/api/js?` + e;
              d[q] = f;
              a.onerror = () => (h = n(Error(p + " could not load.")));
              a.nonce = m.querySelector("script[nonce]")?.nonce || "";
              m.head.append(a);
            }));
        d[l] ? console.warn(p + " only loads once. Ignoring:", g)
             : (d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)));
      })({ key: GOOGLE_API_KEY, v: "weekly", language: "es", region: "MX" });

      // Ahora importLibrary está disponible — cargamos places
      window.google.maps.importLibrary('places').then(resolve).catch(reject);
    } catch (err) {
      reject(err);
    }
  });
  return loaderPromise;
}

export default function AddressAutocomplete({ onSelect }) {
  const containerRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    let pacEl = null;
    let cleanup = () => {};

    loadGoogleMaps()
      .then(async () => {
        if (!active || !containerRef.current) return;

        // Acceder directo a la nueva librería de Places (ya cargada por libraries=places)
        const PlaceAutocompleteElement = window.google?.maps?.places?.PlaceAutocompleteElement;
        if (!PlaceAutocompleteElement) {
          throw new Error('PlaceAutocompleteElement no disponible. Verifica que Places API (New) esté habilitada en Google Cloud.');
        }

        // Crear el web component (la nueva API usa includedRegionCodes en vez de componentRestrictions)
        pacEl = new PlaceAutocompleteElement({
          includedRegionCodes: ['mx'],
        });
        pacEl.style.width = '100%';

        // Listener del evento de selección
        const onPlaceSelect = async (event) => {
          try {
            const place = event.placePrediction.toPlace();
            await place.fetchFields({
              fields: ['addressComponents', 'location', 'formattedAddress'],
            });

            const components = place.addressComponents || [];
            const get = (type) => {
              const c = components.find(comp => comp.types?.includes(type));
              return c?.longText || c?.shortText || '';
            };

            const route = get('route');
            const num = get('street_number');

            onSelect({
              calle: num ? `${route} ${num}` : route,
              colonia: get('sublocality_level_1') || get('neighborhood') || get('sublocality') || '',
              ciudad: get('locality') || get('administrative_area_level_2') || '',
              estado: get('administrative_area_level_1') || '',
              cp: get('postal_code') || '',
              lat: place.location?.lat() ?? null,
              lng: place.location?.lng() ?? null,
              formatted: place.formattedAddress || '',
            });
          } catch (err) {
            console.error('[AddressAutocomplete] error en select:', err);
            setError('No se pudieron obtener los detalles. Intenta otra dirección.');
          }
        };

        pacEl.addEventListener('gmp-select', onPlaceSelect);
        containerRef.current.appendChild(pacEl);
        cleanup = () => {
          pacEl?.removeEventListener('gmp-select', onPlaceSelect);
          pacEl?.remove();
        };

        setLoading(false);
      })
      .catch(err => {
        console.error('[AddressAutocomplete] error al cargar:', err);
        setError(err.message);
        setLoading(false);
      });

    return () => {
      active = false;
      cleanup();
    };
  }, [onSelect]);

  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-slate-700">Buscar dirección</label>
      <div ref={containerRef} className="autocomplete-container">
        {loading && (
          <div className="min-h-[44px] w-full rounded-[16px] border px-3.5 py-3 text-sm border-slate-200 bg-slate-50 text-slate-400 flex items-center">
            Cargando Google Maps…
          </div>
        )}
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
      <p className="text-xs text-slate-400 mt-1">Empieza a escribir y selecciona de la lista. Los campos de abajo se llenarán solos.</p>
    </div>
  );
}
