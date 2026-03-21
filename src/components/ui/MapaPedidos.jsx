// MapaPedidos.jsx — Mapa de órdenes pendientes para planeación de rutas.
// Pins naranjas = sin ruta, azules = ya asignadas. Click en pin abre popup.
// Leaflet + OpenStreetMap — sin API key.
import { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';

const COLORS = {
  sinRuta:   { bg: '#f97316', border: '#ea580c', text: 'white' }, // naranja
  conRuta:   { bg: '#3b82f6', border: '#2563eb', text: 'white' }, // azul
};

const pinIcon = (L, label, tipo) => {
  const c = COLORS[tipo] || COLORS.sinRuta;
  return L.divIcon({
    html: `<div style="
      background:${c.bg};border:2.5px solid ${c.border};
      color:${c.text};min-width:26px;height:26px;border-radius:13px;
      display:flex;align-items:center;justify-content:center;
      font-weight:700;font-size:10px;padding:0 5px;
      box-shadow:0 2px 10px rgba(0,0,0,0.3);
      white-space:nowrap;
    ">${label}</div>`,
    className: '',
    iconSize: null,
    iconAnchor: [13, 13],
    popupAnchor: [0, -16],
  });
};

/**
 * @param {Array} ordenes - órdenes con { id, folio, clienteNombre, dir, productos, total, latitud, longitud, rutaId }
 */
export default function MapaPedidos({ ordenes = [] }) {
  const mapRef  = useRef(null);
  const mapInst = useRef(null);
  const [loading, setLoading] = useState(true);

  const conCoords = ordenes.filter(o => o.latitud && o.longitud);

  useEffect(() => {
    if (!mapRef.current || mapInst.current) return;

    const init = async () => {
      const L = (await import('leaflet')).default;

      delete L.Icon.Default.prototype._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl:       'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl:     'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      // Centro: primera orden con coords, o Hermosillo
      const first = conCoords[0];
      const center = first ? [first.latitud, first.longitud] : [29.0892, -110.9611];

      const map = L.map(mapRef.current, { zoomControl: true }).setView(center, 12);
      mapInst.current = map;

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© <a href="https://openstreetmap.org">OpenStreetMap</a>',
        maxZoom: 19,
      }).addTo(map);

      conCoords.forEach(o => {
        const tipo = (o.rutaId || o.ruta_id) ? 'conRuta' : 'sinRuta';
        const label = o.folio ? o.folio.replace(/^OV-/, '') : '?';
        const marker = L.marker([o.latitud, o.longitud], { icon: pinIcon(L, label, tipo) }).addTo(map);

        marker.bindPopup(`
          <div style="min-width:180px;font-family:sans-serif;line-height:1.4">
            <p style="margin:0 0 2px;font-weight:700;font-size:13px;color:#1e293b">${o.folio || '—'}</p>
            <p style="margin:0 0 1px;font-size:12px;font-weight:600;color:#334155">${o.clienteNombre || '—'}</p>
            ${o.dir ? `<p style="margin:0 0 6px;font-size:11px;color:#64748b">📍 ${o.dir}</p>` : ''}
            <p style="margin:0 0 6px;font-size:11px;color:#475569">${o.productos || ''}</p>
            <div style="display:flex;justify-content:space-between;align-items:center">
              <span style="font-size:12px;font-weight:700;color:#0f172a">$${Number(o.total||0).toLocaleString()}</span>
              <span style="font-size:10px;padding:2px 7px;border-radius:99px;font-weight:600;
                background:${(o.rutaId||o.ruta_id)?'#dbeafe':'#ffedd5'};
                color:${(o.rutaId||o.ruta_id)?'#1d4ed8':'#c2410c'}">
                ${(o.rutaId||o.ruta_id) ? 'En ruta' : 'Sin ruta'}
              </span>
            </div>
          </div>
        `, { maxWidth: 240 });
      });

      if (conCoords.length >= 2) {
        map.fitBounds(conCoords.map(o => [o.latitud, o.longitud]), { padding: [40, 40] });
      }

      setLoading(false);
    };

    init();

    return () => {
      if (mapInst.current) { mapInst.current.remove(); mapInst.current = null; }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Actualizar marcadores cuando cambian las órdenes (sin re-montar el mapa)
  useEffect(() => {
    if (!mapInst.current) return;
    // Simple: invalidate size for re-render on tab switch
    mapInst.current.invalidateSize();
  }, [ordenes]);

  if (conCoords.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-slate-400 text-sm bg-slate-50 rounded-2xl border border-slate-200">
        <p className="font-medium">Sin coordenadas</p>
        <p className="text-xs mt-1">Agrega lat/lng a los clientes para ver el mapa</p>
      </div>
    );
  }

  return (
    <div className="relative rounded-2xl overflow-hidden border border-slate-200 shadow-sm" style={{ height: 360 }}>
      <div ref={mapRef} style={{ height: '100%', width: '100%' }} />

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-100/80 backdrop-blur-sm">
          <div className="h-7 w-7 rounded-full border-4 border-slate-300 border-t-blue-500 animate-spin" />
        </div>
      )}

      {!loading && (
        <div className="absolute top-3 right-3 bg-white/95 backdrop-blur-sm rounded-xl px-3 py-2 text-xs shadow border border-slate-200 space-y-1.5">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: '#f97316' }} />
            <span className="text-slate-600">Sin ruta ({ordenes.filter(o => !(o.rutaId||o.ruta_id) && o.latitud).length})</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: '#3b82f6' }} />
            <span className="text-slate-600">Asignadas ({ordenes.filter(o => (o.rutaId||o.ruta_id) && o.latitud).length})</span>
          </div>
        </div>
      )}
    </div>
  );
}
