import { useState, useMemo, useCallback } from 'react';
import { diaNegocio } from '../utils/fechas';
import { s, n, fmtMoney, extraerTelefono } from '../utils/safe';
import { EmptyState } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import NuevaVentaModal from './NuevaVentaModal';
import ModoPruebaBanner from './ui/ModoPruebaBanner';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel, StatusBadge, RoleHeader, HeaderStat, SegmentedTabs, ChoiceButton, KpiTile, PageHeader } from './ui/Components';
import { Icons } from './ui/Icons';

// Fase A3 (convergencia visual por rol): esta vista usa las primitivas del
// shell de Administración. El flujo (Por cobrar / Hoy / Todas, nueva venta por
// NuevaVentaModal variant="standalone", cobro por updateOrdenEstatus o link de
// pago por crearCheckoutPago), el alcance por vendedor (isOwnedBy) y los
// métodos de pago no cambian.
//   embedded: la vista vive dentro del shell compartido (sin cabecera propia).
//   tab/onTab: pestaña controlada por el shell (menú por rol); sin ellas, estado interno.
const PAGOS = ["Efectivo", "Transferencia SPEI", "Tarjeta (terminal)", "QR / Link de pago", "Crédito (fiado)"];
const TABS = [{ k: "ventas", l: "Por cobrar", icon: "DollarSign" }, { k: "hoy", l: "Hoy", icon: "Clock" }, { k: "todas", l: "Todas", icon: "List" }];
const CONTENIDO = "mx-auto w-full max-w-[640px] space-y-4 md:max-w-3xl lg:max-w-5xl";

