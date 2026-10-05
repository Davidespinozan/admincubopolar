// roleUiConvergencia.test.jsx — Fases A3–A5 y B de la convergencia visual por
// rol. Cada vista por rol cambia de presentación pero conserva EXACTAMENTE sus
// llamadas de negocio, validaciones, alcance de datos, valores persistidos y
// flujo. Las primitivas nuevas se prueban por su salida.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { SegmentedTabs, ChoiceButton, KpiTile } from '../components/ui/Components';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const html = (el) => renderToStaticMarkup(el);

describe('A1+: primitivas nuevas (SegmentedTabs, ChoiceButton, KpiTile)', () => {
  it('SegmentedTabs marca la activa y expone role=tab', () => {
    const h = html(<SegmentedTabs items={[{ k: 'a', l: 'Uno', icon: 'Clock' }, { k: 'b', l: 'Dos' }]} value="b" onChange={() => {}} accent="emerald" />);
    expect(h).toMatch(/role="tablist"/);
    expect((h.match(/role="tab"/g) || []).length).toBe(2);
    expect(h).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/button>).)*Dos/);
    expect(h).toMatch(/bg-emerald-600/);
    expect(h).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
  });
  it('ChoiceButton: activo por tono, inactivo neutro, aria-pressed', () => {
    expect(html(<ChoiceButton active tone="amber">x</ChoiceButton>)).toMatch(/aria-pressed="true"[^>]*border-amber-500 bg-amber-50/);
    expect(html(<ChoiceButton>x</ChoiceButton>)).toMatch(/aria-pressed="false"[^>]*border-slate-200/);
    expect(html(<ChoiceButton disabled>x</ChoiceButton>)).toMatch(/disabled=""/);
  });
  it('KpiTile usa la familia de tarjetas del shell', () => {
    const h = html(<KpiTile label="Vendido hoy" value="$1,000" hint="hoy" />);
    expect(h).toMatch(/rounded-card border border-slate-200\/80 bg-white\/80/);
    expect(h).toMatch(/font-display/);
    expect(h).toMatch(/hoy/);
  });
});

describe('A3: Ventas — presentación nueva, negocio idéntico', () => {
  const v = sinComentarios(src('../components/VentasStandaloneView.jsx'));
  it('usa primitivas compartidas; sin cabecera, hoja, badge ni toast propios', () => {
    expect(v).toMatch(/import Modal, \{ FormInput, FormBtn \} from '\.\/ui\/Modal'/);
    expect(v).toMatch(/SegmentedTabs items=\{TABS\} value=\{tab\} onChange=\{setTab\}/);
    expect(v).toMatch(/<StatusBadge status=\{s\(o\.estatus\)\} \/>/);
    expect(v).toMatch(/<Modal open=\{!!pagoModal\}/);
    expect(v).toMatch(/data-testid="ventas-shell"/);
    expect(v).not.toMatch(/from-emerald-600 to-teal-600|rounded-t-\[30px\]|fixed inset-0|setLocalToast|useBodyScrollLock|bg-blue-100 text-blue-700/);
  });
  it('llamadas de negocio y argumentos idénticos', () => {
    expect(v).toMatch(/const result = await actions\.crearCheckoutPago\?\.\(pagoModal\.id, checkoutProvider\);/);
    expect(v).toMatch(/await actions\.updateOrdenEstatus\(pagoModal\.id, "Entregada", pagoForm\.metodo\);/);
    expect(v).toMatch(/actions\.updateOrdenEstatus\(o\.id, "Asignada"\); showToast\("Asignada a ruta"\);/);
    expect(v).toMatch(/const \[checkoutProvider\] = useState\('stripe'\);/);
    expect((v.match(/actions\.\w+/g) || []).sort()).toEqual(['actions.crearCheckoutPago', 'actions.updateOrdenEstatus', 'actions.updateOrdenEstatus']);
  });
  it('métodos de pago persistidos y flujo de cobro idénticos', () => {
    expect(v).toMatch(/const PAGOS = \["Efectivo", "Transferencia SPEI", "Tarjeta \(terminal\)", "QR \/ Link de pago", "Crédito \(fiado\)"\];/);
    expect(v).toMatch(/if \(pagoForm\.metodo === "QR \/ Link de pago"\) \{/);
    expect(v).toMatch(/pagoForm\.metodo\.includes\("Crédito"\) \|\| pagoForm\.metodo\.includes\("fiado"\) \? "Venta a crédito registrada" : "Cobrado — " \+ pagoForm\.metodo/);
    expect(v).toMatch(/pagoForm\.metodo === "Transferencia SPEI" &&/);
    expect(v).toMatch(/disabled=\{generandoLink \|\| confirmandoCobro\}/);
    expect(v).toMatch(/const cobrar = \(ord\) => \{ setPagoModal\(ord\); setPagoForm\(\{ metodo: "Efectivo", referencia: "" \}\); setCheckoutUrl\(null\); setShortUrl\(null\); \};/);
  });
  it('alcance por vendedor y vista previa de Admin idénticos', () => {
    const owned = v.slice(v.indexOf('const isOwnedBy = useCallback'), v.indexOf('}, [user]);'));
    expect(owned).toMatch(/const ownerKeys = \['usuario_id', 'vendedor_id', 'owner_id', 'created_by'\];/);
    expect(owned).toMatch(/const authKeys = \['auth_id', 'usuario_auth_id', 'vendedor_auth_id'\];/);
    expect(owned).toMatch(/const nameKeys = \['usuario', 'vendedor'\];/);
    expect(v).toMatch(/const isAdminPreview = user\?\.rol === 'Admin';/);
    expect(v).toMatch(/isAdminPreview \? \(data\.ordenes \|\| \[\]\) : \(data\.ordenes \|\| \[\]\)\.filter\(o => isOwnedBy\(o\)\)/);
    expect(v).toMatch(/o\.fecha && o\.fecha\.slice\(0, 10\) === hoy/);
    expect(v).toMatch(/ordenesUsuario\.filter\(o => o\.estatus === "Creada"\)/);
  });
  it('pestañas, pestaña inicial y NuevaVentaModal idénticos (controlables por el shell)', () => {
    expect(v).toMatch(/\{ k: "ventas", l: "Por cobrar"[^}]*\}, \{ k: "hoy", l: "Hoy"[^}]*\}, \{ k: "todas", l: "Todas"[^}]*\}/);
    expect(v).toMatch(/useState\("ventas"\)/);
    expect(v).toMatch(/const tab = tabProp \?\? tabLocal;/);
    expect(v).toMatch(/variant="standalone"/);
    expect(v).toMatch(/toast=\{toast\}/);
    expect(v).toMatch(/if \(orden\) \{\s*showToast\('Orden creada — ahora cobra'\);\s*cobrar\(orden\);/);
  });
});
