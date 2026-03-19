import { useState, useCallback } from 'react';
import { Icons } from './Icons';
import { BtnSpinner } from './Skeleton';

export default function Modal({ open, onClose, title, wide, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-md" aria-hidden="true" />
      <div
        className={`relative mx-3 mb-0 w-full max-h-[92vh] max-w-lg overflow-y-auto rounded-t-[30px] border border-white/60 bg-white/90 shadow-[0_30px_70px_rgba(3,14,19,0.18)] md:mx-4 md:mb-0 md:max-h-[85vh] md:rounded-[30px] ${wide ? "md:max-w-2xl" : "md:max-w-md"}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mx-auto mt-3 h-1 w-10 rounded-full bg-slate-200 md:hidden" />
        <div className="sticky top-0 z-10 flex items-center justify-between rounded-t-[30px] border-b border-slate-200/80 bg-white/88 p-4 backdrop-blur-xl">
          <div>
            <p className="erp-kicker text-slate-400">Accion</p>
            <h2 className="font-display max-w-[calc(100%-52px)] truncate text-base font-bold tracking-[-0.03em] text-slate-900">{title}</h2>
          </div>
          <button onClick={onClose} className="flex min-h-[44px] min-w-[44px] flex-shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700" aria-label="Cerrar modal" title="Cerrar modal">
            <Icons.X />
          </button>
        </div>
        <div className="p-4 md:p-5">{children}</div>
      </div>
    </div>
  );
}

export function FormInput({ label, error, ...props }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</label>
      <input className={`min-h-[44px] w-full rounded-[16px] border px-3.5 py-3 text-sm transition-all focus:outline-none focus:ring-2 md:py-2.5 ${
        error ? "border-red-300 focus:border-red-400 focus:ring-red-50" : "border-slate-200 bg-white/80 focus:border-cyan-600 focus:ring-cyan-50"
      }`} {...props} />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function FormSelect({ label, error, options, ...props }) {
  return (
    <div>
      <label className="mb-1.5 block text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</label>
      <select className={`min-h-[44px] w-full rounded-[16px] border bg-white/80 px-3.5 py-3 text-sm focus:outline-none md:py-2.5 ${
        error ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-cyan-600"
      }`} {...props}>
        {options.map(o => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function FormBtn({ children, primary, danger, onClick, disabled, loading, className = "" }) {
  return (
    <button onClick={onClick} disabled={disabled || loading}
      className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[16px] px-5 py-3 text-sm font-semibold transition-all md:py-2.5 ${
        primary ? "bg-slate-900 text-white shadow-[0_18px_28px_rgba(8,20,27,0.16)] hover:bg-slate-800" :
        danger ? "bg-red-600 text-white hover:bg-red-700" :
        "border border-slate-200 bg-white/80 text-slate-700 hover:bg-slate-50"
      } ${(disabled || loading) ? "opacity-50 cursor-not-allowed" : ""} ${className}`}>
      {loading ? <><BtnSpinner /> Guardando...</> : children}
    </button>
  );
}

// ─── CONFIRM DIALOG ───
// Usage: <ConfirmDialog open={showConfirm} onClose={()=>set(false)} onConfirm={doDelete} title="..." message="..." danger />
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }) {
  const [loading, setLoading] = useState(false);
  if (!open) return null;
  const handleConfirm = async () => {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); onClose(); }
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-md" aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-[28px] border border-white/60 bg-white/92 p-5 shadow-[0_30px_70px_rgba(3,14,19,0.18)]" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={title || '¿Estás seguro?'}>
        <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${danger ? 'bg-red-100' : 'bg-amber-100'}`}>
          <span className="text-xl">{danger ? '🗑' : '⚠️'}</span>
        </div>
        <h3 className="font-display mb-1 text-center text-base font-bold tracking-[-0.03em] text-slate-900">{title || '¿Estás seguro?'}</h3>
        {message && <p className="mb-4 text-center text-sm text-slate-500">{message}</p>}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose} disabled={loading} className="min-h-[44px] flex-1 rounded-[16px] border border-slate-200 bg-white/80 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleConfirm} disabled={loading}
            className={`min-h-[44px] flex-1 rounded-[16px] py-3 text-sm font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-slate-800'} ${loading ? 'opacity-50' : ''}`}>
            {loading ? 'Procesando...' : (confirmLabel || 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── useConfirm HOOK ───
// Usage: const [askConfirm, ConfirmEl] = useConfirm();
//        askConfirm("Título", "Mensaje", async () => { ... }, true);
//        return (<div>{ConfirmEl} ... </div>);
export function useConfirm() {
  const [state, setState] = useState(null);
  const ask = useCallback((title, message, onConfirm, danger = false) => {
    setState({ title, message, onConfirm, danger });
  }, []);
  const Dialog = state ? (
    <ConfirmDialog open onClose={() => setState(null)}
      onConfirm={state.onConfirm} title={state.title}
      message={state.message} danger={state.danger} />
  ) : null;
  return [ask, Dialog];
}
