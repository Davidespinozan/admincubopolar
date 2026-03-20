// MapaRuta.jsx — Mapa embebido con paradas numeradas, posición del chofer en tiempo real
// y ruta trazada. Leaflet + OpenStreetMap (sin API key).
// Routing via OSRM público (gratis). Turn-by-turn abre Google Maps.
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

// Ícono numerado para cada parada
const stopIcon = (L, num, entregada) => L.divIcon({
  html: `<div style="
    background:${entregada ? '#10b981' : '#1e293b'};
    color:${entregada ? 'white' : '#a5f3fc'};
    width:30px;height:30px;border-radius:50%;
    display:flex;align-items:center;justify-content:center;
    font-weight:700;font-size:12px;
    border:2.5px solid white;
    box-shadow:0 2px 10px rgba(0,0,0,0.35)">
    ${entregada ? '✓' : num}
  </div>`,
  className: '',
  iconSize: [30, 30],
  iconAnchor: [15, 15],
  popupAnchor: [0, -18],
});

// Ícono de posición del chofer (punto azul pulsante)
const driverIconHtml = `<div style="
  width:18px;height:18px;border-radius:50%;
  background:#3b82f6;border:3px solid white;
  box-shadow:0 0 0 4px rgba(59,130,246,0.35)"></div>`;

export default function MapaRuta({ paradas = [] }) {
  const mapRef     = useRef(null);
  const mapInst    = useRef(null);
  const driverMark = useRef(null);
  const routeLayer = useRef(null);
  const [gpsError, setGpsError] = useState(null);
  const [loading,  setLoading]  = useState(true);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;

    let watchId = null;

    const init = async () => {
      const L = (await import('leaflet')).default;

      // Fix Leaflet default icons broken en Vite
      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Centro inicial: primera parada con coords, o Durango como fallback
      const first = paradas.find(p => p.latitud && p.longitud);
      const center = first ? [first.latitud, first.longitud] : [24.0277, -104.6532];

      const map = L.map(mapRef.current, { zoomControl: true }).setView(center, 13);
      mapInst.current = map;

      // Mapa base OpenStreetMap — gratis, sin API key
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      // Marcadores de paradas
      const conCoords = paradas.filter(p => p.latitud && p.longitud);
      conCoords.forEach((p, i) => {
        const marker = L.marker([p.latitud, p.longitud], {
          icon: stopIcon(L, i + 1, p.entregada),
        }).addTo(map);

        const navUrl = `https://www.google.com/maps/dir/?api=1&destination=${p.latitud},${p.longitud}&travelmode=driving`;
        marker.bindPopup(`
          <div style="min-width:170px;font-family:sans-serif">
            <p style="font-weight:700;margin:0 0 2px;font-size:14px">${p.nombre}</p>
            <p style="font-size:11px;color:#64748b;margin:0 0 10px">${p.direccion || '—'}</p>
            ${p.entregada
              ? `<p style="text-align:center;color:#10b981;font-weight:600;font-size:13px">✓ Entregada</p>`
              : `<a href="${navUrl}" target="_blank" rel="noopener noreferrer"
                   style="display:block;text-align:center;background:#1e293b;color:white;
                   padding:7px 12px;border-radius:10px;text-decoration:none;
                   font-size:13px;font-weight:600">
                   Navegar aquí →
                 </a>`
            }
          </div>
        `, { maxWidth: 220 });
      });

      // Ajustar vista para mostrar todas las paradas
      if (conCoords.length >= 2) {
        map.fitBounds(conCoords.map(p => [p.latitud, p.longitud]), { padding: [40, 40] });
      }

      // Trazar ruta real via OSRM (gratis, sin API key)
      if (conCoords.length >= 2) {
        const coords = conCoords.map(p => `${p.longitud},${p.latitud}`).join(';');
        try {
          const res = await fetch(
            `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
            { signal: AbortSignal.timeout(6000) }
          );
          const data = await res.json();
          if (data.routes?.[0]?.geometry) {
            routeLayer.current = L.geoJSON(data.routes[0].geometry, {
              style: { color: '#3b82f6', weight: 5, opacity: 0.75 },
            }).addTo(map);
          }
        } catch {
          // Fallback: línea punteada directa si OSRM no responde
          routeLayer.current = L.polyline(
            conCoords.map(p => [p.latitud, p.longitud]),
            { color: '#3b82f6', weight: 3, dashArray: '10,6', opacity: 0.7 }
          ).addTo(map);
        }
      }

      setLoading(false);

      // Posición en tiempo real del chofer
      if (navigator.geolocation) {
        const driverIcon = L.divIcon({
          html: driverIconHtml,
          className: '',
          iconSize: [18, 18],
          iconAnchor: [9, 9],
        });

        watchId = navigator.geolocation.watchPosition(
          ({ coords }) => {
            const latlng = [coords.latitude, coords.longitude];
            if (!driverMark.current) {
              driverMark.current = L.marker(latlng, { icon: driverIcon, zIndexOffset: 1000 })
                .addTo(map)
                .bindTooltip('Tu posición', { direction: 'top', offset: [0, -10] });
            } else {
              driverMark.current.setLatLng(latlng);
            }
          },
          () => setGpsError('GPS no disponible — activa el permiso de ubicación'),
          { enableHighAccuracy: true, maximumAge: 4000 }
        );
      } else {
        setGpsError('Este navegador no soporta GPS');
      }
    };

    init();

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
      if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; }
      driverMark.current  = null;
      routeLayer.current  = null;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="relative rounded-[22px] overflow-hidden border border-slate-200/80 shadow-[0_12px_32px_rgba(8,20,27,0.12)]" style={{ height: 340 }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

      {/* Spinner mientras carga */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-2">
            <div className="h-8 w-8 rounded-full border-4 border-slate-300 border-t-blue-500 animate-spin" />
            <p className="text-xs font-medium text-slate-500">Cargando mapa...</p>
          </div>
        </div>
      )}

      {/* Error de GPS (no bloquea el mapa) */}
      {gpsError && (
        <div className="absolute bottom-3 left-3 right-3 bg-amber-50 border border-amber-200 text-amber-800 text-xs px-3 py-2 rounded-xl shadow">
          ⚠ {gpsError}
        </div>
      )}

      {/* Leyenda */}
      {!loading && (
        <div className="absolute top-3 right-3 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 text-xs shadow border border-slate-200/80 space-y-1">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-slate-900 flex-shrink-0" />
            <span className="text-slate-600">Pendiente</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-emerald-500 flex-shrink-0" />
            <span className="text-slate-600">Entregada</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded-full bg-blue-500 flex-shrink-0" />
            <span className="text-slate-600">Tu posición</span>
          </div>
        </div>
      )}
    </div>
  );
}
