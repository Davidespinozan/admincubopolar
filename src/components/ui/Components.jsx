import { Icons } from './Icons';
import { EmptyState } from './Skeleton';

// Primitivas del sistema "CUBOPOLAR 2026" (docs/sistema/diseno.md): lienzo
// neutro, superficies blancas con línea fina, radios 14/20/28, una tinta, un
// acento. Toda vista usa estas piezas; nada se dibuja a mano.

// ─── STATUS BADGE ───
const STATUS_COLORS = {
  "Activo": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Activa": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Revertida": "bg-slate-100 text-slate-600 border-slate-200",
  "Inactivo": "bg-slate-100 text-slate-600 border-slate-200",
  "Creada": "bg-amber-50 text-amber-800 border-amber-100",
  "Asignada": "bg-sky-50 text-sky-800 border-sky-100",
  "En ruta": "bg-blue-50 text-blue-800 border-blue-100",
  "Entregada": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "No entregada": "bg-amber-50 text-amber-800 border-amber-100",
  "Facturada": "bg-cyan-50 text-cyan-800 border-cyan-100",
  "En progreso": "bg-sky-50 text-sky-800 border-sky-100",
  "Completada": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Programada": "bg-slate-100 text-slate-700 border-slate-200",
  "Cerrada": "bg-slate-200/70 text-slate-800 border-slate-300/70",
  "Confirmada": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "En proceso": "bg-amber-50 text-amber-800 border-amber-100",
  "Empaque": "bg-orange-50 text-orange-800 border-orange-100",
  "Producto Terminado": "bg-cyan-50 text-cyan-800 border-cyan-100",
  "Entrada": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Salida": "bg-red-50 text-red-800 border-red-100",
  "Traspaso": "bg-sky-50 text-sky-800 border-sky-100",
  "Devolución": "bg-violet-50 text-violet-800 border-violet-100",
  "Merma": "bg-amber-50 text-amber-800 border-amber-100",
  "Pendiente": "bg-amber-50 text-amber-800 border-amber-100",
  "Pagada": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Vencida": "bg-red-50 text-red-800 border-red-100",
  "OK": "bg-emerald-50 text-emerald-800 border-emerald-100",
  "Bajo": "bg-red-50 text-red-800 border-red-100",
};
const DEFAULT_STATUS_COLOR = "bg-slate-100 text-slate-700 border-slate-200";
export const StatusBadge = ({ status }) => (
  <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none ${STATUS_COLORS[status] || DEFAULT_STATUS_COLOR}`}>
    {status}
  </span>
);

// ─── ALERT BADGE ───
export const AlertBadge = ({ tipo }) => {
  const c = { critica: "bg-red-500", accionable: "bg-amber-500", info: "bg-blue-400" };
  return <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c[tipo]}`} />;
};

