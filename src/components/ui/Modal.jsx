import { Icons } from './Icons';
import { BtnSpinner } from './Skeleton';

export default function Modal({ open, onClose, title, wide, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" />
      <div
        className={`relative bg-white w-full max-h-[92vh] md:max-h-[85vh] overflow-y-auto rounded-t-2xl md:rounded-2xl shadow-2xl mx-3 md:mx-4 mb-0 md:mb-0 ${wide ? "md:max-w-2xl" : "md:max-w-md"} max-w-lg`}
        onClick={e => e.stopPropagation()}
      >
        <div className="md:hidden w-10 h-1 bg-slate-200 rounded-full mx-auto mt-3" />
        <div className="sticky top-0 flex items-center justify-between p-4 border-b border-slate-100 bg-white z-10 rounded-t-2xl">
          <h2 className="text-base font-bold text-slate-800 truncate max-w-[calc(100%-52px)]">{title}</h2>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-xl text-slate-400 min-w-[44px] min-h-[44px] flex items-center justify-center flex-shrink-0">
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
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      <input className={`w-full px-3.5 py-3 md:py-2.5 border rounded-xl text-sm focus:outline-none focus:ring-2 transition-all min-h-[44px] ${
        error ? "border-red-300 focus:border-red-400 focus:ring-red-50" : "border-slate-200 focus:border-blue-400 focus:ring-blue-50"
      }`} {...props} />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

export function FormSelect({ label, error, options, ...props }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
      <select className={`w-full px-3.5 py-3 md:py-2.5 border rounded-xl text-sm focus:outline-none bg-white min-h-[44px] ${
        error ? "border-red-300 focus:border-red-400" : "border-slate-200 focus:border-blue-400"
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
      className={`inline-flex items-center justify-center gap-1.5 font-semibold rounded-xl transition-all text-sm px-5 py-3 md:py-2.5 min-h-[44px] ${
        primary ? "bg-blue-600 hover:bg-blue-700 text-white shadow-sm shadow-blue-200" :
        danger ? "bg-red-600 hover:bg-red-700 text-white" :
        "border border-slate-200 text-slate-600 hover:bg-slate-50"
      } ${(disabled || loading) ? "opacity-50 cursor-not-allowed" : ""} ${className}`}>
      {loading ? <><BtnSpinner /> Guardando...</> : children}
    </button>
  );
}
