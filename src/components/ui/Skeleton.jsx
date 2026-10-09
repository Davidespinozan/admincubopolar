import { Icons } from './Icons';

// Esqueleto de carga inicial de la app (antes del shell).
export function PageSkeleton() {
  return (
    <div className="min-h-dvh bg-canvas">
      <div className="flex h-14 items-center px-4 md:ml-[300px] md:h-16 md:px-6">
        <div className="skeleton h-4 w-32 rounded-full" />
      </div>
      <div className="space-y-4 p-4 md:ml-[300px] md:p-6">
        <div className="skeleton h-7 w-48 rounded-lg" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {[1, 2, 3, 4].map(i => <div key={i} className="skeleton h-24 rounded-card" />)}
        </div>
        <div className="skeleton h-64 rounded-card" />
      </div>
    </div>
  );
}

// Esqueleto de una vista mientras carga su módulo (Suspense del shell).
export function ViewSkeleton() {
  return (
    <div className="space-y-3 animate-view-in" aria-busy="true" aria-label="Cargando">
      <div className="skeleton h-11 w-40 rounded-field" />
      <div className="grid grid-cols-2 gap-3">
        <div className="skeleton h-24 rounded-card" />
        <div className="skeleton h-24 rounded-card" />
      </div>
      <div className="skeleton h-32 rounded-card" />
      <div className="skeleton h-32 rounded-card" />
    </div>
  );
}

// Spinner para botones durante el guardado.
export function BtnSpinner() {
  return (
    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

// Estado vacío: icono en círculo suave, frase corta, pista y CTA.
export function EmptyState({
  message = "Sin datos",
  icon,
  hint,
  cta,
  onCta,
  secondaryLabel,
  onSecondary,
}) {
  const Ic = typeof icon === 'string' ? Icons[icon] : null;
  const iconNode = Ic ? <Ic /> : icon;

  return (
    <div className="px-4 py-10 text-center">
      <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400 [&>svg]:h-6 [&>svg]:w-6">
        {iconNode || <Icons.Box />}
      </div>
      <p className="text-[15px] font-semibold text-ink">{message}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-[13px] text-slate-500">{hint}</p>}
      {(cta || secondaryLabel) && (
        <div className="mt-4 flex items-center justify-center gap-2">
          {cta && onCta && (
            <button onClick={onCta} className="min-h-[44px] rounded-field bg-ink px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-800">
              {cta}
            </button>
          )}
          {secondaryLabel && onSecondary && (
            <button onClick={onSecondary} className="min-h-[44px] rounded-field border border-line bg-white px-4 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50">
              {secondaryLabel}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