// ─── ADAPTIVE DATA TABLE ───
// Desktop: tabla | Móvil: tarjetas apiladas (misma fuente, sin duplicar).
//   columns: [{ key, label, bold, render, primary, hideOnMobile, badge }]
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

      {data.length > 0 && <div className="hidden overflow-x-auto rounded-card border border-line bg-white shadow-card md:block">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line bg-slate-50/80">
              {columns.map(col => (
                <th key={col.key + col.label} className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500">{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => (
              <tr key={i} onClick={() => onRowClick?.(row)} className="cursor-pointer border-b border-line/80 transition-colors hover:bg-slate-50 group">
                {columns.map(col => (
                  <td key={col.key + col.label} className="px-4 py-3.5 text-sm tnum">
                    {col.render ? col.render(row[col.key], row) : <span className={col.bold ? "font-semibold text-ink" : "text-slate-600"}>{row[col.key]}</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>}

      {data.length > 0 && <div className="space-y-2 md:hidden">
        {data.map((row, i) => {
          const badgeCol = columns.find(c => c.badge);
          return (
          <div key={i} onClick={() => onRowClick?.(row)} className="cursor-pointer rounded-card border border-line bg-white p-3.5 shadow-card transition-colors active:bg-slate-50">
            <div className="mb-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="line-clamp-2 text-[15px] font-semibold leading-snug text-ink [&_.truncate]:whitespace-normal">
                  {cardTitle ? cardTitle(row) : (primaryCol.render ? primaryCol.render(row[primaryCol.key], row) : row[primaryCol.key])}
                </div>
                {cardSubtitle && <div className="mt-0.5 text-[13px] text-slate-500">{cardSubtitle(row)}</div>}
              </div>
              {badgeCol && (
                <div className="flex-shrink-0">
                  {badgeCol.render ? badgeCol.render(row[badgeCol.key], row) : <StatusBadge status={row[badgeCol.key]} />}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              {secondaryCols.filter(c => !c.badge).map(col => {
                const val = col.render ? col.render(row[col.key], row) : row[col.key];
                if (val === undefined || val === null || val === "") return null;
                return (
                  <div key={col.key + col.label} className="flex items-start justify-between gap-3 text-[13px]">
                    <span className="flex-shrink-0 text-slate-500">{col.label}</span>
                    <span className="min-w-0 break-words text-right font-medium text-slate-800 tnum">{val}</span>
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
// Móvil: el título vive en la barra superior del shell; aquí solo las acciones.
// sm+: título, subtítulo y acciones en una fila.
export const PageHeader = ({ title, subtitle, action, actionLabel, actionIcon, extraButtons }) => (
  <div className={`mb-3 flex-col gap-3 sm:mb-6 sm:flex sm:flex-row sm:items-center sm:justify-between ${action || extraButtons ? 'flex' : 'hidden'}`} data-testid="page-header">
    <div className="hidden min-w-0 sm:block">
      <h1 className="font-display text-[1.5rem] font-bold text-ink">{title}</h1>
      {subtitle && <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>}
    </div>
    <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap sm:flex-shrink-0">
      {extraButtons}
      {action && (
        <button onClick={action} className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-field bg-ink px-4 py-2.5 text-sm font-semibold text-white shadow-cta transition-colors hover:bg-slate-800">
          {actionIcon || <Icons.Plus />} {actionLabel}
        </button>
      )}
    </div>
  </div>
);

// ─── ICON BUTTON ───
// Botón de solo icono (acciones de fila, cabecera): 40 px, área táctil 44.
export const IconButton = ({ icon, label, onClick, tone = "neutral", className = "", disabled }) => {
  const Ic = Icons[icon] || Icons.MoreH;
  const tones = {
    neutral: "text-slate-500 hover:bg-slate-100 hover:text-ink",
    danger: "text-red-600 hover:bg-red-50",
    accent: "text-accent hover:bg-accent-soft",
  };
  return (
    <button type="button" onClick={onClick} disabled={disabled} aria-label={label} title={label}
      className={`inline-flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] transition-colors disabled:opacity-40 ${tones[tone] || tones.neutral} ${className}`}>
      <Ic />
    </button>
  );
};

// ─── STAT CARD ───
export const StatCard = ({ label, value, unit, change, up, icon: IconComp }) => (
  <div className="rounded-card border border-line bg-white p-4 shadow-card sm:p-5">
    <div className="mb-2 flex items-start justify-between sm:mb-3">
      <SectionLabel>{label}</SectionLabel>
      {IconComp && <div className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-accent-soft text-accent"><IconComp /></div>}
    </div>
    <div className="flex items-baseline gap-1.5 sm:gap-2">
      <span className="font-display text-2xl font-bold text-ink tnum sm:text-[1.9rem]">{value}</span>
      {unit && <span className="text-xs font-medium text-slate-500">{unit}</span>}
    </div>
    {change && (
      <div className={`mt-1.5 flex items-center gap-1 text-xs font-semibold sm:mt-2 ${up ? "text-emerald-700" : "text-slate-500"}`}>
        {up ? <Icons.ArrowUp /> : null}
        {change}
      </div>
    )}
  </div>
);

// ─── CAPACITY BAR ───
export const CapacityBar = ({ pct }) => (
  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
    <div className={`h-full rounded-full transition-all ${pct > 80 ? "bg-amber-500" : pct > 50 ? "bg-sky-600" : "bg-emerald-500"}`} style={{ width: `${Math.min(100, pct)}%` }} />
  </div>
);

// ─── CARD ───
export const Card = ({ children, className = "", padding = "p-4 sm:p-5", tone }) => (
  <div className={`rounded-card border shadow-card ${
    tone === "success" ? "border-emerald-100 bg-emerald-50" :
    tone === "warning" ? "border-amber-100 bg-amber-50" :
    tone === "danger" ? "border-red-100 bg-red-50" :
    tone === "dark" ? "border-white/10 bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 text-slate-100" :
    "border-line bg-white"
  } ${padding} ${className}`}>
    {children}
  </div>
);

// ─── SECTION LABEL ───
export const SectionLabel = ({ children, className = "" }) => (
  <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-500 ${className}`}>{children}</p>
);

// ─── LIST ROW ───
// Fila de lista (clientes, empleados, rutas…): icono/avatar, título, subtítulo,
// valor a la derecha y chevron si navega. Dentro de `Card padding="p-0"` o suelta.
export const ListRow = ({ icon, avatar, title, subtitle, value, valueHint, badge, onClick, chevron, trailing, className = "" }) => {
  const Ic = icon ? (Icons[icon] || Icons.Package) : null;
  const Tag = onClick ? "button" : "div";
  return (
    <Tag type={onClick ? "button" : undefined} onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left ${onClick ? "transition-colors active:bg-slate-50" : ""} ${className}`}>
      {avatar !== undefined && (
        <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-bold text-accent">{String(avatar || '?').charAt(0).toUpperCase()}</span>
      )}
      {Ic && <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-600"><Ic /></span>}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-semibold text-ink">{title}</span>
        {subtitle && <span className="mt-0.5 block truncate text-[13px] text-slate-500">{subtitle}</span>}
      </span>
      {(value !== undefined || badge) && (
        <span className="flex flex-shrink-0 flex-col items-end gap-1">
          {value !== undefined && <span className="text-[15px] font-semibold text-ink tnum">{value}</span>}
          {valueHint && <span className="text-[11px] text-slate-500">{valueHint}</span>}
          {badge}
        </span>
      )}
      {trailing}
      {chevron && <span className="flex-shrink-0 text-slate-400"><Icons.ChevronRight /></span>}
    </Tag>
  );
};

// ─── CHIPS (filtros desplazables) ───
export const Chips = ({ items, value, onChange, className = "" }) => (
  <div className={`no-scrollbar -mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0 ${className}`} role="tablist">
    {items.map(t => {
      const active = value === t.k;
      return (
        <button key={t.k} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.k)}
          className={`inline-flex min-h-[40px] flex-shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition-colors ${
            active ? "border-ink bg-ink text-white" : "border-line bg-white text-slate-600"}`}>
          {t.l}{t.n != null && <span className={`rounded-full px-1.5 text-[11px] ${active ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{t.n}</span>}
        </button>
      );
    })}
  </div>
);

// ─── ROLE HEADER ───
// Cabecera oscura de las vistas por rol (Chofer en modo enfoque): marca, título,
// bienvenida y acciones. `compact`: título más chico, contenido antes.
const ACCENTS = {
  amber:   "text-amber-200/90",
  emerald: "text-emerald-200/90",
  sky:     "text-sky-200/90",
  cyan:    "text-cyan-200/90",
};
export const RoleHeader = ({ kicker, title, subtitle, accent = "cyan", onLogout, logoutLabel = "Salir", right, children, compact = false }) => (
  <header className={`bg-gradient-to-b from-blue-950 via-slate-900 to-slate-900 px-4 text-slate-100 ${compact ? "pb-3" : "pb-5"}`}
    style={{ paddingTop: compact ? "max(env(safe-area-inset-top, 0px), 0.75rem)" : "max(env(safe-area-inset-top, 44px), 44px)" }}>
    <div className="mx-auto w-full max-w-[640px] md:max-w-3xl lg:max-w-5xl">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {kicker && <p className={`erp-kicker ${ACCENTS[accent] || ACCENTS.cyan}`}>{compact ? <><span className="text-white/60">CUBOPOLAR</span> · {kicker}</> : kicker}</p>}
          <h1 className={`font-display font-bold text-white ${compact ? "text-[1.35rem]" : "text-[1.7rem]"}`}>{title}</h1>
          {subtitle && <p className="truncate text-[13px] text-slate-300">{subtitle}</p>}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          {right}
          {onLogout && (
            <button onClick={onLogout} className="inline-flex min-h-[40px] items-center justify-center rounded-[12px] border border-white/10 bg-white/10 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-white/15">
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
  <div className={`rounded-card border border-white/10 bg-white/10 p-3.5 ${className}`}>
    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-300">{label}</p>
    <p className="mt-1.5 font-display text-2xl font-bold text-white tnum">{value}</p>
  </div>
);

// ─── SEGMENTED TABS ───
// Control segmentado (≤ 4 opciones): pista gris, píldora activa. `accent`
// colorea la píldora en las vistas por rol (emerald Ventas, blue Producción).
const SEG_ACTIVE = {
  slate:   "bg-white text-ink shadow-[0_1px_2px_rgba(11,18,32,0.08),0_2px_8px_rgba(11,18,32,0.06)]",
  emerald: "bg-emerald-600 text-white shadow-[0_6px_16px_-8px_rgba(5,150,105,0.6)]",
  blue:    "bg-blue-600 text-white shadow-[0_6px_16px_-8px_rgba(37,99,235,0.6)]",
  amber:   "bg-amber-600 text-white shadow-[0_6px_16px_-8px_rgba(217,119,6,0.6)]",
};
export const SegmentedTabs = ({ items, value, onChange, accent = "slate", className = "" }) => (
  <div className={`grid gap-1 rounded-[14px] bg-slate-900/[0.06] p-1 ${className}`}
    style={{ gridTemplateColumns: `repeat(${Math.max(1, items.length)}, minmax(0, 1fr))` }} role="tablist">
    {items.map(t => {
      const Ic = t.icon ? Icons[t.icon] : null;
      const active = value === t.k;
      return (
        <button key={t.k} type="button" role="tab" aria-selected={active} onClick={() => onChange(t.k)}
          className={`inline-flex min-h-[40px] items-center justify-center gap-1.5 rounded-[11px] px-2 py-2 text-[13px] font-semibold transition-all ${active ? (SEG_ACTIVE[accent] || SEG_ACTIVE.slate) : "text-slate-600 hover:text-ink"}`}>
          {Ic && <span className="[&>svg]:h-4 [&>svg]:w-4"><Ic /></span>}
          <span className="truncate">{t.l}</span>
        </button>
      );
    })}
  </div>
);

// ─── CHOICE BUTTON ───
// Opción de captura táctil (producto, método de pago, turno, cuarto, causa…).
const CHOICE_ACTIVE = {
  slate:   "border-ink bg-ink text-white",
  blue:    "border-blue-500 bg-blue-50 text-blue-800",
  emerald: "border-emerald-500 bg-emerald-50 text-emerald-800",
  amber:   "border-amber-500 bg-amber-50 text-amber-800",
  red:     "border-red-500 bg-red-50 text-red-800",
  cyan:    "border-cyan-500 bg-cyan-50 text-cyan-800",
};
export const ChoiceButton = ({ active, tone = "blue", onClick, children, className = "", disabled }) => (
  <button type="button" onClick={onClick} disabled={disabled} aria-pressed={!!active}
    className={`min-h-[48px] rounded-field border-2 px-3 py-2.5 text-[14px] font-semibold leading-tight transition-colors ${
      active ? (CHOICE_ACTIVE[tone] || CHOICE_ACTIVE.blue) : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
    } ${disabled ? "opacity-40 cursor-not-allowed" : ""} ${className}`}>
    {children}
  </button>
);

// ─── KPI TILE ───
// Cifra de cabecera: etiqueta 11 px, cifra tabular, pista. En `grid grid-cols-2`.
export const KpiTile = ({ label, value, hint, compact = false, tone, children, className = "" }) => (
  <div className={`rounded-card border p-4 shadow-card ${
    tone === "success" ? "border-emerald-100 bg-emerald-50" :
    tone === "warning" ? "border-amber-100 bg-amber-50" :
    tone === "danger" ? "border-red-100 bg-red-50" :
    tone === "accent" ? "border-transparent bg-ink text-white" :
    "border-line bg-white"} ${className}`}>
    <p className={`text-[11px] font-semibold uppercase tracking-[0.08em] ${tone === "accent" ? "text-white/60" : "text-slate-500"}`}>{label}</p>
    <p className={compact
      ? `mt-1 truncate text-base font-bold ${tone === "accent" ? "text-white" : "text-ink"}`
      : `mt-1 font-display text-2xl font-bold tnum ${tone === "accent" ? "text-white" : tone === "danger" ? "text-red-700" : tone === "warning" ? "text-amber-700" : tone === "success" ? "text-emerald-700" : "text-ink"}`}>{value}</p>
    {hint && <p className={`mt-0.5 text-xs ${tone === "accent" ? "text-white/60" : "text-slate-500"}`}>{hint}</p>}
    {children ? <div className="mt-2">{children}</div> : null}
  </div>
);

// ─── BOTTOM NAV (móvil) ───
// Barra inferior con la marca oscura (misma del menú y del sidebar): 5 destinos,
// activo con píldora de acento. Se oculta en lg+ (manda el sidebar).
const BN_ITEM = "flex min-h-[56px] min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] font-medium transition-colors";
const BN_ICON = "flex h-8 w-12 items-center justify-center rounded-full transition-colors [&>svg]:h-5 [&>svg]:w-5";
const bnItem = (active) => `${BN_ITEM} ${active ? "text-white font-semibold" : "text-slate-400 hover:text-white"}`;
const bnIcon = (active) => `${BN_ICON} ${active ? "bg-cyan-400/20 text-cyan-200" : "text-slate-400"}`;
export const BottomNav = ({ items, value, onChange, onMas, mas = false, masActivo = false }) => (
  <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-gradient-to-t from-blue-950 via-slate-900 to-slate-900 text-slate-100 lg:hidden"
    style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }} aria-label="Navegación principal" data-testid="bottom-nav">
    <div className="mx-auto grid w-full max-w-3xl px-1" style={{ gridTemplateColumns: `repeat(${items.length + (mas ? 1 : 0)}, minmax(0, 1fr))` }}>
      {items.map(it => {
        const Ic = Icons[it.icon] || Icons.Package;
        const active = value === it.id;
        return (
          <button key={it.id} type="button" onClick={() => onChange(it.id)} aria-current={active ? "page" : undefined} aria-label={it.label} className={bnItem(active)}>
            <span className={bnIcon(active)}><Ic /></span>
            <span className="w-full truncate text-center">{it.label}</span>
          </button>
        );
      })}
      {mas && (
        <button type="button" onClick={onMas} aria-label="Más módulos" aria-expanded={false} className={bnItem(masActivo)}>
          <span className={bnIcon(masActivo)}><Icons.MoreH /></span>
          <span className="w-full truncate text-center">Más</span>
        </button>
      )}
    </div>
  </nav>
);
