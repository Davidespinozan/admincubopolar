// EvidenciasOrden — fotos ligadas a una venta (mig 134): comprobante de
// transferencia y foto de la entrega. Solo lectura; las carga al abrir el
// detalle. No se muestra nada si la venta no tiene evidencias.
import { useEffect, useState } from 'react';
import { SectionLabel } from './ui/Components';
import { etiquetaEvidencia } from '../data/evidenciaLogic';
import { s, fmtDate } from '../utils/safe';

export default function EvidenciasOrden({ ordenId, cargar }) {
  const [lista, setLista] = useState(null);
  useEffect(() => {
    let vivo = true;
    setLista(null);
    if (typeof cargar !== 'function' || !ordenId) return undefined;
    cargar(ordenId).then(r => { if (vivo) setLista(r?.error ? [] : (r?.data || [])); });
    return () => { vivo = false; };
  }, [ordenId, cargar]);

  if (!lista || lista.length === 0) return null;
  return (
    <div data-testid="evidencias-orden">
      <SectionLabel className="mb-2">Fotos de la venta</SectionLabel>
      <div className="grid grid-cols-2 gap-2">
        {lista.map(ev => (
          <a key={ev.id} href={ev.url || undefined} target="_blank" rel="noopener noreferrer" className="block overflow-hidden rounded-card border border-line bg-slate-50">
            {ev.url
              ? <img src={ev.url} alt={etiquetaEvidencia(ev.tipo)} loading="lazy" className="h-32 w-full object-cover" />
              : <div className="flex h-32 items-center justify-center px-2 text-center text-xs text-slate-500">No se pudo abrir la foto</div>}
            <div className="px-2 py-1.5">
              <p className="text-[13px] font-semibold text-ink">{etiquetaEvidencia(ev.tipo)}</p>
              <p className="truncate text-[11px] text-slate-500">{s(ev.subidoPorNombre)}{ev.createdAt ? ` · ${fmtDate(ev.createdAt)}` : ''}{ev.referencia ? ` · ref. ${s(ev.referencia)}` : ''}</p>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}
