import { Icons } from './Icons';
import { EmptyState } from './Skeleton';

// ─── STATUS BADGE ───
const STATUS_COLORS = {
  "Activo": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Activa": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Revertida": "bg-slate-100/80 text-slate-600 border-slate-200/80",
  "Inactivo": "bg-slate-100/90 text-slate-600 border-slate-200",
  "Creada": "bg-amber-100/80 text-amber-900 border-amber-200/80",
  "Asignada": "bg-sky-100/90 text-sky-900 border-sky-200/80",
  "En ruta": "bg-blue-100/80 text-blue-900 border-blue-200/80",
  "Entregada": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "No entregada": "bg-amber-100/80 text-amber-900 border-amber-200/80",
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
  // Fase A: nivel de existencia (vistas por rol).
  "OK": "bg-emerald-100/80 text-emerald-900 border-emerald-200/80",
  "Bajo": "bg-red-100/80 text-red-900 border-red-200/80",
};
const DEFAULT_STATUS_COLOR = "bg-slate-100/90 text-slate-700 border-slate-200/90";
export const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_COLORS[status] || DEFAULT_STATUS_COLOR}`}>
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
export const DataTable = ({
  columns,
  data,
  onRowClick,
  cardTitle,
  cardSubtitle,
  emptyMessage,
  emptyHint,
  emptyCta,
  onEmptyCta,
  emptySecondaryLabel,
  onEmptySecondary,
  emptyIcon,
}) => {
  // Determine which column is "primary" for card title
  const primaryCol = columns.find(c => c.primary) || columns.find(c => c.bold) || columns[0];
  const secondaryCols = columns.filter(c => c !== primaryCol && !c.hideOnMobile);

  return (
    <div>
      {data.length === 0 && (
        <EmptyState
          message={emptyMessage || 'Sin datos'}
          hint={emptyHint}
          cta={emptyCta}
          onCta={onEmptyCta}
          secondaryLabel={emptySecondaryLabel}
          onSecondary={onEmptySecondary}
          icon={emptyIcon}
        />
      )}

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
          <div key={i} onClick={() => onRowClick?.(row)} className="cursor-pointer rounded-[20px] border border-slate-200/80 bg-white/80 p-3 shadow-[0_8px_20px_rgba(8,20,27,0.05)] transition-colors active:bg-slate-50 sm:p-4">
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
  <div className="mb-3 flex flex-col gap-3 rounded-[22px] border border-slate-200/80 bg-white/60 px-3 py-2.5 shadow-[0_12px_24px_rgba(8,20,27,0.05)] backdrop-blur-xl sm:mb-6 sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:rounded-[28px] sm:px-5 sm:py-4.5">
    <div className="min-w-0">
      <h1 className="font-display text-base font-bold tracking-[-0.03em] text-slate-900 sm:text-[1.6rem]">{title}</h1>
      {subtitle && <p className="hidden text-xs text-slate-500 sm:block sm:mt-1 sm:text-sm">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:flex-shrink-0">
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

// ─── CARD ───
// Fase A: la tarjeta de contenido del shell de Administración (misma familia
// que StatCard / DataTable móvil) para que las vistas por rol no repitan
// bordes, radios y sombras a mano.
export const Card = ({ children, className = "", padding = "p-4 sm:p-5", tone }) => (
  <div className={`rounded-card border shadow-card ${
    tone === "success" ? "border-emerald-200/80 bg-emerald-50/80" :
    tone === "warning" ? "border-amber-200/80 bg-amber-50/80" :
    tone === "danger" ? "border-red-200/80 bg-red-50/80" :
    "border-slate-200/80 bg-white/80"
  } ${padding} ${className}`}>
    {children}
  </div>
);

// ─── SECTION LABEL ───
// Etiqueta de sección en mayúsculas (la misma de DataTable y StatCard).
export const SectionLabel = ({ children, className = "" }) => (
  <p className={`text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400 ${className}`}>{children}</p>
);

// ─── ROLE HEADER ───
// Fase A: cabecera de las vistas por rol (Almacén Bolsas, Ventas, Producción,
// Chofer) con el lenguaje del shell de Administración: el mismo degradado
// oscuro del aside, kicker, título display y el nombre del usuario. El rol
// solo aporta un acento de color; el marco es el mismo producto.
//   kicker/title/subtitle: textos. accent: 'amber' | 'emerald' | 'sky' | 'cyan'.
//   onLogout/logoutLabel: botón de salida (en "Ver como" devuelve a Admin).
//   right: nodos extra junto al botón (p. ej. firmas pendientes).
//   children: contenido bajo el título (KPIs, nota).
const ACCENTS = {
  amber:   "text-amber-200/80",
  emerald: "text-emerald-200/80",
  sky:     "text-sky-200/80",
  cyan:    "text-cyan-200/80",
};
//   compact (B2): modo operativo (Chofer): menos alto, marca CUBOPOLAR + rol en
//   una línea, título más chico; el contenido operativo aparece antes.
export const RoleHeader = ({ kicker, title, subtitle, accent = "cyan", onLogout, logoutLabel = "Salir", right, children, compact = false }) => (
  <header className={`bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 px-4 text-slate-100 shadow-[0_20px_50px_rgba(8,20,27,0.18)] ${compact ? "pb-3" : "pb-5"}`}
    style={{ paddingTop: compact ? "max(env(safe-area-inset-top, 0px), 0.75rem)" : "max(env(safe-area-inset-top, 44px), 44px)" }}>
    <div className="mx-auto w-full max-w-[640px] md:max-w-3xl lg:max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker && <p className={`erp-kicker ${ACCENTS[accent] || ACCENTS.cyan}`}>{compact ? <><span className="text-white/60">CUBOPOLAR</span> · {kicker}</> : kicker}</p>}
          <h1 className={`font-display font-bold tracking-[-0.04em] text-white ${compact ? "text-[1.25rem] sm:text-[1.4rem]" : "text-[1.6rem] sm:text-[1.8rem]"}`}>{title}</h1>
          {subtitle && <p className="truncate text-xs text-slate-300">{subtitle}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {right}
          {onLogout && (
            <button onClick={onLogout} className="inline-flex min-h-[36px] items-center justify-center rounded-[13px] border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/15">
              {logoutLabel}
            </button>
          )}
        </div>
      </div>
      {children && <div className={compact ? "mt-3" : "mt-4"}>{children}</div>}
    </div>
  </header>
);

// Tarjeta de cifra para el RoleHeader (fondo oscuro).
export const HeaderStat = ({ label, value, className = "" }) => (
  <div className={`rounded-[22px] border border-white/10 bg-white/10 p-3.5 backdrop-blur-xl ${className}`}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-300">{label}</p>
    <p className="mt-1.5 font-display text-2xl font-bold tracking-[-0.04em] text-white">{value}</p>
  </div>
);

// ─── SEGMENTED TABS ───
// Fase A3: control segmentado de las vistas por rol (Ventas, Producción).
// En el shell compartido las mismas pestañas viven en el menú lateral; en
// móvil este control es el acceso con una mano. `items`: [{ k, l, icon? }].
const SEG_ACTIVE = {
  slate:   "bg-slate-900 text-white shadow-[0_12px_22px_rgba(8,20,27,0.16)]",
  emerald: "bg-emerald-600 text-white shadow-[0_12px_22px_rgba(5,150,105,0.14)]",
  blue:    "bg-blue-600 text-white shadow-[0_12px_22px_rgba(37,99,235,0.14)]",
  amber:   "bg-amber-600 text-white shadow-[0_12px_22px_rgba(217,119,6,0.14)]",
};
export const SegmentedTabs = ({ items, value, onChange, accent = "slate", className = "" }) => (
  <div className={`grid gap-1 rounded-[20px] border border-slate-200/80 bg-white/70 p-1.5 shadow-panel ${className}`}
    style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }} role="tablist">
    {items.map(t => {
      const Ic = t.icon ? Icons[t.icon] : null;
      const active = value === t.k;
      return (
        <button key={t.k} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.k)}
          className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-[16px] px-2 py-2.5 text-sm font-semibold transition-all ${active ? (SEG_ACTIVE[accent] || SEG_ACTIVE.slate) : "text-slate-600 hover:bg-slate-900/[0.04]"}`}>
          {Ic && <span className="[&>svg]:h-4 [&>svg]:w-4"><Ic /></span>}
          <span className="truncate">{t.l}</span>
        </button>
      );
    })}
  </div>
);

