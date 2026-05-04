import { useState, useMemo, useCallback } from 'react';
import { s, n, fmtMoney, extraerTelefono, todayLocalISO } from '../utils/safe';
import { EmptyState } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import NuevaVentaModal from './NuevaVentaModal';

const PAGOS = ["Efectivo", "Transferencia SPEI", "Tarjeta (terminal)", "QR / Link de pago", "Crédito (fiado)"];
const VENTAS_SHELL = "min-h-screen w-full max-w-[640px] mx-auto bg-[linear-gradient(180deg,#f8fafc_0%,#eef4f7_100%)] text-slate-900 md:max-w-3xl lg:max-w-5xl";

export default function VentasStandaloneView({ user, data, actions, onLogout }) {
  const toast = useToast();
  const [tab, setTab] = useState("ventas");
  const [modal, setModal] = useState(false);
  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({ metodo: "Efectivo", referencia: "" });
  const [checkoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [confirmandoCobro, setConfirmandoCobro] = useState(false);
  const [localToast, setLocalToast] = useState("");

  const showToast = (msg) => { setLocalToast(msg); setTimeout(() => setLocalToast(""), 3000); };

  const isOwnedBy = useCallback((row) => {
    if (!row) return false;
    const ownerId = user?.id;
    const authId = user?.auth_id;
    const ownerName = s(user?.nombre);
    const ownerKeys = ['usuario_id', 'vendedor_id', 'owner_id', 'created_by'];
    if (ownerKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(ownerId))) return true;
    const authKeys = ['auth_id', 'usuario_auth_id', 'vendedor_auth_id'];
    if (authId && authKeys.some(k => row[k] !== undefined && row[k] !== null && String(row[k]) === String(authId))) return true;
    const nameKeys = ['usuario', 'vendedor'];
    if (ownerName && nameKeys.some(k => row[k] !== undefined && row[k] !== null && s(row[k]) === ownerName)) return true;
    return false;
  }, [user]);

  const isAdminPreview = user?.rol === 'Admin';
  const ordenesUsuario = useMemo(() => isAdminPreview ? (data.ordenes || []) : (data.ordenes || []).filter(o => isOwnedBy(o)), [data.ordenes, isOwnedBy, isAdminPreview]);

  const cobrar = (ord) => { setPagoModal(ord); setPagoForm({ metodo: "Efectivo", referencia: "" }); setCheckoutUrl(null); setShortUrl(null); };

  const confirmarCobro = async () => {
    if (!pagoModal) return;
    if (pagoForm.metodo === "QR / Link de pago") {
      setGenerandoLink(true);
      try {
        const result = await actions.crearCheckoutPago?.(pagoModal.id, checkoutProvider);
        if (result?.checkoutUrl) {
          setCheckoutUrl(result.checkoutUrl);
          setShortUrl(result.shortUrl || result.checkoutUrl);
          showToast('Link de pago generado');
        } else {
          showToast('Error al generar link de pago');
        }
      } catch (e) {
        showToast('Error: ' + (e.message || 'No se pudo generar el link'));
      } finally {
        setGenerandoLink(false);
      }
      return;
    }
    if (confirmandoCobro) return;
    setConfirmandoCobro(true);
    try {
      await actions.updateOrdenEstatus(pagoModal.id, "Entregada", pagoForm.metodo);
      showToast(pagoForm.metodo.includes("Crédito") || pagoForm.metodo.includes("fiado") ? "Venta a crédito registrada" : "Cobrado — " + pagoForm.metodo);
      setPagoModal(null);
    } catch (e) {
      console.error('Error confirmando cobro:', e);
      showToast('Error al cobrar. Verifica tu conexión.');
    } finally {
      setConfirmandoCobro(false);
    }
  };

  const hoy = todayLocalISO();
  const ordenesHoy = useMemo(() => ordenesUsuario.filter(o => o.fecha && o.fecha.slice(0, 10) === hoy), [ordenesUsuario, hoy]);
  const pendientes = useMemo(() => ordenesUsuario.filter(o => o.estatus === "Creada"), [ordenesUsuario]);
  const ventasHoy = useMemo(() => ordenesHoy.filter(o => o.estatus === "Entregada").reduce((s, o) => s + n(o.total), 0), [ordenesHoy]);

  const abrirNuevaVenta = () => setModal(true);

  return (
    <div className={VENTAS_SHELL}>
      <div className="bg-gradient-to-r from-emerald-600 to-teal-600 px-4 pb-5 text-white shadow-[0_24px_48px_rgba(5,150,105,0.18)]" style={{ paddingTop: "max(env(safe-area-inset-top, 44px), 44px)" }}>
        <div className="flex items-center justify-between mb-1">
          <div><p className="erp-kicker text-emerald-100/80">Ventas</p><h1 className="font-display text-[1.6rem] font-bold tracking-[-0.04em]">Ventas del día</h1><p className="text-xs text-emerald-100">{s(user?.nombre)}</p></div>
          <button onClick={onLogout} className="rounded-full border border-white/10 bg-white/8 px-3 py-1.5 text-xs">Salir</button>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Vendido hoy</p><p className="mt-1.5 text-[1.8rem] font-extrabold">{fmtMoney(ventasHoy)}</p></div>
          <div className="rounded-[22px] border border-white/10 bg-white/8 p-4 backdrop-blur-xl"><p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-amber-200/70">Pendientes</p><p className="mt-1.5 text-[1.8rem] font-extrabold">{pendientes.length}</p><p className="text-xs text-stone-300">órdenes por cobrar</p></div>
        </div>
      </div>

      <div className="px-4 pt-4 space-y-4">
        <button onClick={abrirNuevaVenta}
          className="inline-flex w-full sm:w-auto items-center justify-center gap-2 rounded-[22px] bg-emerald-600 hover:bg-emerald-700 px-6 sm:px-10 py-4 sm:py-3.5 text-base sm:text-sm font-extrabold text-white shadow-[0_20px_34px_rgba(5,150,105,0.16)] transition-all active:scale-[0.98]">
          + Nueva venta
        </button>

        <div className="grid grid-cols-1 gap-1 rounded-[20px] border border-stone-200/80 bg-white/72 p-1.5 shadow-[0_14px_28px_rgba(22,18,15,0.05)] sm:grid-cols-3">
          {[{ k: "ventas", l: "Por cobrar" }, { k: "hoy", l: "Hoy" }, { k: "todas", l: "Todas" }].map(t => (
            <button key={t.k} onClick={() => setTab(t.k)}
              className={`flex-1 rounded-[16px] py-3 text-sm font-semibold transition-all ${tab === t.k ? "bg-emerald-600 text-white shadow-[0_12px_22px_rgba(5,150,105,0.14)]" : "text-slate-600"}`}>
              {t.l}
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {(tab === "ventas" ? pendientes : tab === "hoy" ? ordenesHoy : ordenesUsuario).map(o => (
            <div key={o.id} className="rounded-[24px] border border-stone-200/80 bg-white/78 p-4 shadow-[0_14px_28px_rgba(22,18,15,0.05)]">
              <div className="flex justify-between items-start">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-600">{s(o.folio)}</span>
                    {o.requiereFactura && <span className="text-[10px] bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded">FACTURA</span>}
                  </div>
                  <p className="text-sm font-bold text-slate-800 mt-0.5">{s(o.cliente)}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{s(o.productos)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-extrabold text-slate-800">{fmtMoney(o.total)}</p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                    o.estatus === "Creada" ? "bg-blue-100 text-blue-700" :
                    o.estatus === "Asignada" ? "bg-amber-100 text-amber-700" :
                    o.estatus === "Entregada" ? "bg-emerald-100 text-emerald-700" :
                    "bg-slate-100 text-slate-600"
                  }`}>{s(o.estatus)}</span>
                </div>
              </div>
              {o.estatus === "Creada" && (
                <div className="flex gap-2 mt-3">
                  <button onClick={() => cobrar(o)} className="flex-1 rounded-[18px] bg-emerald-600 py-3.5 text-sm font-bold text-white transition-transform active:scale-[0.98]">Cobrar</button>
                  <button onClick={() => { actions.updateOrdenEstatus(o.id, "Asignada"); showToast("Asignada a ruta"); }}
                    className="flex-1 rounded-[18px] border border-amber-200 bg-amber-50 py-3.5 text-sm font-bold text-amber-800">Enviar a ruta</button>
                </div>
              )}
              {o.estatus === "Asignada" && (
                <button onClick={() => cobrar(o)} className="w-full mt-3 rounded-[18px] border border-emerald-200 bg-emerald-50 py-3.5 text-sm font-bold text-emerald-700">Cobrar entrega</button>
              )}
            </div>
          ))}
          {(tab === "ventas" ? pendientes : tab === "hoy" ? ordenesHoy : ordenesUsuario).length === 0 && (
            <>
              {tab === "ventas" && (
                <EmptyState
                  message="Sin órdenes pendientes"
                  hint="Cuando crees una venta a crédito o se asigne entrega, aparecerá aquí"
                />
              )}
              {tab === "hoy" && (
                <EmptyState
                  message="Aún no hay ventas hoy"
                  hint="Usa el botón verde de arriba para registrar la primera del día"
                />
              )}
              {tab === "todas" && (
                <EmptyState
                  message="No has hecho ventas todavía"
                  hint="Usa el botón verde de arriba para crear tu primera venta"
                />
              )}
            </>
          )}
        </div>
        <div className="h-8" />
      </div>

      {/* ═══ MODAL NUEVA VENTA (componente compartido) ═══ */}
      <NuevaVentaModal
        open={modal}
        onClose={() => setModal(false)}
        onSuccess={(orden) => {
          setModal(false);
          if (orden) {
            showToast('Orden creada — ahora cobra');
            cobrar(orden);
          } else {
            showToast('Orden creada');
          }
        }}
        data={data}
        actions={actions}
        user={user}
        toast={toast}
        variant="standalone"
      />

      {/* ═══ MODAL COBRO ═══ */}
      {pagoModal && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={() => setPagoModal(null)}>
          <div className="w-full max-w-lg rounded-t-[30px] border border-slate-200/80 bg-white p-5 shadow-[0_30px_70px_rgba(22,18,15,0.18)]" onClick={e => e.stopPropagation()} style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 24px)" }}>
            <div className="w-10 h-1 bg-slate-300 rounded-full mx-auto mb-4" />
            <p className="erp-kicker text-slate-400">Cobranza</p>
            <h3 className="font-display text-lg font-bold tracking-[-0.03em] text-slate-900 mb-1">Cobrar {s(pagoModal.folio)}</h3>
            <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} — <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span>
              {pagoModal.requiereFactura && <span className="ml-2 text-xs bg-purple-100 text-purple-700 font-bold px-1.5 py-0.5 rounded">FACTURA</span>}
            </p>
            <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Método de pago</label>
            <div className="grid grid-cols-1 gap-2 mb-4 sm:grid-cols-2">
              {PAGOS.map(m => (
                <button key={m} onClick={() => setPagoForm(f => ({ ...f, metodo: m }))}
                  className={`py-3 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${pagoForm.metodo === m ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-slate-200 text-slate-600"}`}>
                  {m}
                </button>
              ))}
            </div>
            {pagoForm.metodo === "Transferencia SPEI" && (
              <div className="mb-4"><label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-1">Referencia</label>
                <input value={pagoForm.referencia} onChange={e => setPagoForm(f => ({ ...f, referencia: e.target.value }))}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Últimos 6 dígitos" /></div>
            )}

            {pagoForm.metodo === "QR / Link de pago" && checkoutUrl && (
              <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
                <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
                <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
                  {(() => {
                    const cliente = (data?.clientes || []).find(c => String(c.id) === String(pagoModal.clienteId || pagoModal.cliente_id));
                    const tel = extraerTelefono(cliente?.contacto || cliente?.telefono);
                    const empresaNombre = s(data?.configEmpresa?.razonSocial) || 'Cubo Polar';
                    const msg = `Hola, aquí está tu link de pago de ${empresaNombre} por ${fmtMoney(pagoModal.total)} MXN:\n${shortUrl || checkoutUrl}`;
                    const href = tel
                      ? `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`
                      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                    return <a href={href} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 Enviar por WhatsApp</a>;
                  })()}
                </div>
                <button onClick={() => { setCheckoutUrl(null); setShortUrl(null); setPagoModal(null); }} className="w-full py-2 text-xs text-slate-500 font-semibold">Cerrar</button>
              </div>
            )}
            {pagoForm.metodo === "Crédito (fiado)" && (
              <div className="mb-4 p-3 bg-amber-50 rounded-xl"><p className="text-xs text-amber-700 font-semibold">Se agregará al saldo del cliente</p></div>
            )}
            {!checkoutUrl && <button onClick={confirmarCobro} disabled={generandoLink || confirmandoCobro} className={`w-full py-3.5 text-white font-bold rounded-xl text-sm shadow-lg shadow-emerald-200 disabled:cursor-not-allowed ${(generandoLink || confirmandoCobro) ? 'bg-slate-400' : 'bg-emerald-600'}`}>{generandoLink ? 'Generando link…' : confirmandoCobro ? 'Cobrando…' : pagoForm.metodo === "QR / Link de pago" ? "Generar link de pago" : "Confirmar cobro"}</button>}
          </div>
        </div>
      )}

      {localToast && (
        <div className="fixed top-4 left-1/2 z-[60] -translate-x-1/2 rounded-full bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_18px_32px_rgba(5,150,105,0.24)]" style={{ top: "max(env(safe-area-inset-top, 16px), 52px)" }} role="status" aria-live="polite">
          {localToast}
        </div>
      )}
    </div>
  );
}
