// Full-page skeleton for initial load
export function PageSkeleton() {
  return (
    <div className="min-h-screen bg-slate-50 animate-pulse">
      {/* Top bar */}
      <div className="h-14 md:h-16 bg-white border-b border-slate-100 flex items-center px-4 md:px-6 md:ml-[240px]">
        <div className="w-32 h-4 bg-slate-200 rounded" />
      </div>
      {/* Content */}
      <div className="md:ml-[240px] p-4 md:p-6 space-y-4">
        <div className="w-48 h-6 bg-slate-200 rounded" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <div key={i} className="h-24 bg-white rounded-2xl border border-slate-100" />)}
        </div>
        <div className="h-64 bg-white rounded-2xl border border-slate-100" />
      </div>
    </div>
  );
}

// Inline spinner for buttons during save
export function BtnSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// Empty state for sections that use .map() directly
import { Icons } from './Icons';

export function EmptyState({
  message = "Sin datos",
  icon,
  hint,
  cta,
  onCta,
  secondaryLabel,
  onSecondary,
}) {
  // icon puede ser string (nombre de Icons) o ReactNode directo
  const iconNode = typeof icon === 'string' && Icons[icon]
    ? Icons[icon]()
    : icon;

  return (
    <div className="text-center py-10 px-4">
      {iconNode && (
        <div className="text-slate-300 mb-3 flex justify-center [&>svg]:w-12 [&>svg]:h-12">
          {iconNode}
        </div>
      )}
      <p className="text-sm font-semibold text-slate-600 mb-1">{message}</p>
      {hint && <p className="text-xs text-slate-400 max-w-sm mx-auto">{hint}</p>}
      {(cta || secondaryLabel) && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {cta && onCta && (
            <button
              onClick={onCta}
              className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-sm font-bold rounded-xl transition-colors"
            >
              {cta}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button
              onClick={onSecondary}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 text-sm font-bold rounded-xl transition-colors"
            >
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
