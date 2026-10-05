import { useState, useMemo, useRef } from 'react';
import { diaNegocio } from '../utils/fechas';
import { s, n } from '../utils/safe';
import { EmptyState } from './ui/Skeleton';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel, StatusBadge, RoleHeader } from './ui/Components';
import { Icons } from './ui/Icons';
import { useToast } from './ui/Toast';
import ModoPruebaBanner from './ui/ModoPruebaBanner';
import { resolverOperacion } from '../data/produccionAtomicaLogic';
import { clasificarMovEmpaque, resumenDiaEmpaque } from '../data/empaqueLogic';

// Fase A (convergencia visual por rol): esta vista usa las primitivas del shell
// de Administración (RoleHeader, Card, Modal, FormInput, FormBtn, StatusBadge,
// toast global). El flujo (dos movimientos: entrada por compra y entrega a
// Producción), sus validaciones y la llamada a movimientoBolsa no cambian.
const BOLSAS_SHELL = "min-h-dvh w-full text-slate-900";
const CONTENIDO = "mx-auto w-full max-w-[640px] px-4 pt-4 space-y-4 md:max-w-3xl lg:max-w-5xl";
const SKU_BTN = "rounded-[16px] border-2 px-3 py-3 text-left text-sm font-semibold transition-colors";

