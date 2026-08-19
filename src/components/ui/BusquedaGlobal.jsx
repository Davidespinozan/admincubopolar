// BusquedaGlobal — buscador del shell admin (Tanda 27). Botón en la
// topbar que abre un panel con input + resultados; tocar un resultado
// navega al módulo. Mismo patrón visual que los paneles de alertas y
// notificaciones. La lógica de búsqueda vive en data/busquedaLogic.js.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarGlobal } from '../../data/busquedaLogic';

export default function BusquedaGlobal({ data, onNavigate }) {
  const [abierto, setAbierto] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef(null);

  const resultados = useMemo(() => buscarGlobal(data, query), [data, query]);

  useEffect(() => {
    if (abierto) inputRef.current?.focus();
    else setQuery('');
  }, [abierto]);

  useEffect(() => {
    if (!abierto) return undefined;
    const onKeyDown = (e) => { if (e.key === 'Escape') setAbierto(false); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [abierto]);

  const ir = (r) => {
    onNavigate?.(r.modulo);
    setAbierto(false);
  };

  return (
    <>
      <button
        onClick={() => setAbierto(a => !a)}
        className="relative flex h-9 w-9 items-center justify-center rounded-[14px] border border-slate-200 bg-white/80 text-slate-500 transition-colors hover:bg-white hover:text-slate-800 lg:h-11 lg:w-11 lg:rounded-[16px]"
        title="Buscar (clientes, ventas, rutas…)"
        aria-label="Buscar"
        aria-haspopup="dialog"
        aria-expanded={abierto}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
      </button>
      {abierto && (
        <div className="erp-panel absolute right-0 top-12 z-[70] max-h-[28rem] w-[calc(100vw-32px)] overflow-y-auto rounded-[24px] sm:w-96 md:w-[24rem]" role="dialog" aria-modal="false" aria-label="Búsqueda global">
          <div className="border-b border-slate-200/80 p-3">
            <input
              ref={inputRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Buscar cliente, folio, ruta, producto…"
              className="w-full px-3.5 py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/40"
              aria-label="Texto a buscar"
            />
          </div>
          {query.trim().length < 2 ? (
            <div className="p-4 text-center text-sm text-slate-400">Escribe al menos 2 letras</div>
          ) : resultados.length === 0 ? (
            <div className="p-4 text-center text-sm text-slate-400">Sin resultados para “{query.trim()}”</div>
          ) : (
            <div className="divide-y divide-slate-100">
              {resultados.map(r => (
                <button
                  key={`${r.tipo}-${r.id}`}
                  onClick={() => ir(r)}
                  className="w-full text-left px-4 py-3 flex gap-3 items-center hover:bg-slate-50 transition-colors"
                >
                  <span className="text-lg flex-shrink-0" aria-hidden="true">{r.icono}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-slate-800 truncate">{r.titulo}</span>
                    {r.subtitulo && <span className="block text-xs text-slate-500 truncate">{r.subtitulo}</span>}
                  </span>
                  <span className="flex-shrink-0 text-[10px] font-bold uppercase tracking-wide text-slate-400">{r.tipo}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {abierto && <div className="fixed inset-0 z-[60]" onClick={() => setAbierto(false)} aria-hidden="true" />}
    </>
  );
}
