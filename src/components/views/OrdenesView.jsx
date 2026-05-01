import { useState, useMemo, Icons, StatusBadge, DataTable, PageHeader, s, fmtDate, fmtMoney, useDebounce, useToast, reporteVentas, PAGE_SIZE, Paginator } from './viewsCommon';
import NuevaVentaModal from '../NuevaVentaModal';

export function OrdenesView({ data, actions, user }) {
  const toast = useToast();
  const [modal, setModal] = useState(false);
  const [search, setSearch] = useState("");
  const [filterEst, setFilterEst] = useState("");
  const [page, setPage] = useState(0);

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
    return data.ordenes.filter(o => {
      const ms = !q || s(o.folio).toLowerCase().includes(q) || s(o.cliente).toLowerCase().includes(q);
      const me = !filterEst || o.estatus === filterEst; return ms && me;
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
      <select value={filterEst} onChange={e=>{setFilterEst(e.target.value);setPage(0)}} className="border border-slate-200 rounded-xl px-3 py-3 md:py-2.5 text-sm text-slate-600 bg-white focus:outline-none focus:border-blue-400 min-h-[44px]"><option value="">Todos</option>{["Creada","Asignada","Entregada","Facturada"].map(st=><option key={st}>{st}</option>)}</select>
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
        {key:"estatus",label:"Estatus",badge:true,render:(v,r)=><div className="flex items-center gap-2 flex-wrap"><StatusBadge status={v}/><span className="hidden md:inline">{v==="Creada"&&<><button onClick={(e)=>{e.stopPropagation();cobrarOrden(r)}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar</button><button onClick={(e)=>{e.stopPropagation();actions.updateOrdenEstatus(r.id,"Asignada")}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">Asignar ruta</button></>}{v==="Asignada"&&<button onClick={(e)=>{e.stopPropagation();cobrarOrden(r,"entrega")}} className="text-xs text-emerald-600 font-semibold px-2 py-0.5">Cobrar entrega</button>}{v==="Entregada"&&<button onClick={(e)=>{e.stopPropagation();actions.timbrar(r.folio)}} className="text-xs text-slate-600 hover:text-slate-900 font-semibold px-2 py-0.5">→ Facturar</button>}</span></div>},
        {key:"ruta",label:"Ruta",hideOnMobile:true},
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
                <a href={`https://wa.me/?text=${encodeURIComponent(`Hola, aquí está tu link de pago de Cubo Polar por ${fmtMoney(pagoModal.total)} MXN:\n${shortUrl || checkoutUrl}`)}`} target="_blank" rel="noopener noreferrer" className="py-2.5 bg-green-500 text-white rounded-lg text-xs font-bold text-center">📲 Enviar por WhatsApp</a>
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
