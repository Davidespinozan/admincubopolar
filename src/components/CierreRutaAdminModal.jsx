// CierreRutaAdminModal — T5-D2 (mig 142), solo Admin. Cierre de una ruta cuando el chofer no
// puede: primero la conciliación (lo que el servidor sabe), después lo que bloquea se resuelve
// una cosa a la vez con su contrato, y al final UNA llamada que cierra todo o nada
// (`cerrar_ruta_admin`). No hay "forzar": nada se marca entregado, cobrado ni mermado solo.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Modal, { FormBtn, FormTextarea } from './ui/Modal';
import { s, fmtMoney, fmtDateTime } from '../utils/safe';
import VentasRapidasRuta from './VentasRapidasRuta';
import {
  TIPO_CIERRE, MOTIVO_MINIMO, modoCierreAdmin, resumenConciliacion, diferenciasDelConteo, faltantesParaServidor, motivoNoCerrar,
} from '../data/conciliacionRutaLogic';
import { nuevoOperacionId } from '../data/stockContratosLogic';

const METODOS_RESOLVER = ['Efectivo', 'Transferencia', 'Tarjeta', 'Crédito'];
const Caja = ({ titulo, children, tono = 'slate', testid }) => (
  <div className={`rounded-xl p-4 ${tono === 'rojo' ? 'border border-red-200 bg-red-50' : tono === 'ambar' ? 'border border-amber-200 bg-amber-50' : 'bg-slate-50'}`} data-testid={testid}>
    <h4 className={`mb-2 text-xs font-bold uppercase ${tono === 'rojo' ? 'text-red-700' : tono === 'ambar' ? 'text-amber-800' : 'text-slate-500'}`}>{titulo}</h4>
    {children}
  </div>
);

