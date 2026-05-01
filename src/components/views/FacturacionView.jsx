import { useState, useMemo, useCallback, Modal, FormBtn, DataTable, PageHeader, s, n, fmtDate, fmtMoney, useToast } from './viewsCommon';

export function FacturacionView({ data, actions }) {
  const toast = useToast();
  const [previewOrden, setPreviewOrden] = useState(null);

  const { timbradas, totalFact } = useMemo(() => {
    let count = 0, sum = 0;
    for (const o of data.ordenes) {
      if (o.estatus === "Facturada") { count++; sum += n(o.total); }
    }
    return { timbradas: count, totalFact: sum };
  }, [data.ordenes]);

  const handleTimbrar = useCallback(async (folio) => {
    const err = await actions.timbrar(folio);
    if (!err) toast?.success(`CFDI timbrado: ${folio}`);
    setPreviewOrden(null);
  }, [actions, toast]);

const handleReintento = useCallback(async (ordenId) => {
      await actions.reintentarComplemento?.(ordenId);
    }, [actions]);

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

  // Clientes map for preview
  const clientesMap = useMemo(() => {
    const m = {};
    for (const c of (data.clientes || [])) m[c.id] = c;
    return m;
  }, [data.clientes]);

  // Build preview data from an order
  const openPreview = (row) => {
    const orden = data.ordenes.find(o => s(o.folio) === s(row.folio)) || row;
    const cli = clientesMap[orden.cliente_id] || {};
    setPreviewOrden({ ...orden, clienteObj: cli });
  };

  return (<div>
    <PageHeader title="Facturación CFDI" subtitle="Timbrado y complementos de pago" />
    <div className="grid grid-cols-3 gap-2 sm:gap-4 mb-4 sm:mb-6">
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Por facturar</p><p className="text-xl sm:text-3xl font-extrabold text-amber-600 mt-1 sm:mt-2">{(data.facturacionPendiente || []).length}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturadas</p><p className="text-xl sm:text-3xl font-extrabold text-emerald-600 mt-1 sm:mt-2">{timbradas}</p></div>
      <div className="bg-white border border-slate-100 rounded-2xl p-3 sm:p-5 text-center"><p className="text-[10px] sm:text-xs font-semibold text-slate-400 uppercase">Facturado</p><p className="text-xl sm:text-3xl font-extrabold text-slate-800 mt-1 sm:mt-2">{fmtMoney(totalFact)}</p></div>
    </div>

    {/* Pendientes de timbrar */}
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5 mb-4">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Pendientes de factura</h3>
      {(data.facturacionPendiente || []).length===0?<p className="text-sm text-slate-400 text-center py-6">Todo facturado ✓</p>:
      <DataTable columns={[
        {key:"folio",label:"Folio",render:v=><span className="font-mono text-xs font-bold text-blue-600">{s(v)}</span>},
        {key:"cliente",label:"Cliente",bold:true},
        {key:"rfc",label:"RFC",render:v=><span className="font-mono text-xs text-slate-500">{s(v)}</span>},
        {key:"fecha",label:"Entrega",render:v=>fmtDate(v)},{key:"total",label:"Total",bold:true,render:v=>fmtMoney(v)},
        {key:"folio",label:"Acción",hideOnMobile:true,render:(v,r)=><div className="flex gap-2">
          <button onClick={(e)=>{e.stopPropagation();openPreview(r)}} className="text-xs font-semibold text-slate-600 bg-slate-50 px-3 py-2 rounded-lg hover:bg-slate-100 min-h-[44px]">Vista previa</button>
          <button onClick={(e)=>{e.stopPropagation();handleTimbrar(v)}} className="text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2 rounded-lg hover:bg-blue-100 min-h-[44px]">Timbrar CFDI</button>
        </div>},
      ]} data={data.facturacionPendiente}
      cardSubtitle={r => <div className="flex gap-2 mt-2">
        <button onClick={(e)=>{e.stopPropagation();openPreview(r)}} className="flex-1 text-xs font-semibold text-slate-600 bg-slate-50 px-3 py-2.5 rounded-lg min-h-[44px]">Vista previa</button>
        <button onClick={(e)=>{e.stopPropagation();handleTimbrar(r.folio)}} className="flex-1 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-2.5 rounded-lg min-h-[44px]">Timbrar CFDI</button>
      </div>}
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
            return (
              <div key={o.id} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0 gap-2 flex-wrap">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="font-mono text-xs font-bold text-slate-700">{s(o.folio)}</span>
                  <span className="text-xs text-slate-500 truncate">{s(o.cliente || o.cliente_nombre)}</span>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
                  {s(o.facturama_folio) && (
                    <span className="text-[10px] font-mono bg-slate-100 text-slate-600 px-2 py-0.5 rounded">
                      CFDI {s(o.facturama_folio)}
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${esPPD ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {esPPD ? 'PPD' : 'PUE'}
                  </span>
                  {esPPD && (
                    tieneComplemento ?
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ Complemento</span> :
                        <button onClick={() => handleReintento(o.id)} className="text-[10px] font-bold px-2.5 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100 transition-colors">
                          ⚠ Reintentar complemento
                      </button>
                  )}
                  {!esPPD && <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">✓ Pagado</span>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    )}

    {/* ═══ MODAL: Vista previa de factura ═══ */}
    <Modal open={!!previewOrden} onClose={() => setPreviewOrden(null)} title="Vista previa de factura" wide>
      {previewOrden && (() => {
        const o = previewOrden;
        const cli = o.clienteObj || {};
        const lineas = o.preciosSnapshot || [];
        const subtotal = lineas.reduce((s, l) => s + n(l.subtotal || n(l.qty || l.cantidad) * n(l.precio_unit)), 0);
        const esPPD = s(o.metodo_pago).toLowerCase().includes('crédito');
        return <div className="space-y-4">
          {/* Emisor / Receptor */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-3">
              <p className="text-[10px] font-bold text-blue-400 uppercase mb-1">Emisor</p>
              <p className="text-sm font-bold text-slate-800">Cubo Polar S.A. de C.V.</p>
            </div>
            <div className="bg-slate-50 rounded-xl p-3">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-1">Receptor</p>
              <p className="text-sm font-bold text-slate-800">{s(cli.nombre) || s(o.cliente)}</p>
              <p className="font-mono text-xs text-slate-500 mt-0.5">{s(cli.rfc) || 'Sin RFC'}</p>
              {s(cli.regimen_fiscal) && <p className="text-xs text-slate-400 mt-0.5">{s(cli.regimen_fiscal)}</p>}
            </div>
          </div>

          {/* Detalles generales */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
            <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Folio</p><p className="text-sm font-bold">{s(o.folio)}</p></div>
            <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Fecha</p><p className="text-sm font-bold">{fmtDate(o.fecha)}</p></div>
            <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Método pago</p><p className="text-sm font-bold">{esPPD ? 'PPD' : 'PUE'}</p></div>
            <div className="bg-slate-50 rounded-lg p-2"><p className="text-[10px] text-slate-400 uppercase">Forma pago</p><p className="text-sm font-bold">{s(o.metodo_pago) || 'Efectivo'}</p></div>
          </div>

          {/* Conceptos */}
          <div>
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Conceptos</p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50"><tr>
                  <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">SKU</th>
                  <th className="text-left px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Producto</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Cant.</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">P. Unit</th>
                  <th className="text-right px-3 py-2 text-[10px] font-bold text-slate-400 uppercase">Subtotal</th>
                </tr></thead>
                <tbody>
                  {lineas.map((l, i) => <tr key={i} className="border-t border-slate-100">
                    <td className="px-3 py-2 font-mono text-xs text-slate-600">{s(l.sku)}</td>
                    <td className="px-3 py-2 text-slate-700">{s(l.nombre_producto || l.sku)}</td>
                    <td className="px-3 py-2 text-right font-semibold">{n(l.qty || l.cantidad)}</td>
                    <td className="px-3 py-2 text-right">{fmtMoney(l.precio_unit, { decimals: 2 })}</td>
                    <td className="px-3 py-2 text-right font-semibold">{fmtMoney(l.subtotal || n(l.qty || l.cantidad) * n(l.precio_unit))}</td>
                  </tr>)}
                  {lineas.length === 0 && <tr><td colSpan={5} className="px-3 py-4 text-center text-slate-400 text-xs">{s(o.productos)}</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totales */}
          <div className="bg-slate-50 rounded-xl p-3 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-slate-500">Subtotal</span><span className="font-semibold">{fmtMoney(subtotal)}</span></div>
            <div className="flex justify-between text-sm"><span className="text-slate-500">IVA (0% — hielo)</span><span className="font-semibold">$0</span></div>
            <div className="flex justify-between text-sm font-bold border-t border-slate-200 pt-1"><span>Total</span><span className="text-lg">{fmtMoney(o.total)}</span></div>
          </div>

          {/* ClaveProdServ / Régimen */}
          <div className="text-xs text-slate-400 space-y-0.5">
            <p>ClaveProdServ: 50202302 — Hielo</p>
            <p>Uso CFDI: G03 — Gastos en general</p>
            <p>IVA: Tasa 0% (Art. 2-A Fracción I LIVA)</p>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <FormBtn onClick={() => setPreviewOrden(null)}>Cerrar</FormBtn>
            <FormBtn primary onClick={() => handleTimbrar(o.folio)}>Timbrar CFDI</FormBtn>
          </div>
        </div>;
      })()}
    </Modal>
  </div>);
}
