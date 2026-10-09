// roleUiPhaseA.test.jsx — Fase A de la convergencia visual por rol.
// A1: las primitivas compartidas ganan props opcionales sin cambiar su salida
// por defecto. A2: Almacén de Bolsas usa esas primitivas y conserva EXACTAMENTE
// su comportamiento de negocio (llamada, validaciones, flujo, textos).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import Modal, { FormInput, FormBtn } from '../components/ui/Modal';
import { Card, SectionLabel, RoleHeader, HeaderStat, StatusBadge } from '../components/ui/Components';

const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');
const sinComentarios = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');
const html = (el) => renderToStaticMarkup(el);

describe('A1: primitivas — la salida por defecto no cambia', () => {
  it('FormBtn sin props nuevas conserva sus clases de siempre; size="lg" y tonos nuevos son opcionales', () => {
    const base = html(<FormBtn primary onClick={() => {}}>Guardar</FormBtn>);
    // Sistema 2026: radio 14 (rounded-field), tinta (bg-ink); lg = 52 px.
    expect(base).toMatch(/min-h-\[44px\]/);
    expect(base).toMatch(/rounded-field/);
    expect(base).toMatch(/bg-ink/);
    expect(base).not.toMatch(/min-h-\[52px\]/);
    const lg = html(<FormBtn success size="lg">Llegaron</FormBtn>);
    expect(lg).toMatch(/min-h-\[52px\]/);
    expect(lg).toMatch(/bg-emerald-600/);
    expect(html(<FormBtn warning>x</FormBtn>)).toMatch(/bg-amber-600/);
    expect(html(<FormBtn disabled>x</FormBtn>)).toMatch(/opacity-50/);
  });
  it('FormInput: hint e inputClassName son opcionales; error sigue teniendo prioridad sobre hint', () => {
    const plain = html(<FormInput label="Nombre" value="" onChange={() => {}} />);
    expect(plain).toMatch(/min-h-\[48px\] w-full rounded-field/);
    expect(plain).not.toMatch(/mt-1 text-xs text-slate-500/);
    const withHint = html(<FormInput label="Costo" hint="ayuda" inputClassName="text-center" value="" onChange={() => {}} />);
    expect(withHint).toMatch(/ayuda/);
    expect(withHint).toMatch(/text-center/);
    const withErr = html(<FormInput label="Costo" hint="ayuda" error="falta" value="" onChange={() => {}} />);
    expect(withErr).toMatch(/falta/);
    expect(withErr).not.toMatch(/ayuda/);
  });
  it('Modal: sin kicker ni safeBottom es el de siempre; con ellos agrega etiqueta y relleno inferior', () => {
    const base = html(<Modal open onClose={() => {}} title="T"><p>c</p></Modal>);
    expect(base).toMatch(/z-\[90\]/);
    expect(base).toMatch(/rounded-t-panel/);
    expect(base).toMatch(/animate-sheet-in/);
    expect(base).not.toMatch(/erp-kicker/);
    expect(base).not.toMatch(/safe-area-inset-bottom/);
    // Sistema 2026: pie pegajoso opcional con safe-area.
    expect(html(<Modal open onClose={() => {}} title="T" footer={<button>Ok</button>}><p>c</p></Modal>)).toMatch(/data-testid="hoja-pie"[^>]*>|hoja-pie/);
    const sheet = html(<Modal open onClose={() => {}} title="T" kicker="Movimiento" safeBottom><p>c</p></Modal>);
    expect(sheet).toMatch(/erp-kicker/);
    expect(sheet).toMatch(/safe-area-inset-bottom/);
    expect(html(<Modal open={false} onClose={() => {}} title="T"><p>c</p></Modal>)).toBe('');
  });
  it('Card, SectionLabel, RoleHeader y HeaderStat renderizan el lenguaje del shell de Administración', () => {
    expect(html(<Card>x</Card>)).toMatch(/rounded-card border shadow-card border-line bg-white/);
    expect(html(<Card tone="danger" padding="p-2.5">x</Card>)).toMatch(/border-red-100 bg-red-50 p-2\.5/);
    expect(html(<SectionLabel>Hoy</SectionLabel>)).toMatch(/uppercase tracking-\[0\.08em\] text-slate-500/);
    const h = html(<RoleHeader kicker="Almacén" title="Almacén de Bolsas" subtitle="Ana" accent="amber" onLogout={() => {}}><p>nota</p></RoleHeader>);
    expect(h).toMatch(/from-blue-950 via-slate-900 to-slate-900/);   // el mismo degradado del aside de Admin
    expect(h).toMatch(/erp-kicker text-amber-200\/90/);
    expect(h).toMatch(/font-display/);
    expect(h).toMatch(/safe-area-inset-top/);
    expect(h).toMatch(/Salir/);
    expect(h).toMatch(/nota/);
    expect(html(<RoleHeader title="Sin salir" />)).not.toMatch(/Salir/);
    expect(html(<HeaderStat label="Vendido hoy" value="$1,000" />)).toMatch(/bg-white\/10/);   // B2: /8 no existe en la escala de Tailwind
    expect(html(<StatusBadge status="Bajo" />)).toMatch(/bg-red-50 text-red-800/);
    expect(html(<StatusBadge status="OK" />)).toMatch(/bg-emerald-50 text-emerald-800/);
    expect(html(<StatusBadge status="Creada" />)).toMatch(/bg-amber-50 text-amber-800/);
  });
  it('tokens: radios y sombras con nombre; el aviso global queda por encima de modal y confirmación', () => {
    const tw = src('../../tailwind.config.js');
    expect(tw).toMatch(/field: '14px'/);
    expect(tw).toMatch(/card: '20px'/);
    expect(tw).toMatch(/panel: '28px'/);
    expect(tw).toMatch(/sheet: '0 -8px 40px/);
    expect(src('../components/ui/Toast.jsx')).toMatch(/z-\[96\]/);
  });
});

describe('A2: Almacén de Bolsas — presentación nueva, negocio idéntico', () => {
  const v = sinComentarios(src('../components/BolsasView.jsx'));
  it('usa las primitivas compartidas y ya no dibuja cabecera, hoja ni aviso propios', () => {
    expect(v).toMatch(/import Modal, \{ FormInput, FormBtn \} from '\.\/ui\/Modal'/);
    expect(v).toMatch(/import \{ Card, SectionLabel, StatusBadge, RoleHeader \} from '\.\/ui\/Components'/);
    expect(v).toMatch(/useToast\(\)/);
    // Mobile-first (2026-10-09): sin banner global de modo prueba (solo vive en Facturación).
    expect(v).not.toMatch(/ModoPruebaBanner/);
    expect(v).toMatch(/<RoleHeader kicker="Almacén" title="Almacén de Bolsas"/);
    expect(v).toMatch(/<Modal open=\{!!modal\}/);
    expect(v).not.toMatch(/from-amber-600 to-orange-600/);
    expect(v).not.toMatch(/rounded-t-\[30px\]/);
    expect(v).not.toMatch(/fixed inset-0/);
    expect(v).not.toMatch(/setToast|const \[toast, setToast\]/);
    expect(v).not.toMatch(/useBodyScrollLock/);   // lo hace Modal
  });
  it('la llamada de negocio es exactamente la misma (orden de argumentos, motivo, costo, proveedor, crédito, operación)', () => {
    expect(v).toMatch(/actions\.movimientoBolsa\(\s*form\.sku,\s*n\(form\.cantidad\),\s*esEntrada \? "Entrada" : "Salida",\s*motivo,\s*esEntrada \? n\(form\.costo\) : 0,\s*form\.proveedor \|\| null,\s*form\.esCredito,\s*\{ operacionId: op\.id \}\s*\)/);
    expect(v).toMatch(/const motivo = esEntrada \? "Recepción de compra" : \(form\.destino \|\| "Producción"\);/);
    expect(v).toMatch(/const clave = \[modal, form\.sku, n\(form\.cantidad\), esEntrada \? n\(form\.costo\) : 0, form\.proveedor \|\| '', !!form\.esCredito\]\.join\('\|'\);/);
    expect(v).toMatch(/resolverOperacion\(opRef\.current, clave\)/);
    expect(v).toMatch(/if \(err\?\.error\) \{ showToast\(err\.error, 'error'\); return; \}/);
    expect(v).toMatch(/opRef\.current = null;/);
    expect(v).not.toMatch(/supabase|rpc\(/);
  });
  it('validaciones y condición de deshabilitado idénticas', () => {
    expect(v).toMatch(/if \(!form\.cantidad \|\| n\(form\.cantidad\) <= 0\) return;/);
    expect(v).toMatch(/if \(esEntrada && !\(n\(form\.costo\) > 0\)\) \{ showToast\('Captura el total de la compra', 'error'\); return; \}/);
    expect(v).toMatch(/if \(esEntrada && form\.esCredito && !String\(form\.proveedor \|\| ''\)\.trim\(\)\) \{ showToast\('La compra a crédito requiere proveedor', 'error'\); return; \}/);
    expect(v).toMatch(/disabled=\{registrando \|\| !form\.cantidad \|\| n\(form\.cantidad\) <= 0 \|\| \(modal === "salida" && n\(form\.cantidad\) > stockActual\(form\.sku\)\) \|\| \(modal === "entrada" && !\(n\(form\.costo\) > 0\)\)\}/);
    expect(v).toMatch(/n\(p\.stock\) < 200/);
  });
  it('flujo y valores por defecto idénticos (dos movimientos, SKU EMP-25, destino Producción solo en entrega)', () => {
    expect(v).toMatch(/useState\(\{ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false \}\)/);
    expect(v).toMatch(/setModal\("entrada"\); setForm\(\{ sku: "EMP-25", cantidad: "", destino: "", costo: "", proveedor: "", esCredito: false \}\)/);
    expect(v).toMatch(/setModal\("salida"\); setForm\(\{ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false \}\)/);
    expect((v.match(/setModal\("(entrada|salida)"\)/g) || []).length).toBe(2);
    expect(v).toMatch(/resumenDiaEmpaque\(data\.inventarioMov, empaques\.map\(e => s\(e\.sku\)\), diaNegocio\(\)\)/);
    expect(v).toMatch(/clasificarMovEmpaque\(m\)/);
    expect(v).toMatch(/\.filter\(p => s\(p\.tipo\) === "Empaque"\)/);
  });
  it('textos de negocio conservados; la etiqueta del costo ya no dice "opcional" (siempre fue obligatorio)', () => {
    for (const t of ['total de la empresa (almacén + Producción sin usar)', 'Entregadas a Producción (no descuenta el total)', 'Se creará cuenta por pagar (deuda)',
      'Se registra egreso en contabilidad', 'entregadas a Producción', 'Sin tipos de empaque configurados', 'Pedir más bolsas', 'Registrando…',
      'Error al registrar. Verifica tu conexión.']) {
      expect(v, t).toContain(t);
    }
    expect(v).toMatch(/Costo total de la compra \*/);
    expect(v).not.toMatch(/opcional/);
  });
  it('el store no cambió: movimientoBolsa sigue con la misma firma y el mismo guard', () => {
    const store = src('../data/supaStore.js');
    expect(store).toMatch(/movimientoBolsa: async \(sku, cantidad, tipo, motivo, costo, proveedor, esCredito, opciones = \{\}\) => \{\s*const guard = requireRol\(\['Admin', 'Almacén Bolsas'\]\);/);
  });
  // (La guarda "las otras vistas no se tocaron" era del paquete A1+A2; A3–A5 y B
  // convergen el resto y se prueban en roleUiConvergencia.test.jsx.)
});
