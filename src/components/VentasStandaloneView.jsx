import { useState, useMemo, useCallback } from 'react';
import { diaNegocio } from '../utils/fechas';
import { s, fmtMoney, fmtDate, extraerTelefono } from '../utils/safe';
import { resumenPendientes, resumenVentasHoy, resumenHistorial, textoDesglose } from '../data/ventasResumenLogic';
import { FILTROS_VENTAS } from '../data/navRolLogic';
import { accionesCobroVentas, ejecutarMutacion } from '../data/ventasCobroLogic';
import { modoVentaDirecta, linkPagadoCompleto, METODO_LINK } from '../data/ventaDirectaLogic';
import VentaDirectaOrigen, { useVentaDirecta } from './VentaDirectaOrigen';
import { EmptyState } from './ui/Skeleton';
import { useToast } from './ui/Toast';
import NuevaVentaModal from './NuevaVentaModal';
import Modal, { FormInput, FormBtn } from './ui/Modal';
import { Card, SectionLabel, StatusBadge, RoleHeader, HeaderStat, SegmentedTabs, ChoiceButton } from './ui/Components';
import { Icons } from './ui/Icons';

// Fase A3 (convergencia visual por rol): esta vista usa las primitivas del
// shell de Administración. B3.6: Ventas es UN espacio de trabajo con filtros
// internos (Pendientes / Hoy / Todas) sobre las mismas órdenes; nueva venta por
// NuevaVentaModal variant="standalone", cobro y entrega por completar_venta_directa (OL-02C) o link de
// pago por crearCheckoutPago, el alcance por vendedor (isOwnedBy) y los
// métodos de pago no cambian.
//   embedded: la vista vive dentro del shell compartido (sin cabecera propia).
//   filtro/onFiltro: filtro interno controlado por el shell (hash #/ventas,
//   #/ventas-hoy, #/ventas-todas); sin ellos, estado interno.
const PAGOS = ["Efectivo", "Transferencia SPEI", "Tarjeta (terminal)", "QR / Link de pago", "Crédito (fiado)"];
const FILTROS = FILTROS_VENTAS.map(f => ({ k: f.id, l: f.label, icon: f.icon }));
// B2: dentro del shell el contenido ocupa el workspace como las vistas de Admin
// (sin columna angosta); solo la vista suelta conserva el ancho móvil centrado.
const CONTENIDO = "mx-auto w-full max-w-[640px] space-y-4 md:max-w-3xl lg:max-w-5xl";
const CONTENIDO_SHELL = "w-full space-y-4";

