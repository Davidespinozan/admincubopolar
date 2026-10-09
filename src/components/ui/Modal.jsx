import { useState, useCallback, useEffect } from 'react';
import { Icons } from './Icons';
import { BtnSpinner } from './Skeleton';

/**
 * Bloquea el scroll del body mientras `active === true` (iOS Safari: sin esto
 * el fondo se desplaza al llegar al final del scroll interno de la hoja).
 * Restaura el valor original al desmontar.
 */
export function useBodyScrollLock(active) {
  useEffect(() => {
    if (!active) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [active]);
}

// Hoja inferior en móvil (radio 28 arriba, asa, encabezado y pie pegajosos) y
// diálogo centrado en escritorio. `footer`: acciones fijas al pie (con safe-area).
// `kicker`: etiqueta sobre el título. `safeBottom`: relleno inferior cuando no hay pie.
export default function Modal({ open, onClose, title, kicker, wide, safeBottom = false, footer, children, closeOnEscape = true }) {
  useBodyScrollLock(open);

  useEffect(() => {
    if (!open || !closeOnEscape) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-end justify-center md:items-center" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/40 animate-fadeIn" aria-hidden="true" />
      <div
        className={`relative flex w-full max-h-[92dvh] flex-col overflow-hidden rounded-t-panel bg-white shadow-sheet animate-sheet-in md:mx-4 md:max-h-[85vh] md:rounded-panel md:shadow-pop ${wide ? "md:max-w-2xl lg:max-w-3xl" : "md:max-w-md lg:max-w-lg"}`}
        onClick={e => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="hoja"
      >
        <div className="mx-auto mt-2.5 h-1.5 w-10 flex-shrink-0 rounded-full bg-slate-200 md:hidden" />
        <div className="flex flex-shrink-0 items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-2 md:pt-4">
          <div className="min-w-0 flex-1">
            {kicker && <p className="erp-kicker text-slate-500">{kicker}</p>}
            <h2 className="font-display truncate text-[17px] font-bold text-ink">{title}</h2>
          </div>
          <button onClick={onClose} className="-mr-2 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-ink" aria-label="Cerrar modal" title="Cerrar modal">
            <Icons.X />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 md:px-5"
          style={!footer && safeBottom ? { paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" } : undefined}>
          {children}
        </div>
        {footer && (
          <div className="flex flex-shrink-0 gap-2 border-t border-line bg-white px-4 pt-3 md:px-5"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)" }} data-testid="hoja-pie">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

const FIELD = "min-h-[48px] w-full rounded-field border bg-slate-50 px-3.5 py-3 text-[15px] text-ink placeholder:text-slate-400 transition-all focus:bg-white focus:outline-none focus:ring-2 md:min-h-[44px] md:py-2.5";
const FIELD_OK = "border-line focus:border-accent focus:ring-accent/15";
const FIELD_ERR = "border-red-300 focus:border-red-400 focus:ring-red-100";
const LABEL = "mb-1.5 block text-[13px] font-medium text-slate-700";

// `hint` (ayuda bajo el campo) e `inputClassName` (clases extra) son opcionales.
export function FormInput({ label, error, hint, inputClassName = "", ...props }) {
  return (
    <div>
      {label && <label className={LABEL}>{label}</label>}
      <input className={`${FIELD} ${error ? FIELD_ERR : FIELD_OK} ${inputClassName}`} {...props} />
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
      {!error && hint && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
    </div>
  );
}

export function FormSelect({ label, error, options, ...props }) {
  return (
    <div>
      {label && <label className={LABEL}>{label}</label>}
      <select className={`${FIELD} ${error ? FIELD_ERR : FIELD_OK}`} {...props}>
        {options.map(o => typeof o === "string" ? <option key={o} value={o}>{o}</option> : <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

export function FormTextarea({ label, error, rows = 3, ...props }) {
  return (
    <div>
      {label && <label className={LABEL}>{label}</label>}
      <textarea rows={rows} className={`w-full rounded-field border bg-slate-50 px-3.5 py-3 text-[15px] text-ink placeholder:text-slate-400 transition-all focus:bg-white focus:outline-none focus:ring-2 ${error ? FIELD_ERR : FIELD_OK}`} {...props} />
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

// Botón: `primary` tinta · `success` · `danger` · `warning` · `ghost` · default
// blanco con línea. `size="lg"` 52 px para acciones de campo; `loading` spinner.
export function FormBtn({ children, primary, danger, success, warning, ghost, size, onClick, disabled, loading, className = "", type = "button" }) {
  return (
    <button type={type} onClick={onClick} disabled={disabled || loading}
      className={`inline-flex items-center justify-center gap-1.5 font-semibold transition-all ${
        size === "lg" ? "min-h-[52px] rounded-[16px] px-6 py-3.5 text-[15px]" : "min-h-[44px] rounded-field px-4 py-2.5 text-sm"
      } ${
        primary ? "bg-ink text-white shadow-cta hover:bg-slate-800" :
        danger ? "bg-red-600 text-white hover:bg-red-700" :
        success ? "bg-emerald-600 text-white shadow-[0_10px_24px_-10px_rgba(5,150,105,0.6)] hover:bg-emerald-700" :
        warning ? "bg-amber-600 text-white hover:bg-amber-700" :
        ghost ? "bg-slate-100 text-slate-700 hover:bg-slate-200" :
        "border border-line bg-white text-slate-700 hover:bg-slate-50"
      } ${(disabled || loading) ? "opacity-50 cursor-not-allowed" : ""} ${className}`}>
      {loading ? <><BtnSpinner /> Guardando...</> : children}
    </button>
  );
}

// ─── CONFIRM DIALOG ───
export function ConfirmDialog({ open, onClose, onConfirm, title, message, confirmLabel, danger }) {
  const [loading, setLoading] = useState(false);
  useBodyScrollLock(open);
  useEffect(() => {
    if (!open || loading) return;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, loading, onClose]);

  if (!open) return null;
  const handleConfirm = async () => {
    setLoading(true);
    try { await onConfirm(); } finally { setLoading(false); onClose(); }
  };
  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center p-5" onClick={onClose}>
      <div className="absolute inset-0 bg-ink/40 animate-fadeIn" aria-hidden="true" />
      <div className="relative w-full max-w-sm rounded-panel bg-white p-5 shadow-pop animate-pop-in" onClick={e => e.stopPropagation()} role="alertdialog" aria-modal="true" aria-label={title || '¿Estás seguro?'}>
        <div className={`mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full ${danger ? 'bg-red-50 text-red-600' : 'bg-amber-50 text-amber-600'}`}>
          {danger ? <Icons.Trash /> : <Icons.AlertTriangle />}
        </div>
        <h3 className="font-display mb-1 text-center text-[17px] font-bold text-ink">{title || '¿Estás seguro?'}</h3>
        {message && <p className="mb-4 text-center text-[13px] text-slate-500">{message}</p>}
        <div className="mt-4 flex gap-2">
          <button onClick={onClose} disabled={loading} className="min-h-[44px] flex-1 rounded-field border border-line bg-white py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">Cancelar</button>
          <button onClick={handleConfirm} disabled={loading}
            className={`min-h-[44px] flex-1 rounded-field py-3 text-sm font-semibold text-white ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-ink hover:bg-slate-800'} ${loading ? 'opacity-50' : ''}`}>
            {loading ? 'Procesando...' : (confirmLabel || 'Confirmar')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── useConfirm HOOK ───
// const [askConfirm, ConfirmEl] = useConfirm(); askConfirm("Título", "Mensaje", async () => {…}, true);
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
