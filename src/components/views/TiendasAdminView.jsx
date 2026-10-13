// TiendasAdminView — Tiendas E5: administración de tiendas propias (solo Admin).
//
// Cuatro pestañas, cada una sobre un contrato que YA existe en el servidor (migración 146):
//   Cajas       guardar_caja                         alta, nombre, activar / desactivar
//   Turnos      cerrar_turno_caja · reabrir_turno_caja   cierre administrativo y reapertura con motivo
//   Ventas      corregir_venta_tienda                devolución de una venta del POS (una por venta)
//   Reembolsos  confirmar_reembolso_tienda           marcar como entregado un reembolso que estaba solo registrado
// No se inventa nada: dar de alta tiendas, asignar personas o elegir los clientes de una tienda
// todavía no tiene contrato (se hace con SQL del dueño) y por eso no hay pantalla para ello.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, SectionLabel, SegmentedTabs, Guia } from '../ui/Components';
import Modal, { FormInput, FormSelect, FormTextarea, FormBtn } from '../ui/Modal';
import { AvisoPos } from '../PosTiendaView';
import { TiendaConfigPanel } from './TiendaConfigPanel';
import { TraspasosPanel } from './TraspasosPanel';
import { nuevaOperacionId, leerMonto, pesos, mediosParaVenta, construirCorreccion, textoReembolso } from '../../data/posLogic';

const TABS = [{ k: 'config', l: 'Configuración' }, { k: 'abasto', l: 'Abastecimiento' }, { k: 'cajas', l: 'Cajas' }, { k: 'turnos', l: 'Turnos' }, { k: 'ventas', l: 'Ventas' }, { k: 'reembolsos', l: 'Reembolsos' }];
const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—'; } catch { return '—'; } };

