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

describe('A5: Chofer — modo enfoque con la identidad del producto; flujo, offline, GPS, fotos y firma idénticos', () => {
  const v = sinComentarios(src('../components/ChoferView.jsx'));
  it('conserva la máquina de pasos y el chrome de enfoque (sin sidebar); sin toast ni hojas propias', () => {
    expect(v).toMatch(/const step = stepOverride \?\? \(rutaEnProgreso \? 'ruta' : \(rutaPendienteFirma \? 'esperando-firma' : \(rutaCargada \? 'cargada' : 'cargar'\)\)\);/);
    for (const st of ['"cargar"', '"esperando-firma"', '"cargada"', '"ruta"', '"cierre"']) expect(v).toMatch(new RegExp(`if \\(step === ${st}\\)`));
    expect((v.match(/data-testid="chofer-shell"/g) || []).length).toBe(5);
    expect((v.match(/<RoleHeader /g) || []).length).toBe(5);
    expect((v.match(/<Modal open=/g) || []).length).toBe(6);
    expect(v).not.toMatch(/bg-\[#07131a\]|rounded-t-\[30px\]|fixed inset-0|setToast|useBodyScrollLock|function Toast/);
    expect(v).toMatch(/fixed bottom-0 left-1\/2 z-40/);   // barra de acciones fija en ruta
    expect(v).toMatch(/<BannerColaOffline online=\{online\} cola=\{colaOffline\} sincronizando=\{sincronizando\} onSincronizar=\{sincronizarCola\} \/>/);
  });
  it('cola offline, GPS, fotos y firma: código idéntico', () => {
    expect(v).toMatch(/useColaOffline\(\{ rutaId: miRutaActiva\?\.id, ejecutores: ejecutoresOffline, avisar: showToast \}\)/);
    expect(v).toMatch(/encolarOffline\(TIPOS_MUTACION\.ENTREGA, \{\s*ordenId: entregaModal\.id,\s*metodoPago: cobroMetodo,\s*folioNota: folioNota \|\| null,\s*\}\)/);
    expect(v).toMatch(/supabase\.from\('chofer_ubicaciones'\)\.insert\(\{\s*ruta_id: miRutaActiva\.id,\s*chofer_id: user\.id,/);
    expect(v).toMatch(/const interval = setInterval\(enviarUbicacion, 30000\);/);
    expect((v.match(/capture="environment"/g) || []).length).toBe(3);
    expect(v).toMatch(/const validErr = validarCobroTransferencia\(\{ metodoPago: cobroMetodo, fotoTransf \}\);/);
    expect(v).toMatch(/const firmaBase64 = canvas\.toDataURL\('image\/png'\);/);
    expect(v).toMatch(/el\.getContext\('2d'\)\.scale\(2, 2\);/);
    expect(v).toMatch(/const ordenesEnColaOffline = useMemo\(\(\) => ordenesBloqueadas\(colaOffline\), \[colaOffline\]\);/);
  });
  it('llamadas al store, argumentos y precondiciones de cierre idénticos', () => {
    expect(new Set(v.match(/actions\.\w+/g))).toEqual(new Set(['actions.updateOrdenEstatus', 'actions.marcarNoEntregada', 'actions.solicitarFirmaCarga', 'actions.firmarCarga', 'actions.crearCheckoutPago', 'actions.updateRutaEstatus', 'actions.prepararCierreRuta', 'actions.finalizarInventarioRuta']));
    expect(v).toMatch(/await actions\.updateOrdenEstatus\(entregaModal\.id, "Entregada", cobroMetodo, \{ folioNota: folioNota \|\| null \}\)/);
    expect(v).toMatch(/await actions\.solicitarFirmaCarga\?\.\(miRutaActiva\.id, cargaRealNum\);/);
    expect(v).toMatch(/await actions\.updateRutaEstatus\(miRutaActiva\.id, 'En progreso'\);/);
    expect(v).toMatch(/if \(!online\) \{\s*showToast\('Sin señal — busca conexión para cerrar la ruta', 'info'\);\s*return;\s*\}/);
    expect(v).toMatch(/if \(pendientesCola\(\)\.length > 0\) \{\s*showToast\('Sincronizando pendientes…', 'info'\);\s*await sincronizarCola\(\);/);
    expect(v).toMatch(/const PAGOS = \["Efectivo", "Transferencia", "Tarjeta", "QR \/ Link de pago", "Crédito"\];/);
    expect(v).toMatch(/const MERMA_CAUSAS = \["Bolsa rota", "Hielo derretido", "Daño transporte", "Rechazo cliente"\];/);
    expect(v).toMatch(/disabled=\{cerrandoRuta \|\| !balanceCierre \|\| Object\.keys\(difConteo\.faltante\)\.length > 0 \|\| Object\.keys\(difConteo\.sobrante\)\.length > 0\}/);
    expect(v).toMatch(/disabled=\{creandoVenta\|\|!vForm\.cant\|\|n\(vForm\.cant\)<=0\|\|n\(vForm\.cant\)>\(restante\[vForm\.sku\]\|\|0\)\|\|\(vForm\.factura&&!!errorFacturaExpress\)\}/);
    expect(v).toMatch(/disabled=\{registrandoMerma\|\|!mForm\.cant\|\|n\(mForm\.cant\)<=0\|\|!fotoMerma\}/);
    expect(v).toMatch(/const disabled = generandoLink \|\| confirmandoEntrega \|\| faltaFotoTransf;/);
    expect(v).toMatch(/localStorage\.removeItem\('mermas_ruta_' \+ miRutaActiva\.id\);\s*localStorage\.removeItem\('entregas_ruta_' \+ miRutaActiva\.id\);/);
  });
});

describe('B2: pulido visual e integración en el shell (solo presentación)', () => {
  it('BarraVistaPrevia: una línea de 36px con PREVIEW, rol, aviso de datos sin recorte y "Volver a Admin"', async () => {
    const { default: BarraVistaPrevia, ALTO_BARRA_VISTA_PREVIA } = await import('../components/ui/BarraVistaPrevia');
    const h = html(<BarraVistaPrevia rol="Chofer" onVolver={() => {}} />);
    expect(ALTO_BARRA_VISTA_PREVIA).toBe(36);
    expect(h).toMatch(/h-9/);
    expect(h).toMatch(/Vista previa/);
    expect(h).toMatch(/Chofer/);
    expect(h).toMatch(/Ves TODOS los datos como Admin; cada usuario real solo ve lo suyo/);
    expect(h).toMatch(/Volver a Admin/);
    expect(h).toMatch(/z-\[110\]/);
    expect(h).toMatch(/bg-slate-950\/95/);
    const app = src('../App.jsx');
    expect(app).toMatch(/<BarraVistaPrevia rol=\{adminViewAs\} onVolver=\{\(\) => setAdminViewAs\(null\)\} \/>/);
    expect(app).toMatch(/offsetSuperior=\{topPaddingPx\}/);
    expect(app).toMatch(/if \(isAdmin && adminViewAs\) \{\s*setAdminViewAs\(null\)\s*return\s*\}/);   // volver a Admin: misma semántica
  });
  it('RoleHeader compact: menos alto, marca CUBOPOLAR + rol; sin compact es el de siempre', async () => {
    const { RoleHeader } = await import('../components/ui/Components');
    const c = html(<RoleHeader compact kicker="Chofer" title="En ruta" subtitle="X" onLogout={() => {}} />);
    expect(c).toMatch(/CUBOPOLAR/);
    expect(c).toMatch(/pb-3/);
    expect(c).toMatch(/0\.75rem/);
    expect(c).toMatch(/text-\[1\.25rem\]/);
    const n = html(<RoleHeader kicker="Ventas" title="Ventas del día" />);
    expect(n).not.toMatch(/CUBOPOLAR/);
    expect(n).toMatch(/44px/);
    expect(n).toMatch(/text-\[1\.6rem\]/);
  });
  it('dentro del shell la vista no repite el título de página y ocupa el workspace', () => {
    for (const f of ['../components/VentasStandaloneView.jsx', '../components/ProduccionStandaloneView.jsx', '../components/BolsasView.jsx']) {
      const v = src(f);
      expect(v, f).not.toMatch(/<PageHeader/);
      expect(v, f).toMatch(/CONTENIDO_SHELL = "w-full space-y-[34]"/);
    }
    expect(src('../components/ChoferView.jsx').match(/<RoleHeader compact /g)?.length).toBe(5);
    const shell = src('../components/CuboPolarERP.jsx');
    expect(shell).toMatch(/offsetSuperior = 0/);
    expect(shell).toMatch(/calc\(100% - \$\{offsetSuperior\}px\)/);
  });
  it('ninguna clase de opacidad fuera de la escala de Tailwind en los archivos del programa (no se generan)', () => {
    const escala = new Set(['0', '5', '10', '15', '20', '25', '30', '40', '50', '60', '70', '75', '80', '90', '95', '100']);
    for (const f of ['../components/ui/Components.jsx', '../components/ui/BarraVistaPrevia.jsx', '../components/ui/Modal.jsx', '../components/CuboPolarERP.jsx',
      '../components/ChoferView.jsx', '../components/VentasStandaloneView.jsx', '../components/ProduccionStandaloneView.jsx', '../components/BolsasView.jsx']) {
      const malas = [...src(f).matchAll(/(?:bg|text|border|from|via|to|ring|divide)-[a-z]+(?:-[0-9]{2,3})?\/([0-9]+)\b/g)].map(m => m[1]).filter(v => !escala.has(v));
      expect(malas, f).toEqual([]);
    }
  });
});

describe('B3: primitiva BottomNav', async () => {
  const { BottomNav } = await import('../components/ui/Components');
  it('fija abajo, oculta en lg+, safe-area, estado activo y "Más"', () => {
    const items = [{ id: 'a', label: 'Uno', icon: 'Clock' }, { id: 'b', label: 'Dos', icon: 'List' }];
    const h = html(<BottomNav items={items} value="b" onChange={() => {}} />);
    expect(h).toMatch(/data-testid="bottom-nav"/);
    expect(h).toMatch(/fixed inset-x-0 bottom-0 z-30/);
    expect(h).toMatch(/lg:hidden/);
    expect(h).toMatch(/safe-area-inset-bottom/);
    expect(h).toMatch(/aria-label="Navegación principal"/);
    expect(h).toMatch(/aria-current="page"[^>]*aria-label="Dos"/);
    expect((h.match(/min-h-\[56px\]/g) || []).length).toBe(2);
    // B3.1: mismo lenguaje oscuro que el aside de escritorio
    expect(h).toMatch(/border-white\/10 bg-gradient-to-t from-blue-950 via-slate-900 to-slate-900 text-slate-100/);
    expect(h).toMatch(/aria-current="page"[^>]*text-white[^>]*>[\s\S]*?bg-blue-600 text-white/);
    expect(h).toMatch(/aria-label="Uno" class="[^"]*text-slate-300\/80/);
    expect(h).toMatch(/bg-white\/5 text-slate-300/);
    expect(h).not.toMatch(/bg-white\/95|text-slate-900/);
    expect(h).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(h).not.toMatch(/Más/);
    const m = html(<BottomNav items={items} value="zzz" onChange={() => {}} mas masActivo onMas={() => {}} />);
    expect(m).toMatch(/Más/);
    expect(m).toMatch(/repeat\(3, minmax\(0, 1fr\)\)/);
    expect(m).toMatch(/aria-label="Más módulos"[^>]*text-white/);
  });
});
