import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, Modal, FormInput, FormBtn, useConfirm, s, fmtDate, fmtMoney, useDebounce, useToast, reporteVentas, extraerTelefono, PAGE_SIZE, Paginator } from './viewsCommon';
import NuevaVentaModal from '../NuevaVentaModal';
import EditarVentaModal from '../EditarVentaModal';
import DevolucionModal from '../DevolucionModal';

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
  const cobrarOrden = (ord, tipo) => { setPagoModal({...ord, tipoCobro: tipo || "oficina"}); setPagoForm({metodo:"Efectivo",referencia:""}); setCheckoutUrl(null); setShortUrl(null); };
  const confirmarCobro = async () => {
    if (!pagoModal) return;
    if (pagoForm.metodo === "QR / Link de pago") {
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
    const err = await actions.updateOrdenEstatus(pagoModal.id, "Entregada", pagoForm.metodo);
    if (err) {
      toast?.error("No se pudo registrar el cobro");
      return;
    }
    toast?.success("Orden " + s(pagoModal.folio) + " cobrada - " + pagoForm.metodo);
    setPagoModal(null);
  };

  const filtered = useMemo(() => {
    const q = dSearch?.toLowerCase() || "";
    return (data.ordenes || []).filter(o => {
      if (!o) return false;
      const ms = !q || s(o.folio).toLowerCase().includes(q) || s(o.cliente).toLowerCase().includes(q);
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
    <button onClick={() => reporteVentas(data.ordenes, 'excel')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors">📗 Excel</button>
    <button onClick={() => reporteVentas(data.ordenes, 'pdf')} className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 bg-red-50 hover:bg-red-100 rounded-lg transition-colors">📕 PDF</button>
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
              <span className="hidden md:inline">{v==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">Asignar ruta</button></>}{v==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"entrega")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar entrega</button>}{v==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">→ Facturar</button>}</span>
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
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100 transition-colors"
              >
                <Icons.Edit />
              </button>
            ) : (
              <button
                disabled
                aria-label="No editable"
                title={`Solo se puede editar en estatus Creada (actual: ${s(row.estatus)})`}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <Icons.Edit />
              </button>
            )}
            {est.puedeCancelar ? (
              <button
                onClick={()=>{ setCancelarOrden(row); setMotivoCancelar(''); }}
                aria-label="Cancelar orden"
                title="Cancelar"
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 transition-colors"
              >
                <span className="text-base leading-none">⊘</span>
              </button>
            ) : (
              <button
                disabled
                aria-label="No se puede cancelar"
                title={est.razonNoCancela || `No se puede cancelar (estatus ${s(row.estatus)})`}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
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
                  className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-violet-300 cursor-not-allowed"
                >
                  <span className="text-base leading-none">↩</span>
                </button>
              ) : (
                <button
                  onClick={() => setDevolverOrden(row)}
                  aria-label="Registrar devolución"
                  title="Registrar devolución"
                  className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-violet-600 hover:bg-violet-50 transition-colors"
                >
                  <span className="text-base leading-none">↩</span>
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
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-red-600 hover:bg-red-50 transition-colors"
              >
                <span className="text-base leading-none">🗑</span>
              </button>
            ) : (
              <button
                disabled
                aria-label="No se puede eliminar"
                title={est.razonNoElimina ? `No se puede eliminar — ${est.razonNoElimina}. Usa Cancelar.` : 'No se puede eliminar'}
                className="p-2 min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-300 cursor-not-allowed"
              >
                <span className="text-base leading-none opacity-50">🗑</span>
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
          {est==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="mt-2 w-full text-xs font-semibold text-slate-700 bg-slate-100 px-3 py-2.5 rounded-lg min-h-[44px]">Asignar a ruta</button></>}
          {est==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"entrega")}} className="mt-2 w-full text-xs font-semibold text-emerald-600 bg-emerald-50 px-3 py-2.5 rounded-lg min-h-[44px]">Cobrar entrega</button>}
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={()=>setPagoModal(null)}>
        <div className="bg-white w-full max-w-md rounded-2xl p-5" onClick={e=>e.stopPropagation()}>
          <h3 className="font-bold text-lg text-slate-800 mb-1">Cobrar orden {s(pagoModal.folio)}</h3>
          <p className="text-sm text-slate-500 mb-4">{s(pagoModal.cliente)} &mdash; <span className="font-bold text-slate-800">{fmtMoney(pagoModal.total)}</span></p>
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

          {pagoForm.metodo==="QR / Link de pago" && checkoutUrl && (
            <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl space-y-3">
              <p className="text-xs font-bold text-emerald-700">✓ Link de pago generado</p>
              <p className="text-xs text-slate-600 break-all bg-white p-2 rounded-lg border border-slate-200">{shortUrl || checkoutUrl}</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => { navigator.clipboard.writeText(shortUrl || checkoutUrl); toast?.success('Link copiado'); }} className="py-2.5 bg-slate-100 text-slate-700 rounded-lg text-xs font-bold">📋 Copiar link</button>
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
            </div>
          )}
          <div className="flex gap-2 mt-4">
            <button onClick={()=>{setCheckoutUrl(null);setShortUrl(null);setPagoModal(null)}} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm font-semibold text-slate-600">{checkoutUrl ? 'Cerrar' : 'Cancelar'}</button>
            {!checkoutUrl && <button onClick={confirmarCobro} disabled={generandoLink} className={`flex-1 py-2.5 text-white rounded-xl text-sm font-bold ${generandoLink ? 'bg-slate-400' : 'bg-emerald-600'}`}>{generandoLink ? 'Generando link…' : pagoForm.metodo==="QR / Link de pago" ? 'Generar link de pago' : 'Confirmar cobro'}</button>}
          </div>
        </div>
      </div>
    )}
  </div>);
}
