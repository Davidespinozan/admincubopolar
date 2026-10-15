// CorreccionesTienda — P4-H3E (mig 153). Inventario → "Correcciones de tiendas".
// ADMINISTRACIÓN SOLICITA → DUEÑO AUTORIZA → ADMINISTRACIÓN EJECUTA. Cada paso es un contrato del servidor; la
// pantalla no calcula existencias, vigencias ni permisos definitivos: solo ofrece lo que corresponde, conserva la
// operación de cada intento (un reintento no duplica) y muestra lo que el servidor respondió.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Modal, FormBtn, FormInput, FormSelect, EmptyState, fmtDateTime, useToast } from './views/viewsCommon';
import { FormTextarea } from './ui/Modal';
import {
  ESTADOS_CORRECCION, estadoDe, perfilCorrecciones, accionesFila, cuartosDeTienda, tiendasConCongelador, existenciaDe,
  compararCorreccion, signoDiferencia, validarSolicitud, claveSolicitud, claveDecision, claveEjecucion,
  claveCancelacion, filtrarCorrecciones, resumenEstados, diferenciaFila, MOTIVO_MIN_SOLICITUD, MOTIVO_MIN_CANCELACION,
  MENSAJE_CONTEO_OBSOLETO, crearEnviadorCorrecciones,
} from '../data/correccionesTiendaLogic';

const TONOS = {
  amber: 'bg-amber-50 text-amber-800 border-amber-200', blue: 'bg-blue-50 text-blue-800 border-blue-200',
  green: 'bg-emerald-50 text-emerald-800 border-emerald-200', red: 'bg-red-50 text-red-700 border-red-200',
  slate: 'bg-slate-100 text-slate-700 border-slate-200',
};

export function EtiquetaEstado({ estado }) {
  const e = ESTADOS_CORRECCION[estado] || { label: estado, tono: 'slate' };
  return <span className={`inline-block rounded-md border px-2 py-0.5 text-xs font-semibold ${TONOS[e.tono]}`} data-estado={estado}>{e.label}</span>;
}

function Dato({ label, children }) {
  return <div className="bg-slate-50 rounded-xl p-3"><p className="text-[11px] text-slate-500 uppercase font-bold">{label}</p><div className="text-sm text-slate-800 font-semibold">{children}</div></div>;
}

function ErrorDialogo({ err }) {
  if (!err) return null;
  return <p role="alert" data-incierto={err.incierto ? '1' : '0'} className={`text-sm font-medium rounded-lg p-3 ${err.incierto ? 'bg-amber-50 text-amber-800' : 'bg-red-50 text-red-700'}`}>{err.mensaje}</p>;
}

/** Datos de la solicitud (lo que se pidió), comunes a autorizar, ejecutar y cancelar. */
function DetalleCorreccion({ fila, nombreTienda, nombreCuarto }) {
  const d = diferenciaFila(fila);
  return (
    <div className="grid grid-cols-2 gap-2" data-testid="detalle-correccion">
      <Dato label="Folio">{fila.folio}</Dato>
      <Dato label="Estado"><EtiquetaEstado estado={estadoDe(fila)} /></Dato>
      <Dato label="Tienda">{nombreTienda(fila.establecimiento_id)}</Dato>
      <Dato label="Congelador">{nombreCuarto(fila.cuarto_id)}</Dato>
      <Dato label="Producto"><span className="font-mono">{fila.sku}</span></Dato>
      <Dato label="Solicitó">{fila.solicitada_por_nombre || '—'} <span className="font-normal text-slate-500">· {fmtDateTime(fila.solicitada_at)}</span></Dato>
      <Dato label="Existencia registrada al solicitar">{fila.existencia_vista}</Dato>
      <Dato label="Existencia contada">{fila.existencia_propuesta}</Dato>
      <Dato label="Diferencia">{signoDiferencia(d)} {d > 0 ? '(ajuste positivo)' : '(ajuste negativo)'}</Dato>
      {fila.decidida_por_nombre && <Dato label={estadoDe(fila) === 'rechazada' ? 'Rechazó' : 'Autorizó'}>{fila.decidida_por_nombre}</Dato>}
      {fila.vence_at && <Dato label="Vigencia (hora del servidor)">vence {fmtDateTime(fila.vence_at)}</Dato>}
      <div className="col-span-2"><Dato label="Motivo">{fila.motivo}</Dato></div>
    </div>
  );
}

