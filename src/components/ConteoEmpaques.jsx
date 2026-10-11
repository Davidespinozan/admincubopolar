// ConteoEmpaques — T5-C (mig 140), solo Admin.
// Sección "Empaques" de Insumos: existencia registrada de cada bolsa, su último movimiento,
// "Registrar conteo" (compara lo contado con lo registrado, pide motivo y confirmación; nada se
// aplica solo) y "Ver historial". La existencia la mueve únicamente el servidor
// (`registrar_conteo_empaque`), que rechaza un conteo preparado sobre datos que ya cambiaron.
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Modal, FormBtn, FormInput, EmptyState, fmtDateTime } from './views/viewsCommon';
import { FormTextarea } from './ui/Modal';
import { compararConteo, motivoNoConfirmar, filaEmpaque, filaMovimiento } from '../data/conteoEmpaqueLogic';
import { nuevoOperacionId } from '../data/stockContratosLogic';

const num = (v) => Number(v || 0).toLocaleString('es-MX');
const costoTxt = (v) => (v === null || v === undefined ? '—' : `$${Number(v).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 6 })}`);
const signo = (d) => (d > 0 ? `+${num(d)}` : d < 0 ? `−${num(Math.abs(d))}` : '0');

// Cuerpo del diálogo de conteo: lo registrado, lo contado, la diferencia calculada, el motivo
// y la confirmación explícita. Sin estado propio: lo que se ve es lo que se va a enviar.
export function CuerpoConteo({ conteo, comp, falta, errConteo, onCambio }) {
  return (
    <div className="space-y-4 text-sm" data-testid="dialogo-conteo">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-slate-50 rounded-xl p-3"><p className="text-[11px] text-slate-500 uppercase font-bold">SKU</p><p className="font-mono text-slate-800">{conteo.emp.sku}</p></div>
        <div className="bg-slate-50 rounded-xl p-3"><p className="text-[11px] text-slate-500 uppercase font-bold">Existencia registrada</p><p className="text-lg font-extrabold text-slate-800" data-testid="existencia-registrada">{num(conteo.emp.existencia)} <span className="text-xs font-normal text-slate-500">{conteo.emp.unidad}</span></p></div>
      </div>
      <FormInput label="Cantidad contada (piezas)" inputMode="numeric" autoComplete="off" placeholder="Ej. 8450" value={conteo.texto}
        onChange={ev => onCambio({ texto: ev.target.value, confirmado: false })} />
      {comp && comp.tipo !== 'vacio' && (
        <div className={`rounded-xl p-3 ${comp.tipo === 'igual' ? 'bg-emerald-50 text-emerald-800' : comp.tipo === 'faltante' ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`} data-testid="diferencia-conteo">
          {comp.diferencia !== null && <p className="text-xs font-bold uppercase">Diferencia: {signo(comp.diferencia)} piezas</p>}
          <p className="text-sm mt-0.5">{comp.mensaje}</p>
        </div>
      )}
      <FormTextarea label="Motivo (obligatorio)" rows={2} placeholder="Ej. Conteo de apertura con Santiago; bolsas rotas en la tarima 3" value={conteo.motivo}
        onChange={ev => onCambio({ motivo: ev.target.value })} />
      <label className="flex items-start gap-2 text-sm text-slate-700">
        <input type="checkbox" className="mt-1 h-4 w-4" checked={conteo.confirmado} disabled={!comp?.valido}
          onChange={ev => onCambio({ confirmado: ev.target.checked })} />
        <span>{comp?.valido && comp.tipo === 'faltante'
          ? `Confirmo que conté ${num(comp.conteo)} piezas y que la existencia debe quedar en ${num(comp.conteo)}.`
          : 'Confirmo que revisé el conteo y quiero guardarlo.'}</span>
      </label>
      {errConteo && <p className="text-xs font-medium text-red-700 bg-red-50 rounded-lg p-2" role="alert">{errConteo}</p>}
      {!errConteo && falta && comp?.valido && <p className="text-xs text-slate-500">{falta}</p>}
    </div>
  );
}
// `inicial`: filas ya cargadas (precarga); sin ellas la sección las pide al montarse.
export default function ConteoEmpaques({ actions, refrescoKey, inicial = null }) {
  const [filas, setFilas] = useState(() => (Array.isArray(inicial) ? inicial.map(filaEmpaque) : null));
  const [error, setError] = useState(null);
  const [conteo, setConteo] = useState(null);     // { emp, texto, motivo, confirmado, operacionId }
  const [enviando, setEnviando] = useState(false);
  const [errConteo, setErrConteo] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [hist, setHist] = useState(null);         // { emp, data, error }

  const cargar = useCallback(async () => {
    const r = await actions?.empaquesParaConteo?.();
    if (!r || r.error) { setError(r?.error || 'No se pudo cargar la lista de empaques'); return null; }
    const lista = (r.data || []).map(filaEmpaque);
    setError(null);
    setFilas(lista);
    return lista;
  }, [actions]);
  useEffect(() => { cargar(); }, [cargar, refrescoKey]);

  const abrirConteo = (emp) => { setErrConteo(null); setAviso(null); setConteo({ emp, texto: '', motivo: '', confirmado: false, operacionId: nuevoOperacionId() }); };

  const comp = useMemo(() => (conteo ? compararConteo(conteo.emp.existencia, conteo.texto) : null), [conteo]);
  const falta = conteo ? motivoNoConfirmar({ comparacion: comp, motivo: conteo.motivo, confirmado: conteo.confirmado }) : null;

  const confirmar = async () => {
    if (enviando || !conteo || falta) return;
    setEnviando(true);
    try {
      const r = await actions.registrarConteoEmpaque?.({
        operacionId: conteo.operacionId, sku: conteo.emp.sku, existencia: conteo.emp.existencia,
        revision: conteo.emp.revision, conteo: comp.conteo, motivo: conteo.motivo,
      });
      if (!r || r.error) {
        if (r?.obsoleto) {
          // Alguien movió este empaque mientras se contaba: se muestra la existencia vigente y
          // el conteo se confirma de nuevo (operación nueva; la anterior no aplicó nada).
          const lista = await cargar();
          const vigente = (lista || []).find(e => e.sku === conteo.emp.sku);
          if (vigente) setConteo(c => ({ ...c, emp: vigente, confirmado: false, operacionId: nuevoOperacionId() }));
        }
        setErrConteo(r?.error || 'No se pudo registrar el conteo. No se aplicó ningún cambio.');
        return;
      }
      const d = r.data || {};
      setAviso(Number(d.delta) === 0
        ? `Conteo de ${conteo.emp.nombre} guardado: coincide con lo registrado (${num(d.nueva)}).`
        : `Conteo de ${conteo.emp.nombre} aplicado: ${num(d.anterior)} → ${num(d.nueva)} (${signo(Number(d.delta))}).`);
      setConteo(null);
      await cargar();
    } finally { setEnviando(false); }
  };

  const abrirHistorial = async (emp) => {
    setHist({ emp, data: null, error: null });
    const r = await actions.historialEmpaque?.(emp.sku);
    setHist(h => (h && h.emp.sku === emp.sku ? { emp, data: r?.error ? null : (r?.data || null), error: r?.error || (!r ? 'No se pudo cargar el historial' : null) } : h));
  };

  const acciones = (e) => (
    <div className="flex flex-wrap gap-2">
      <FormBtn onClick={() => abrirHistorial(e)}>Ver historial</FormBtn>
      <FormBtn primary onClick={() => abrirConteo(e)}>Registrar conteo</FormBtn>
    </div>
  );
  const ultimoTxt = (e) => (e.ultimo ? `${fmtDateTime(e.ultimo.fecha)} · ${e.ultimo.tipo} ${num(e.ultimo.cantidad)}` : 'Sin movimientos');

  return (
    <section className="bg-white border border-slate-100 rounded-2xl p-4 mb-4" data-testid="conteo-empaques">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Empaques</h3>
          <p className="text-xs text-slate-500 mt-0.5">Existencia registrada de cada bolsa. Cuenta las bolsas físicas y registra el conteo: el sistema te muestra la diferencia antes de aplicarla.</p>
        </div>
        <FormBtn ghost onClick={cargar}>Actualizar</FormBtn>
      </div>
      {aviso && <p className="text-xs text-emerald-800 bg-emerald-50 rounded-lg p-2 mb-3" role="status">{aviso}</p>}
      {error && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2 mb-3">{error}</p>}
      {filas === null && !error && <p className="text-sm text-slate-500">Cargando empaques…</p>}
      {filas && filas.length === 0 && <EmptyState message="No hay empaques dados de alta" hint="Los empaques se dan de alta en Productos, con tipo Empaque." />}

      {filas && filas.length > 0 && (<>
        {/* Móvil: tarjetas */}
        <div className="space-y-3 md:hidden">
          {filas.map(e => (
            <div key={e.sku} className="border border-slate-100 rounded-xl p-3">
              <div className="flex justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold text-slate-800 truncate">{e.nombre}</p>
                  <p className="font-mono text-[11px] text-slate-500">{e.sku}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xl font-extrabold text-slate-800">{num(e.existencia)}</p>
                  <p className="text-[11px] text-slate-500">{e.unidad}</p>
                </div>
              </div>
              <p className="text-[11px] text-slate-500 mt-1">Costo unitario: {costoTxt(e.costo)} · Último movimiento: {ultimoTxt(e)}</p>
              <div className="mt-2">{acciones(e)}</div>
            </div>
          ))}
        </div>
        {/* Escritorio: tabla */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 border-b border-slate-100">
                <th className="py-2 pr-3">SKU</th><th className="py-2 pr-3">Empaque</th>
                <th className="py-2 pr-3 text-right">Existencia registrada</th><th className="py-2 pr-3">Unidad</th>
                <th className="py-2 pr-3 text-right">Costo unitario</th><th className="py-2 pr-3">Último movimiento</th><th className="py-2">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filas.map(e => (
                <tr key={e.sku} className="border-b border-slate-50 last:border-0 align-middle">
                  <td className="py-2 pr-3 font-mono text-xs text-slate-600">{e.sku}</td>
                  <td className="py-2 pr-3 font-semibold text-slate-800">{e.nombre}</td>
                  <td className="py-2 pr-3 text-right font-extrabold text-slate-800">{num(e.existencia)}</td>
                  <td className="py-2 pr-3 text-slate-600">{e.unidad}</td>
                  <td className="py-2 pr-3 text-right text-slate-600">{costoTxt(e.costo)}</td>
                  <td className="py-2 pr-3 text-xs text-slate-600">{ultimoTxt(e)}{e.ultimo?.usuario ? ` · ${e.ultimo.usuario}` : ''}</td>
                  <td className="py-2">{acciones(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>)}

      {conteo && (
        <Modal open onClose={() => !enviando && setConteo(null)} title={`Conteo de ${conteo.emp.nombre}`} kicker="Registrar conteo físico"
          footer={<div className="flex gap-2 justify-end">
            <FormBtn onClick={() => setConteo(null)} disabled={enviando}>Cancelar</FormBtn>
            <FormBtn primary onClick={confirmar} disabled={!!falta} loading={enviando}>Confirmar conteo</FormBtn>
          </div>}>
          <CuerpoConteo conteo={conteo} comp={comp} falta={falta} errConteo={errConteo}
            onCambio={(cambio) => { setErrConteo(null); setConteo(c => ({ ...c, ...cambio })); }} />
        </Modal>
      )}

      {hist && (
        <Modal open onClose={() => setHist(null)} title={`Historial de ${hist.emp.nombre}`} kicker={hist.emp.sku} wide safeBottom>
          <div className="space-y-5 text-sm" data-testid="historial-empaque">
            {hist.error && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg p-2">{hist.error}</p>}
            {!hist.data && !hist.error && <p className="text-slate-500">Cargando historial…</p>}
            {hist.data && (<>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Conteos y ajustes</h4>
                {(hist.data.conteos || []).length === 0 ? <p className="text-slate-500">Aún no hay conteos registrados.</p> : (hist.data.conteos || []).map((c, i) => (
                  <div key={i} className="py-2 border-b border-slate-50 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-slate-800">{num(c.existencia_anterior)} → {num(c.existencia_resultante)} <span className={Number(c.diferencia) < 0 ? 'text-red-600' : 'text-emerald-700'}>({signo(Number(c.diferencia) || 0)})</span></span>
                      <span className="text-xs text-slate-500 flex-shrink-0">{fmtDateTime(c.created_at)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5">{c.motivo || 'Sin motivo'} · {c.actor || 'Sin responsable'}</p>
                  </div>
                ))}
              </div>
              <div>
                <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Movimientos</h4>
                {(hist.data.movimientos || []).length === 0 ? <p className="text-slate-500">Este empaque no tiene movimientos.</p> : (hist.data.movimientos || []).map(filaMovimiento).map(m => (
                  <div key={m.id} className="py-2 border-b border-slate-50 last:border-0">
                    <div className="flex justify-between gap-2">
                      <span><span className={`font-bold ${m.entrada ? 'text-emerald-600' : 'text-red-600'}`}>{m.entrada ? '+' : '−'}{num(m.cantidad)}</span> <span className="text-slate-700 ml-1">{m.clase}</span></span>
                      <span className="text-xs text-slate-500 flex-shrink-0">{fmtDateTime(m.fecha)}</span>
                    </div>
                    <p className="text-xs text-slate-600 mt-0.5 break-words">{m.detalle}{m.responsable ? ` · ${m.responsable}` : ''}{m.anterior !== null && m.resultante !== null ? ` · ${num(m.anterior)} → ${num(m.resultante)}` : ''}</p>
                  </div>
                ))}
              </div>
            </>)}
          </div>
        </Modal>
      )}
    </section>
  );
}
