// RecuperacionRutaModal — T5-A (mig 138), solo Admin.
// Muestra por qué una ruta no cuadra (por producto: cargado, entregado, merma, exceso) y
// permite corregirla sin SQL: revertir una entrega marcada por error (motivo obligatorio,
// queda evidencia) y marcar "No entregada" lo que sigue pendiente. No inventa carga, no
// mueve inventario y no borra cobros: todo lo decide el servidor (`diagnostico_ruta`,
// `revertir_entrega_ruta`, `registrar_no_entrega`).
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, FormBtn, s, fmtMoney } from './views/viewsCommon';
import { FormTextarea } from './ui/Modal';
import { resumenDiagnostico } from '../data/recuperacionRutaLogic';
import { nuevoOperacionId } from '../data/stockContratosLogic';

const lineasTxt = (lineas) => (lineas || []).map(l => `${l.cantidad}× ${l.sku}`).join(', ');

export default function RecuperacionRutaModal({ ruta, actions, productos, onClose }) {
  const [diag, setDiag] = useState(null);
  const [error, setError] = useState(null);
  const [form, setForm] = useState(null);      // { tipo: 'revertir'|'no_entrega', orden, motivo, conservarCobro, operacionId, pideCobro }
  const [enviando, setEnviando] = useState(false);
  const [errForm, setErrForm] = useState(null);

  const nombreDe = useCallback((sku) => s((productos || []).find(p => s(p.sku) === s(sku))?.nombre) || sku, [productos]);

  const cargar = useCallback(async () => {
    if (!ruta?.id) return;
    const r = await actions.diagnosticoRuta?.(ruta.id);
    if (!r || r.error) { setError(r?.error || 'No se pudo revisar la ruta'); return; }
    setError(null);
    setDiag(r.data);
  }, [actions, ruta?.id]);
  useEffect(() => { setDiag(null); setForm(null); setError(null); cargar(); }, [cargar]);

  const res = useMemo(() => resumenDiagnostico(diag), [diag]);

  const abrir = (tipo, orden) => { setErrForm(null); setForm({ tipo, orden, motivo: '', conservarCobro: false, operacionId: nuevoOperacionId(), pideCobro: tipo === 'revertir' && Number(orden.cobrado) > 0 }); };

  const confirmar = async () => {
    if (enviando || !form) return;
    if (String(form.motivo || '').trim().length < 5) { setErrForm('Escribe el motivo (mínimo 5 letras).'); return; }
    if (form.pideCobro && !form.conservarCobro) { setErrForm('Marca la casilla para confirmar que el cobro se conserva.'); return; }
    setEnviando(true);
    try {
      const r = form.tipo === 'revertir'
        ? await actions.revertirEntregaRuta?.({ operacionId: form.operacionId, ordenId: form.orden.id, motivo: form.motivo, conservarCobro: form.conservarCobro })
        : await actions.marcarNoEntregada?.(form.orden.id, form.motivo, false, { operacionId: form.operacionId });
      if (r?.error) {
        // El servidor avisa que la orden tiene dinero cobrado: se pide reconocerlo, no se asume.
        if (r.codigo === 'COBRO_REGISTRADO') setForm(f => ({ ...f, pideCobro: true }));
        setErrForm(r.error);
        return;
      }
      setForm(null);
      await cargar();
    } finally { setEnviando(false); }
  };

  if (!ruta) return null;
  return (
    <Modal open onClose={onClose} title={`Inventario de la ruta ${s(ruta.folio) || s(ruta.nombre)}`} kicker="Revisar y corregir" wide>
      <div className="space-y-4 text-sm" data-testid="recuperacion-ruta">
        {error && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800">{error}</p>}
        {!diag && !error && <p className="text-slate-500">Revisando la ruta…</p>}
        {diag && (<>
          {!res.cargaConfirmada ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-slate-600">Esta ruta todavía no tiene carga confirmada: no hay inventario de camión que revisar.</p>
          ) : res.consistente ? (
            <p className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-semibold text-emerald-800">El inventario de la ruta cuadra: lo entregado y la merma no superan lo cargado.</p>
          ) : (
            <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-red-800" role="alert">
              <p className="font-bold">La ruta no se puede cerrar: se registró más de lo que se cargó.</p>
              <p className="mt-1 text-xs">{res.excesos.map(x => `${nombreDe(x.sku)}: cargado ${x.cargado}, entregado ${x.entregado}${x.merma ? `, merma ${x.merma}` : ''} (sobran ${x.exceso})`).join(' · ')}</p>
              <p className="mt-1 text-xs">Revierte abajo la entrega que no ocurrió. Si el producto sí se entregó, márcala no entregada aquí y captúrala como venta de mostrador (sale del cuarto frío).</p>
            </div>
          )}

          {res.inventario.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-slate-200">
              <table className="w-full min-w-[420px] text-xs">
                <thead className="bg-slate-50 text-left uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Producto</th><th className="px-3 py-2 text-right">Cargado</th><th className="px-3 py-2 text-right">Entregado</th><th className="px-3 py-2 text-right">Merma</th><th className="px-3 py-2 text-right">Queda</th></tr>
                </thead>
                <tbody>
                  {res.inventario.map(x => (
                    <tr key={x.sku} className={`border-t border-slate-100 ${x.exceso > 0 ? 'bg-red-50 font-semibold text-red-800' : ''}`}>
                      <td className="px-3 py-2">{nombreDe(x.sku)}</td><td className="px-3 py-2 text-right">{x.cargado}</td><td className="px-3 py-2 text-right">{x.entregado}</td>
                      <td className="px-3 py-2 text-right">{x.merma}</td><td className="px-3 py-2 text-right">{x.exceso > 0 ? `−${x.exceso}` : x.restante}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {res.abierta && res.cargaConfirmada && res.entregadas.length > 0 && (
            <div>
              <p className="mb-1.5 font-semibold text-slate-800">Entregas registradas</p>
              <ul className="space-y-2">
                {res.entregadas.map(o => (
                  <li key={o.id} className={`rounded-xl border p-3 ${o.enExceso ? 'border-red-200 bg-white' : 'border-slate-200 bg-white'}`}>
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-semibold text-slate-800">{s(o.folio)} · {s(o.cliente)}</p>
                        <p className="text-xs text-slate-500">{lineasTxt(o.lineas)} · {fmtMoney(o.total)}{o.cobrado > 0 ? ` · cobrado ${fmtMoney(o.cobrado)}` : ''}{o.cxc_saldo != null ? ` · fiado ${fmtMoney(o.cxc_saldo)}` : ''}</p>
                        {!o.reversible && <p className="mt-0.5 text-xs text-slate-500">No se puede revertir: {s(o.no_reversible)}</p>}
                      </div>
                      {o.reversible && <FormBtn onClick={() => abrir('revertir', o)}>Revertir entrega</FormBtn>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {res.abierta && res.pendientes.length > 0 && (
            <div>
              <p className="mb-1.5 font-semibold text-slate-800">Pendientes de resolver ({res.pendientes.length})</p>
              <ul className="space-y-2">
                {res.pendientes.map(o => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-200 bg-white p-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800">{s(o.folio)} · {s(o.cliente)}</p>
                      <p className="text-xs text-slate-500">{lineasTxt(o.lineas)} · {fmtMoney(o.total)}{Number(o.cobrado) > 0 ? ` · cobrado ${fmtMoney(o.cobrado)}` : ''}</p>
                    </div>
                    <FormBtn onClick={() => abrir('no_entrega', o)}>Marcar no entregada</FormBtn>
                  </li>
                ))}
              </ul>
              <p className="mt-1.5 text-xs text-slate-500">La ruta se cierra cuando no queda ninguna pendiente. El producto de una no entregada sigue en el camión y regresa al cuarto con el conteo del cierre.</p>
            </div>
          )}

          {form && (
            <div className="space-y-3 rounded-xl border border-slate-300 bg-slate-50 p-3" data-testid="recuperacion-form">
              <p className="font-semibold text-slate-800">{form.tipo === 'revertir' ? `Revertir la entrega de ${s(form.orden.folio)}` : `Marcar ${s(form.orden.folio)} como no entregada`}</p>
              {form.tipo === 'revertir' && (
                <p className="text-xs text-slate-600">La orden vuelve a "Asignada" en esta misma ruta. No se mueve inventario{form.orden.cxc_saldo != null ? '; su cuenta por cobrar (sin abonos) se anula' : ''}. Queda registro de quién lo hizo y por qué.</p>
              )}
              <FormTextarea label="Motivo (obligatorio)" rows={2} value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })}
                placeholder={form.tipo === 'revertir' ? 'Por qué esa entrega no ocurrió' : 'Por qué no se entregó'} />
              {form.pideCobro && (
                <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-900">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={form.conservarCobro} onChange={e => setForm({ ...form, conservarCobro: e.target.checked })} />
                  <span>Esta orden tiene <b>{fmtMoney(form.orden.cobrado)}</b> cobrados. La reversión <b>no borra ese cobro</b>: la orden quedará cobrada y pendiente de entrega. Si ese dinero no se recibió, aparecerá como faltante en el corte de caja de la ruta. Entiendo y lo conservo.</span>
                </label>
              )}
              {errForm && <p className="text-xs font-medium text-red-700">{errForm}</p>}
              <div className="flex gap-2">
                <FormBtn primary loading={enviando} onClick={confirmar}>{form.tipo === 'revertir' ? 'Revertir entrega' : 'Marcar no entregada'}</FormBtn>
                <FormBtn ghost onClick={() => setForm(null)}>Cancelar</FormBtn>
              </div>
            </div>
          )}

          {res.revertidas.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-slate-800">Entregas revertidas en esta ruta</p>
              <ul className="space-y-1">
                {res.revertidas.map((x, i) => <li key={i} className="rounded-lg border border-slate-200 bg-white p-2 text-xs text-slate-600">{s(x.folio)} · {s(x.actor)} · “{s(x.motivo)}”</li>)}
              </ul>
            </div>
          )}
        </>)}
        <div className="flex justify-end"><FormBtn onClick={onClose}>Cerrar</FormBtn></div>
      </div>
    </Modal>
  );
}