export function TiendasAdminView({ data, actions }) {
  const [tab, setTab] = useState('config');
  const [d, setD] = useState(null);
  const [errorCarga, setErrorCarga] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState(null);            // { tipo, ...datos }
  const [form, setForm] = useState({});
  // Un operacion_id por modal abierto: si no hay respuesta, el reintento usa el mismo (no se duplica).
  const opId = useRef(null);

  const cargar = useCallback(async () => {
    const r = await actions.tiendasAdminDatos();
    if (r?.error) { setErrorCarga(r.error); return; }
    setErrorCarga(null);
    setD(r.data);
  }, [actions]);
  useEffect(() => { cargar(); }, [cargar]);

  const todas = useMemo(() => (d?.establecimientos || []).filter(e => e.tipo !== 'cedis'), [d]);
  // Las pestañas de operación (cajas, turnos, ventas, reembolsos) son de las tiendas ACTIVAS.
  const tiendas = useMemo(() => todas.filter(e => e.activo !== false), [todas]);
  const nombreTienda = useCallback((id) => (d?.establecimientos || []).find(e => String(e.id) === String(id))?.nombre || `Tienda ${id}`, [d]);
  const nombreCaja = useCallback((id) => (d?.cajas || []).find(c => String(c.id) === String(id))?.nombre || `Caja ${id}`, [d]);
  const ordenDe = useCallback((id) => (d?.ordenes || []).find(o => String(o.id) === String(id)) || null, [d]);
  const correccionDe = useCallback((ordenId) => (d?.correcciones || []).find(c => String(c.orden_id) === String(ordenId)) || null, [d]);
  const turnosAbiertosDe = useCallback((estId) => (d?.turnos || []).filter(t => t.estado === 'abierto' && String(t.establecimiento_id) === String(estId)), [d]);

  const abrir = (m, inicial = {}) => { opId.current = nuevaOperacionId(); setForm(inicial); setAviso(null); setModal(m); };
  const cerrarModal = () => { if (!ocupado) setModal(null); };
  const ejecutar = async (llamada) => {
    setOcupado(true);
    const r = await llamada();
    setOcupado(false);
    if (r?.error) {
      setAviso({ tono: 'error', texto: r.incierto ? 'No hubo respuesta del servidor. Vuelve a tocar el botón: la operación no se hará dos veces.' : r.error });
      return false;
    }
    setAviso(null); setModal(null);
    await cargar();
    return r;
  };

  // ── Acciones ──
  const guardarCaja = () => ejecutar(() => actions.guardarCaja({ id: modal.caja?.id ?? null, establecimientoId: modal.caja ? null : form.establecimientoId, nombre: form.nombre, activa: form.activa !== false }));
  const cerrarTurno = () => {
    const m = leerMonto(form.contado, 'el efectivo contado');
    if (m.error) { setAviso({ tono: 'error', texto: m.error }); return; }
    return ejecutar(() => actions.posCerrarTurno({ p_operacion_id: opId.current, p_turno_id: modal.turno.id, p_efectivo_contado: m.valor,
      p_motivo_diferencia: (form.motivo || '').trim() || null, p_notas: (form.notas || '').trim() || null }));
  };
  const reabrirTurno = () => ejecutar(() => actions.reabrirTurnoCaja({ p_operacion_id: opId.current, p_turno_id: modal.turno.id, p_motivo: form.motivo || '' }));
  const corregir = () => {
    const parcial = form.parcial ? Object.entries(form.cantidades || {}).map(([sku, cantidad]) => ({ sku, cantidad })) : null;
    const built = construirCorreccion({ operacionId: opId.current, ordenId: modal.venta.orden_id, motivo: form.motivo, disposicion: form.disposicion, cuartoId: form.cuartoId,
      items: parcial, medio: form.medio, entregado: form.entregado, turnoReembolsoId: form.turnoId ? Number(form.turnoId) : null, metodoVenta: modal.venta.metodo });
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    return ejecutar(() => actions.corregirVentaTienda(built.args));
  };
  const confirmarReembolso = () => ejecutar(() => actions.confirmarReembolsoTienda({ p_operacion_id: opId.current, p_correccion_id: modal.correccion.id,
    p_referencia: (form.referencia || '').trim() || null, p_turno_reembolso_id: modal.correccion.reembolso_medio === 'efectivo_caja' && form.turnoId ? Number(form.turnoId) : null }));

  if (errorCarga && !d) {
    return <div className="space-y-3" data-testid="tiendas-admin"><AvisoPos tono="error">{errorCarga} <button type="button" onClick={cargar} className="ml-2 font-semibold underline">Reintentar</button></AvisoPos></div>;
  }
  if (!d) return <div data-testid="tiendas-admin"><Card><p className="text-sm text-slate-500">Cargando tiendas…</p></Card></div>;
  const pendientes = (d.correcciones || []).filter(c => c.reembolso_estado === 'registrado');

  return (
    <div className="space-y-3" data-testid="tiendas-admin">
      <div>
        <p className="font-display text-xl font-bold tracking-[-0.03em] text-slate-900">Tiendas</p>
        <p className="text-sm text-slate-500">Configuración y activación, cajas, turnos, ventas de tienda y reembolsos.</p>
      </div>
      <SegmentedTabs items={TABS.map(t => (t.k === 'reembolsos' && pendientes.length ? { ...t, l: `Reembolsos (${pendientes.length})` } : t))} value={tab} onChange={setTab} />
      {aviso && !modal && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}

      {tab === 'config' && <TiendaConfigPanel data={data} actions={actions} tiendas={todas} tiendasHabilitadas={!!d.tiendasHabilitadas} onCambio={cargar} />}
      {tab === 'abasto' && <TraspasosPanel data={data} actions={actions} tiendas={todas} cuartos={d.cuartos} />}
      {tab !== 'config' && tab !== 'abasto' && tiendas.length === 0 && (
        <Guia titulo="Todavía no hay tiendas activas" testid="tiendas-sin-activas">Configura y activa una tienda en la pestaña Configuración; después aquí verás sus cajas, turnos, ventas y reembolsos.</Guia>
      )}

      {tab === 'cajas' && (
        <div className="grid gap-3 md:grid-cols-2" data-testid="tiendas-cajas">
          {tiendas.map(e => (
            <Card key={e.id}>
              <div className="flex items-center justify-between gap-2">
                <div><SectionLabel>{e.tipo === 'tienda_fabrica' ? 'Tienda de fábrica' : 'Tienda'}</SectionLabel><p className="font-display text-base font-bold text-slate-900">{e.nombre}</p></div>
                <FormBtn primary onClick={() => abrir({ tipo: 'caja', caja: null }, { establecimientoId: e.id, nombre: '', activa: true })}>Nueva caja</FormBtn>
              </div>
              <div className="mt-3 space-y-2">
                {(d.cajas || []).filter(c => String(c.establecimiento_id) === String(e.id)).map(c => {
                  const abierta = (d.turnos || []).find(t => t.caja_id === c.id && t.estado === 'abierto');
                  return (
                    <div key={c.id} className="flex items-center justify-between gap-2 rounded-[14px] bg-slate-50 p-3 text-sm">
                      <div><p className="font-semibold text-slate-900">{c.nombre}</p>
                        <p className="text-xs text-slate-500">{!c.activa ? 'Desactivada' : abierta ? `Turno abierto · ${abierta.cajero_nombre}` : 'Libre'}</p></div>
                      <FormBtn onClick={() => abrir({ tipo: 'caja', caja: c }, { nombre: c.nombre, activa: c.activa })}>Editar</FormBtn>
                    </div>
                  );
                })}
                {(d.cajas || []).every(c => String(c.establecimiento_id) !== String(e.id)) && <p className="text-sm text-slate-500">Sin cajas: nadie puede abrir turno en esta tienda todavía.</p>}
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'turnos' && (
        <Card padding="p-0">
          <div className="divide-y divide-slate-100" data-testid="tiendas-turnos">
            {(d.turnos || []).map(t => (
              <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{nombreTienda(t.establecimiento_id)} · {nombreCaja(t.caja_id)} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${t.estado === 'abierto' ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{t.estado}</span></p>
                  <p className="text-slate-500">{t.cajero_nombre} · abrió {hora(t.abierto_at)}{t.cerrado_at ? ` · cerró ${hora(t.cerrado_at)}` : ''}{t.reaperturas ? ` · reabierto ${t.reaperturas}×` : ''}</p>
                  {t.estado === 'cerrado' && (
                    <p className={Number(t.diferencia) === 0 ? 'text-slate-500' : 'font-semibold text-amber-700'}>
                      Esperado {pesos(t.efectivo_esperado)} · contado {pesos(t.efectivo_contado)} · diferencia {pesos(t.diferencia)}{t.motivo_diferencia ? ` — ${t.motivo_diferencia}` : ''}
                    </p>
                  )}
                </div>
                {t.estado === 'abierto'
                  ? <FormBtn onClick={() => abrir({ tipo: 'cerrar', turno: t }, { contado: '', motivo: '', notas: '' })}>Cerrar turno</FormBtn>
                  : <FormBtn onClick={() => abrir({ tipo: 'reabrir', turno: t }, { motivo: '' })}>Reabrir</FormBtn>}
              </div>
            ))}
            {(d.turnos || []).length === 0 && <p className="p-4 text-sm text-slate-500">Todavía no hay turnos.</p>}
          </div>
        </Card>
      )}

      {tab === 'ventas' && (
        <Card padding="p-0">
          <div className="divide-y divide-slate-100" data-testid="tiendas-ventas">
            {(d.ventas || []).map(v => {
              const o = ordenDe(v.orden_id); const c = correccionDe(v.orden_id);
              return (
                <div key={v.operacion_id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{o?.folio || `Orden ${v.orden_id}`} <span className="font-normal text-slate-500">· {hora(v.created_at)} · {nombreTienda(v.establecimiento_id)} · {nombreCaja(v.caja_id)}</span></p>
                    <p className="truncate text-slate-500">{o?.cliente_nombre || ''} · {o?.productos || ''}{v.desde_cedis ? ' · con producto del CEDIS' : ''}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right"><p className="font-semibold text-slate-900">{pesos(v.total)}</p><p className="text-xs text-slate-500">{v.metodo}</p></div>
                    {c ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-800">Corregida</span>
                      : <FormBtn onClick={() => abrir({ tipo: 'corregir', venta: v }, { motivo: '', disposicion: 'Reintegrar', cuartoId: '', parcial: false, cantidades: {}, medio: 'efectivo_administracion', entregado: false, turnoId: '' })}>Corregir</FormBtn>}
                  </div>
                </div>
              );
            })}
            {(d.ventas || []).length === 0 && <p className="p-4 text-sm text-slate-500">Todavía no hay ventas de tienda.</p>}
          </div>
        </Card>
      )}

      {tab === 'reembolsos' && (
        <Card padding="p-0">
          <div className="divide-y divide-slate-100" data-testid="tiendas-reembolsos">
            {(d.correcciones || []).map(c => {
              const o = ordenDe(c.orden_id); const t = textoReembolso(c);
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-semibold text-slate-900">{o?.folio || `Orden ${c.orden_id}`} <span className="font-normal text-slate-500">· {hora(c.created_at)} · {nombreTienda(c.establecimiento_id)}</span></p>
                    <p className="text-slate-500">{c.motivo} · devuelto {pesos(c.total_devuelto)} · reembolso {pesos(c.reembolso_monto)}</p>
                    <p className={t.tono === 'ok' ? 'text-emerald-700' : t.tono === 'aviso' ? 'font-semibold text-amber-700' : 'text-slate-500'}>
                      {t.texto}{c.reembolso_referencia ? ` · ref ${c.reembolso_referencia}` : ''}{c.reembolso_ejecutado_por ? ` · ${c.reembolso_ejecutado_por}` : ''}
                    </p>
                  </div>
                  {c.reembolso_estado === 'registrado' && <FormBtn warning onClick={() => abrir({ tipo: 'confirmar', correccion: c }, { referencia: '', turnoId: '' })}>Confirmar entrega</FormBtn>}
                </div>
              );
            })}
            {(d.correcciones || []).length === 0 && <p className="p-4 text-sm text-slate-500">No hay correcciones.</p>}
          </div>
        </Card>
      )}

      {/* ── Modales ── */}
      <Modal open={modal?.tipo === 'caja'} onClose={cerrarModal} title={modal?.caja ? 'Editar caja' : 'Nueva caja'} kicker="Tiendas"
        footer={<><FormBtn onClick={cerrarModal}>Cancelar</FormBtn><FormBtn primary onClick={guardarCaja} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Guardar'}</FormBtn></>}>
        <div className="space-y-3">
          <FormInput label="Nombre de la caja" value={form.nombre || ''} onChange={e => setForm(f => ({ ...f, nombre: e.target.value }))} maxLength={60} placeholder="Caja 1" />
          {modal?.caja && <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={form.activa !== false} onChange={e => setForm(f => ({ ...f, activa: e.target.checked }))} /> Caja activa</label>}
          {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
        </div>
      </Modal>

      <Modal open={modal?.tipo === 'cerrar'} onClose={cerrarModal} title="Cerrar turno" kicker={modal?.turno ? `${nombreCaja(modal.turno.caja_id)} · ${modal.turno.cajero_nombre}` : ''}
        footer={<><FormBtn onClick={cerrarModal}>Cancelar</FormBtn><FormBtn primary onClick={cerrarTurno} disabled={ocupado}>{ocupado ? 'Cerrando…' : 'Cerrar turno'}</FormBtn></>}>
        <div className="space-y-3">
          <FormInput label="Efectivo contado en el cajón" inputMode="decimal" placeholder="0.00" value={form.contado || ''} onChange={e => setForm(f => ({ ...f, contado: e.target.value }))} />
          <FormTextarea label="Por qué lo cierra Administración" rows={2} value={form.notas || ''} onChange={e => setForm(f => ({ ...f, notas: e.target.value }))} />
          <FormTextarea label="Motivo de la diferencia (solo si lo contado no coincide)" rows={2} value={form.motivo || ''} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} />
          {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
        </div>
      </Modal>

      <Modal open={modal?.tipo === 'reabrir'} onClose={cerrarModal} title="Reabrir turno" kicker={modal?.turno ? `${nombreCaja(modal.turno.caja_id)} · ${modal.turno.cajero_nombre}` : ''}
        footer={<><FormBtn onClick={cerrarModal}>Cancelar</FormBtn><FormBtn warning onClick={reabrirTurno} disabled={ocupado}>{ocupado ? 'Reabriendo…' : 'Reabrir'}</FormBtn></>}>
        <div className="space-y-3">
          <p className="text-sm text-slate-600">El cierre anterior queda guardado en la historia. No se puede reabrir si la caja o el cajero ya tienen otro turno abierto.</p>
          <FormTextarea label="Motivo de la reapertura" rows={2} value={form.motivo || ''} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} />
          {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
        </div>
      </Modal>

      {modal?.tipo === 'corregir' && (() => {
        const v = modal.venta; const o = ordenDe(v.orden_id);
        const porSku = {}; for (const a of v.asignacion || []) porSku[a.sku] = (porSku[a.sku] || 0) + Number(a.cantidad || 0);
        const origen = [...new Set((v.asignacion || []).map(a => a.cuarto_id))];
        const cuartos = (d.cuartos || []).filter(c => String(c.establecimiento_id) === String(v.establecimiento_id) || origen.includes(c.id));
        const turnos = turnosAbiertosDe(v.establecimiento_id);
        return (
          <Modal open onClose={cerrarModal} title={`Corregir ${o?.folio || `orden ${v.orden_id}`}`} kicker={`${pesos(v.total)} · ${v.metodo}`} wide
            footer={<><FormBtn onClick={cerrarModal}>Cancelar</FormBtn><FormBtn danger onClick={corregir} disabled={ocupado}>{ocupado ? 'Registrando…' : 'Registrar corrección'}</FormBtn></>}>
            <div className="space-y-3" data-testid="tiendas-corregir">
              <AvisoPos tono="aviso">Una venta admite una sola corrección. Se registra la devolución y su salida de dinero en contabilidad.</AvisoPos>
              <FormTextarea label="Motivo" rows={2} value={form.motivo || ''} onChange={e => setForm(f => ({ ...f, motivo: e.target.value }))} />
              <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!form.parcial} onChange={e => setForm(f => ({ ...f, parcial: e.target.checked, cantidades: e.target.checked ? { ...porSku } : {} }))} /> Devolver solo una parte</label>
              {form.parcial && Object.keys(porSku).map(sku => (
                <FormInput key={sku} label={`${sku} (vendido: ${porSku[sku]})`} inputMode="numeric" value={form.cantidades?.[sku] ?? ''} onChange={e => setForm(f => ({ ...f, cantidades: { ...f.cantidades, [sku]: e.target.value } }))} />
              ))}
              <FormSelect label="¿Qué pasa con el producto?" value={form.disposicion} onChange={e => setForm(f => ({ ...f, disposicion: e.target.value }))}
                options={[{ value: 'Reintegrar', label: 'Vuelve al congelador' }, { value: 'Merma', label: 'Es merma (no vuelve)' }]} />
              {form.disposicion === 'Reintegrar' && (
                <FormSelect label="Congelador" value={form.cuartoId || ''} onChange={e => setForm(f => ({ ...f, cuartoId: e.target.value }))}
                  options={[{ value: '', label: origen.length === 1 ? `El mismo del que salió (${origen[0]})` : 'Elige el congelador' }, ...cuartos.map(c => ({ value: c.id, label: `${c.nombre} (${c.id})` }))]} />
              )}
              <FormSelect label="¿De dónde sale el reembolso?" value={form.medio} onChange={e => setForm(f => ({ ...f, medio: e.target.value, entregado: false, turnoId: '' }))}
                options={mediosParaVenta(v.metodo).map(m => ({ value: m.id, label: m.label }))} />
              {form.medio === 'electronico'
                ? <AvisoPos tono="aviso">La devolución a tarjeta o transferencia se hace en la terminal o en el banco. Aquí queda <strong>registrada como pendiente</strong>; cuando el banco la confirme, márcala en Reembolsos con su referencia.</AvisoPos>
                : (
                  <>
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!form.entregado} onChange={e => setForm(f => ({ ...f, entregado: e.target.checked }))} /> El efectivo ya se entregó al cliente</label>
                    {form.medio === 'efectivo_caja' && form.entregado && (
                      <FormSelect label="Turno abierto del que salió el efectivo" value={form.turnoId || ''} onChange={e => setForm(f => ({ ...f, turnoId: e.target.value }))}
                        options={[{ value: '', label: turnos.length ? 'Elige el turno' : 'No hay turnos abiertos en esta tienda' }, ...turnos.map(t => ({ value: String(t.id), label: `${nombreCaja(t.caja_id)} · ${t.cajero_nombre}` }))]} />
                    )}
                    {!form.entregado && <p className="text-xs text-slate-500">Queda como pendiente hasta que confirmes la entrega en Reembolsos.</p>}
                  </>
                )}
              {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
            </div>
          </Modal>
        );
      })()}

      {modal?.tipo === 'confirmar' && (() => {
        const c = modal.correccion; const turnos = turnosAbiertosDe(c.establecimiento_id);
        return (
          <Modal open onClose={cerrarModal} title="Confirmar reembolso" kicker={`${pesos(c.reembolso_monto)} · ${textoReembolso(c).texto}`}
            footer={<><FormBtn onClick={cerrarModal}>Cancelar</FormBtn><FormBtn success onClick={confirmarReembolso} disabled={ocupado}>{ocupado ? 'Confirmando…' : 'El dinero ya se devolvió'}</FormBtn></>}>
            <div className="space-y-3">
              {c.reembolso_medio === 'electronico' && <FormInput label="Referencia de la devolución (terminal o banco)" value={form.referencia || ''} onChange={e => setForm(f => ({ ...f, referencia: e.target.value }))} maxLength={80} />}
              {c.reembolso_medio === 'efectivo_caja' && (
                <FormSelect label="Turno abierto del que sale el efectivo" value={form.turnoId || ''} onChange={e => setForm(f => ({ ...f, turnoId: e.target.value }))}
                  options={[{ value: '', label: turnos.length ? 'Elige el turno' : 'No hay turnos abiertos en esta tienda' }, ...turnos.map(t => ({ value: String(t.id), label: `${nombreCaja(t.caja_id)} · ${t.cajero_nombre}` }))]} />
              )}
              {c.reembolso_medio === 'efectivo_administracion' && <p className="text-sm text-slate-600">Confirma solo cuando Administración ya entregó el efectivo al cliente.</p>}
              {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}
