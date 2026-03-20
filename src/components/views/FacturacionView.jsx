import { useMemo, useCallback, DataTable, PageHeader, s, n, fmtDate, useToast } from './viewsCommon';

export function FacturacionView({ data, actions }) {
  const toast = useToast();

  // FIX P5a: Two separate .filter() on ordenes ran every render = 2×1000 iterations
  // Now single pass, memoized
  const { timbradas, totalFact } = useMemo(() => {
    let count = 0, sum = 0;
    for (const o of data.ordenes) {
      if (o.estatus === "Facturada") { count++; sum += n(o.total); }
    }
    return { timbradas: count, totalFact: sum };
  }, [data.ordenes]);

  // FIX P5b: handleTimbrar recreated every render, passed to every row button
  const handleTimbrar = useCallback(async (folio) => {
    const err = await actions.timbrar(folio);
    if (!err) toast?.success(`CFDI timbrado: ${folio}`);
  }, [actions, toast]);

  // Órdenes ya timbradas
  const ordenesTimbradas = useMemo(() => (data.ordenes || []).filter(o => o.facturama_id), [data.ordenes]);

  // Para cada orden timbrada: saber si tiene complemento generado
  const complementosPorOrden = useMemo(() => {
    const map = {};
    for (const a of (data.invoiceAttempts || [])) {
      const payload = a.requestPayload || {};
      if (payload.CfdiType === 'P' && a.ordenId && a.status === 'success') {
        map[a.ordenId] = true;
      }
    }
    return map;
  }, [data.invoiceAttempts]);

  return (<div>
    <PageHeader title="Facturación CFDI" subtitle="Timbrado manual" />
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Por facturar</p><p className="text-xl sm:text-3xl font-extrabold text-amber-600 mt-1 sm:mt-2">{(data.facturacionPendiente || []).length}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturadas</p><p className="text-xl sm:text-3xl font-extrabold text-emerald-600 mt-1 sm:mt-2">{timbradas}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturado</p><p className="text-xl sm:text-3xl font-extrabold text-slate-800 mt-1 sm:mt-2">${totalFact.toLocaleString("es-MX",{minimumFractionDigits:0})}</p></div>
    </div>

    {/* Pendientes de timbrar */}
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5 mb-4">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Pendientes de factura</h3>
      {(data.facturacionPendiente || []).length===0?<p className="text-sm text-slate-400 text-center py-6">Todo facturado ✓</p>:
      <DataTable columns={[
        {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span>},
        {key:"cliente",label:"Cliente",bold:true},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"fecha",label:"Entrega",render:v=>fmtDate(v)},{key:"total",label:"Total",bold:true,render:v=>`$${n(v).toLocaleString()}`},
        {key:"folio",label:"Acción",hideOnMobile:true,render:(v)=><button onClick={(e)=>{e.stopPropagation();handleTimbrar(v)}} className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 min-h-[44px]">Timbrar CFDI</button>},
      ]} data={data.facturacionPendiente}
      cardSubtitle={r => <button onClick={(e)=>{e.stopPropagation();handleTimbrar(r.folio)}} className="mt-2 w-full text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg hover:bg-blue-100 min-h-[44px]">Timbrar CFDI</button>}
      />}
    </div>

    {/* Facturas timbradas con estado de complemento */}
    {ordenesTimbradas.length > 0 && (
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <h3 className="text-sm font-bold text-slate-700 mb-4">Facturas timbradas</h3>
        <div className="space-y-2">
          {ordenesTimbradas.map(o => {
            const esPPD = s(o.metodo_pago).toLowerCase().includes('crédito');
            const tieneComplemento = complementosPorOrden[o.id];
            const complementoPendiente = esPPD && !tieneComplemento;
            return (
              <div key={o.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 gap-2 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs font-bold text-slate-700">{s(o.folio)}</span>
                  <span className="text-xs text-slate-500 truncate">{s(o.cliente || o.cliente_nombre)}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {s(o.facturama_folio) && (
                    <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      CFDI {s(o.facturama_folio)}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${esPPD ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {esPPD ? 'PPD' : 'PUE'}
                  </span>
                  {esPPD && (
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${tieneComplemento ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                      {tieneComplemento ? '✓ Complemento' : '⚠ Sin complemento'}
                    </span>
                  )}
                  {!esPPD && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ Pagado</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}
  </div>);
}