export default function BolsasView({ user, data, actions, onLogout }) {
  const [modal, setModal] = useState(null); // "entrada" | "salida"
  const [form, setForm] = useState({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false });
  const opRef = useRef(null);
  const toast = useToast();
  const [registrando, setRegistrando] = useState(false);

  const empaques = useMemo(() => data.productos.filter(p => s(p.tipo) === "Empaque"), [data.productos]);
  const empaqueSKUs = useMemo(() => new Set(empaques.map(e => s(e.sku))), [empaques]);
  const showToast = (msg, tipo = "success") => { (toast?.[tipo] || toast?.info)?.(msg); };

  // Cargar historial del día desde la BD (inventarioMov) para empaques
  const historial = useMemo(() => {
    const hoyStr = diaNegocio();
    return (data.inventarioMov || [])
      .filter(m => {
        const fecha = s(m.createdAt || m.created_at || m.fecha);
        const sku = s(m.producto || m.sku);
        return fecha.startsWith(hoyStr) && empaqueSKUs.has(sku);
      })
      .map(m => {
        const sku = s(m.producto || m.sku);
        const prod = empaques.find(e => s(e.sku) === sku);
        return {
          id: m.id,
          // 092: 'entrada' (llegó, suma al total), 'entrega' (a Producción, no
          // resta) u otro movimiento (consumo de producción, historia previa).
          tipo: clasificarMovEmpaque(m),
          sku,
          nombre: prod ? s(prod.nombre) : '',
          cantidad: Math.abs(n(m.cantidad)),
          motivo: s(m.origen),
          hora: new Date(m.createdAt || m.created_at).toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" }),
        };
      })
      .sort((a, b) => b.id - a.id);
  }, [data.inventarioMov, empaqueSKUs, empaques]);

  const movHoy = useMemo(
    () => resumenDiaEmpaque(data.inventarioMov, empaques.map(e => s(e.sku)), diaNegocio()),
    [data.inventarioMov, empaques],
  );

  const registrar = async () => {
    if (registrando) return;
    if (!form.cantidad || n(form.cantidad) <= 0) return;
    const esEntrada = modal === "entrada";
    const motivo = esEntrada ? "Recepción de compra" : (form.destino || "Producción");

    if (esEntrada && !(n(form.costo) > 0)) { showToast('Captura el total de la compra', 'error'); return; }
    if (esEntrada && form.esCredito && !String(form.proveedor || '').trim()) { showToast('La compra a crédito requiere proveedor', 'error'); return; }
    // 088: un operacion_id por movimiento lógico; un reintento con los mismos
    // datos reutiliza el UUID (el servidor no duplica stock ni contabilidad).
    const clave = [modal, form.sku, n(form.cantidad), esEntrada ? n(form.costo) : 0, form.proveedor || '', !!form.esCredito].join('|');
    const op = resolverOperacion(opRef.current, clave);
    opRef.current = op;

    setRegistrando(true);
    try {
      const err = await actions.movimientoBolsa(
        form.sku,
        n(form.cantidad),
        esEntrada ? "Entrada" : "Salida",
        motivo,
        esEntrada ? n(form.costo) : 0,
        form.proveedor || null,
        form.esCredito,
        { operacionId: op.id }
      );
      if (err?.error) { showToast(err.error, 'error'); return; }
      opRef.current = null;

      // El historial se actualiza automáticamente via realtime desde inventarioMov.
      showToast(esEntrada
        ? "+" + form.cantidad + " " + form.sku + (form.esCredito ? " (crédito)" : "")
        : form.cantidad + " " + form.sku + " entregadas a Producción");
      setModal(null);
      setForm({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false });
    } catch (e) {
      console.error('Error registrando movimiento bolsa:', e);
      showToast('Error al registrar. Verifica tu conexión.', 'error');
    } finally {
      setRegistrando(false);
    }
  };

  const stockActual = (sku) => n(empaques.find(p => s(p.sku) === sku)?.stock || 0);
  const esEntrada = modal === "entrada";
  const faltaProveedor = esEntrada && form.esCredito && !String(form.proveedor || '').trim();
  const excedeTotal = modal === "salida" && !!form.cantidad && n(form.cantidad) > stockActual(form.sku);

  return (
    <div className={BOLSAS_SHELL}>
      <ModoPruebaBanner />
      <RoleHeader kicker="Almacén" title="Almacén de Bolsas" subtitle={s(user?.nombre)} accent="amber" onLogout={onLogout}>
        <p className="text-sm text-slate-300">Registra lo que llega y lo que entregas a Producción. El inventario es el total de la empresa: baja cuando Producción usa las bolsas.</p>
      </RoleHeader>

      <div className={CONTENIDO}>
        {(!empaques || empaques.length === 0) && (
          <EmptyState
            icon="Package"
            message="Sin tipos de empaque configurados"
            hint="Pide a Admin que agregue empaques (EMP-25, EMP-5) al catálogo"
          />
        )}
        {empaques.map(p => {
          const mov = movHoy[s(p.sku)] || { entradas: 0, entregas: 0 };
          const bajo = n(p.stock) < 200;
          return (
            <Card key={p.id}>
              <div className="mb-2 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-800">{s(p.nombre)}</p>
                  <p className="font-mono text-xs text-slate-500">{s(p.sku)}</p>
                </div>
                <StatusBadge status={bajo ? "Bajo" : "OK"} />
              </div>
              <p className="font-display text-4xl font-bold tracking-[-0.05em] text-slate-900">{n(p.stock).toLocaleString()}</p>
              <p className="mt-1 text-xs text-slate-500">total de la empresa (almacén + Producción sin usar)</p>
              {(mov.entradas > 0 || mov.entregas > 0) && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {mov.entradas > 0 && <Card tone="success" padding="p-2.5"><SectionLabel className="!text-emerald-700">Entradas hoy</SectionLabel><p className="text-lg font-extrabold text-emerald-800">+{mov.entradas.toLocaleString()}</p></Card>}
                  {mov.entregas > 0 && <Card tone="warning" padding="p-2.5"><SectionLabel className="!text-amber-700">Entregadas a Producción hoy</SectionLabel><p className="text-lg font-extrabold text-amber-800">{mov.entregas.toLocaleString()}</p></Card>}
                </div>
              )}
              {bajo && (
                <Card tone="danger" padding="p-2.5" className="mt-3">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-red-700"><Icons.AlertTriangle /> Pedir más bolsas</p>
                </Card>
              )}
            </Card>
          );
        })}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <FormBtn success size="lg" onClick={() => { setModal("entrada"); setForm({ sku: "EMP-25", cantidad: "", destino: "", costo: "", proveedor: "", esCredito: false }); }}>
            <Icons.Plus /> Llegaron
          </FormBtn>
          <FormBtn warning size="lg" onClick={() => { setModal("salida"); setForm({ sku: "EMP-25", cantidad: "", destino: "Producción", costo: "", proveedor: "", esCredito: false }); }}>
            <Icons.Truck /> Entregué a Producción
          </FormBtn>
        </div>

        {historial.length > 0 && (
          <div>
            <SectionLabel className="mb-2">Movimientos de hoy</SectionLabel>
            <div className="space-y-2">
              {historial.map(h => (
                <Card key={h.id} padding="p-3" tone={h.tipo === "entrada" ? "success" : h.tipo === "entrega" ? "warning" : "danger"}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-bold ${h.tipo === "entrada" ? "text-emerald-700" : h.tipo === "entrega" ? "text-amber-800" : "text-red-700"}`}>
                      {h.tipo === "entrada" ? "+" : h.tipo === "entrega" ? "→ " : "-"}{h.cantidad.toLocaleString()} {h.nombre ? `${h.nombre} (${h.sku})` : h.sku}
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1 text-xs text-slate-400"><Icons.Clock /> {h.hora}</span>
                  </div>
                  <p className="mt-1 text-xs text-slate-500">{h.tipo === "entrega" ? "Entregadas a Producción (no descuenta el total)" : h.motivo}</p>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      <Modal open={!!modal} onClose={() => setModal(null)} kicker="Movimiento" safeBottom closeOnEscape={!registrando}
        title={esEntrada ? "¿Cuántas llegaron?" : "¿Cuántas entregaste a producción?"}>
        {modal === "salida" && (
          <p className="mb-3 text-xs text-slate-500">Queda registrada la entrega a Producción. No descuenta el total de la empresa: las bolsas se descuentan cuando Producción registra lo que produjo.</p>
        )}
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Tipo de bolsa</label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {empaques.map(p => (
                <button key={p.sku} type="button" onClick={() => setForm(f => ({ ...f, sku: s(p.sku) }))}
                  className={`${SKU_BTN} ${form.sku === s(p.sku) ? (esEntrada ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-amber-500 bg-amber-50 text-amber-800") : "border-slate-200 bg-white/80 text-slate-600"}`}>
                  {s(p.nombre)}
                  <p className="mt-0.5 text-xs font-normal text-slate-400">Total empresa: {n(p.stock).toLocaleString()}</p>
                </button>
              ))}
            </div>
          </div>
          <FormInput label="¿Cuántas? *" type="number" min="0" inputMode="numeric" value={form.cantidad} onChange={e => setForm(f => ({ ...f, cantidad: e.target.value }))}
            inputClassName="text-center !text-2xl font-bold" placeholder="0" autoFocus
            error={excedeTotal ? `No hay tantas: el total de la empresa es ${stockActual(form.sku).toLocaleString()}` : undefined} />

          {modal === "entrada" && (
            <>
              <FormInput label="Proveedor" type="text" value={form.proveedor} onChange={e => setForm(f => ({ ...f, proveedor: e.target.value }))} placeholder="Ej: Bolsas del Norte"
                error={faltaProveedor ? "La compra a crédito requiere proveedor" : undefined} />
              <FormInput label="Costo total de la compra *" type="number" min="0" step="0.01" inputMode="decimal" value={form.costo} onChange={e => setForm(f => ({ ...f, costo: e.target.value }))}
                inputClassName="text-center" placeholder="$0.00" hint="Con este total se recalcula el costo promedio del empaque." />
              {n(form.costo) > 0 && (
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">Forma de pago</label>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <button type="button" onClick={() => setForm(f => ({ ...f, esCredito: false }))}
                      className={`${SKU_BTN} text-center ${!form.esCredito ? "border-emerald-500 bg-emerald-50 text-emerald-800" : "border-slate-200 bg-white/80 text-slate-600"}`}>
                      Contado
                    </button>
                    <button type="button" onClick={() => setForm(f => ({ ...f, esCredito: true }))}
                      className={`${SKU_BTN} text-center ${form.esCredito ? "border-amber-500 bg-amber-50 text-amber-800" : "border-slate-200 bg-white/80 text-slate-600"}`}>
                      Crédito
                    </button>
                  </div>
                  <p className="mt-1 text-center text-xs text-slate-400">
                    {form.esCredito ? "Se creará cuenta por pagar (deuda)" : "Se registra egreso en contabilidad"}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
        <FormBtn success={esEntrada} warning={!esEntrada} size="lg" className="mt-4 w-full" onClick={registrar}
          disabled={registrando || !form.cantidad || n(form.cantidad) <= 0 || (modal === "salida" && n(form.cantidad) > stockActual(form.sku)) || (modal === "entrada" && !(n(form.costo) > 0))}>
          {registrando ? "Registrando…" : <><Icons.Check /> {esEntrada ? "Registrar entrada" : "Registrar entrega"}</>}
        </FormBtn>
      </Modal>
    </div>
  );
}
