import { Icons } from './Icons';

// ─── STATUS BADGE ───
const STATUS_COLORS = {
  "Activo": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Inactivo": "bg-slate-100 text-slate-500 border-slate-200",
  "Creada": "bg-amber-50 text-amber-700 border-amber-200",
  "Asignada": "bg-blue-50 text-blue-700 border-blue-200",
  "Entregada": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Facturada": "bg-purple-50 text-purple-700 border-purple-200",
  "En progreso": "bg-blue-50 text-blue-700 border-blue-200",
  "Completada": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Programada": "bg-slate-50 text-slate-600 border-slate-200",
  "Cerrada": "bg-slate-200 text-slate-700 border-slate-300",
  "Confirmada": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "En proceso": "bg-amber-50 text-amber-700 border-amber-200",
  "Empaque": "bg-orange-50 text-orange-700 border-orange-200",
  "Producto Terminado": "bg-cyan-50 text-cyan-700 border-cyan-200",
  "Entrada": "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Salida": "bg-red-50 text-red-700 border-red-200",
  "Traspaso": "bg-blue-50 text-blue-700 border-blue-200",
  "Devolución": "bg-purple-50 text-purple-700 border-purple-200",
  "Merma": "bg-amber-50 text-amber-700 border-amber-200",
};
const DEFAULT_STATUS_COLOR = "bg-slate-50 text-slate-600 border-slate-200";
export const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${STATUS_COLORS[status] || DEFAULT_STATUS_COLOR}`}>
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
      {data.length > 0 && <div className="hidden md:block overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              {columns.map(col => (
                <th key={col.key + col.label} className="text-left text-xs font-semibold text-slate-400 uppercase tracking-wider py-3 px-4">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)} className="border-b border-slate-50 hover:bg-slate-50/50 transition-colors cursor-pointer group">
                {columns.map(col => (
                  <td key={col.key + col.label} className="py-3.5 px-4 text-sm">
                    {col.render ? col.render(row[col.key], row) : <span className={col.bold ? "font-semibold text-slate-800" : "text-slate-600"}>{row[col.key]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {/* ── MOBILE CARDS (hidden on desktop) ── */}
      {data.length > 0 && <div className="md:hidden space-y-2">
        {data.map((row, i) => {
          const badgeCol = columns.find(c => c.badge);
          return (
          <div key={i} onClick={() => onRowClick?.(row)} className="bg-white border border-slate-100 rounded-xl p-3.5 active:bg-slate-50 transition-colors cursor-pointer">
            {/* Card header: primary value + badge top-right */}
            <div className="flex items-start justify-between gap-2 mb-1.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-800 truncate">
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
            <div className="space-y-1">
              {secondaryCols.filter(c => !c.badge).map(col => {
                const val = col.render ? col.render(row[col.key], row) : row[col.key];
                if (val === undefined || val === null || val === "") return null;
                return (
                  <div key={col.key + col.label} className="flex items-center justify-between text-xs gap-2">
                    <span className="text-slate-400 flex-shrink-0">{col.label}</span>
                    <span className="text-slate-700 font-medium text-right truncate min-w-0">{val}</span>
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
  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 sm:mb-6">
    <div>
      <h1 className="text-lg sm:text-xl font-bold text-slate-800 tracking-tight">{title}</h1>
      {subtitle && <p className="text-xs sm:text-sm text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      {extraButtons}
      {action && (
        <button onClick={action} className="inline-flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold px-4 py-3 sm:py-2.5 rounded-xl transition-colors shadow-sm shadow-blue-200 min-h-[44px]">
          {actionIcon || <Icons.Plus />} {actionLabel}
        </button>
      )}
    </div>
  </div>
);

// ─── STAT CARD ───
export const StatCard = ({ label, value, unit, change, up, icon: IconComp }) => (
  <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5 hover:shadow-md hover:shadow-slate-100/50 transition-all">
    <div className="flex items-start justify-between mb-2 sm:mb-3">
      <span className="text-xs font-semibold text-slate-400 uppercase tracking-wider">{label}</span>
      <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-blue-50 flex items-center justify-center text-blue-500">
        <IconComp />
      </div>
    </div>
    <div className="flex items-baseline gap-1.5 sm:gap-2">
      <span className="text-xl sm:text-2xl font-extrabold text-slate-800 tracking-tight">{value}</span>
      <span className="text-xs text-slate-400 font-medium">{unit}</span>
    </div>
    {change && (
      <div className={`flex items-center gap-1 mt-1.5 sm:mt-2 text-xs font-semibold ${up ? "text-emerald-600" : "text-slate-400"}`}>
        {up ? <Icons.ArrowUp /> : null}
        {change}
      </div>
    )}
  </div>
);

// ─── CAPACITY BAR ───
export const CapacityBar = ({ pct }) => (
  <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
    <div className={`h-full rounded-full transition-all ${pct > 80 ? "bg-amber-500" : pct > 50 ? "bg-blue-500" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
  </div>
);
