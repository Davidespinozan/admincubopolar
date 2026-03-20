import { Icons } from './Icons';

// ─── STATUS BADGE ───
const STATUS_COLORS = {
  "Activo": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Inactivo": "bg-slate-100/90 text-slate-600 border-slate-200",
  "Creada": "bg-amber-100/80 text-amber-900 border-amber-200/80",
  "Asignada": "bg-sky-100/90 text-sky-900 border-sky-200/80",
  "Entregada": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Facturada": "bg-cyan-100/90 text-cyan-900 border-cyan-200/80",
  "En progreso": "bg-sky-100/90 text-sky-900 border-sky-200/80",
  "Completada": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Programada": "bg-slate-100/90 text-slate-700 border-slate-200/90",
  "Cerrada": "bg-slate-200/80 text-slate-800 border-slate-300/80",
  "Confirmada": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "En proceso": "bg-amber-100/80 text-amber-900 border-amber-200/80",
  "Empaque": "bg-orange-100/80 text-orange-900 border-orange-200/80",
  "Producto Terminado": "bg-cyan-100/90 text-cyan-900 border-cyan-200/80",
  "Entrada": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Salida": "bg-red-100/80 text-red-900 border-red-200/80",
  "Traspaso": "bg-sky-100/90 text-sky-900 border-sky-200/80",
  "Devolución": "bg-violet-100/80 text-violet-900 border-violet-200/80",
  "Merma": "bg-amber-100/80 text-amber-900 border-amber-200/80",
};
const DEFAULT_STATUS_COLOR = "bg-slate-100/90 text-slate-700 border-slate-200/90";
export const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-[0.08em] uppercase ${STATUS_COLORS[status] || DEFAULT_STATUS_COLOR}`}>
    {status}
  </span>
);

// ─── ALERT BADGE ───
export const AlertBadge = ({ tipo }) => {
  const c = { critica: "bg-red-500", accionable: "bg-amber-500", info: "bg-blue-400" };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c[tipo]}`} />;
};

