import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormBtn, useConfirm, s, fmtDate, fmtMoney, useDebounce, useToast, reporteVentas, extraerTelefono, PAGE_SIZE, Paginator, normalizeStr } from './viewsCommon';
import NuevaVentaModal from '../NuevaVentaModal';
import EditarVentaModal from '../EditarVentaModal';
import DevolucionModal from '../DevolucionModal';
import VentaDirectaOrigen, { useVentaDirecta } from '../VentaDirectaOrigen';
import { esElegibleVentaDirecta, modoVentaDirecta, linkPagadoCompleto, METODO_LINK } from '../../data/ventaDirectaLogic';

export function OrdenesView({ data, actions, user }) {
  const toast = useToast();
  const [askConfirm, ConfirmEl] = useConfirm();
  const [modal, setModal] = useState(false);
  const [editarOrden, setEditarOrden] = useState(null);
  const [cancelarOrden, setCancelarOrden] = useState(null);
  const [motivoCancelar, setMotivoCancelar] = useState('');
  const [cancelando, setCancelando] = useState(false);
  const [devolverOrden, setDevolverOrden] = useState(null);
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("activas"); // activas | todas | <estatus>
  const [page, setPage] = useState(0);

  const ordenesEstado = useMemo(() => {
    const map = {};
    const pagosByOrden = {};
    (data?.pagos || []).forEach(p => {
      if (!p) return;
      const oid = String(p.ordenId || p.orden_id || '');
      if (oid) pagosByOrden[oid] = (pagosByOrden[oid] || 0) + 1;
    });
    const cxcByOrden = {};
    (data?.cuentasPorCobrar || []).forEach(c => {
      if (!c) return;
      const oid = String(c.ordenId || c.orden_id || '');
      if (oid) cxcByOrden[oid] = c;
    });
    (data?.ordenes || []).forEach(o => {
      if (!o) return;
      const id = String(o.id);
      const estatus = s(o.estatus);
      const tienePagos = !!pagosByOrden[id];
      const cxc = cxcByOrden[id] || null;
      const cxcConPagos = cxc && Number(cxc.montoPagado || cxc.monto_pagado || 0) > 0;
      const enRuta = !!(o.rutaId || o.ruta_id);
      map[id] = {
        estatus,
        puedeEditar: estatus === 'Creada',
        puedeCancelar: !['Cancelada', 'Entregada', 'Facturada'].includes(estatus) && !cxcConPagos && !(tienePagos && !cxc),
        puedeEliminar: estatus === 'Creada' && !tienePagos && !cxc && !enRuta,
        razonNoCancela: cxcConPagos
          ? 'Tiene pagos parciales. Anula los pagos primero.'
          : (tienePagos && !cxc ? 'Venta de contado pagada. Registra una devolución.' : null),
        razonNoElimina: tienePagos
          ? 'Tiene pagos asociados'
          : cxc ? 'Tiene cuenta por cobrar' : enRuta ? 'Está en una ruta asignada' : (estatus !== 'Creada' ? `Estatus ${estatus}` : null),
      };
    });
    return map;
  }, [data?.ordenes, data?.pagos, data?.cuentasPorCobrar]);

  const dSearch = useDebounce(search);

  const [pagoModal, setPagoModal] = useState(null);
  const [pagoForm, setPagoForm] = useState({metodo:"Efectivo",referencia:""});
  const [checkoutProvider] = useState('stripe');

  const [checkoutUrl, setCheckoutUrl] = useState(null);
  const [shortUrl, setShortUrl] = useState(null);
  const [generandoLink, setGenerandoLink] = useState(false);
  // OL-02C: una orden SIN ruta (Creada o Asignada) se cobra y entrega con el
  // mismo contrato atómico que Ventas (completar_venta_directa, origen físico
  // explícito). Las órdenes con ruta conservan su flujo de ruta.
  const venta = useVentaDirecta({ actions, cuartosFrios: data.cuartosFrios });
  const cobrarOrden = (ord, tipo) => {
    setPagoModal({...ord, tipoCobro: tipo || "oficina", entregaPagada: tipo === "pagado"}); setPagoForm({metodo:"Efectivo",referencia:""}); setCheckoutUrl(null); setShortUrl(null);
    if (esElegibleVentaDirecta(ord)) venta.iniciar(ord); else venta.terminar();
  };
  const cerrarCobro = () => { setCheckoutUrl(null); setShortUrl(null); setPagoModal(null); venta.terminar(); };
  const directa = !!pagoModal && esElegibleVentaDirecta(pagoModal);
  const modoCobro = directa ? (pagoModal.entregaPagada ? 'pagado_link' : modoVentaDirecta(pagoForm.metodo)) : null;
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
          toast?.success('Link de pago generado');
        } else {
          toast?.error('Error al generar link de pago');
        }
      } catch (e) {
        toast?.error('Error: ' + (e.message || 'No se pudo generar el link'));
      } finally {
        setGenerandoLink(false);
      }
      return;
    }
    if (directa) {
      if (!modoCobro || venta.enviando) return;
      if (sinClienteCredito) { toast?.error('La venta a crédito requiere cliente'); return; }
      if (!venta.validacion.ok) { toast?.error('Indica de qué cuarto sale cada producto'); return; }
      const metodo = modoCobro === 'pagado_link' ? METODO_LINK : pagoForm.metodo;
      const r = await venta.completar({ modo: modoCobro, metodo, referencia: metodo === "Transferencia SPEI" ? pagoForm.referencia : null });
      if (!r || r.error) return; // el store ya mostró el error; el diálogo sigue abierto
      toast?.success(modoCobro === 'pagado_link' ? "Pedido " + s(pagoModal.folio) + " entregado" : "Orden " + s(pagoModal.folio) + " cobrada y entregada - " + metodo);
      cerrarCobro();
      return;
    }
    // Orden con ruta: flujo de ruta existente (sin cambio en OL-02C).
    const err = await actions.updateOrdenEstatus(pagoModal.id, "Entregada", pagoForm.metodo);
    if (err) {
      toast?.error("No se pudo registrar el cobro");
      return;
    }
    toast?.success("Orden " + s(pagoModal.folio) + " cobrada - " + pagoForm.metodo);
    setPagoModal(null);
  };

  const filtered = useMemo(() => {
    const q = normalizeStr(dSearch);
    return (data.ordenes || []).filter(o => {
      if (!o) return false;
      const ms = !q || normalizeStr(o.folio).includes(q) || normalizeStr(o.cliente).includes(q);
      let me = true;
      if (filterEst === 'activas') me = s(o.estatus) !== 'Cancelada' && s(o.estatus) !== 'No entregada';
      else if (filterEst === 'todas') me = true;
      else if (filterEst === 'reagendar') me = s(o.estatus) === 'No entregada' && (o.reagendada || o.reagendar);
      else if (filterEst) me = o.estatus === filterEst;
      return ms && me;
    });
  }, [data.ordenes, dSearch, filterEst]);

  const paginated = useMemo(() => filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE), [filtered, page]);

  const exportBtns = <>
    <button onClick={() => reporteVentas(data.ordenes, 'excel')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[14px] border border-emerald-200 bg-white px-3.5 py-2 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-50"><Icons.Sheet /> Excel</button>
    <button onClick={() => reporteVentas(data.ordenes, 'pdf')} className="inline-flex min-h-[44px] items-center gap-1.5 rounded-[14px] border border-red-200 bg-white px-3.5 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"><Icons.FilePdf /> PDF</button>
  </>;

  const openModal = () => setModal(true);

  return (<div>
    <PageHeader title="Ventas" subtitle="Crear venta, cobrar y asignar entregas" action={openModal} actionLabel="Nueva orden" extraButtons={exportBtns} />
    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 mb-4">
      <div className="flex-1 relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"><Icons.Search /></span><input value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}} placeholder="Buscar folio o cliente..." className="w-full pl-10 pr-4 py-3 md:py-2.5 border border-slate-200 rounded-xl text-sm bg-white focus:outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-50 min-h-[44px]" /></div>
      <select value={filterEst} onChange={e=>{setFilterEst(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]">
        <option value="activas">Activas</option>
        <option value="todas">Todas (incl. canceladas)</option>
        <option value="reagendar">Pendientes de reagendar</option>
        {["Creada","Asignada","En ruta","Entregada","Facturada","Cancelada","No entregada"].map(st=><option key={st} value={st}>{st}</option>)}
      </select>
    </div>
    <div className="bg-white border border-slate-100 rounded-2xl p-4 sm:p-5">
      <DataTable columns={[
        {key:"folio",label:"Folio",render:(_,row)=><div><span className="font-mono text-xs font-bold text-blue-600">{s(row.folio)}</span>{row.folio_nota&&<span className="block text-[10px] text-slate-400">Nota: {s(row.folio_nota)}</span>}</div>},
        {key:"cliente",label:"Cliente",bold:true},{key:"fecha",label:"Fecha",render:v=>fmtDate(v),hideOnMobile:true},
        {key:"productos",label:"Productos",hideOnMobile:true,render:v=>{
          const raw = s(v);
          if (!raw) return <span className="text-xs text-slate-400">—</span>;
          const partes = raw.split(',').map(part => {
            const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
            if (!mt) return part.trim();
            const qty = mt[1];
            const sku = mt[2];
            const prod = (data.productos || []).find(p => s(p.sku) === s(sku));
            return prod ? `${qty}× ${s(prod.nombre)}` : `${qty}× ${sku}`;
          });
          return <span className="text-xs text-slate-600">{partes.join(', ')}</span>;
        }},
        {key:"total",label:"Total",bold:true,render:v=>fmtMoney(v)},
        {key:"estatus",label:"Estatus",badge:true,render:(v,r)=>{
          const motivoNoEntrega = s(r.motivoNoEntrega || r.motivo_no_entrega);
          const reagendada = !!(r.reagendada || r.reagendar);
          return (
            <div className="flex items-center gap-2 flex-wrap">
              <StatusBadge status={v}/>
              {v === "No entregada" && reagendada && (
                <span className="text-[10px] font-bold uppercase tracking-wide text-amber-800 bg-amber-100 border border-amber-200 px-2 py-0.5 rounded-full">Reagendar</span>
              )}
              {v === "No entregada" && motivoNoEntrega && (
                <span className="text-[10px] text-slate-500 italic truncate max-w-[160px]" title={motivoNoEntrega}>{motivoNoEntrega}</span>
              )}
              <span className="hidden md:inline">{v==="Creada"&&<>{linkPagadoCompleto(r, data.pagos)?<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"pagado")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Entregar pagado</button>:<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar</button>}<button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">Asignar ruta</button></>}{v==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,linkPagadoCompleto(r, data.pagos)?"pagado":"entrega")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">{linkPagadoCompleto(r, data.pagos)?"Entregar pagado":"Cobrar entrega"}</button>}{v==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">→ Facturar</button>}</span>
            </div>
          );
        }},
        {key:"ruta",label:"Ruta",hideOnMobile:true},
        {key:"acciones",label:"",render:(_,row)=>{
          const est = ordenesEstado[String(row.id)] || {};
          return <div className="flex gap-1 justify-end" onClick={(e)=>e.stopPropagation()}>
            {est.puedeEditar ? (
              <button
                onClick={()=>setEditarOrden(row)}
                aria-label="Editar orden"
                title="Editar"
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
              >
                <Icons.Edit />
              </button>
            ) : (
              <button
                disabled
                aria-label="No editable"
                title={`Solo se puede editar en estatus Creada (actual: ${s(row.estatus)})`}
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <Icons.Edit />
              </button>
            )}
            {est.puedeCancelar ? (
              <button
                onClick={()=>{ setCancelarOrden(row); setMotivoCancelar(''); }}
                aria-label="Cancelar orden"
                title="Cancelar"
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <span className="text-base leading-none">⊘</span>
              </button>
            ) : (
              <button
                disabled
                aria-label="No se puede cancelar"
                title={est.razonNoCancela || `No se puede cancelar (estatus ${s(row.estatus)})`}
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <span className="text-base leading-none opacity-50">⊘</span>
              </button>
            )}
            {(s(row.estatus) === 'Entregada' || s(row.estatus) === 'Facturada') && (
              row.tieneDevolucion || row.tiene_devolucion ? (
                <button
                  disabled
                  aria-label="Devolución registrada"
                  title="Esta orden ya tiene una devolución registrada"
                  className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-violet-300 cursor-not-allowed"
                >
                  <Icons.Undo />
                </button>
              ) : (
                <button
                  onClick={() => setDevolverOrden(row)}
                  aria-label="Registrar devolución"
                  title="Registrar devolución"
                  className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-violet-600 hover:bg-violet-50 transition-colors"
                >
                  <Icons.Undo />
                </button>
              )
            )}
            {est.puedeEliminar ? (
              <button
                onClick={()=>askConfirm(
                  'Eliminar permanentemente',
                  `¿Eliminar la orden ${s(row.folio)} permanentemente? Esta acción no se puede deshacer.`,
                  async ()=>{
                    const result = await actions.deleteOrden(row.id);
                    if (result?.error) { toast?.error(result.error); return; }
                    toast?.success('Orden eliminada');
                  },
                  true
                )}
                aria-label="Eliminar permanentemente"
                title="Eliminar permanentemente"
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              >
                <Icons.Trash />
              </button>
            ) : (
              <button
                disabled
                aria-label="No se puede eliminar"
                title={est.razonNoElimina ? `No se puede eliminar — ${est.razonNoElimina}. Usa Cancelar.` : 'No se puede eliminar'}
                className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <span className="opacity-50"><Icons.Trash /></span>
              </button>
            )}
          </div>;
        }},
      ]} data={paginated}
      cardSubtitle={r => {
        const est = r.estatus;
        const prodsLegibles = (() => {
          const raw = s(r.productos);
          if (!raw) return '';
          return raw.split(',').map(part => {
            const mt = part.trim().match(/(\d+)\s*[×x]\s*(\S+)/);
            if (!mt) return part.trim();
            const prod = (data.productos || []).find(p => s(p.sku) === s(mt[2]));
            return prod ? `${mt[1]}× ${s(prod.nombre)}` : `${mt[1]}× ${mt[2]}`;
          }).join(', ');
        })();
        return <div>
          <span className="text-xs text-slate-400">{fmtDate(r.fecha)} · {prodsLegibles}</span>
          {est==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,linkPagadoCompleto(r, data.pagos)?"pagado":undefined)}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">{linkPagadoCompleto(r, data.pagos)?"Entregar pagado":"Cobrar"}</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="mt-2 w-full text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2.5 rounded-lg min-h-[44px]">Asignar a ruta</button></>}
          {est==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,linkPagadoCompleto(r, data.pagos)?"pagado":"entrega")}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">{linkPagadoCompleto(r, data.pagos)?"Entregar pagado":"Cobrar entrega"}</button>}
          {est==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="mt-2 w-full text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2.5 rounded-lg min-h-[44px]">→ Facturar</button>}
        </div>;
      }}
        emptyMessage={(search?.trim() || filterEst) ? "Sin resultados" : "Aún no tienes ventas"}
        emptyHint={(search?.trim() || filterEst) ? "Intenta con otra búsqueda o limpia los filtros" : "Crea tu primera venta con el botón de arriba"}
        emptyCta={(search?.trim() || filterEst) ? "Limpiar filtros" : "+ Nueva orden"}
        onEmptyCta={(search?.trim() || filterEst) ? () => { setSearch(''); setFilterEst(''); setPage(0); } : openModal}
      />
      <Paginator page={page} total={filtered.length} onPage={setPage} />
    </div>

    {ConfirmEl}

    <EditarVentaModal
      open={!!editarOrden}
      onClose={()=>setEditarOrden(null)}
      orden={editarOrden}
      data={data}
      actions={actions}
      user={user}
      toast={toast}
      onSuccess={()=>{ toast?.success('Orden actualizada'); setEditarOrden(null); }}
    />

    <Modal open={!!cancelarOrden} onClose={()=>{ if (cancelando) return; setCancelarOrden(null); setMotivoCancelar(''); }} title="Cancelar orden">
      {cancelarOrden && (
        <div className="space-y-3">
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-sm text-amber-900">
            <p className="font-bold mb-1">¿Cancelar orden {s(cancelarOrden.folio)}?</p>
            <p className="text-xs">
              {s(cancelarOrden.estatus) === 'Asignada'
                ? 'El stock se regresará al cuarto frío de origen.'
                : 'No hay stock que regresar (la orden no fue asignada todavía).'}
            </p>
            <p className="text-xs mt-1">
              Cliente: <span className="font-semibold">{s(cancelarOrden.cliente)}</span> · Total: <span className="font-semibold">{fmtMoney(cancelarOrden.total)}</span>
            </p>
          </div>
          <FormInput
            label="Motivo de la cancelación *"
            value={motivoCancelar}
            onChange={(e)=>setMotivoCancelar(e.target.value)}
            placeholder="Ej: Cliente canceló pedido, error de captura, ..."
          />
          <div className="flex justify-end gap-2 mt-4">
            <FormBtn onClick={()=>{ if (cancelando) return; setCancelarOrden(null); setMotivoCancelar(''); }}>Volver</FormBtn>
            <button
              onClick={async ()=>{
                if (cancelando) return;
                const motivo = motivoCancelar.trim();
                if (!motivo) { toast?.error('Captura el motivo'); return; }
                setCancelando(true);
                try {
                  const result = await actions.cancelarOrden({ ordenId: cancelarOrden.id, motivo });
                  if (result?.error) { toast?.error(result.error); return; }
                  toast?.success('Orden cancelada');
                  setCancelarOrden(null);
                  setMotivoCancelar('');
                } finally {
                  setCancelando(false);
                }
              }}
              disabled={cancelando || !motivoCancelar.trim()}
              className="px-4 py-2.5 text-sm font-bold rounded-xl bg-red-600 text-white hover:bg-red-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {cancelando ? 'Cancelando…' : 'Cancelar orden'}
            </button>
          </div>
        </div>
      )}
    </Modal>

    <NuevaVentaModal
      open={modal}
      onClose={() => setModal(false)}
      onSuccess={() => {
        toast?.success('Orden creada');
        setModal(false);
      }}
      data={data}
      actions={actions}
      user={user}
      toast={toast}
      variant="admin"
    />

    <DevolucionModal
      open={!!devolverOrden}
      orden={devolverOrden}
      data={data}
      actions={actions}
      onClose={() => setDevolverOrden(null)}
      onSuccess={() => setDevolverOrden(null)}
    />

    {/* MODAL DE COBRO - VENTAS */}
    {pagoModal && (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>{ if (!venta.enviando) cerrarCobro(); }}>
        <div className="bg-white w-full max-w-md max-h-[90dvh] overflow-y-auto rounded-2xl p-5" onClick={e=>e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-1">{pagoModal.entregaPagada ? 'Entregar orden' : 'Cobrar orden'} {s(pagoModal.folio)}</h3>
          <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} &mdash; <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span></p>
          {pagoModal.entregaPagada && <p className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-800">Pagado con link. Confirma de qué cuarto sale el pedido.</p>}
          {!pagoModal.entregaPagada && <>
          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">M&eacute;todo de pago</label>
          <div className="grid grid-cols-2 gap-2 mb-4">
            {["Efectivo","Transferencia SPEI","Tarjeta (terminal)","QR / Link de pago","Crédito (fiado)"].map(m=>(
              <button key={m} onClick={()=>setPagoForm(f=>({...f,metodo:m}))}
                className={`py-3 px-3 rounded-xl text-xs font-semibold border-2 transition-all ${pagoForm.metodo===m ? "border-blue-500 bg-blue-50 text-blue-700" : "border-slate-200 text-slate-600"}`}>
                {m}
              </button>
            ))}
          </div>
          {pagoForm.metodo==="Transferencia SPEI" && (
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">Referencia SPEI</label>
              <input value={pagoForm.referencia} onChange={e=>setPagoForm(f=>({...f,referencia:e.target.value}))}
                className="w-full px-3 py-2.5 border border-slate-200 rounded-xl text-sm" placeholder="Últimos 6 dígitos"/>
            </div>
          )}
          </>}
          {sinClienteCredito && <p className="mb-4 text-xs font-semibold text-amber-700">La venta a crédito requiere cliente.</p>}
          {modoCobro && <div className="mb-2"><VentaDirectaOrigen venta={venta} disabled={venta.enviando} /></div>}

          {pagoForm.metodo==="QR / Link de pago" && checkoutUrl && (
            <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
              <p className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700"><Icons.CheckCircle /> Link de pago generado</p>
              <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); toast?.success('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5"><Icons.Copy /> Copiar link</button>
                {(() => {
                  const cliente = (data?.clientes || []).find(c => String(c.id) === String(pagoModal.clienteId || pagoModal.cliente_id));
                  const tel = extraerTelefono(cliente?.contacto || cliente?.telefono);
                  const empresaNombre = s(data?.configEmpresa?.razonSocial) || 'Cubo Polar';
                  const msg = `Hola, aquí está tu link de pago de ${empresaNombre} por ${fmtMoney(pagoModal.total)} MXN:\n${shortUrl || checkoutUrl}`;
                  const href = tel
                    ? `https://wa.me/52${tel}?text=${encodeURIComponent(msg)}`
                    : `https://wa.me/?text=${encodeURIComponent(msg)}`;
                  return <a href={href} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center inline-flex items-center justify-center gap-1.5"><Icons.Send /> Enviar por WhatsApp</a>;
                })()}
              </div>
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={cerrarCobro} disabled={venta.enviando} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600">{checkoutUrl ? 'Cerrar' : 'Cancelar'}</button>
            {!checkoutUrl && (() => {
              const bloqueado = generandoLink || venta.enviando || (!!modoCobro && (!venta.validacion.ok || sinClienteCredito));
              const etiqueta = generandoLink ? 'Generando link…' : venta.enviando ? 'Registrando…'
                : modoCobro === 'pagado_link' ? 'Entregar pedido' : modoCobro === 'credito' ? 'Registrar crédito y entregar'
                : modoCobro === 'contado' ? 'Cobrar y entregar' : pagoForm.metodo==="QR / Link de pago" ? 'Generar link de pago' : 'Confirmar cobro';
              return <button onClick={confirmarCobro} disabled={bloqueado} className={`flex-1 py-2.5 text-white rounded-xl text-sm font-bold ${bloqueado ? 'bg-slate-400' : 'bg-emerald-600'}`}>{etiqueta}</button>;
            })()}
          </div>
        </div>
      </div>
    )}
  </div>);
}