export default function VentasStandaloneView({ user, data, actions, onLogout, embedded = false, filtro: filtroProp, onFiltro }) {
  const toast = useToast();
  const [filtroLocal, setFiltroLocal] = useState("pendientes");
  const filtro = FILTROS.some(f => f.k === filtroProp) ? filtroProp : filtroLocal;
  const setFiltro = (k) => { if (onFiltro) onFiltro(k); else setFiltroLocal(k); };
  const [modal, setModal] = useState(false);
  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({ metodo: "Efectivo", referencia: "" });
  const [checkoutProvider] = useState('stripe');
  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  const [enviandoRuta, setEnviandoRuta] = useState(null); // OL-01A: id de la orden en envío a ruta

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

  // OL-02C: la venta directa (cobro + salida física + Entregada) va por UN
  // contrato del servidor (completar_venta_directa). El link de pago es otro
  // momento: genera el link y no mueve inventario; la entrega de un pedido ya
  // pagado por link se hace después con "Entregar pedido pagado".
  const venta = useVentaDirecta({ actions, cuartosFrios: data.cuartosFrios });
  const cobrar = (ord, { entregaPagada = false } = {}) => {
    const fresca = (data.ordenes || []).find(x => String(x.id) === String(ord?.id)) || ord;
    setPagoModal({ ...fresca, entregaPagada });
    setPagoForm({ metodo: "Efectivo", referencia: "" }); setCheckoutUrl(null); setShortUrl(null);
    venta.iniciar(fresca);
  };
  const cerrarCobro = () => { setPagoModal(null); setCheckoutUrl(null); setShortUrl(null); venta.terminar(); };
  const modoCobro = pagoModal?.entregaPagada ? 'pagado_link' : modoVentaDirecta(pagoForm.metodo);
  const sinClienteCredito = modoCobro === 'credito' && !(pagoModal?.clienteId || pagoModal?.cliente_id);

  const confirmarCobro = async () => {
    if (!pagoModal) return;
    if (!pagoModal.entregaPagada && pagoForm.metodo === "QR / Link de pago") {
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
    if (!modoCobro || venta.enviando) return;
    if (sinClienteCredito) { showToast('La venta a crédito requiere cliente', 'error'); return; }
    if (!venta.validacion.ok) { showToast('Indica de qué cuarto sale cada producto', 'error'); return; }
    const metodo = modoCobro === 'pagado_link' ? METODO_LINK : pagoForm.metodo;
    try {
      // Éxito y cierre SOLO con el resultado del servidor; si falla, el store
      // ya mostró el error y el diálogo queda abierto (mismo intento = mismo UUID).
      const r = await venta.completar({ modo: modoCobro, metodo, referencia: metodo === "Transferencia SPEI" ? pagoForm.referencia : null });
      if (!r || r.error) return;
      showToast(modoCobro === 'pagado_link' ? `Pedido ${s(pagoModal.folio)} entregado` : modoCobro === 'credito' ? "Venta a crédito registrada y entregada" : "Cobrado y entregado — " + metodo);
      cerrarCobro();
    } catch (e) {
      console.error('Error completando la venta directa:', e);
      showToast('Error al cobrar. Verifica tu conexión.', 'error');
    }
  };

  const hoy = diaNegocio();
  // El contexto de cada filtro sale del MISMO `ordenesUsuario` que pinta sus
  // listas (propias, o todas en la vista previa de Admin). Sin consultas nuevas.
  const pend = useMemo(() => resumenPendientes(ordenesUsuario, data.pagos), [ordenesUsuario, data.pagos]);
  const resumenHoy = useMemo(() => resumenVentasHoy(ordenesUsuario, hoy), [ordenesUsuario, hoy]);
  const historial = useMemo(() => resumenHistorial(ordenesUsuario), [ordenesUsuario]);
  const ordenesHoy = resumenHoy.ordenesHoy;
  const ventasHoy = resumenHoy.vendidoHoy;

  const abrirNuevaVenta = () => setModal(true);
  const lista = filtro === "hoy" ? ordenesHoy : ordenesUsuario;
  // B3.6: acción principal del espacio de trabajo — tamaño normal en escritorio
  // (a la derecha de la barra), ancho completo en móvil para alcanzarla con el pulgar.
  const nuevaVentaBtn = (
    <FormBtn success className="w-full sm:w-auto sm:px-6" onClick={abrirNuevaVenta}>
      <Icons.Plus /> Nueva venta
    </FormBtn>
  );
  const REJILLA_LISTA = embedded ? "grid grid-cols-1 gap-2 xl:grid-cols-2" : "space-y-2";

  // OL-01A: "Enviar a ruta" solo avisa éxito si el store lo confirma.
  const enviarARuta = async (o) => {
    if (enviandoRuta) return;
    setEnviandoRuta(o.id);
    try {
      await ejecutarMutacion(() => actions.updateOrdenEstatus(o.id, "Asignada"), { onExito: () => showToast("Asignada a ruta") });
    } catch (e) {
      console.error('Error enviando a ruta:', e);
      showToast('Error al enviar a ruta. Verifica tu conexión.', 'error');
    } finally {
      setEnviandoRuta(null);
    }
  };

  // Tarjeta de orden: mismo contenido; acciones según accionesCobroVentas
  // (OL-01A): Creada → Cobrar / Enviar a ruta; Asignada sin ruta → Cobrar
  // entrega; Asignada con ruta → sin cobro del vendedor (la cobra el chofer).
  const tarjetaOrden = (o) => { const acc = accionesCobroVentas(o); const pagado = linkPagadoCompleto(o, data.pagos); return (
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
      {acc.cobrar && acc.enviarARuta && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {pagado
            ? <FormBtn success onClick={() => cobrar(o, { entregaPagada: true })}>Entregar pedido pagado</FormBtn>
            : <FormBtn success onClick={() => cobrar(o)}>Cobrar</FormBtn>}
          <FormBtn onClick={() => enviarARuta(o)} disabled={enviandoRuta === o.id}
            className="border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100"><Icons.Truck /> Enviar a ruta</FormBtn>
        </div>
      )}
      {acc.cobrarEntrega && (pagado
        ? <FormBtn onClick={() => cobrar(o, { entregaPagada: true })} className="mt-3 w-full border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100">Entregar pedido pagado</FormBtn>
        : <FormBtn onClick={() => cobrar(o)} className="mt-3 w-full border-emerald-200 bg-emerald-50 text-emerald-800 hover:bg-emerald-100">Cobrar entrega</FormBtn>
      )}
      {acc.enRutaDelChofer && (
        <p className="mt-3 flex items-center gap-1.5 rounded-[12px] border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600" data-testid="orden-en-ruta-chofer">
          <Icons.Truck /> {s(o.ruta) && s(o.ruta) !== "—" ? `En ${s(o.ruta)}` : "En ruta"} · la cobra el chofer
        </p>
      )}
    </Card>
  ); };

  // B3.6: un resumen compacto del filtro activo (una línea de datos, no un
  // tablero por filtro); sin cifras en $0 de relleno.
  const dato = (valor, etiqueta, testid) => (
    <span className="inline-flex items-baseline gap-1.5" data-testid={testid}>
      <span className="font-display text-base font-bold tracking-[-0.03em] text-slate-900">{valor}</span>
      <span className="text-xs font-medium text-slate-500">{etiqueta}</span>
    </span>
  );
  const grupoTxt = (g, uno, varios) => `${g.count === 1 ? uno : varios}${g.count > 0 ? ` · ${fmtMoney(g.monto)}` : ""}`;
  const resumenFiltro =
    filtro === "pendientes" ? (pend.vacio && pend.conChofer.count === 0 ? null : (
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1" data-testid="resumen-pendientes">
        {dato(pend.porCobrar.count, grupoTxt(pend.porCobrar, "por cobrar", "por cobrar"), "pend-por-cobrar")}
        {pend.pagadasPorEntregar.count > 0 && dato(pend.pagadasPorEntregar.count, grupoTxt(pend.pagadasPorEntregar, "pagada por entregar", "pagadas por entregar"), "pend-pagadas")}
        {pend.conChofer.count > 0 && dato(pend.conChofer.count, "en ruta con el chofer", "pend-chofer")}
      </div>
    )) :
    filtro === "hoy" ? (resumenHoy.count === 0 ? null : (
      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1" data-testid="resumen-hoy">
        {dato(fmtMoney(resumenHoy.vendidoHoy), "vendido hoy (entregadas)", "hoy-vendido")}
        {dato(resumenHoy.count, `${resumenHoy.count === 1 ? "orden" : "órdenes"} · ${textoDesglose(resumenHoy.porEstatus)}`, "hoy-ordenes")}
        {dato(resumenHoy.ultima.folio, `última · ${fmtMoney(resumenHoy.ultima.total)}${resumenHoy.ultima.cliente ? ` · ${resumenHoy.ultima.cliente}` : ""}`, "hoy-ultima")}
      </div>
    )) :
    (historial.count === 0 ? null : (
      <p className="text-sm text-slate-500" data-testid="resumen-todas">
        <span className="font-semibold text-slate-700">{historial.count} {historial.count === 1 ? "orden" : "órdenes"}</span>
        {historial.desde && <> · desde {fmtDate(historial.desde)}</>}
      </p>
    ));

  return (
    <div className={embedded ? "text-slate-900" : "min-h-dvh w-full text-slate-900"} data-testid="ventas-shell">
      {/* B2: el shell pone el título de página. B3.4: dentro del shell cada módulo
          abre con su propio contexto (abajo); la cabecera suelta no cambia. */}
      {!embedded && (
        <RoleHeader kicker="Ventas" title="Ventas del día" subtitle={s(user?.nombre)} accent="emerald" onLogout={onLogout}>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <HeaderStat label="Vendido hoy" value={fmtMoney(ventasHoy)} />
            <HeaderStat label="Pendientes" value={<>{pend.count} <span className="text-sm font-medium text-slate-300">por cobrar o entregar</span></>} />
          </div>
        </RoleHeader>
      )}

      <div className={embedded ? CONTENIDO_SHELL : `${CONTENIDO} px-4 pt-4`}>
        {/* B3.6: un espacio de trabajo — barra (filtros internos + Nueva venta),
            resumen del filtro activo y su lista. Mismo modelo en escritorio y móvil. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between" data-testid="ventas-barra">
          <SegmentedTabs items={FILTROS} value={filtro} onChange={setFiltro} accent="emerald" className="w-full sm:w-auto sm:min-w-[360px]" />
          {nuevaVentaBtn}
        </div>
        {resumenFiltro}

        {filtro === "pendientes" && !pend.vacio && (<>
          {pend.porCobrar.count > 0 && (
            <div className="space-y-2" data-testid="grupo-por-cobrar">
              <SectionLabel>Por cobrar ({pend.porCobrar.count})</SectionLabel>
              <div className={REJILLA_LISTA}>{pend.porCobrar.ordenes.map(tarjetaOrden)}</div>
            </div>
          )}
          {pend.pagadasPorEntregar.count > 0 && (
            <div className="space-y-2" data-testid="grupo-pagadas-por-entregar">
              <SectionLabel>Pagadas por entregar ({pend.pagadasPorEntregar.count})</SectionLabel>
              <div className={REJILLA_LISTA}>{pend.pagadasPorEntregar.ordenes.map(tarjetaOrden)}</div>
            </div>
          )}
        </>)}

        <div className={REJILLA_LISTA}>
          {filtro !== "pendientes" && lista.map(tarjetaOrden)}
          {(filtro === "pendientes" ? pend.vacio : lista.length === 0) && (
            <Card className="xl:col-span-2">
              {filtro === "pendientes" && (
                <EmptyState
                  icon="ClipboardCheck"
                  message="Sin pendientes"
                  hint={pend.conChofer.count > 0 ? "Tus órdenes en ruta las entrega y cobra el chofer; las ves en Todas" : "Las ventas por cobrar o por entregar aparecerán aquí"}
                />
              )}
              {filtro === "hoy" && (
                <EmptyState
                  icon="ShoppingCart"
                  message="Aún no hay ventas hoy"
                  hint="Usa Nueva venta para registrar la primera del día"
                />
              )}
              {filtro === "todas" && (
                <EmptyState
                  icon="ShoppingCart"
                  message="No has hecho ventas todavía"
                  hint="Usa Nueva venta para crear tu primera venta"
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
      <Modal open={!!pagoModal} onClose={cerrarCobro} kicker={pagoModal?.entregaPagada ? "Entrega" : "Cobranza"} safeBottom closeOnEscape={!generandoLink && !venta.enviando}
        title={pagoModal ? `${pagoModal.entregaPagada ? 'Entregar' : 'Cobrar'} ${s(pagoModal.folio)}` : ""}>
        {pagoModal && (<>
          <p className="mb-4 text-sm text-slate-500">{s(pagoModal.cliente)} — <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span>
            {pagoModal.requiereFactura && <span className="ml-2 rounded-full border border-violet-200/80 bg-violet-100/80 px-2 py-0.5 text-[10px] font-bold text-violet-900">FACTURA</span>}
          </p>
          {pagoModal.entregaPagada && (
            <p className="mb-4 rounded-[12px] border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Pagado con link. Confirma de qué cuarto sale el pedido.</p>
          )}
          {!pagoModal.entregaPagada && (<>
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
          </>)}

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
              <p className="text-[11px] text-slate-500">El pedido se entrega cuando el pago se confirme.</p>
              <button type="button" onClick={cerrarCobro} className="w-full py-2 text-xs font-semibold text-slate-500">Cerrar</button>
            </Card>
          )}
          {!pagoModal.entregaPagada && pagoForm.metodo === "Crédito (fiado)" && (
            <Card tone="warning" padding="p-3" className="mb-4"><p className="text-xs font-semibold text-amber-800">{sinClienteCredito ? "La venta a crédito requiere cliente" : "Se agregará al saldo del cliente (vence en 30 días)"}</p></Card>
          )}
          {modoCobro && (
            <div className="mb-4"><VentaDirectaOrigen venta={venta} disabled={venta.enviando} /></div>
          )}
          {!checkoutUrl && (
            <FormBtn success size="lg" className="w-full" onClick={confirmarCobro}
              disabled={generandoLink || venta.enviando || (!!modoCobro && (!venta.validacion.ok || sinClienteCredito))}>
              {generandoLink ? 'Generando link…' : venta.enviando ? 'Registrando…'
                : modoCobro === 'pagado_link' ? 'Entregar pedido' : modoCobro === 'credito' ? 'Registrar crédito y entregar'
                : modoCobro === 'contado' ? 'Cobrar y entregar' : 'Generar link de pago'}
            </FormBtn>
          )}
        </>)}
      </Modal>
    </div>
  );
}