// ─── ADAPTIVE DATA TABLE ───
// Desktop: standard table | Mobile: stacked cards
// Single component, zero duplication. Breakpoint handled via CSS.
//
// Props:
//   columns: [{ key, label, bold, render, primary, hideOnMobile }]
//     - primary: true → shown as card title on mobile (first match)
//     - hideOnMobile: true → hidden in card mode
//   cardTitle: (row) => string — override for mobile card title
//   cardSubtitle: (row) => ReactNode — extra line under title
//   data, onRowClick
export const DataTable = ({ columns, data, onRowClick, cardTitle, cardSubtitle }) => {
  // Determine which column is "primary" for card title
  const primaryCol = columns.find(c => c.primary) || columns.find(c => c.bold) || columns[0];
  const secondaryCols = columns.filter(c => c !== primaryCol && !c.hideOnMobile);

  return (
    <div>
      {data.length === 0 && <p className="text-sm text-slate-400 text-center py-8">Sin datos</p>}

      {/* ── DESKTOP TABLE (hidden on mobile) ── */}
      {data.length > 0 && <div className="hidden overflow-x-auto rounded-[28px] border border-slate-200/80 bg-white/70 shadow-[0_14px_32px_rgba(8,20,27,0.06)] md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200/80 bg-slate-900/[0.025]">
              {columns.map(col => (
                <th key={col.key + col.label} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)} className="cursor-pointer border-b border-slate-100/90 transition-colors hover:bg-slate-900/[0.025] group">
                {columns.map(col => (
                  <td key={col.key + col.label} className="px-4 py-3.5 text-sm">
                    {col.render ? col.render(row[col.key], row) : <span className={col.bold ? "font-semibold text-slate-800" : "text-slate-600"}>{row[col.key]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* ── MOBILE CARDS (hidden on desktop) ── */}
      {data.length > 0 && <div className="space-y-2 md:hidden">
        {data.map((row, i) => {
          const badgeCol = columns.find(c => c.badge);
          return (
          <div key={i} onClick={() => onRowClick?.(row)} className="cursor-pointer rounded-[20px] border border-slate-200/80 bg-white/78 p-3 shadow-[0_8px_20px_rgba(8,20,27,0.05)] transition-colors active:bg-slate-50 sm:p-4">
            {/* Card header: primary value + badge top-right */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold text-slate-800 sm:text-[15px]">
                  {cardTitle ? cardTitle(row) : (primaryCol.render ? primaryCol.render(row[primaryCol.key], row) : row[primaryCol.key])}
                </p>
                {cardSubtitle && <div className="mt-0.5">{cardSubtitle(row)}</div>}
              </div>
              {badgeCol && (
                <div className="flex-shrink-0">
                  {badgeCol.render ? badgeCol.render(row[badgeCol.key], row) : <StatusBadge status={row[badgeCol.key]} />}
                </div>
              )}
            </div>
            {/* Card body: key-value pairs */}
            <div className="space-y-1.5">
              {secondaryCols.filter(c => !c.badge).map(col => {
                const val = col.render ? col.render(row[col.key], row) : row[col.key];
                if (val === undefined || val === null || val === "") return null;
                return (
                  <div key={col.key + col.label} className="flex items-start justify-between gap-2 text-xs sm:text-sm">
                    <span className="text-slate-400 flex-shrink-0">{col.label}</span>
                    <span className="min-w-0 break-words text-right font-medium text-slate-700">{val}</span>
                  </div>
                );
              })}
            </div>
          </div>
          );
        })}
      </div>}
    </div>
  );
};

// ─── PAGE HEADER ───
// Mobile: stacked, full-width action button
// Desktop: row with inline button
export const PageHeader = ({ title, subtitle, action, actionLabel, actionIcon, extraButtons }) => (
  <div className="mb-3 flex flex-row items-center justify-between gap-2 rounded-[22px] border border-slate-200/80 bg-white/62 px-3 py-2.5 shadow-[0_12px_24px_rgba(8,20,27,0.05)] backdrop-blur-xl sm:mb-6 sm:gap-3 sm:rounded-[28px] sm:px-5 sm:py-4.5">
    <div className="min-w-0">
      <h1 className="font-display text-base font-bold tracking-[-0.03em] text-slate-900 sm:text-[1.6rem]">{title}</h1>
      {subtitle && <p className="hidden text-xs text-slate-500 sm:block sm:mt-1 sm:text-sm">{subtitle}</p>}
    </div>
    <div className="flex flex-shrink-0 items-center gap-2">
      {extraButtons}
      {action && (
        <button onClick={action} className="inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-[13px] bg-slate-900 px-3 py-2 text-xs font-semibold text-white shadow-[0_10px_20px_rgba(8,20,27,0.14)] transition-all hover:translate-y-[-1px] hover:bg-slate-800 sm:min-h-[44px] sm:gap-2 sm:rounded-[16px] sm:px-4 sm:py-2.5 sm:text-sm">
          {actionIcon || <Icons.Plus />} {actionLabel}
        </button>
      )}
    </div>
  </div>
);

// ─── STAT CARD ───
export const StatCard = ({ label, value, unit, change, up, icon: IconComp }) => (
  <div className="rounded-[24px] border border-slate-200/80 bg-white/80 p-4 shadow-[0_12px_24px_rgba(8,20,27,0.06)] transition-all hover:translate-y-[-1px] hover:shadow-[0_16px_28px_rgba(8,20,27,0.08)] sm:p-5">
    <div className="flex items-start justify-between mb-2 sm:mb-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{label}</span>
      <div className="flex h-8 w-8 items-center justify-center rounded-[12px] bg-slate-900 text-cyan-200 sm:h-9 sm:w-9">
        <IconComp />
      </div>
    </div>
    <div className="flex items-baseline gap-1.5 sm:gap-2">
      <span className="font-display text-2xl font-bold tracking-[-0.05em] text-slate-900 sm:text-[2rem]">{value}</span>
      <span className="text-xs font-medium text-slate-400">{unit}</span>
    </div>
    {change && (
      <div className={`mt-1.5 flex items-center gap-1 text-xs font-semibold sm:mt-2 ${up ? "text-emerald-700" : "text-slate-400"}`}>
        {up ? <Icons.ArrowUp /> : null}
        {change}
      </div>
    )}
  </div>
);

// ─── CAPACITY BAR ───
export const CapacityBar = ({ pct }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200/80">
    <div className={`h-full rounded-full transition-all ${pct > 80 ? "bg-amber-500" : pct > 50 ? "bg-sky-600" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
  </div>
);