// ─── CHOICE BUTTON ───
// Fase A3: opción de captura táctil (producto, método de pago, turno, cuarto,
// causa…). Reemplaza los botones `border-2` que cada vista por rol dibujaba
// a mano. `active` + `tone` dan el estado seleccionado.
const CHOICE_ACTIVE = {
  slate:   "border-slate-900 bg-slate-900 text-white",
  blue:    "border-blue-500 bg-blue-50 text-blue-800",
  emerald: "border-emerald-500 bg-emerald-50 text-emerald-800",
  amber:   "border-amber-500 bg-amber-50 text-amber-800",
  red:     "border-red-500 bg-red-50 text-red-800",
  cyan:    "border-cyan-500 bg-cyan-50 text-cyan-800",
};
export const ChoiceButton = ({ active, tone = "blue", onClick, children, className = "", disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!active}
    className={`min-h-[44px] rounded-[16px] border-2 px-3 py-2.5 text-sm font-semibold transition-colors ${
      active ? (CHOICE_ACTIVE[tone] || CHOICE_ACTIVE.blue) : "border-slate-200 bg-white/80 text-slate-600 hover:bg-slate-50"
    } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}>
    {children}
  </button>
);

// ─── KPI ROW (contenido claro, dentro del shell) ───
// Cifras de cabecera de una vista por rol cuando la vista vive dentro del
// shell compartido (fondo claro): misma familia que StatCard, sin icono.
export const KpiTile = ({ label, value, hint, className = "" }) => (
  <div className={`rounded-card border border-slate-200/80 bg-white/80 p-4 shadow-card ${className}`}>
    <SectionLabel>{label}</SectionLabel>
    <p className="mt-1.5 font-display text-2xl font-bold tracking-[-0.05em] text-slate-900 sm:text-[1.8rem]">{value}</p>
    {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
  </div>
);

// ─── BOTTOM NAV (móvil) ───
// B3: navegación inferior fija para los roles en modo completo. Consume los
// mismos ids/iconos que el sidebar (navRolLogic.bottomNavParaRol); se oculta
// en lg+ donde manda el sidebar. `masActivo`: el módulo actual vive en el menú.
export const BottomNav = ({ items, value, onChange, onMas, mas = false, masActivo = false }) => (
  <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/80 bg-white/95 shadow-[0_-10px_30px_rgba(8,20,27,0.08)] backdrop-blur-xl lg:hidden"
    style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} aria-label="Navegación principal" data-testid="bottom-nav">
    <div className="mx-auto grid w-full max-w-3xl px-1" style={{ gridTemplateColumns: `repeat(${items.length + (mas ? 1 : 0)}, minmax(0, 1fr))` }}>
      {items.map(it => {
        const Ic = Icons[it.icon] || Icons.Package;
        const active = value === it.id;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)} aria-current={active ? "page" : undefined} aria-label={it.label}
            className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold transition-colors ${active ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
            <span className={`flex h-8 w-11 items-center justify-center rounded-[12px] transition-colors [&>svg]:h-5 [&>svg]:w-5 ${active ? "bg-slate-900 text-cyan-200" : "bg-transparent"}`}><Ic /></span>
            <span className="w-full truncate text-center">{it.label}</span>
          </button>
        );
      })}
      {mas && (
        <button type="button" onClick={onMas} aria-label="Más módulos" aria-expanded={false}
          className={`flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-semibold ${masActivo ? "text-slate-900" : "text-slate-500 hover:text-slate-700"}`}>
          <span className={`flex h-8 w-11 items-center justify-center rounded-[12px] [&>svg]:h-5 [&>svg]:w-5 ${masActivo ? "bg-slate-900 text-cyan-200" : "bg-transparent"}`}><Icons.MoreH /></span>
          <span className="w-full truncate text-center">Más</span>
        </button>
      )}
    </div>
  </nav>
);