// Vista de la conciliación (sin estado): lo que Administración revisa antes de cerrar.
export function PanelConciliacion({ r, nombreDe = (sku) => sku }) {
  if (!r) return null;
  return (
    <div className="space-y-3" data-testid="conciliacion-ruta">
      <Caja titulo="Ruta">
        <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
          <div><span className="text-slate-500">Estado:</span> <b>{r.estatus}</b></div>
          <div><span className="text-slate-500">Chofer:</span> <b>{r.chofer || '—'}</b></div>
          <div><span className="text-slate-500">Entregadas:</span> <b>{r.entregadas.length}</b></div>
          <div><span className="text-slate-500">No entregadas:</span> <b>{r.noEntregadas.length}</b></div>
          <div><span className="text-slate-500">Sin resolver:</span> <b className={r.pendientes.length > 0 ? 'text-red-700' : ''}>{r.pendientes.length}</b></div>
          <div><span className="text-slate-500">Entregas revertidas:</span> <b>{r.revertidas.length}</b></div>
          <div><span className="text-slate-500">Ventas rápidas:</span> <b>{r.ventasRapidas.ventas}</b>{r.ventasRapidas.ventas > 0 && <span className="text-slate-500"> ({fmtMoney(r.ventasRapidas.total)})</span>}</div>
          <div><span className="text-slate-500">Cierre financiero:</span> <b>{r.marcaFinanciera ? 'registrado' : 'sin registrar'}</b></div>
        </div>
        {r.intervenciones.length > 0 && (
          <p className="mt-2 text-xs text-slate-600">Intervenciones de Administración: {r.intervenciones.map(i => `${i.tipo === 'inicio_admin' ? 'salida registrada' : i.tipo === 'no_salio' ? 'camión no salió' : 'cierre'} por ${s(i.actor)} (${fmtDateTime(i.fecha)})`).join('; ')}.</p>
        )}
      </Caja>
      <Caja titulo="Dinero registrado" testid="conciliacion-dinero">
        {r.cobros.length === 0 && <p className="text-xs text-slate-500">No hay cobros registrados en esta ruta.</p>}
        {r.cobros.map(x => (
          <div key={x.metodo} className="flex justify-between text-sm"><span className="text-slate-600">{x.metodo} <span className="text-xs text-slate-400">({x.pagos} {x.pagos === 1 ? 'pago' : 'pagos'})</span></span><b>{fmtMoney(x.monto)}</b></div>
        ))}
        {r.cobros.length > 0 && <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 text-sm"><span className="font-semibold text-slate-700">Total cobrado</span><b>{fmtMoney(r.cobradoTotal)}</b></div>}
        {r.credito.cuentas > 0 && <div className="mt-1 flex justify-between text-sm text-amber-700"><span>Crédito ({r.credito.cuentas} {r.credito.cuentas === 1 ? 'cuenta por cobrar' : 'cuentas por cobrar'})</span><b>{fmtMoney(r.credito.saldo)} por cobrar</b></div>}
        <p className="mt-2 text-[11px] text-slate-500">
          {r.cierreCaja
            ? `Efectivo conciliado: esperado ${fmtMoney(r.cierreCaja.esperadoEfectivo)}, contado ${fmtMoney(r.cierreCaja.contadoEfectivo)}${r.cierreCaja.diferencia !== 0 ? `, diferencia ${fmtMoney(r.cierreCaja.diferencia)}` : ''}.`
            : `El efectivo todavía NO está conciliado: cerrar la ruta no cuenta el dinero. El efectivo registrado (${fmtMoney(r.efectivo)}) se concilia después en Conciliación.`}
        </p>
      </Caja>
      {r.links.length > 0 && (
        <Caja titulo={`Links de pago pendientes (${r.links.length})`} tono="ambar" testid="conciliacion-links">
          {r.links.map(x => <div key={x.ordenId} className="flex justify-between text-sm"><span><span className="font-mono text-xs">{x.folio}</span> {x.cliente}</span><b>{fmtMoney(x.falta)}</b></div>)}
          <p className="mt-2 text-xs text-amber-900">Estas entregas NO están pagadas ni fiadas. No impiden cerrar la ruta: siguen pendientes hasta que llegue el pago o se cobren de otra forma, y aparecen en tus avisos.</p>
        </Caja>
      )}
      {(r.mermas.length > 0 || r.faltantes.length > 0) && (
        <Caja titulo="Mermas y faltantes registrados">
          {r.mermas.map(m => <div key={m.id} className="flex justify-between text-sm"><span>{m.cantidad}× {nombreDe(m.sku)} <span className="text-xs text-slate-500">— {m.causa}{m.conFoto ? ' (con foto)' : ''}</span></span><span className="text-xs text-slate-500">merma</span></div>)}
          {r.faltantes.map(m => <div key={m.id} className="flex justify-between text-sm text-red-700"><span>{m.cantidad}× {nombreDe(m.sku)} <span className="text-xs">— {m.motivo}</span></span><span className="text-xs font-bold">FALTANTE NO JUSTIFICADO</span></div>)}
        </Caja>
      )}
    </div>
  );
}

export default function CierreRutaAdminModal({ ruta, actions, productos, onClose, onCerrada }) {
  const [crudo, setCrudo] = useState(null);
  const [error, setError] = useState(null);
  const [eleccion, setEleccion] = useState(null);     // ruta Cargada: 'no_salio' | 'salio'
  const [conteo, setConteo] = useState({});
  const [reconoce, setReconoce] = useState(false);    // faltante no justificado reconocido
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [errEnvio, setErrEnvio] = useState(null);
  const [accion, setAccion] = useState(null);         // { tipo, orden, motivo, metodo, operacionId }
  const [causaMerma, setCausaMerma] = useState('');
  const conteoTocado = useRef(false);

  const nombreDe = useCallback((sku) => s((productos || []).find(p => s(p.sku) === s(sku))?.nombre) || sku, [productos]);

  const cargar = useCallback(async () => {
    if (!ruta?.id) return null;
    const r = await actions.conciliacionRuta?.(ruta.id);
    if (!r || r.error) { setError(r?.error || 'No se pudo leer la conciliación de la ruta'); return null; }
    setError(null);
    setCrudo(r.data);
    return r.data;
  }, [actions, ruta?.id]);
  useEffect(() => { setCrudo(null); setEleccion(null); setConteo({}); setReconoce(false); setMotivo(''); setErrEnvio(null); setAccion(null); conteoTocado.current = false; cargar(); }, [cargar]);

  const r = useMemo(() => (crudo ? resumenConciliacion(crudo) : null), [crudo]);
  const modo = r ? modoCierreAdmin({ estatus: r.estatus, carga_confirmada: r.cargaConfirmada }) : null;
  const tipo = modo === 'cargada' && eleccion === 'no_salio' ? TIPO_CIERRE.NO_SALIO : TIPO_CIERRE.ADMIN;
  const contando = modo === 'cerrar' || (modo === 'cargada' && eleccion === 'no_salio');

  // Conteo sugerido = lo que debe regresar, mientras Administración no lo haya tocado.
  useEffect(() => {
    if (!r || conteoTocado.current) return;
    setConteo(Object.fromEntries(r.inventario.map(b => [b.sku, String(Math.max(0, b.restante))])));
  }, [r]);

  const dif = r ? diferenciasDelConteo(r.inventario, conteo) : { faltante: {}, sobrante: {} };
  const hayFaltante = Object.keys(dif.faltante).length > 0;
  const bloqueo = contando ? motivoNoCerrar({ resumen: r, tipo, conteo, motivo, faltanteReconocido: reconoce }) : null;

  const cerrar = async () => {
    if (enviando || bloqueo) return;
    setEnviando(true); setErrEnvio(null);
    try {
      const res = await actions.cerrarRuta?.(ruta.id, { tipo, conteo, faltantes: reconoce ? faltantesParaServidor(dif.faltante) : [], motivo });
      if (!res || res.error) {
        setErrEnvio(res?.error || 'No se pudo cerrar la ruta. No se aplicó ningún cambio.');
        // El estado ya no es el que se veía: se muestra el vigente y se confirma de nuevo.
        if (res?.cambio) { setReconoce(false); conteoTocado.current = false; await cargar(); }
        return;
      }
      onCerrada?.(res.data);
    } finally { setEnviando(false); }
  };

  const registrarSalida = async () => {
    if (enviando) return;
    if (String(motivo).trim().length < MOTIVO_MINIMO) { setErrEnvio(`Escribe el motivo (mínimo ${MOTIVO_MINIMO} letras): por qué Administración registra la salida.`); return; }
    setEnviando(true); setErrEnvio(null);
    try {
      const res = await actions.iniciarRutaAdmin?.(ruta.id, motivo);
      if (!res || res.error) { setErrEnvio(res?.error || 'No se pudo registrar la salida.'); if (res?.cambio) await cargar(); return; }
      setEleccion(null); setMotivo(''); conteoTocado.current = false;
      await cargar();
    } finally { setEnviando(false); }
  };

  // Resolver UNA orden con su contrato: no entregada (motivo), entregada o cobro (forma de pago).
  const confirmarAccion = async () => {
    if (enviando || !accion) return;
    if (accion.tipo === 'no_entrega' && String(accion.motivo || '').trim().length < 5) { setErrEnvio('Escribe el motivo de la no entrega (mínimo 5 letras).'); return; }
    setEnviando(true); setErrEnvio(null);
    try {
      const res = accion.tipo === 'no_entrega'
        ? await actions.marcarNoEntregada?.(accion.orden.id, accion.motivo, false, { operacionId: accion.operacionId })
        : await actions.entregarOrdenRuta?.(accion.orden.id, accion.metodo, { operacionId: accion.operacionId });
      if (res?.error) { setErrEnvio(typeof res.error === 'string' ? res.error : 'No se pudo registrar. No se aplicó ningún cambio.'); return; }
      setAccion(null); conteoTocado.current = false;
      await cargar();
    } finally { setEnviando(false); }
  };

  const registrarMermaJustificada = async () => {
    if (enviando || !hayFaltante) return;
    if (String(causaMerma).trim().length < 5) { setErrEnvio('Escribe la causa comprobada de la merma (mínimo 5 letras).'); return; }
    setEnviando(true); setErrEnvio(null);
    try {
      const items = Object.entries(dif.faltante).map(([sku, cant]) => ({ sku, cant, causa: String(causaMerma).trim() }));
      const res = await actions.registrarMermasRuta?.(ruta.id, items);
      if (res?.error) { setErrEnvio(res.error); return; }
      setCausaMerma(''); setReconoce(false);
      await cargar();
    } finally { setEnviando(false); }
  };

  const abrirAccion = (tipoAccion, orden) => { setErrEnvio(null); setAccion({ tipo: tipoAccion, orden, motivo: '', metodo: METODOS_RESOLVER.includes(orden.metodo) ? orden.metodo : 'Efectivo', operacionId: nuevoOperacionId() }); };

  if (!ruta) return null;
  return (
    <Modal open onClose={() => !enviando && onClose?.()} title={`Cerrar ${s(ruta.nombre) || s(ruta.folio)}`} kicker="Cierre por Administración" wide safeBottom>
      <div className="space-y-4 text-sm" data-testid="cierre-ruta-admin">
        {error && <p className="rounded-lg bg-amber-50 p-2 text-xs font-semibold text-amber-800">{error}</p>}
        {!r && !error && <p className="text-slate-500">Leyendo la conciliación de la ruta…</p>}
        {r && <PanelConciliacion r={r} nombreDe={nombreDe} />}
        {r && <VentasRapidasRuta rutaId={ruta.id} actions={actions} />}

        {r && modo === null && <p className="rounded-lg bg-slate-100 p-3 text-xs text-slate-700">Esta ruta está {r.estatus}: no hay nada que cerrar aquí.</p>}

        {/* Órdenes sin resolver: una por una, con su contrato. Nada se marca solo. */}
        {r && r.pendientes.length > 0 && (
          <Caja titulo={`Órdenes sin resolver (${r.pendientes.length})`} tono="rojo" testid="ordenes-sin-resolver">
            <p className="mb-2 text-xs text-red-800">{modo === 'cargada' && eleccion !== 'salio'
              ? 'Si el camión no salió, estos pedidos se liberan (vuelven a "Creada", sin ruta) al cerrar. Si salió, hay que resolverlos uno por uno.'
              : 'La ruta no se cierra con órdenes sin resolver. Marca cada una como entregada (con su cobro) o no entregada (con su motivo).'}</p>
            {r.pendientes.map(o => (
              <div key={o.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-red-200 py-2">
                <span><span className="font-mono text-xs">{o.folio}</span> {o.cliente} · <b>{fmtMoney(o.total)}</b></span>
                {modo === 'cerrar' && (
                  <span className="flex gap-2">
                    <FormBtn onClick={() => abrirAccion('no_entrega', o)} disabled={enviando}>No entregada</FormBtn>
                    <FormBtn onClick={() => abrirAccion('entregar', o)} disabled={enviando}>Sí se entregó</FormBtn>
                  </span>
                )}
              </div>
            ))}
          </Caja>
        )}

        {/* Entregas sin registro financiero: bloquean. Se resuelven con el contrato de entrega (139). */}
        {r && r.sinRegistro.length > 0 && (
          <Caja titulo={`Entregas sin cobro ni cuenta por cobrar (${r.sinRegistro.length})`} tono="rojo" testid="entregas-sin-registro">
            <p className="mb-2 text-xs text-red-800">Están entregadas pero el sistema no tiene cómo se cobraron. Registra la forma de cobro real de cada una.</p>
            {r.sinRegistro.map(x => (
              <div key={x.ordenId} className="flex flex-wrap items-center justify-between gap-2 border-t border-red-200 py-2">
                <span><span className="font-mono text-xs">{x.folio}</span> {x.cliente} · falta <b>{fmtMoney(x.falta)}</b></span>
                <FormBtn onClick={() => abrirAccion('cobro', { id: x.ordenId, folio: x.folio, cliente: x.cliente, total: x.total, metodo: x.metodo })} disabled={enviando}>Registrar cobro</FormBtn>
              </div>
            ))}
          </Caja>
        )}

        {accion && (
          <Caja titulo={accion.tipo === 'no_entrega' ? `No entregada: ${accion.orden.folio}` : accion.tipo === 'cobro' ? `Cobro de ${accion.orden.folio}` : `Entregada: ${accion.orden.folio}`} tono="ambar" testid="resolver-orden">
            {accion.tipo === 'no_entrega' ? (
              <FormTextarea label="Motivo de la no entrega (obligatorio)" rows={2} value={accion.motivo} onChange={e => setAccion(a => ({ ...a, motivo: e.target.value }))} />
            ) : (
              <label className="block text-xs font-semibold text-slate-700">¿Cómo se cobró? (lo que realmente pasó)
                <select className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm" value={accion.metodo} onChange={e => setAccion(a => ({ ...a, metodo: e.target.value }))}>
                  {METODOS_RESOLVER.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
            )}
            <div className="mt-2 flex justify-end gap-2">
              <FormBtn onClick={() => setAccion(null)} disabled={enviando}>Cancelar</FormBtn>
              <FormBtn primary onClick={confirmarAccion} loading={enviando}>Registrar</FormBtn>
            </div>
          </Caja>
        )}

        {/* Camión cargado sin iniciar: Administración dice qué pasó físicamente. El sistema no lo deduce. */}
        {r && modo === 'cargada' && (
          <Caja titulo="El camión está cargado y la ruta no se inició" tono="ambar" testid="eleccion-cargada">
            <p className="mb-2 text-xs text-amber-900">El producto ya salió del cuarto frío en el sistema. Indica lo que pasó:</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <button type="button" onClick={() => { setEleccion('no_salio'); setErrEnvio(null); }} className={`rounded-lg border p-3 text-left text-xs ${eleccion === 'no_salio' ? 'border-slate-900 bg-white' : 'border-amber-300 bg-white/60'}`}>
                <b className="block text-sm text-slate-900">El camión NO salió</b>Se cuenta y se devuelve toda la carga al cuarto frío; sus pedidos se liberan para otra ruta.
              </button>
              <button type="button" onClick={() => { setEleccion('salio'); setErrEnvio(null); }} className={`rounded-lg border p-3 text-left text-xs ${eleccion === 'salio' ? 'border-slate-900 bg-white' : 'border-amber-300 bg-white/60'}`}>
                <b className="block text-sm text-slate-900">El camión SÍ salió</b>El chofer no inició la ruta en la aplicación. Se registra la salida y la ruta sigue su flujo normal.
              </button>
            </div>
            {eleccion === 'salio' && (
              <div className="mt-3 space-y-2">
                <FormTextarea label="Motivo (obligatorio): por qué Administración registra la salida" rows={2} value={motivo} onChange={e => { setMotivo(e.target.value); setErrEnvio(null); }} />
                <div className="flex justify-end"><FormBtn primary onClick={registrarSalida} loading={enviando}>Registrar la salida</FormBtn></div>
              </div>
            )}
          </Caja>
        )}

        {/* Conteo físico y cierre */}
        {r && contando && (<>
          <div className="border-t pt-4" data-testid="conteo-cierre">
            <h4 className="mb-1 text-sm font-bold text-slate-700">Inventario del camión</h4>
            <p className="mb-3 text-xs text-slate-500">El sistema calcula lo que debe regresar; captura lo que realmente regresó. Vuelve al cuarto frío de donde salió.</p>
            {r.inventario.length === 0 && <p className="text-xs text-slate-500">La ruta no tiene inventario en el camión.</p>}
            {r.inventario.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="text-[11px] uppercase text-slate-500"><th className="py-1 text-left">Producto</th><th className="text-center">Cargó</th><th className="text-center">Entregó</th><th className="text-center">Merma</th><th className="text-center">Debe regresar</th><th className="text-center">Contado</th></tr></thead>
                  <tbody>
                    {r.inventario.map(b => {
                      const mal = dif.faltante[b.sku] || dif.sobrante[b.sku];
                      return (
                        <tr key={b.sku} className="border-t border-slate-100">
                          <td className="py-1.5 font-semibold text-slate-700">{nombreDe(b.sku)}<span className="block text-[10px] font-normal text-slate-400">{b.sku}</span></td>
                          <td className="text-center">{b.cargado}</td><td className="text-center">{b.entregado}</td><td className="text-center">{b.merma}</td>
                          <td className="text-center font-bold">{b.restante}</td>
                          <td className="text-center"><input type="number" inputMode="numeric" min="0" aria-label={`Contado de ${b.sku}`} value={conteo[b.sku] ?? ''}
                            onChange={e => { conteoTocado.current = true; setConteo(c => ({ ...c, [b.sku]: e.target.value })); setReconoce(false); setErrEnvio(null); }}
                            className={`w-20 rounded-lg border px-2 py-1.5 text-center ${mal ? 'border-red-300 text-red-700' : 'border-slate-200'}`} /></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {Object.keys(dif.sobrante).length > 0 && <p className="mt-2 text-xs font-semibold text-red-600">El conteo supera lo que debe regresar ({Object.entries(dif.sobrante).map(([k, q]) => `${q}× ${nombreDe(k)}`).join(', ')}). Vuelve a contar.</p>}
            {hayFaltante && (
              <div className="mt-3 space-y-3 rounded-xl border border-red-200 bg-red-50 p-3" data-testid="faltante-conteo">
                <p className="text-xs font-bold text-red-700">Falta producto: {Object.entries(dif.faltante).map(([k, q]) => `${q}× ${nombreDe(k)}`).join(', ')}. Vuelve a contar, o indica qué pasó:</p>
                <div className="rounded-lg bg-white p-2">
                  <p className="text-xs font-semibold text-slate-700">¿Hay una causa comprobada? Regístralo como merma:</p>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input value={causaMerma} onChange={e => setCausaMerma(e.target.value)} placeholder="Causa comprobada (bolsa rota, derretido…)" className="min-w-[180px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
                    <FormBtn onClick={registrarMermaJustificada} disabled={enviando}>Registrar merma</FormBtn>
                  </div>
                </div>
                <label className="flex items-start gap-2 rounded-lg bg-white p-2 text-xs text-red-800">
                  <input type="checkbox" className="mt-0.5 h-4 w-4" checked={reconoce} onChange={e => { setReconoce(e.target.checked); setErrEnvio(null); }} />
                  <span><b>No hay explicación:</b> declarar {Object.entries(dif.faltante).map(([k, q]) => `${q}× ${nombreDe(k)}`).join(', ')} como <b>FALTANTE NO JUSTIFICADO</b>. Queda registrado a tu nombre con el motivo de abajo; no es una merma comprobada y no se puede deshacer.</span>
                </label>
              </div>
            )}
          </div>
          <FormTextarea label={`Motivo de la intervención (obligatorio): por qué cierra Administración${tipo === TIPO_CIERRE.NO_SALIO ? ' y por qué el camión no salió' : ' y no el chofer'}`} rows={2}
            value={motivo} onChange={e => { setMotivo(e.target.value); setErrEnvio(null); }} />
          <p className="text-[11px] text-slate-500">Aquí solo aparece lo que ya llegó al sistema. Si el chofer tiene entregas, ventas o mermas guardadas sin señal en su teléfono, no se ven: pregúntale antes de cerrar. Lo que llegue después del cierre se rechaza y queda en su teléfono para revisión.</p>
        </>)}

        {errEnvio && <p className="rounded-lg bg-red-50 p-2 text-xs font-semibold text-red-700" role="alert">{errEnvio}</p>}
        {contando && bloqueo && !errEnvio && <p className="text-xs text-slate-500" data-testid="bloqueo-cierre">{bloqueo}</p>}
        <div className="flex justify-end gap-2">
          <FormBtn onClick={() => onClose?.()} disabled={enviando}>Cancelar</FormBtn>
          {contando && <FormBtn primary onClick={cerrar} disabled={!!bloqueo} loading={enviando}>{tipo === TIPO_CIERRE.NO_SALIO ? 'Devolver la carga y cerrar' : 'Cerrar ruta'}</FormBtn>}
        </div>
      </div>
    </Modal>
  );
}
