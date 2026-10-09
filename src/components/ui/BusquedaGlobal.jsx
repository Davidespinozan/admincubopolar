// BusquedaGlobal — buscador del shell (back office). Botón en la barra
// superior que abre un panel con campo y resultados; tocar un resultado
// navega al módulo. La lógica de búsqueda vive en data/busquedaLogic.ts.
import { useEffect, useMemo, useRef, useState } from 'react';
import { buscarGlobal } from '../../data/busquedaLogic';
import { Icons } from './Icons';

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
        className="relative flex h-10 w-10 items-center justify-center rounded-full text-slate-700 transition-colors hover:bg-slate-100 lg:h-11 lg:w-11"
        title="Buscar (clientes, ventas, rutas…)"
        aria-label="Buscar"
        aria-haspopup="dialog"
        aria-expanded={abierto}
      >
        <Icons.Search />
      </button>
      {abierto && (
        <>
          <div className="fixed inset-0 z-[60] bg-ink/20 animate-fadeIn" onClick={() => setAbierto(false)} aria-hidden="true" />
          <div className="absolute right-0 top-12 z-[70] max-h-[70vh] w-[calc(100vw-16px)] overflow-y-auto rounded-card border border-line bg-white shadow-pop animate-pop-in sm:w-96" role="dialog" aria-modal="false" aria-label="Búsqueda global">
            <div className="sticky top-0 border-b border-line bg-white p-3">
              <div className="relative">
                <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span>
                <input
                  ref={inputRef}
                  value={query}
                  onChange={e => setQuery(e.target.value)}
                  placeholder="Cliente, folio, ruta, producto…"
                  className="min-h-[48px] w-full rounded-field border border-line bg-slate-50 pl-10 pr-3.5 text-[15px] text-ink placeholder:text-slate-400 focus:border-accent focus:bg-white focus:outline-none focus:ring-2 focus:ring-accent/15"
                  aria-label="Texto a buscar"
                />
              </div>
            </div>
            {query.trim().length < 2 ? (
              <div className="p-5 text-center text-[13px] text-slate-500">Escribe al menos 2 letras</div>
            ) : resultados.length === 0 ? (
              <div className="p-5 text-center text-[13px] text-slate-500">Sin resultados para “{query.trim()}”</div>
            ) : (
              <div className="divide-y divide-line">
                {resultados.map(r => (
                  <button
                    key={`${r.tipo}-${r.id}`}
                    onClick={() => ir(r)}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-slate-50"
                  >
                    <IconoResultado nombre={r.icono} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-semibold text-ink">{r.titulo}</span>
                      {r.subtitulo && <span className="block truncate text-[13px] text-slate-500">{r.subtitulo}</span>}
                    </span>
                    <span className="flex-shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold capitalize text-slate-600">{r.tipo}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

function IconoResultado({ nombre }) {
  const Ic = Icons[nombre] || Icons.Package;
  return (
    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-accent-soft text-accent" aria-hidden="true">
      <Ic />
    </span>
  );
}
