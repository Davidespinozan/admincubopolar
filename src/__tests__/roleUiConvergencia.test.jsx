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
// Quita comentarios JSX {/* */} y líneas //; no toca `accept="image/*"`.
const sinComentarios = (t) => t.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '');
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

describe('A4: Producción — presentación nueva, negocio idéntico', () => {
  const v = sinComentarios(src('../components/ProduccionStandaloneView.jsx'));
  it('usa primitivas compartidas; sin cabecera, hojas, toast ni bloqueo propios', () => {
    expect(v).toMatch(/SegmentedTabs items=\{TABS\} value=\{tab\} onChange=\{setTab\}/);
    expect((v.match(/<Modal open=/g) || []).length).toBe(5);
    expect(v).toMatch(/<BotonFirmasPendientes\s+user=\{user\}\s+data=\{data\}\s+actions=\{actions\}\s+mostrarBannerUrgente=\{true\}/);
    expect(v).not.toMatch(/from-blue-600 to-blue-800|rounded-t-\[30px\]|fixed inset-0|setToast|useBodyScrollLock|addEventListener\('keydown'/);
  });
  it('llamadas al store y argumentos idénticos', () => {
    expect(v).toMatch(/await actions\.producirYCongelar\(\{ \.\.\.datosProd, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.registrarMermaCuarto\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.registrarMermaCuarto\(\{ \.\.\.datosMerma, operacionId: opMerma\.id \}\)/);
    expect(v).toMatch(/await actions\.addTransformacion\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.traspasoEntreUbicaciones\(\{ \.\.\.tForm, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.sacarDeCuartoFrio\(sacarModal\.cfId, sacarForm\.sku, sacarForm\.cantidad, mot\.motivo, \{ operacionId: op\.id \}\)/);
    expect(new Set(v.match(/actions\.\w+/g))).toEqual(new Set(['actions.producirYCongelar', 'actions.registrarMermaCuarto', 'actions.addTransformacion', 'actions.traspasoEntreUbicaciones', 'actions.sacarDeCuartoFrio']));
    expect(v).toMatch(/supabase\.storage\s*\.from\('mermas'\)\s*\.upload\(filePath, fotoMermaFile/);
    expect(v).toMatch(/await supabase\.storage\.from\('mermas'\)\.remove\(\[filePath\]\);/);
  });
  it('validaciones, condiciones de deshabilitado y valores por defecto idénticos', () => {
    expect(v).toMatch(/if \(!mForm\.cantidad \|\| n\(mForm\.cantidad\) <= 0 \|\| !fotoMermaFile\) return;/);
    expect(v).toMatch(/if \(bolsaSku && n\(form\.cantidad\) > stockBolsa\) \{/);
    expect(v).toMatch(/const \{ puede, ocupadoActual, ocupadoFuturo, capacidad \} = puedeAgregarAlCuarto\(/);
    expect(v).toMatch(/if \(merma <= 0 \|\| merma > cant\) return;/);
    expect(v).toMatch(/const mot = motivoSalidaManual\(sacarForm\.motivo, sacarForm\.detalle\);/);
    expect(v).toMatch(/n\(form\.mermaCantidad\) > n\(form\.cantidad\) \|\|\s*!fotoMermaProdFile/);
    expect(v).toMatch(/disabled=\{haciendoTraspaso \|\| !tForm\.cantidad \|\| n\(tForm\.cantidad\) <= 0 \|\| tForm\.origen === tForm\.destino\}/);
    expect(v).toMatch(/disabled=\{haciendoSalida \|\| !sacarForm\.cantidad \|\| n\(sacarForm\.cantidad\) <= 0 \|\| !s\(sacarForm\.motivo\)\}/);
    expect(v).toMatch(/disabled=\{guardandoMerma \|\| !mForm\.cantidad \|\| n\(mForm\.cantidad\) <= 0 \|\| !fotoMermaFile\}/);
    expect(v).toMatch(/transOutputKg > transInputKg \|\| \(transStockInput !== null && transInputKg > transStockInput\)\}/);
    expect(v).toMatch(/useState\(\{ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" \}\)/);
    expect(v).toMatch(/const MERMA_CAUSAS = \["Bolsa rota", "Mal sellado", "Hielo derretido", "Falla de equipo", "Desmolde fallido", "Contaminación", "Otro"\];/);
    expect(v).toMatch(/\["Máquina 30", "Máquina 20", "Máquina 15"\]/);
    expect(v).toMatch(/\["Turno 1", "Turno 2", "Turno 3"\]/);
    expect(v).toMatch(/useState\("producir"\)/);
    expect(v).toMatch(/\{ k: "producir"[^}]*\}, \{ k: "cuartos"[^}]*\}, \{ k: "mermas"[^}]*\}, \{ k: "trans"[^}]*\}/);
    expect(v).toMatch(/onClose=\{cerrarProd\}/);
    expect(v).toMatch(/const cerrarProd = \(\) => \{ setModal\(false\); clearFotoMermaProd\(\); \};/);
    expect((v.match(/capture="environment"/g) || []).length).toBe(2);
  });
});
