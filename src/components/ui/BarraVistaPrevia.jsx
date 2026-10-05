// BarraVistaPrevia — B2: barra compacta (una línea, 36px) que muestra Admin
// cuando usa "Ver como". Misma semántica que la barra anterior de App.jsx:
// indica PREVIEW, el rol pintado, el aviso de que Admin ve TODOS los datos
// (cada usuario real solo ve lo suyo) y el botón "Volver a Admin". No cambia
// la autorización ni el alcance de datos: eso vive en App.jsx (scopedData).

export const ALTO_BARRA_VISTA_PREVIA = 36;

export default function BarraVistaPrevia({ rol, onVolver }) {
  return (
    <div className="fixed top-0 left-0 right-0 z-[110] flex h-9 items-center justify-between gap-3 border-b border-white/10 bg-slate-950/95 px-3 text-cyan-50 erp-shell-blur shadow-[0_10px_24px_rgba(8,20,27,0.28)]" role="status" data-testid="admin-preview-bar">
      <p className="min-w-0 truncate text-[11px] leading-none">
        <span className="font-bold uppercase tracking-[0.14em]">Vista previa</span>
        <span className="mx-1.5 text-white/40">·</span>
        <span className="font-semibold">{rol}</span>
        <span className="mx-1.5 text-white/40">·</span>
        <span className="text-amber-300">Ves TODOS los datos como Admin; cada usuario real solo ve lo suyo</span>
      </p>
      <button onClick={onVolver} className="flex-shrink-0 rounded-[10px] border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-white transition-colors hover:bg-white/15">
        ← Volver a Admin
      </button>
    </div>
  );
}
