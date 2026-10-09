import { useState, useMemo, useCallback, Modal, FormBtn, DataTable, PageHeader, EmptyState, s, n, fmtDate, fmtMoney, useToast, Icons, KpiTile } from './viewsCommon';
import CancelarCFDIModal from '../CancelarCFDIModal';
import { isSandboxMode } from '../../lib/facturamaMode';
import { estadoComplementosOrden, ESTADO_COMPLEMENTO } from '../../data/complementoLogic';

// OL-04: estado del complemento POR PAGO (parcialidad, monto, fecha) y acción sobre ESE pago.
const ETIQUETA_COMPLEMENTO = {
  [ESTADO_COMPLEMENTO.EMITIDO]: ['Complemento emitido', 'bg-emerald-50 text-emerald-700'],
  [ESTADO_COMPLEMENTO.EN_PROCESO]: ['En proceso', 'bg-blue-50 text-blue-700'],
  [ESTADO_COMPLEMENTO.REQUIERE_CONCILIACION]: ['Requiere conciliación', 'bg-red-50 text-red-700'],
  [ESTADO_COMPLEMENTO.ESPERA_ANTERIOR]: ['Espera parcialidad anterior', 'bg-slate-100 text-slate-600'],
  [ESTADO_COMPLEMENTO.BLOQUEADO]: ['Otra operación en curso', 'bg-slate-100 text-slate-600'],
  [ESTADO_COMPLEMENTO.NO_ELEGIBLE]: ['No elegible', 'bg-slate-100 text-slate-600'],
};
function PagosComplemento({ orden, pagos, operaciones, onEmitir, emitiendo }) {
  const st = estadoComplementosOrden(orden, pagos, operaciones);
  if (!st.aplica) return null;
  return (
    <div className="mt-1 w-full space-y-1 pl-2" data-testid="complementos-por-pago">
      {st.pagos.map(f => {
        const [txt, cls] = ETIQUETA_COMPLEMENTO[f.estado] || [];
        return (
          <div key={f.pago.id} className="flex flex-wrap items-center gap-2 text-[11px] text-slate-600">
            <span className="font-semibold">Parcialidad {f.parcialidad}</span>
            <span>{fmtMoney(f.pago.monto)} · {fmtDate(f.pago.fecha)}</span>
            {f.estado === ESTADO_COMPLEMENTO.EMITIBLE ? (
              <button onClick={() => onEmitir(f.pago.id)} disabled={emitiendo === f.pago.id}
                className="rounded bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-800 hover:bg-amber-100 disabled:opacity-60">
                {emitiendo === f.pago.id ? 'Emitiendo…' : 'Emitir complemento'}
              </button>
            ) : (
              <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${cls}`} title={f.motivo || f.cfdiUuid || ''}>{f.estado === ESTADO_COMPLEMENTO.EMITIDO && <Icons.Check />}{txt}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function FacturacionView({ data, actions }) {
  const toast = useToast();
  const [previewOrden, setPreviewOrden] = useState(null);
  const [cancelOrden, setCancelOrden] = useState(null);
  const [filtroEstado, setFiltroEstado] = useState('todas'); // 'todas' | 'vigentes' | 'canceladas'

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

  const [emitiendo, setEmitiendo] = useState(null);
  const handleEmitirComplemento = useCallback(async (pagoId) => {
    if (emitiendo) return;
    setEmitiendo(pagoId);
    try { await actions.emitirComplemento?.(pagoId); } finally { setEmitiendo(null); }
  }, [actions, emitiendo]);

  // Órdenes timbradas (incluye canceladas, que conservan facturama_id como histórico).
  const ordenesTimbradasAll = useMemo(() => (data.ordenes || []).filter(o => o.facturama_id), [data.ordenes]);
  const ordenesTimbradas = useMemo(() => {
    if (filtroEstado === 'vigentes') return ordenesTimbradasAll.filter(o => !o.cfdi_cancelado_at);
    if (filtroEstado === 'canceladas') return ordenesTimbradasAll.filter(o => !!o.cfdi_cancelado_at);
    return ordenesTimbradasAll;
  }, [ordenesTimbradasAll, filtroEstado]);


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
    {isSandboxMode() && (
      <div
        data-testid="facturacion-modo-prueba-aviso"
        className="mb-4 flex gap-2.5 rounded-[16px] border border-amber-200 bg-amber-50 px-3.5 py-3 text-xs sm:text-sm text-amber-900"
      >
        <span className="mt-0.5 flex-shrink-0"><Icons.Info /></span>
        <span><span className="font-bold">Facturación en modo prueba.</span> Las facturas que se timbren aquí no son válidas ante el SAT hasta activar la facturación real.</span>
      </div>
    )}
    <div className="grid grid-cols-2 gap-3 mb-4">
      <KpiTile label="Por facturar" value={(data.facturacionPendiente || []).length} tone="warning" />
      <KpiTile label="Facturadas" value={timbradas} tone="success" />
      <KpiTile label="Facturado" value={fmtMoney(totalFact)} className="col-span-2" />
    </div>

    {/* Pendientes de timbrar */}
    <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5 mb-4">
      <h3 className="text-sm font-bold text-slate-700 mb-4">Pendientes de factura</h3>
      {(data.facturacionPendiente || []).length===0?
        <EmptyState
          message="Aún no hay órdenes facturables"
          hint="Las órdenes con toggle 'Facturar' activado y entregadas aparecerán aquí para timbrar."
        />:
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
    {ordenesTimbradasAll.length > 0 && (
      <div className="bg-white border border-slate-100 rounded-2xl p-3.5 sm:p-5">
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          <h3 className="text-sm font-bold text-slate-700">Facturas timbradas</h3>
          <div className="flex gap-1 text-[11px]">
            {[
              { key: 'todas',      label: 'Todas' },
              { key: 'vigentes',   label: 'Vigentes' },
              { key: 'canceladas', label: 'Canceladas' },
            ].map(b => (
              <button
                key={b.key}
                onClick={() => setFiltroEstado(b.key)}
                className={`px-2.5 py-1 rounded font-semibold ${filtroEstado === b.key ? 'bg-blue-100 text-blue-700' : 'bg-slate-50 text-slate-500 hover:bg-slate-100'}`}
              >{b.label}</button>
            ))}
          </div>
        </div>
        {ordenesTimbradas.length === 0 ?
          <p className="text-xs text-slate-400 text-center py-4">No hay facturas en este filtro</p>
        :
        <div className="space-y-2">
          {ordenesTimbradas.map(o => {
            const esPPD = s(o.metodo_pago).toLowerCase().includes('crédito');
            const cancelado = !!o.cfdi_cancelado_at;
            return (
              <div key={o.id} className={`flex items-center justify-between py-2 border-b border-slate-50 last:border-0 gap-2 flex-wrap ${cancelado ? 'opacity-70' : ''}`}>
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
                  {cancelado ? (
                    <span
                      className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-red-50 text-red-700"
                      title={`Motivo ${s(o.cfdi_cancelado_motivo)} — ${fmtDate(o.cfdi_cancelado_at)}`}
                    >
                      <Icons.X /> Cancelada {s(o.cfdi_cancelado_motivo) ? `(${s(o.cfdi_cancelado_motivo)})` : ''}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                      <Icons.Check /> Vigente
                    </span>
                  )}
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${esPPD ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>
                    {esPPD ? 'PPD' : 'PUE'}
                  </span>
                  {!cancelado && !esPPD && <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700"><Icons.Check /> Pagado</span>}
                  {!cancelado && (
                    <button
                      onClick={() => setCancelOrden(o)}
                      className="text-[10px] font-bold px-2.5 py-1 rounded bg-slate-100 text-slate-600 hover:bg-red-50 hover:text-red-600 transition-colors"
                      title="Cancelar este CFDI ante SAT"
                    >
                      Cancelar CFDI
                    </button>
                  )}
                </div>
                <PagosComplemento orden={o} pagos={data.pagosCxc} operaciones={data.cfdiOperaciones} onEmitir={handleEmitirComplemento} emitiendo={emitiendo} />
              </div>
            );
          })}
        </div>
        }
      </div>
    )}

    <CancelarCFDIModal
      open={!!cancelOrden}
      orden={cancelOrden}
      actions={actions}
      onClose={() => setCancelOrden(null)}
      onSuccess={() => setCancelOrden(null)}
    />

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
              <p className="text-sm font-bold text-slate-800">{s(data?.configEmpresa?.razonSocial) || 'Cubo Polar S.A. de C.V.'}</p>
              {data?.configEmpresa?.rfc && <p className="font-mono text-xs text-slate-500 mt-0.5">{s(data.configEmpresa.rfc)}</p>}
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
            {/* Tanda 17 P1: overflow-x con overscroll-contain para que el
                scroll horizontal en mobile no rebote al body. */}
            <div className="border border-slate-200 rounded-xl overflow-x-auto overscroll-contain">
              <table className="w-full text-sm min-w-[480px]">
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