// `inicial` = { filas, tiendas } ya cargados (precarga); sin él, la sección los pide al montarse.
export default function CorreccionesTienda({ data, actions, usuario, inicial = null }) {
  const toast = useToast();
  const perfil = useMemo(() => perfilCorrecciones(usuario), [usuario]);
  const usuarioId = usuario?.id ?? null;
  const [filas, setFilas] = useState(() => (Array.isArray(inicial?.filas) ? inicial.filas : null));
  const [errorLista, setErrorLista] = useState(null);
  const [tiendas, setTiendas] = useState(() => (Array.isArray(inicial?.tiendas) ? inicial.tiendas : []));
  const [filtros, setFiltros] = useState({ estado: '', tiendaId: '', desde: '', hasta: '' });
  const [dialogo, setDialogo] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [err, setErr] = useState(null);
  const enviarRef = useRef(null); // misma operación en cada reintento; un doble clic no sale dos veces
  if (!enviarRef.current) enviarRef.current = crearEnviadorCorrecciones();

  const cuartos = data?.cuartosFrios || [];
  const productos = useMemo(() => (data?.productos || []).filter(p => String(p.tipo) === 'Producto Terminado'), [data?.productos]);
  const nombreTienda = useCallback((id) => tiendas.find(t => String(t.id) === String(id))?.nombre || `Tienda ${id}`, [tiendas]);
  const nombreCuarto = useCallback((id) => cuartos.find(c => String(c.id) === String(id))?.nombre || id, [cuartos]);

  const cargar = useCallback(async () => {
    const r = await actions?.correccionesTiendaConsulta?.({});
    if (!r || r.error) { setErrorLista(r?.error || 'No se pudo cargar el historial de correcciones.'); return null; }
    setErrorLista(null);
    const lista = Array.isArray(r.data) ? r.data : [];
    setFilas(lista);
    return lista;
  }, [actions]);

  useEffect(() => {
    if (!perfil.visible) return;
    cargar();
    actions?.tiendaEstado?.(null)?.then(r => { if (r?.data?.tiendas) setTiendas(r.data.tiendas); });
  }, [perfil.visible, cargar, actions]);

  const visibles = useMemo(() => filtrarCorrecciones(filas, filtros), [filas, filtros]);
  const resumen = useMemo(() => resumenEstados(filas), [filas]);

  if (!perfil.visible) return null;

  const enviar = enviarRef.current;
  const cerrar = () => { if (enviando) return; setDialogo(null); setErr(null); };

  // ── Solicitar (Administración sin el Dueño) ──
  const abrirSolicitud = () => { setErr(null); setDialogo({ tipo: 'solicitar', paso: 'form', tiendaId: '', cuartoId: '', sku: '', contado: '', motivo: '', cf: null, registrada: null, errores: {} }); };
  const releerCongelador = async (cuartoId) => {
    if (!cuartoId) return null;
    const r = await actions.leerCongeladorCorreccion(cuartoId);
    if (r?.error) { setErr({ mensaje: r.error, incierto: !!r.incierto }); return null; }
    return r.data;
  };
  const cambiarSolicitud = async (cambio) => {
    const sig = { ...dialogo, ...cambio, errores: {} };
    if ('tiendaId' in cambio) { sig.cuartoId = ''; sig.cf = null; sig.registrada = null; }
    if ('cuartoId' in cambio) { sig.cf = null; sig.registrada = null; }
    setDialogo(sig); setErr(null);
    if (('cuartoId' in cambio && cambio.cuartoId) || ('sku' in cambio && sig.cuartoId)) {
      const cf = await releerCongelador(sig.cuartoId);
      setDialogo(d => (d && d.cuartoId === sig.cuartoId ? { ...d, cf, registrada: cf && d.sku ? existenciaDe(cf, d.sku) : null } : d));
    }
  };
  const revisarSolicitud = async () => {
    const d = dialogo;
    const cf = await releerCongelador(d.cuartoId); // existencia vigente del servidor, no la que quedó en el navegador
    if (!cf && d.cuartoId) return;
    if (cf && d.sku && d.registrada != null && existenciaDe(cf, d.sku) !== d.registrada) {
      setDialogo({ ...d, cf, registrada: existenciaDe(cf, d.sku), errores: { registrada: `${MENSAJE_CONTEO_OBSOLETO} (Ahora: ${existenciaDe(cf, d.sku)}.)` } });
      return;
    }
    const v = validarSolicitud({ tiendaId: d.tiendaId, cuarto: cf, sku: d.sku, registrada: d.registrada, contadoTexto: d.contado, motivo: d.motivo });
    if (v.errores) { setDialogo({ ...d, cf, errores: v.errores }); return; }
    setDialogo({ ...d, cf, paso: 'confirmar', datos: v.datos, errores: {} });
  };
  const enviarSolicitud = async () => {
    if (enviando) return;
    const datos = dialogo.datos;
    const clave = claveSolicitud(datos);
    setEnviando(true); setErr(null);
    const r = await enviar(clave, (operacionId) => actions.solicitarCorreccionTienda({ ...datos, operacionId }));
    setEnviando(false);
    if (r?.ignorado) return;
    if (r?.error) { setErr({ mensaje: r.error, incierto: !!r.incierto }); if (r.codigo === 'CONTEO_OBSOLETO') setDialogo(d => ({ ...d, paso: 'form' })); return; }
    setDialogo(null);
    toast?.success(`Solicitud ${r.data?.folio || ''} registrada. El inventario no cambió: falta la autorización del Dueño.`);
    cargar();
  };

  // ── Autorizar / rechazar (solo el Dueño) ──
  const enviarDecision = async (decision) => {
    if (enviando) return;
    const { fila, nota } = dialogo;
    const clave = claveDecision({ correccionId: fila.id, decision, nota });
    setEnviando(true); setErr(null);
    const r = await enviar(clave, (operacionId) => actions.decidirCorreccionTienda({ correccionId: fila.id, decision, nota, operacionId }));
    setEnviando(false);
    if (r?.ignorado) return;
    if (r?.error) { setErr({ mensaje: r.error, incierto: !!r.incierto }); return; }
    setDialogo(null);
    toast?.success(decision === 'autorizar'
      ? `${r.data?.folio || 'Corrección'} autorizada; vence ${fmtDateTime(r.data?.vence_at)} (hora del servidor). El inventario no cambió.`
      : `${r.data?.folio || 'Corrección'} rechazada. El inventario no cambió.`);
    cargar();
  };

  // ── Ejecutar (Administración; no quien autorizó) ──
  const abrirEjecucion = async (fila) => {
    setErr(null);
    const lista = await cargar(); // estado vigente antes de una operación que mueve inventario
    if (!lista) { toast?.error('No se pudo comprobar el estado actual de la corrección; intenta de nuevo.'); return; }
    const fresca = (lista || []).find(f => String(f.id) === String(fila.id));
    if (!fresca || estadoDe(fresca) !== 'autorizada') {
      toast?.error(fresca && estadoDe(fresca) === 'vencida' ? 'La autorización venció (24 horas). Hace falta una nueva solicitud.' : 'La corrección ya no está autorizada; revisa su estado en la lista.');
      return;
    }
    setDialogo({ tipo: 'ejecutar', fila: fresca });
  };
  const enviarEjecucion = async () => {
    if (enviando) return;
    const { fila } = dialogo;
    const clave = claveEjecucion({ correccionId: fila.id });
    setEnviando(true); setErr(null);
    const r = await enviar(clave, (operacionId) => actions.ejecutarCorreccionTienda({ correccionId: fila.id, operacionId }));
    setEnviando(false);
    if (r?.ignorado) return;
    if (r?.error) { setErr({ mensaje: r.error, incierto: !!r.incierto }); if (!r.incierto) cargar(); return; }
    setDialogo({ tipo: 'resultado', fila, resultado: r.data });
    cargar();
  };

  // ── Cancelar (quien solicitó o el Dueño) ──
  const enviarCancelacion = async () => {
    if (enviando) return;
    const { fila, motivo } = dialogo;
    if (String(motivo || '').trim().length < MOTIVO_MIN_CANCELACION) { setErr({ mensaje: `Escribe el motivo (mínimo ${MOTIVO_MIN_CANCELACION} caracteres).` }); return; }
    const clave = claveCancelacion({ correccionId: fila.id, motivo });
    setEnviando(true); setErr(null);
    const r = await enviar(clave, (operacionId) => actions.cancelarCorreccionTienda({ correccionId: fila.id, motivo, operacionId }));
    setEnviando(false);
    if (r?.ignorado) return;
    if (r?.error) { setErr({ mensaje: r.error, incierto: !!r.incierto }); return; }
    setDialogo(null);
    toast?.success(r.data?.estado === 'vencida' ? `${r.data?.folio} quedó cerrada como vencida.` : `${r.data?.folio} cancelada. El inventario no cambió.`);
    cargar();
  };

  const d = dialogo;
  const tiendasElegibles = tiendasConCongelador(tiendas, cuartos);
  const comp = d?.tipo === 'solicitar' && d.registrada != null ? compararCorreccion(d.registrada, d.contado) : null;

  return (
    <div data-testid="correcciones-tienda">
      <div className="rounded-2xl border border-blue-100 bg-blue-50 p-4 mb-4 text-sm text-blue-900">
        <p className="font-semibold">Cómo funciona</p>
        <p><b>Solicitar</b> (Administración): no cambia el inventario. <b>Autorizar</b> (Dueño): permite ejecutarla durante 24 horas; no cambia el inventario. <b>Ejecutar</b> (Administración, no quien autorizó): sí corrige el inventario y deja kardex y auditoría.</p>
      </div>

      <div className="flex flex-wrap gap-2 mb-4" data-testid="resumen-correcciones">
        {Object.entries(ESTADOS_CORRECCION).map(([k, e]) => (
          <span key={k} className={`rounded-lg border px-3 py-1.5 text-xs font-semibold ${TONOS[e.tono]}`}>{e.label}: {resumen[k]}</span>
        ))}
      </div>

      <div className="grid gap-2 sm:grid-cols-5 mb-4 items-end">
        <FormSelect label="Estado" value={filtros.estado} onChange={e => setFiltros({ ...filtros, estado: e.target.value })}
          options={[{ value: '', label: 'Todos' }, ...Object.entries(ESTADOS_CORRECCION).map(([k, e]) => ({ value: k, label: e.label }))]} />
        <FormSelect label="Tienda" value={filtros.tiendaId} onChange={e => setFiltros({ ...filtros, tiendaId: e.target.value })}
          options={[{ value: '', label: 'Todas' }, ...tiendas.map(t => ({ value: String(t.id), label: t.nombre }))]} />
        <FormInput label="Desde" type="date" value={filtros.desde} onChange={e => setFiltros({ ...filtros, desde: e.target.value })} />
        <FormInput label="Hasta" type="date" value={filtros.hasta} onChange={e => setFiltros({ ...filtros, hasta: e.target.value })} />
        <div className="flex gap-2">
          <FormBtn onClick={cargar}>Actualizar</FormBtn>
          {perfil.puedeSolicitar && <FormBtn primary onClick={abrirSolicitud}>Solicitar corrección</FormBtn>}
        </div>
      </div>

      {errorLista && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-3 mb-3">{errorLista}</p>}
      {filas === null && !errorLista ? <p className="text-sm text-slate-500">Cargando…</p>
        : visibles.length === 0 ? <EmptyState message="Sin correcciones" />
        : (
          <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
            <table className="min-w-full text-xs" data-testid="tabla-correcciones">
              <thead className="bg-slate-50 text-slate-500 uppercase">
                <tr>{['Folio', 'Solicitada', 'Tienda', 'Congelador', 'Producto', 'Registrada', 'Contada', 'Diferencia', 'Motivo', 'Solicitó', 'Autorizó / rechazó', 'Estado', 'Vence', 'Ejecutó', 'Ejecutada', ''].map(h => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>)}</tr>
              </thead>
              <tbody>
                {visibles.map(f => {
                  const a = accionesFila(f, perfil, usuarioId);
                  return (
                    <tr key={f.id} className="border-t border-slate-100 align-top" data-folio={f.folio}>
                      <td className="px-3 py-2 font-mono">{f.folio}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{fmtDateTime(f.solicitada_at)}</td>
                      <td className="px-3 py-2">{nombreTienda(f.establecimiento_id)}</td>
                      <td className="px-3 py-2">{nombreCuarto(f.cuarto_id)}</td>
                      <td className="px-3 py-2 font-mono">{f.sku}</td>
                      <td className="px-3 py-2 text-right">{f.existencia_vista}</td>
                      <td className="px-3 py-2 text-right">{f.existencia_propuesta}</td>
                      <td className="px-3 py-2 text-right font-semibold">{signoDiferencia(diferenciaFila(f))}</td>
                      <td className="px-3 py-2 max-w-[220px]">{f.motivo}</td>
                      <td className="px-3 py-2">{f.solicitada_por_nombre || '—'}</td>
                      <td className="px-3 py-2">{f.decidida_por_nombre || '—'}</td>
                      <td className="px-3 py-2"><EtiquetaEstado estado={estadoDe(f)} /></td>
                      <td className="px-3 py-2 whitespace-nowrap">{f.vence_at ? fmtDateTime(f.vence_at) : '—'}</td>
                      <td className="px-3 py-2">{f.ejecutada_por_nombre || '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{f.ejecutada_at ? `${fmtDateTime(f.ejecutada_at)}${f.kardex_id ? ` · kardex ${f.kardex_id}` : ''}` : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap space-x-1">
                        {a.decidir && <FormBtn size="sm" onClick={() => { setErr(null); setDialogo({ tipo: 'decidir', fila: f, nota: '' }); }}>Autorizar o rechazar</FormBtn>}
                        {a.ejecutar && <FormBtn size="sm" primary onClick={() => abrirEjecucion(f)}>Ejecutar</FormBtn>}
                        {a.cancelar && <FormBtn size="sm" onClick={() => { setErr(null); setDialogo({ tipo: 'cancelar', fila: f, motivo: '' }); }}>{a.cierraVencida ? 'Cerrar como vencida' : 'Cancelar'}</FormBtn>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      {/* Solicitar */}
      <Modal open={d?.tipo === 'solicitar'} onClose={cerrar} title="Solicitar corrección de inventario de tienda">
        {d?.tipo === 'solicitar' && (d.paso === 'form' ? (
          <div className="space-y-3" data-testid="form-solicitud">
            {tiendasElegibles.length === 0 && <p className="text-sm text-slate-500">No hay tiendas con congelador propio.</p>}
            <FormSelect label="Tienda" value={d.tiendaId} error={d.errores.tienda} onChange={e => cambiarSolicitud({ tiendaId: e.target.value })}
              options={[{ value: '', label: 'Elige la tienda' }, ...tiendasElegibles.map(t => ({ value: String(t.id), label: t.nombre }))]} />
            <FormSelect label="Congelador de esa tienda" value={d.cuartoId} error={d.errores.cuarto} disabled={!d.tiendaId} onChange={e => cambiarSolicitud({ cuartoId: e.target.value })}
              options={[{ value: '', label: 'Elige el congelador' }, ...cuartosDeTienda(cuartos, d.tiendaId).map(c => ({ value: String(c.id), label: c.nombre || c.id }))]} />
            <FormSelect label="Producto" value={d.sku} error={d.errores.sku} onChange={e => cambiarSolicitud({ sku: e.target.value })}
              options={[{ value: '', label: 'Elige el producto' }, ...productos.map(p => ({ value: p.sku, label: `${p.sku} · ${p.nombre}` }))]} />
            <Dato label="Existencia registrada (servidor)"><span data-testid="registrada">{d.registrada == null ? '—' : d.registrada}</span></Dato>
            {d.errores.registrada && <p role="alert" className="text-sm text-red-700 bg-red-50 rounded-lg p-2">{d.errores.registrada}</p>}
            <FormInput label="Existencia física contada (piezas)" inputMode="numeric" value={d.contado} error={d.errores.contado} onChange={e => setDialogo({ ...d, contado: e.target.value, errores: {} })} />
            {comp && comp.tipo !== 'vacio' && <p data-testid="diferencia" data-tipo={comp.tipo} className="text-sm rounded-lg p-2 bg-slate-50">{comp.diferencia != null && <b>Diferencia: {signoDiferencia(comp.diferencia)}. </b>}{comp.mensaje}</p>}
            <FormTextarea label={`Motivo (obligatorio, mínimo ${MOTIVO_MIN_SOLICITUD} caracteres)`} rows={2} value={d.motivo} error={d.errores.motivo} onChange={e => setDialogo({ ...d, motivo: e.target.value, errores: {} })} />
            <ErrorDialogo err={err} />
            <div className="flex justify-end gap-2"><FormBtn onClick={cerrar}>Cerrar</FormBtn><FormBtn primary onClick={revisarSolicitud}>Revisar</FormBtn></div>
          </div>
        ) : (
          <div className="space-y-3" data-testid="confirmar-solicitud">
            <div className="grid grid-cols-2 gap-2">
              <Dato label="Tienda">{nombreTienda(d.tiendaId)}</Dato>
              <Dato label="Congelador">{nombreCuarto(d.datos.cuartoId)}</Dato>
              <Dato label="Producto"><span className="font-mono">{d.datos.sku}</span></Dato>
              <Dato label="Existencia actual">{d.datos.vista}</Dato>
              <Dato label="Existencia contada">{d.datos.propuesta}</Dato>
              <Dato label="Diferencia">{signoDiferencia(d.datos.propuesta - d.datos.vista)}</Dato>
              <div className="col-span-2"><Dato label="Motivo">{d.datos.motivo}</Dato></div>
            </div>
            <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">Esta solicitud <b>no modifica todavía el inventario</b>. El Dueño debe autorizarla y después Administración la ejecuta.</p>
            <ErrorDialogo err={err} />
            <div className="flex justify-end gap-2">
              <FormBtn onClick={() => setDialogo({ ...d, paso: 'form' })} disabled={enviando}>Volver</FormBtn>
              <FormBtn primary onClick={enviarSolicitud} loading={enviando}>{err?.incierto ? 'Reintentar (misma solicitud)' : 'Enviar solicitud'}</FormBtn>
            </div>
          </div>
        ))}
      </Modal>

      {/* Autorizar o rechazar */}
      <Modal open={d?.tipo === 'decidir'} onClose={cerrar} title="Autorizar o rechazar corrección">
        {d?.tipo === 'decidir' && (
          <div className="space-y-3" data-testid="dialogo-decision">
            <DetalleCorreccion fila={d.fila} nombreTienda={nombreTienda} nombreCuarto={nombreCuarto} />
            <ul className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 list-disc pl-6">
              <li>La autorización vale <b>24 horas</b> (el servidor fija el vencimiento).</li>
              <li>No modifica el inventario: Administración la ejecuta después.</li>
              <li>Quien autoriza no puede ejecutar esta corrección.</li>
            </ul>
            <FormTextarea label="Nota (opcional)" rows={2} value={d.nota} onChange={e => setDialogo({ ...d, nota: e.target.value })} />
            <ErrorDialogo err={err} />
            <div className="flex justify-end gap-2">
              <FormBtn onClick={cerrar} disabled={enviando}>Cerrar</FormBtn>
              <FormBtn danger onClick={() => enviarDecision('rechazar')} loading={enviando}>Rechazar</FormBtn>
              <FormBtn primary onClick={() => enviarDecision('autorizar')} loading={enviando}>Autorizar</FormBtn>
            </div>
          </div>
        )}
      </Modal>

      {/* Ejecutar */}
      <Modal open={d?.tipo === 'ejecutar'} onClose={cerrar} title="Ejecutar corrección autorizada">
        {d?.tipo === 'ejecutar' && (
          <div className="space-y-3" data-testid="dialogo-ejecucion">
            <DetalleCorreccion fila={d.fila} nombreTienda={nombreTienda} nombreCuarto={nombreCuarto} />
            <p className="text-sm font-semibold text-amber-900 bg-amber-50 rounded-lg p-3">Esta acción <b>sí modifica el inventario</b> del congelador y deja kardex y auditoría. El servidor vuelve a comprobar la existencia: si cambió desde la solicitud, no se aplica.</p>
            <ErrorDialogo err={err} />
            <div className="flex justify-end gap-2">
              <FormBtn onClick={cerrar} disabled={enviando}>Cerrar</FormBtn>
              <FormBtn primary onClick={enviarEjecucion} loading={enviando}>{err?.incierto ? 'Reintentar (misma operación)' : 'Ejecutar corrección'}</FormBtn>
            </div>
          </div>
        )}
      </Modal>

      {/* Resultado de la ejecución (lo que respondió el servidor) */}
      <Modal open={d?.tipo === 'resultado'} onClose={cerrar} title="Corrección ejecutada">
        {d?.tipo === 'resultado' && (
          <div className="space-y-3" data-testid="resultado-ejecucion">
            <div className="grid grid-cols-2 gap-2">
              <Dato label="Folio">{d.resultado?.folio}</Dato>
              <Dato label="Estado"><EtiquetaEstado estado={d.resultado?.estado || 'ejecutada'} /></Dato>
              <Dato label="Existencia anterior">{d.resultado?.existencia_anterior}</Dato>
              <Dato label="Existencia resultante">{d.resultado?.existencia_resultante}</Dato>
              <Dato label="Diferencia">{signoDiferencia(d.resultado?.diferencia)}</Dato>
              <Dato label="Movimiento de kardex">{d.resultado?.kardex_id ?? '—'}</Dato>
            </div>
            {d.resultado?.replay && <p className="text-sm text-slate-600">Ya estaba ejecutada con esta operación: el inventario no se movió dos veces.</p>}
            <div className="flex justify-end"><FormBtn primary onClick={cerrar}>Listo</FormBtn></div>
          </div>
        )}
      </Modal>

      {/* Cancelar */}
      <Modal open={d?.tipo === 'cancelar'} onClose={cerrar} title="Cancelar corrección">
        {d?.tipo === 'cancelar' && (
          <div className="space-y-3" data-testid="dialogo-cancelacion">
            <DetalleCorreccion fila={d.fila} nombreTienda={nombreTienda} nombreCuarto={nombreCuarto} />
            <p className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3">Cancelar no modifica el inventario. Una autorización ya vencida queda cerrada como vencida.</p>
            <FormTextarea label={`Motivo (obligatorio, mínimo ${MOTIVO_MIN_CANCELACION} caracteres)`} rows={2} value={d.motivo} onChange={e => setDialogo({ ...d, motivo: e.target.value })} />
            <ErrorDialogo err={err} />
            <div className="flex justify-end gap-2">
              <FormBtn onClick={cerrar} disabled={enviando}>Cerrar</FormBtn>
              <FormBtn danger onClick={enviarCancelacion} loading={enviando}>Cancelar corrección</FormBtn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