export default function VentasStandaloneView({ user, data, actions, onLogout, embedded = false, tab: tabProp, onTab }) {
  const toast = useToast();
  const [tabLocal, setTabLocal] = useState("ventas");
  const tab = tabProp ?? tabLocal;
  const setTab = (k) => { if (onTab) onTab(k); else setTabLocal(k); };
  const [modal, setModal] = useState(false);
  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({ metodo: "Efectivo", referencia: "" });
  const [checkoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [confirmandoCobro, setConfirmandoCobro] = useState(false);

  const showToast = (msg, tipo = "success") => { (toast?.[tipo] || toast?.info)?.(msg); };

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
          showToast('Error al generar link de pago', 'error');
        }
      } catch (e) {
        showToast('Error: ' + (e.message || 'No se pudo generar el link'), 'error');
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
      showToast('Error al cobrar. Verifica tu conexión.', 'error');
    } finally {
      setConfirmandoCobro(false);
    }
  };

  const hoy = diaNegocio();
  const ordenesHoy = useMemo(() => ordenesUsuario.filter(o => o.fecha && o.fecha.slice(0, 10) === hoy), [ordenesUsuario, hoy]);
  const pendientes = useMemo(() => ordenesUsuario.filter(o => o.estatus === "Creada"), [ordenesUsuario]);
  const ventasHoy = useMemo(() => ordenesHoy.filter(o => o.estatus === "Entregada").reduce((s, o) => s + n(o.total), 0), [ordenesHoy]);

  const abrirNuevaVenta = () => setModal(true);
  const lista = tab === "ventas" ? pendientes : tab === "hoy" ? ordenesHoy : ordenesUsuario;
  const nuevaVentaBtn = (
    <FormBtn success size={embedded ? undefined : "lg"} className={embedded ? "" : "w-full sm:w-auto sm:px-10"} onClick={abrirNuevaVenta}>
      <Icons.Plus /> Nueva venta
    </FormBtn>
  );

  return (
    <div className={embedded ? "text-slate-900" : "min-h-dvh w-full text-slate-900"} data-testid="ventas-shell">
      {!embedded && <ModoPruebaBanner />}
      {embedded ? (
        <div className={CONTENIDO}>
          <PageHeader title="Ventas del día" subtitle={s(user?.nombre)} extraButtons={nuevaVentaBtn} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <KpiTile label="Vendido hoy" value={fmtMoney(ventasHoy)} />
            <KpiTile label="Pendientes" value={pendientes.length} hint="órdenes por cobrar" />
          </div>
        </div>
      ) : (
        <RoleHeader kicker="Ventas" title="Ventas del día" subtitle={s(user?.nombre)} accent="emerald" onLogout={onLogout}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HeaderStat label="Vendido hoy" value={fmtMoney(ventasHoy)} />
            <HeaderStat label="Pendientes" value={<>{pendientes.length} <span className="text-sm font-medium text-slate-300">órdenes por cobrar</span></>} />
          </div>
        </RoleHeader>
      )}

      <div className={`${CONTENIDO} ${embedded ? "pt-4" : "px-4 pt-4"}`}>
        {!embedded && nuevaVentaBtn}

        {/* En el shell compartido el menú lateral ya lista estas pestañas (lg+). */}
        <SegmentedTabs items={TABS} value={tab} onChange={setTab} accent="emerald" className={embedded ? "lg:hidden" : ""} />

        <div className="space-y-2">
          {lista.map(o => (
            <Card key={o.id} padding="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-blue-700">{s(o.folio)}</span>
                    {o.requiereFactura && <span className="rounded-full border border-violet-200/80 bg-violet-100/80 px-2 py-0.5 text-[10px] font-bold text-violet-900">FACTURA</span>}
                  </div>
                  <p className="mt-0.5 truncate text-sm font-bold text-slate-800">{s(o.cliente)}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{s(o.productos)}</p>
                </div>
                <div className="flex flex-shrink-0 flex-col items-end gap-1">
                  <p className="font-display text-base font-bold tracking-[-0.03em] text-slate-900">{fmtMoney(o.total)}</p>
                  <StatusBadge status={s(o.estatus)} />
                </div>
              </div>
              {o.estatus === "Creada" && (
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <FormBtn success onClick={() => cobrar(o)}>Cobrar</FormBtn>
                  <FormBtn onClick={() => { actions.updateOrdenEstatus(o.id, "Asignada"); showToast("Asignada a ruta"); }}
                    className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"><Icons.Truck /> Enviar a ruta</FormBtn>
                </div>
              )}
              {o.estatus === "Asignada" && (
                <FormBtn onClick={() => cobrar(o)} className="mt-3 w-full border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100">Cobrar entrega</FormBtn>
              )}
            </Card>
          ))}
          {lista.length === 0 && (
            <Card>
              {tab === "ventas" && (
                <EmptyState
                  icon="DollarSign"
                  message="Sin órdenes pendientes"
                  hint="Cuando crees una venta a crédito o se asigne entrega, aparecerá aquí"
                />
              )}
              {tab === "hoy" && (
                <EmptyState
                  icon="ShoppingCart"
                  message="Aún no hay ventas hoy"
                  hint="Usa el botón verde de arriba para registrar la primera del día"
                />
              )}
              {tab === "todas" && (
                <EmptyState
                  icon="ShoppingCart"
                  message="No has hecho ventas todavía"
                  hint="Usa el botón verde de arriba para crear tu primera venta"
                />
              )}
            </Card>
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
      <Modal open={!!pagoModal} onClose={() => setPagoModal(null)} kicker="Cobranza" safeBottom closeOnEscape={!generandoLink && !confirmandoCobro}
        title={pagoModal ? `Cobrar ${s(pagoModal.folio)}` : ""}>
        {pagoModal && (<>
          <p className="mb-4 text-sm text-slate-500">{s(pagoModal.cliente)} — <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span>
            {pagoModal.requiereFactura && <span className="ml-2 rounded-full border border-violet-200/80 bg-violet-100/80 px-2 py-0.5 text-[10px] font-bold text-violet-900">FACTURA</span>}
          </p>
          <SectionLabel className="mb-2">Método de pago</SectionLabel>
          <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PAGOS.map(m => (
              <ChoiceButton key={m} tone="emerald" active={pagoForm.metodo === m} onClick={() => setPagoForm(f => ({ ...f, metodo: m }))} className="text-xs">
                {m}
              </ChoiceButton>
            ))}
          </div>
          {pagoForm.metodo === "Transferencia SPEI" && (
            <div className="mb-4">
              <FormInput label="Referencia" value={pagoForm.referencia} onChange={e => setPagoForm(f => ({ ...f, referencia: e.target.value }))} placeholder="Últimos 6 dígitos" />
            </div>
          )}

          {pagoForm.metodo === "QR / Link de pago" && checkoutUrl && (
            <Card tone="success" padding="p-4" className="mb-4 space-y-3">
              <p className="flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Icons.Check /> Link de pago generado</p>
              <p className="break-all rounded-[12px] border border-slate-200 bg-white p-2 text-xs text-slate-600">{shortUrl || checkoutUrl}</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <FormBtn ghost onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); showToast('Link copiado'); }} className="text-xs">Copiar link</FormBtn>
                {(() => {
                  const cliente = (data?.clientes || []).find(c => String(c.id) === String(pagoModal.clienteId || pagoModal.cliente_id));
                  const tel = extraerTelefono(cliente?.contacto || cliente?.telefono);
                  const empresaNombre = s(data?.configEmpresa?.razonSocial) || 'Cubo Polar';
                  const msg = `Hola, aquí está tu link de pago de ${empresaNombre} por ${fmtMoney(pagoModal.total)} MXN:\n${shortUrl || checkoutUrl}`;
                  const href = tel
                    ? `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`
                    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                  return <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-[44px] items-center justify-center rounded-[16px] bg-emerald-600 px-5 py-3 text-xs font-semibold text-white hover:bg-emerald-700">Enviar por WhatsApp</a>;
                })()}
              </div>
              <button type="button" onClick={() => { setCheckoutUrl(null); setShortUrl(null); setPagoModal(null); }} className="w-full py-2 text-xs font-semibold text-slate-500">Cerrar</button>
            </Card>
          )}
          {pagoForm.metodo === "Crédito (fiado)" && (
            <Card tone="warning" padding="p-3" className="mb-4"><p className="text-xs font-semibold text-amber-800">Se agregará al saldo del cliente</p></Card>
          )}
          {!checkoutUrl && (
            <FormBtn success size="lg" className="w-full" onClick={confirmarCobro} disabled={generandoLink || confirmandoCobro}>
              {generandoLink ? 'Generando link…' : confirmandoCobro ? 'Cobrando…' : pagoForm.metodo === "QR / Link de pago" ? "Generar link de pago" : "Confirmar cobro"}
            </FormBtn>
          )}
        </>)}
      </Modal>
    </div>
  );
}
