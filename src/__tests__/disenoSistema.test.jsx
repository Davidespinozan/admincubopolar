// disenoSistema.test.jsx — sistema de diseño CUBOPOLAR 2026 (docs/sistema/diseno.md).
// Vigila los tokens, las primitivas y las decisiones cerradas que dan la
// sensación "premium" en móvil: hojas con pie pegajoso, pickers en dos
// columnas, campos de 48 px, sin superficies translúcidas y sin que el
// contenedor animado de la vista rompa el `position: fixed` de las hojas.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import Modal, { FormBtn, FormInput } from '../components/ui/Modal';
import { ChoiceButton, KpiTile, ListRow, SegmentedTabs } from '../components/ui/Components';
import tailwind from '../../tailwind.config.js';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const dir = (rel) => fileURLToPath(new URL(rel, import.meta.url));

describe('tokens', () => {
  const css = src('../index.css');
  const ext = tailwind.theme.extend;
  it('paleta y radios declarados una sola vez (CSS y Tailwind coinciden)', () => {
    expect(css).toMatch(/--cp-bg:\s*#F4F6F9/i);
    expect(css).toMatch(/--cp-ink:\s*#0B1220/i);
    expect(css).toMatch(/--cp-accent:\s*#0E7490/i);
    expect(ext.borderRadius).toMatchObject({ field: '14px', card: '20px', panel: '28px' });
    expect(Object.keys(ext.colors)).toEqual(expect.arrayContaining(['ink', 'canvas', 'line', 'accent', 'brand']));
    expect(ext.boxShadow).toHaveProperty('sheet');
    expect(ext.boxShadow).toHaveProperty('pop');
  });
  it('tipografía Inter con números tabulares', () => {
    expect(css).toMatch(/fonts\.googleapis\.com\/css2\?family=Inter/);
    expect(css).toMatch(/\.tnum, \.font-display \{ font-variant-numeric: tabular-nums; \}/);
    expect(src('../../index.html')).toMatch(/family=Inter/);
  });
  it('la animación de la vista no deja transform (rompería las hojas fijas)', () => {
    // `both`/`forwards` conservan translateY(0) al terminar y un ancestro con
    // transform vuelve a sí mismo el contenedor de cualquier `position: fixed`.
    expect(css).toMatch(/\.animate-view-in \{ animation: view-in [\d.]+s var\(--cp-ease\) backwards; \}/);
  });
  it('respeta prefers-reduced-motion', () => {
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
  });
});

const html = (el) => renderToStaticMarkup(el);

describe('primitivas', () => {
  it('Modal: hoja inferior con pie pegajoso, safe-area y kicker', () => {
    const h = html(<Modal open onClose={() => {}} title="Prueba" kicker="Kicker" footer={<FormBtn primary>Guardar</FormBtn>}><p>cuerpo</p></Modal>);
    expect(h).toMatch(/data-testid="hoja"/);
    expect(h).toMatch(/rounded-t-panel/);
    expect(h).toMatch(/md:rounded-panel/);
    expect(h).toMatch(/data-testid="hoja-pie"/);
    expect(h).toMatch(/padding-bottom:calc\(env\(safe-area-inset-bottom, 0px\) \+ 12px\)/);
    expect(h).toMatch(/class="erp-kicker text-slate-500">Kicker/);
    expect(h).toMatch(/aria-modal="true"/);
  });
  it('Modal cerrado no renderiza nada; sin pie usa safeBottom', () => {
    expect(html(<Modal open={false} onClose={() => {}} title="X">y</Modal>)).toBe('');
    const h = html(<Modal open onClose={() => {}} title="X" safeBottom>y</Modal>);
    expect(h).not.toMatch(/hoja-pie/);
    expect(h).toMatch(/padding-bottom:calc\(env\(safe-area-inset-bottom, 0px\) \+ 24px\)/);
  });
  it('campos de 48 px, botones de campo de 52 px y type="button" por omisión', () => {
    const campo = html(<FormInput label="Cantidad" value="" onChange={() => {}} />);
    expect(campo).toMatch(/min-h-\[48px\] w-full rounded-field/);
    const lg = html(<FormBtn primary size="lg">Ir</FormBtn>);
    expect(lg).toMatch(/type="button"/);
    expect(lg).toMatch(/min-h-\[52px\]/);
    expect(lg).toMatch(/bg-ink/);
    expect(html(<FormBtn danger>No</FormBtn>)).toMatch(/min-h-\[44px\] rounded-field/);
  });
  it('ChoiceButton: 48 px, aria-pressed y tono', () => {
    const si = html(<ChoiceButton active tone="emerald">Sí</ChoiceButton>);
    expect(si).toMatch(/aria-pressed="true"/);
    expect(si).toMatch(/min-h-\[48px\] rounded-field border-2/);
    expect(si).toMatch(/emerald/);
    expect(html(<ChoiceButton>No</ChoiceButton>)).toMatch(/aria-pressed="false"/);
  });
  it('KpiTile, ListRow y SegmentedTabs usan los tokens', () => {
    const kpi = html(<KpiTile label="Por cobrar" value="$1,840" hint="1 cuenta" tone="warning" />);
    expect(kpi).toMatch(/rounded-card border p-4 shadow-card/);
    expect(kpi).toMatch(/tnum/);
    const fila = html(<ListRow title="SIX CANELAS" subtitle="SCA010101AB1" value="$350" badge={<span>Entregada</span>} onClick={() => {}} />);
    expect(fila).toMatch(/<button/);
    expect(fila).toMatch(/SIX CANELAS/);
    expect(fila).toMatch(/Entregada/);
    const tabs = html(<SegmentedTabs value="a" onChange={() => {}} items={[{ k: 'a', l: 'Uno' }, { k: 'b', l: 'Dos' }]} />);
    expect(tabs).toMatch(/bg-white text-ink shadow/);
  });
});

describe('hojas con pie pegajoso (acciones nunca quedan bajo el teclado)', () => {
  const casos = [
    ['../components/NuevaVentaModal.jsx', /title="Nueva venta" kicker="Ventas" wide footer=\{pie\}/],
    ['../components/EditarVentaModal.jsx', /kicker="Ventas" wide\s+footer=\{<>/],
    ['../components/ChoferView.jsx', /title="Venta exprés" safeBottom closeOnEscape=\{!creandoVenta\}\s+footer=\{/],
    ['../components/ChoferView.jsx', /title="Registrar merma" safeBottom closeOnEscape=\{!registrandoMerma\}\s+footer=\{/],
    ['../components/ChoferView.jsx', /title="Marcar como no entregada" safeBottom closeOnEscape=\{!marcandoNoEntrega\}\s+footer=\{/],
    ['../components/ChoferView.jsx', /footer=\{entregaModal && !checkoutUrl && \(\(\) => \{/],
    ['../components/ProduccionStandaloneView.jsx', /title="¿Qué produjiste\?" safeBottom closeOnEscape=\{!guardandoProd\}\s+footer=\{/],
    ['../components/ProduccionStandaloneView.jsx', /title="Mover entre congeladores" safeBottom closeOnEscape=\{!haciendoTraspaso\}\s+footer=\{/],
    ['../components/ProduccionStandaloneView.jsx', /title="Sacar hielo" safeBottom closeOnEscape=\{!haciendoSalida\}\s+footer=\{/],
    ['../components/ProduccionStandaloneView.jsx', /kicker="Merma" title="Registrar merma" safeBottom closeOnEscape=\{!guardandoMerma\}\s+footer=\{/],
    ['../components/BolsasView.jsx', /title=\{esEntrada \? "¿Cuántas llegaron\?" : "¿Cuántas entregaste a producción\?"\}\s+footer=\{/],
    ['../components/VentasStandaloneView.jsx', /footer=\{pagoModal && !checkoutUrl && \(/],
  ];
  it.each(casos)('%s', (rel, re) => {
    expect(src(rel)).toMatch(re);
  });
  it('ninguna acción principal queda suelta al final del cuerpo de esas hojas', () => {
    for (const rel of ['../components/ChoferView.jsx', '../components/ProduccionStandaloneView.jsx', '../components/BolsasView.jsx', '../components/VentasStandaloneView.jsx']) {
      const hojas = src(rel).split('<Modal ').slice(1).map(h => h.slice(0, h.indexOf('</Modal>')));
      expect(hojas.length, rel).toBeGreaterThan(0);
      for (const h of hojas) expect(h, rel).not.toMatch(/size="lg" className="mt-4 w-full"/);
    }
  });
});

describe('decisiones cerradas en el código', () => {
  const vistas = readdirSync(dir('../components/views')).filter(f => f.endsWith('.jsx')).map(f => `../components/views/${f}`);
  const standalone = ['../components/ChoferView.jsx', '../components/ProduccionStandaloneView.jsx', '../components/VentasStandaloneView.jsx', '../components/BolsasView.jsx', '../components/BotonFirmasPendientes.jsx', '../components/ui/BusquedaGlobal.jsx'];
  it('sin superficies translúcidas en vistas de rol ni popovers', () => {
    for (const rel of standalone) expect(src(rel), rel).not.toMatch(/bg-white\/80/);
  });
  it('pickers de producto y opciones en dos columnas en móvil', () => {
    expect(src('../components/ProduccionStandaloneView.jsx')).not.toMatch(/grid grid-cols-1 gap-2 sm:grid-cols-2">\s*\{skuOptions/);
    expect(src('../components/VentasStandaloneView.jsx')).toMatch(/<div className="mb-4 grid grid-cols-2 gap-2">\s*\{PAGOS\.map/);
  });
  it('cabecera: firmas con el mismo botón redondo que la campana y panel opaco', () => {
    const f = src('../components/BotonFirmasPendientes.jsx');
    expect(f).toMatch(/rounded-full text-slate-700 transition-colors hover:bg-slate-100/);
    expect(f).toMatch(/rounded-card border border-line bg-white shadow-pop animate-pop-in/);
    expect(f).not.toMatch(/animate-pulse/);
  });
  it('las vistas no usan emojis ni el banner de prueba global', () => {
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;
    const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    for (const rel of vistas) expect(sinComentarios(src(rel)), rel).not.toMatch(emoji);
  });
});
