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
    // Sistema 2026: superficie blanca con línea fina; cifra tabular.
    expect(h).toMatch(/rounded-card border p-4 shadow-card border-line bg-white/);
    expect(h).toMatch(/font-display/);
    expect(h).toMatch(/tnum/);
    expect(h).toMatch(/hoy/);
  });
});

describe('A3: Ventas — presentación nueva, negocio idéntico', () => {
  const v = sinComentarios(src('../components/VentasStandaloneView.jsx'));
  it('usa primitivas compartidas; sin cabecera, hoja, badge ni toast propios', () => {
    expect(v).toMatch(/import Modal, \{ FormInput, FormBtn \} from '\.\/ui\/Modal'/);
    expect(v).toMatch(/SegmentedTabs items=\{FILTROS\} value=\{filtro\} onChange=\{setFiltro\}/);
    expect(v).toMatch(/<StatusBadge status=\{s\(o\.estatus\)\} \/>/);
    expect(v).toMatch(/<Modal open=\{!!pagoModal\}/);
    expect(v).toMatch(/data-testid="ventas-shell"/);
    expect(v).not.toMatch(/from-emerald-600 to-teal-600|rounded-t-\[30px\]|fixed inset-0|setLocalToast|useBodyScrollLock|bg-blue-100 text-blue-700/);
  });
  it('llamadas de negocio y argumentos idénticos', () => {
    expect(v).toMatch(/const result = await actions\.crearCheckoutPago\?\.\(pagoModal\.id, checkoutProvider\);/);
    // OL-02C: el cobro directo ya no hace Creada → Entregada por updateOrdenEstatus; va por el contrato atómico.
    expect(v).not.toMatch(/updateOrdenEstatus\(pagoModal\.id, "Entregada"/);
    expect(v).toMatch(/const r = await venta\.completar\(\{ modo: modoCobro, metodo, referencia: metodo === "Transferencia SPEI" \? pagoForm\.referencia : null \}\);/);
    expect(v).toMatch(/await ejecutarMutacion\(\(\) => actions\.updateOrdenEstatus\(o\.id, "Asignada"\), \{ onExito: \(\) => showToast\("Asignada a ruta"\) \}\);/);
    expect(v).toMatch(/const \[checkoutProvider\] = useState\('stripe'\);/);
    expect((v.match(/actions\.\w+/g) || []).sort()).toEqual(['actions.crearCheckoutPago', 'actions.updateOrdenEstatus']);   // OL-02C: el cobro directo va por useVentaDirecta → completarVentaDirecta
  });
  it('métodos de pago persistidos y flujo de cobro idénticos', () => {
    expect(v).toMatch(/const PAGOS = \["Efectivo", "Transferencia SPEI", "Tarjeta \(terminal\)", "QR \/ Link de pago", "Crédito \(fiado\)"\];/);
    // Link de pago: mismo flujo (genera el link; no mueve inventario ni entrega).
    expect(v).toMatch(/if \(!pagoModal\.entregaPagada && pagoForm\.metodo === "QR \/ Link de pago"\) \{/);
    expect(v).toMatch(/pagoForm\.metodo === "Transferencia SPEI" &&/);
    expect(v).toMatch(/setPagoForm\(\{ metodo: "Efectivo", referencia: "" \}\); setCheckoutUrl\(null\); setShortUrl\(null\);/);
  });
  it('alcance por vendedor y vista previa de Admin idénticos', () => {
    const owned = v.slice(v.indexOf('const isOwnedBy = useCallback'), v.indexOf('}, [user]);'));
    expect(owned).toMatch(/const ownerKeys = \['usuario_id', 'vendedor_id', 'owner_id', 'created_by'\];/);
    expect(owned).toMatch(/const authKeys = \['auth_id', 'usuario_auth_id', 'vendedor_auth_id'\];/);
    expect(owned).toMatch(/const nameKeys = \['usuario', 'vendedor'\];/);
    expect(v).toMatch(/const isAdminPreview = user\?\.rol === 'Admin';/);
    expect(v).toMatch(/isAdminPreview \? \(data\.ordenes \|\| \[\]\) : \(data\.ordenes \|\| \[\]\)\.filter\(o => isOwnedBy\(o\)\)/);
    // B3.4: los filtros de "hoy" y de "Creada" viven en ventasResumenLogic (misma regla) y reciben ordenesUsuario.
    const logic = src('../data/ventasResumenLogic.js');
    expect(logic).toMatch(/o && o\.fecha && s\(o\.fecha\)\.slice\(0, 10\) === hoy/);
    expect(logic).toMatch(/export const ESTATUS_DIRECTO = 'Creada';/);
    expect(v).toMatch(/resumenPendientes\(ordenesUsuario, data\.pagos\)/);   // B3.6
    expect(v).toMatch(/resumenVentasHoy\(ordenesUsuario, hoy\)/);
  });
  it('filtros internos (B3.6), filtro inicial y NuevaVentaModal idénticos (controlables por el shell)', () => {
    expect(v).toMatch(/const FILTROS = FILTROS_VENTAS\.map\(f => \(\{ k: f\.id, l: f\.label, icon: f\.icon \}\)\);/);
    expect(v).toMatch(/useState\("pendientes"\)/);
    expect(v).toMatch(/const filtro = FILTROS\.some\(f => f\.k === filtroProp\) \? filtroProp : filtroLocal;/);
    expect(v).toMatch(/variant="standalone"/);
    expect(v).toMatch(/toast=\{toast\}/);
    expect(v).toMatch(/showToast\('Orden creada'\);/);
    expect(v).not.toMatch(/ahora cobra/);
  });
});

describe('A4: Producción — presentación nueva, negocio idéntico', () => {
  const v = sinComentarios(src('../components/ProduccionStandaloneView.jsx'));
  it('usa primitivas compartidas; sin cabecera, hojas, toast ni bloqueo propios', () => {
    expect(v).toMatch(/SegmentedTabs items=\{TABS\} value=\{tab\} onChange=\{setTab\}/);
    expect((v.match(/<Modal open=/g) || []).length).toBe(4);   // OP-01D: sin el modal de Transformación (agosto, superseded)
    expect(v).toMatch(/<BotonFirmasPendientes\s+user=\{user\}\s+data=\{data\}\s+actions=\{actions\}\s+mostrarBannerUrgente=\{true\}/);
    expect(v).not.toMatch(/from-blue-600 to-blue-800|rounded-t-\[30px\]|fixed inset-0|setToast|useBodyScrollLock|addEventListener\('keydown'/);
  });
  it('llamadas al store y argumentos idénticos', () => {
    expect(v).toMatch(/await actions\.producirYCongelar\(\{ \.\.\.datosProd, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.registrarMermaCuarto\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.registrarMermaCuarto\(\{ \.\.\.datosMerma, operacionId: opMerma\.id \}\)/);
    expect(v).toMatch(/await actions\.prepararDesdeBarra\(\{ \.\.\.datos, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.traspasoEntreUbicaciones\(\{ \.\.\.tForm, operacionId: op\.id \}\)/);
    expect(v).toMatch(/await actions\.sacarDeCuartoFrio\(sacarModal\.cfId, sacarForm\.sku, sacarForm\.cantidad, mot\.motivo, \{ operacionId: op\.id \}\)/);
    expect(new Set(v.match(/actions\.\w+/g))).toEqual(new Set(['actions.producirYCongelar', 'actions.registrarMermaCuarto', 'actions.prepararDesdeBarra', 'actions.desglosarBarra', 'actions.traspasoEntreUbicaciones', 'actions.sacarDeCuartoFrio']));
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
    expect(v).toMatch(/if \(!bolsaSku && !seProduceSinEmpaque\(form\.sku\)\) \{/);   // OP-01D: sin empaque solo la barra; el resto sigue bloqueado
    expect(v).toMatch(/useState\(\{ turno: "Turno 1", maquina: "Máquina 30", sku: "", cantidad: "", destino: "CF-1", conMerma: false, mermaCantidad: "", mermaCausa: "Bolsa rota" \}\)/);
    expect(v).toMatch(/const MERMA_CAUSAS = \["Bolsa rota", "Mal sellado", "Hielo derretido", "Falla de equipo", "Desmolde fallido", "Contaminación", "Otro"\];/);
    expect(v).toMatch(/MAQUINAS_PRODUCCION\.map\(m => \(/);   // OP-01D: lista compartida (incluye Máquina Barra)
    expect(v).toMatch(/\["Turno 1", "Turno 2", "Turno 3"\]/);
    expect(v).toMatch(/useState\("producir"\)/);
    expect(v).toMatch(/\{ k: "producir"[^}]*\}, \{ k: "cuartos"[^}]*\}, \{ k: "mermas"[^}]*\}, \{ k: "preparar"[^}]*\}/);
    expect(v).toMatch(/onClose=\{cerrarProd\}/);
    expect(v).toMatch(/const cerrarProd = \(\) => \{ setModal\(false\); clearFotoMermaProd\(\); \};/);
    expect((v.match(/<CapturaFoto /g) || []).length).toBe(2);   // cámara o galería (control compartido)
  });
});

describe('A5: Chofer — modo enfoque con la identidad del producto; flujo, offline, GPS, fotos y firma idénticos', () => {
  const v = sinComentarios(src('../components/ChoferView.jsx'));
  it('conserva la máquina de pasos y el chrome de enfoque (sin sidebar); sin toast ni hojas propias', () => {
    expect(v).toMatch(/const step = stepOverride \?\? \(rutaEnProgreso \? 'ruta' : \(rutaPendienteFirma \? 'esperando-firma' : \(rutaCargada \? 'cargada' : 'cargar'\)\)\);/);
    for (const st of ['"cargar"', '"esperando-firma"', '"cargada"', '"ruta"', '"cierre"']) expect(v).toMatch(new RegExp(`if \\(step === ${st}\\)`));
    expect((v.match(/data-testid="chofer-shell"/g) || []).length).toBe(5);
    expect((v.match(/<RoleHeader /g) || []).length).toBe(5);
    expect((v.match(/<Modal open=/g) || []).length).toBe(8);   // + mapa de la parada y ticket de la entrega
    expect(v).not.toMatch(/bg-\[#07131a\]|rounded-t-\[30px\]|fixed inset-0|setToast|useBodyScrollLock|function Toast/);
    expect(v).toMatch(/fixed bottom-0 left-1\/2 z-40/);   // barra de acciones fija en ruta
    expect(v).toMatch(/<BannerColaOffline online=\{online\} cola=\{colaOffline\} sincronizando=\{sincronizando\} onSincronizar=\{sincronizarCola\} \/>/);
  });
  it('cola offline, GPS, fotos y firma: código idéntico', () => {
    expect(v).toMatch(/useColaOffline\(\{ rutaId: miRutaActiva\?\.id, ejecutores: ejecutoresOffline, avisar: showToast \}\)/);
    expect(v).toMatch(/encolarOffline\(TIPOS_MUTACION\.ENTREGA, \{\s*ordenId: entregaModal\.id,\s*metodoPago: cobroMetodo,\s*folioNota: folioNota \|\| null,\s*\}\)/);
    expect(v).toMatch(/supabase\.from\('chofer_ubicaciones'\)\.insert\(\{\s*ruta_id: miRutaActiva\.id,\s*chofer_id: user\.id,/);
    expect(v).toMatch(/const interval = setInterval\(enviarUbicacion, 30000\);/);
    expect((v.match(/<CapturaFoto /g) || []).length).toBe(3);   // cámara o galería (control compartido)
    expect(v).toMatch(/const validErr = validarCobroTransferencia\(\{ metodoPago: cobroMetodo, fotoTransf \}\);/);
    expect(v).toMatch(/const firmaBase64 = canvas\.toDataURL\('image\/png'\);/);
    expect(v).toMatch(/el\.getContext\('2d'\)\.scale\(2, 2\);/);
    expect(v).toMatch(/const ordenesEnColaOffline = useMemo\(\(\) => ordenesBloqueadas\(colaOffline\), \[colaOffline\]\);/);
  });
  it('llamadas al store, argumentos y precondiciones de cierre idénticos', () => {
    expect(new Set(v.match(/actions\.\w+/g))).toEqual(new Set(['actions.subirEvidenciaOrden', 'actions.updateOrdenEstatus', 'actions.marcarNoEntregada', 'actions.solicitarFirmaCarga', 'actions.firmarCarga', 'actions.crearCheckoutPago', 'actions.updateRutaEstatus', 'actions.prepararCierreRuta', 'actions.finalizarInventarioRuta', 'actions.crearClienteChofer']));
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
    expect(c).toMatch(/text-\[1\.35rem\]/);
    const n = html(<RoleHeader kicker="Ventas" title="Ventas del día" />);
    expect(n).not.toMatch(/CUBOPOLAR/);
    expect(n).toMatch(/44px/);
    expect(n).toMatch(/text-\[1\.7rem\]/);
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
    // Sistema 2026: activo = píldora de acento cian; inactivo gris claro.
    expect(h).toMatch(/aria-current="page"[^>]*text-white[^>]*>[\s\S]*?bg-cyan-400\/20 text-cyan-200/);
    expect(h).toMatch(/aria-label="Uno" class="[^"]*text-slate-400/);
    expect(h).not.toMatch(/bg-white\/95|text-slate-900/);
    expect(h).toMatch(/repeat\(2, minmax\(0, 1fr\)\)/);
    expect(h).not.toMatch(/Más/);
    const m = html(<BottomNav items={items} value="zzz" onChange={() => {}} mas masActivo onMas={() => {}} />);
    expect(m).toMatch(/Más/);
    expect(m).toMatch(/repeat\(3, minmax\(0, 1fr\)\)/);
    expect(m).toMatch(/aria-label="Más módulos"[^>]*text-white/);
  });
});

describe('B3.2: cada módulo de Producción abre con SU resumen (solo presentación; datos ya cargados)', () => {
  const v = sinComentarios(src('../components/ProduccionStandaloneView.jsx'));
  const bloque = (ini, fin) => { const a = v.indexOf(ini), b = v.indexOf(fin); expect(a, ini).toBeGreaterThan(-1); expect(b, fin).toBeGreaterThan(a); return v.slice(a, b); };
  const prod = bloque('{tab === "producir" && (<>', '{tab === "cuartos" && (<>');
  const cuartos = bloque('{tab === "cuartos" && (<>', '{tab === "preparar" && (<>');
  const prep = bloque('{tab === "preparar" && (<>', '{tab === "mermas" && (<>');
  const mermas = bloque('{tab === "mermas" && (<>', '<div className="h-8" />');
  const ACCIONES = ['actions.producirYCongelar', 'actions.registrarMermaCuarto', 'actions.prepararDesdeBarra', 'actions.desglosarBarra', 'actions.traspasoEntreUbicaciones', 'actions.sacarDeCuartoFrio'];

  it('Producción conserva su resumen general (Producido hoy · En congeladores · Merma hoy) con la misma derivación', () => {
    expect(v).toMatch(/const kpis = \[\s*\{ label: "Producido hoy", value: totalHoy\.toLocaleString\(\) \},\s*\{ label: "En congeladores", value: totalEnCuartos\.toLocaleString\(\) \},\s*\{ label: "Merma hoy", value: mermaHoy \},\s*\];/);
    expect(v).toMatch(/const totalHoy = useMemo\(\(\) => prodHoy\.reduce\(\(s, p\) => s \+ n\(p\.cantidad\), 0\), \[prodHoy\]\);/);
    expect(v).toMatch(/const mermaHoy = useMemo\(\(\) => mermasHoyList\.reduce\(\(sum, item\) => sum \+ n\(item\.cantidad\), 0\), \[mermasHoyList\]\);/);
    expect(v).toMatch(/for \(const cf of cuartos\) if \(cf\.stock\) for \(const v of Object\.values\(cf\.stock\)\) t \+= n\(v\);/);
    expect(prod).toMatch(/data-testid="resumen-produccion"/);
    expect(prod).toMatch(/kpis\.map\(\(k, i\) => <KpiTile key=\{k\.label\} label=\{k\.label\} value=\{k\.value\} hint=\{i === 0 \? s\(user\?\.nombre\) : undefined\} \/>\)/);
    expect((v.match(/kpis\.map/g) || []).length).toBe(2);   // pestaña Producción (shell) + cabecera suelta; ya no hay fila global
    expect(v).not.toMatch(/\{embedded \? \(\s*<div className=\{`\$\{CONTENIDO_SHELL\} grid/);
  });
  it('Congeladores: existencia, tarimas ocupadas (barra) y libres; no repite el resumen de Producción', () => {
    expect(cuartos).toMatch(/data-testid="resumen-congeladores"/);
    expect(cuartos).toMatch(/label="Existencia total" value=\{resumenCuartos\.existencia\.toLocaleString\(\)\}/);
    expect(cuartos).toMatch(/label="Tarimas ocupadas"/);
    expect(cuartos).toMatch(/<CapacityBar pct=\{resumenCuartos\.pct\} \/>/);
    expect(cuartos).toMatch(/label="Tarimas libres"/);
    expect(cuartos).not.toMatch(/kpis\.map|Producido hoy|Merma hoy|resumenMer\.|resumenTrans\./);
  });
  it('Mermas: merma de hoy, registros de hoy y última merma; nada de producción ni congeladores', () => {
    expect(mermas).toMatch(/data-testid="resumen-mermas"/);
    expect(mermas).toMatch(/label="Merma hoy" value=\{resumenMer\.mermaHoy\.toLocaleString\(\)\}/);
    expect(mermas).toMatch(/label="Registros hoy" value=\{resumenMer\.registrosHoy\}/);
    expect(mermas).toMatch(/label="Última merma de hoy" compact/);
    expect(mermas).not.toMatch(/kpis\.map|Producido hoy|En congeladores|Tarimas|resumenCuartos\.|resumenTrans\.|fmtPct|%|\$[0-9]/);   // sin monto, porcentaje ni tendencia
  });
  it('Preparar desde barra (OP-01D): preparaciones, barras y bolsas de hoy; vista previa antes de confirmar; sin datos de otros módulos', () => {
    expect(prep).toMatch(/data-testid="resumen-preparacion"/);
    expect(prep).toMatch(/label="Preparaciones hoy" value=\{resumenPrep\.preparaciones\}/);
    expect(prep).toMatch(/label="Barras usadas hoy"/);
    expect(prep).toMatch(/label="Bolsas preparadas hoy"/);
    expect(prep).toMatch(/data-testid="vista-previa-preparacion"/);
    expect(prep).toMatch(/disabled=\{guardandoPrep \|\| !!vistaPrep\.bloqueo\}/);
    expect(prep).not.toMatch(/kpis\.map|Producido hoy|En congeladores|Merma hoy|resumenCuartos\.|resumenMer\./);
    expect(v).not.toMatch(/Transformación|transForm|addTransformacion/);   // la de agosto ya no se ofrece
  });
  it('orden por módulo: resumen → acción principal → contenido', () => {
    for (const [nombre, b, testid] of [['producir', prod, 'resumen-produccion'], ['cuartos', cuartos, 'resumen-congeladores'], ['preparar', prep, 'resumen-preparacion'], ['mermas', mermas, 'resumen-mermas']]) {
      expect(b.indexOf(`data-testid="${testid}"`), nombre).toBeLessThan(b.indexOf('<FormBtn'));
    }
  });
  it('los resúmenes se derivan de datos ya cargados: mismas 5 acciones, sin consultas ni RPC nuevas', () => {
    expect(new Set(v.match(/actions\.\w+/g))).toEqual(new Set(ACCIONES));
    expect((v.match(/supabase\./g) || []).length).toBe(3);        // solo el storage de fotos de merma (A4)
    expect(v).not.toMatch(/supabase\.rpc|supabase\.from\(|fetch\(|backendPost|backendGet/);
    expect(v).toMatch(/resumenCongeladores\(data\.cuartosFrios, data\.productos\)/);
    expect(v).toMatch(/resumenMermas\(data\.mermas, diaNegocio\(\)\)/);
    expect(v).toMatch(/vistaPreviaPreparacion\(\{/);
    const logic = src('../data/produccionResumenLogic.js');
    expect(logic).not.toMatch(/supabase|rpc|fetch\(|backend|useState|useEffect/);
    expect(logic.match(/^import .*$/gm)).toEqual([
      "import { s, n } from '../utils/safe';",
      "import { mermasActivas } from './mermasLogic';",
      "import { tarimasOcupadasEnCuarto, colorTarimasUso } from '../utils/tarimas';",
    ]);
  });
  it('KpiTile: compact (valor textual) y children (indicador); sin ellos es la de siempre', () => {
    const base = html(<KpiTile label="A" value="1" />);
    expect(base).toMatch(/font-display text-2xl/);
    expect(base).not.toMatch(/mt-2/);
    const c = html(<KpiTile label="Última" value="12× HPC-5K" hint="Bolsa rota" compact />);
    expect(c).toMatch(/truncate text-base font-bold/);
    expect(c).not.toMatch(/font-display/);
    const k = html(<KpiTile label="T" value="9.9 / 20"><div data-x="bar" /></KpiTile>);
    expect(k).toMatch(/<div class="mt-2"><div data-x="bar"><\/div><\/div>/);
  });
});

describe('B3.6: Ventas es UN espacio de trabajo con filtros internos (solo presentación; mismas órdenes)', () => {
  const v = sinComentarios(src('../components/VentasStandaloneView.jsx'));
  const resumen = v.slice(v.indexOf('const resumenFiltro ='), v.indexOf('return (', v.indexOf('const resumenFiltro =')));
  const cuerpo = v.slice(v.indexOf('data-testid="ventas-barra"'), v.indexOf('<NuevaVentaModal'));
  it('barra del espacio de trabajo: filtros internos + Nueva venta, luego el resumen del filtro activo, luego la lista', () => {
    expect(cuerpo).toMatch(/^data-testid="ventas-barra">\s*<SegmentedTabs items=\{FILTROS\} value=\{filtro\} onChange=\{setFiltro\} accent="emerald"[^>]*\/>\s*\{nuevaVentaBtn\}\s*<\/div>\s*\{resumenFiltro\}/);
    expect(v).not.toMatch(/!embedded && <SegmentedTabs/);       // el mismo control en el shell y en la vista suelta
    expect(v).not.toMatch(/<KpiTile/);                            // sin bloques de KPI gigantes por filtro
    expect(v).not.toMatch(/Por cobrar directo|En ruta por cobrar/);
  });
  it('Nueva venta: una sola acción primaria, tamaño normal (no franja gigante), ancho completo solo en móvil', () => {
    expect((v.match(/<Icons\.Plus \/> Nueva venta/g) || []).length).toBe(1);
    const btn = v.slice(v.indexOf('const nuevaVentaBtn ='), v.indexOf('const REJILLA_LISTA'));
    expect(btn).toMatch(/<FormBtn success className="w-full sm:w-auto sm:px-6" onClick=\{abrirNuevaVenta\}>/);
    expect(btn).not.toMatch(/size="lg"/);
    expect(v).toMatch(/<NuevaVentaModal\s+open=\{modal\}\s+onClose=\{\(\) => setModal\(false\)\}/);
    expect(v).toMatch(/variant="standalone"/);
  });
  it('Pendientes: lo accionable por el vendedor, en dos grupos (por cobrar / pagadas por entregar); con el chofer solo como dato', () => {
    expect(resumen).toMatch(/filtro === "pendientes" \? \(pend\.vacio && pend\.conChofer\.count === 0 \? null/);
    expect(cuerpo).toMatch(/data-testid="grupo-por-cobrar"[\s\S]*pend\.porCobrar\.ordenes\.map\(tarjetaOrden\)/);
    expect(cuerpo).toMatch(/data-testid="grupo-pagadas-por-entregar"[\s\S]*pend\.pagadasPorEntregar\.ordenes\.map\(tarjetaOrden\)/);
    expect(cuerpo).not.toMatch(/pend\.conChofer\.ordenes\.map/);   // las del chofer no se listan como pendientes
    expect(v).not.toMatch(/TOTAL PENDIENTE|[Ss]aldo por cobrar|CxC|[Cc]obrado hoy|[Cc]omisi|[Mm]eta|[Pp]romedio|[Tt]endencia/);
  });
  it('Hoy: misma semántica (vendido hoy = entregadas de hoy; desglose; última venta)', () => {
    expect(resumen).toMatch(/filtro === "hoy" \? \(resumenHoy\.count === 0 \? null/);
    expect(resumen).toMatch(/fmtMoney\(resumenHoy\.vendidoHoy\), "vendido hoy \(entregadas\)"/);
    expect(resumen).toMatch(/textoDesglose\(resumenHoy\.porEstatus\)/);
    expect(src('../data/ventasResumenLogic.js')).toMatch(/ordenesHoy\.filter\(o => o\.estatus === "Entregada"\)\.reduce\(\(t, o\) => t \+ n\(o\.total\), 0\)/);
    expect(v).toMatch(/const lista = filtro === "hoy" \? ordenesHoy : ordenesUsuario;/);
  });
  it('Todas: todas las órdenes del alcance; solo "N órdenes · desde fecha"', () => {
    const todas = resumen.slice(resumen.indexOf('historial.count === 0'));
    expect(todas).toMatch(/data-testid="resumen-todas"/);
    expect(todas).not.toMatch(/grid/);
    expect(cuerpo).toMatch(/\{filtro !== "pendientes" && lista\.map\(tarjetaOrden\)\}/);
  });
  it('acciones por estatus: una sola tarjeta para todos los filtros, sin acciones nuevas (reglas en ventasCobroLogic)', () => {
    const tarjeta = v.slice(v.indexOf('const tarjetaOrden ='), v.indexOf('const dato ='));
    expect(tarjeta).toMatch(/const acc = accionesCobroVentas\(o\)/);
    expect(tarjeta).toMatch(/\{acc\.cobrar && acc\.enviarARuta && \([\s\S]*cobrar\(o\)\}>Cobrar<[\s\S]*enviarARuta\(o\)/);
    expect(tarjeta).toMatch(/\{acc\.cobrarEntrega && \([\s\S]*cobrar\(o\)\}[^>]*>Cobrar entrega</);
    expect((v.match(/<Card key=\{o\.id\}/g) || []).length).toBe(1);
    expect((v.match(/actions\.\w+/g) || []).sort()).toEqual(['actions.crearCheckoutPago', 'actions.updateOrdenEstatus']);
  });
  it('vacíos coherentes por filtro; sin consultas nuevas; el módulo de resumen es puro', () => {
    expect(cuerpo).toMatch(/message="Sin pendientes"/);
    expect(cuerpo).toMatch(/message="Aún no hay ventas hoy"/);
    expect(cuerpo).toMatch(/message="No has hecho ventas todavía"/);
    expect(v).not.toMatch(/supabase|\.rpc\(|fetch\(|backendPost|backendGet/);
    expect(v).toMatch(/resumenHistorial\(ordenesUsuario\)/);
    expect(v).toMatch(/isAdminPreview \? \(data\.ordenes \|\| \[\]\) : \(data\.ordenes \|\| \[\]\)\.filter\(o => isOwnedBy\(o\)\)/);
    const logic = src('../data/ventasResumenLogic.js');
    expect(logic).not.toMatch(/supabase|rpc|fetch\(|backend|useState|useEffect|react/);
    expect(logic.match(/^import .*$/gm)).toEqual(["import { s, n } from '../utils/safe';", "import { TRANSICIONES_ORDEN } from './ordenLogic';",
      "import { accionesCobroVentas } from './ventasCobroLogic';", "import { linkPagadoCompleto } from './ventaDirectaLogic';"]);
  });
});

describe('OL-01A: honestidad del cobro del vendedor (contención; ciclo de vida y backend sin cambios)', () => {
  const v = sinComentarios(src('../components/VentasStandaloneView.jsx'));
  const cobro = v.slice(v.indexOf('const confirmarCobro = async'), v.indexOf('const hoy = diaNegocio();'));
  const envio = v.slice(v.indexOf('const enviarARuta = async'), v.indexOf('const tarjetaOrden ='));
  it('cobro: el toast de éxito y el cierre del diálogo solo tras el resultado confirmado (OL-02C: contrato atómico)', () => {
    const tras = cobro.slice(cobro.indexOf('const r = await venta.completar('));
    expect(tras).toMatch(/^const r = await venta\.completar\([^;]*\);\s*if \(!r \|\| r\.error\) return;\s*showToast\(/);
    expect((cobro.match(/cerrarCobro\(\)/g) || []).length).toBe(1);
    expect((cobro.match(/Cobrado y entregado — /g) || []).length).toBe(1);
    expect(cobro).not.toMatch(/await actions\.updateOrdenEstatus/);
  });
  it('enviar a ruta: éxito solo confirmado; sin doble envío; misma llamada (no adjunta ruta)', () => {
    expect(envio).toMatch(/if \(enviandoRuta\) return;/);
    expect(envio).toMatch(/\(\) => actions\.updateOrdenEstatus\(o\.id, "Asignada"\), \{ onExito/);
    expect(envio).not.toMatch(/ruta_id|p_ruta_id|asignarOrdenesARuta/);
    expect(v).not.toMatch(/actions\.updateOrdenEstatus\(o\.id, "Asignada"\); showToast/);
  });
  it('orden con ruta: sin cobro del vendedor; solo una etiqueta pasiva', () => {
    const tarjeta = v.slice(v.indexOf('const tarjetaOrden ='), v.indexOf('const grupoMonto'));
    expect(tarjeta).toMatch(/\{acc\.enRutaDelChofer && \([\s\S]*data-testid="orden-en-ruta-chofer"[\s\S]*la cobra el chofer/);
    const etiqueta = tarjeta.slice(tarjeta.indexOf('acc.enRutaDelChofer'));
    expect(etiqueta.slice(0, etiqueta.indexOf('</p>'))).not.toMatch(/onClick|FormBtn|actions\./);
  });
  it('sin cambios de contratos: mismas acciones del store; Admin y Chofer intactos', () => {
    expect((v.match(/actions\.\w+/g) || []).sort()).toEqual(['actions.crearCheckoutPago', 'actions.updateOrdenEstatus']);   // OL-02C: el cobro directo va por useVentaDirecta → completarVentaDirecta
    const admin = src('../components/views/OrdenesView.jsx');
    expect(admin).toMatch(/const err = await actions\.updateOrdenEstatus\(pagoModal\.id, "Entregada", pagoForm\.metodo\);\s*if \(err\) \{\s*toast\?\.error\("No se pudo registrar el cobro"\);\s*return;/);
    const chofer = src('../components/ChoferView.jsx');
    expect(chofer).toMatch(/await actions\.updateOrdenEstatus\(entregaModal\.id, "Entregada", cobroMetodo, \{ folioNota: folioNota \|\| null \}\)/);
    expect(chofer).toMatch(/if \(err\) \{\s*showToast\("No se pudo registrar la entrega", 'error'\);/);
    const logic = src('../data/ventasCobroLogic.js');
    expect(logic).not.toMatch(/supabase|rpc|fetch\(|backend|import /);
    const orden = src('../data/ordenLogic.js');
    expect(orden).toMatch(/Creada: {9}\['Asignada', 'Cancelada'\],/);   // ciclo de vida intacto
  });
});
