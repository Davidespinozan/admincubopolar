// TraspasosPanel — Tiendas E7: abastecimiento de tiendas por traspaso con tránsito (Admin).
//
// Un traspaso es producto de la empresa que cambia de lugar: no es una ruta de clientes, ni un
// comodato, ni una venta. Cada botón llama a UN contrato de la migración 148:
//   crear → despachar (sale del origen; el destino aún no sube) → recibir (entra lo que llegó bien;
//   lo dañado o faltante queda como incidencia). Antes de despachar se puede cancelar; ya despachado,
//   solo se recibe o se registra su retorno físico al origen.
// El formulario de recepción (RecepcionTraspaso) lo comparte la pantalla del personal de la tienda.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, SectionLabel, Chips } from '../ui/Components';
import Modal, { FormInput, FormSelect, FormTextarea, FormBtn } from '../ui/Modal';
import { AvisoPos } from '../PosTiendaView';
import { nuevaOperacionId, ESTADOS_TRASPASO, textoTraspaso, accionesTraspaso, construirTraspaso, construirRecepcion, CEDIS_ID } from '../../data/posLogic';

const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };
const TONO = { ok: 'bg-emerald-100 text-emerald-800', aviso: 'bg-amber-100 text-amber-800', error: 'bg-red-100 text-red-800', neutro: 'bg-slate-100 text-slate-600' };

/** Una fila de traspaso: de dónde a dónde, qué lleva y en qué va. */
export function FilaTraspaso({ t, acciones, onAccion }) {
  const e = textoTraspaso(t);
  return (
    <div className="px-4 py-3 text-sm" data-testid={`traspaso-${t.folio}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-slate-900">{t.folio} <span className={`ml-1 rounded-full px-2 py-0.5 text-xs ${TONO[e.tono] || TONO.neutro}`}>{e.texto}</span></p>
          <p className="text-slate-600">{t.origen?.nombre} <span className="text-slate-400">({t.origen?.cuarto_id})</span> → {t.destino?.nombre} <span className="text-slate-400">({t.destino?.cuarto_id})</span></p>
          <p className="text-slate-500">Transporta {t.responsable} · creado {hora(t.created_at)}{t.despachado_at ? ` · salió ${hora(t.despachado_at)}` : ''}{t.recibido_at ? ` · llegó ${hora(t.recibido_at)} (${t.recibido_por || ''})` : ''}</p>
          <p className="text-slate-700">
            {(t.lineas || []).map(l => `${l.cantidad} ${l.nombre || l.sku}${l.recibida !== null && l.recibida !== undefined ? ` (llegó ${l.recibida}${l.danada ? `, dañado ${l.danada}` : ''}${l.faltante ? `, faltó ${l.faltante}` : ''})` : ''}`).join(' · ')}
          </p>
          {t.notas_recepcion && <p className="text-slate-500">Nota: {t.notas_recepcion}</p>}
          {t.motivo_cancelacion && <p className="text-slate-500">Cancelado: {t.motivo_cancelacion}</p>}
          {t.incidencia_resolucion && <p className="text-slate-500">Resolución: {t.incidencia_resolucion}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          {acciones.despachar && <FormBtn primary onClick={() => onAccion('despachar', t)}>Despachar</FormBtn>}
          {acciones.recibir && <FormBtn success onClick={() => onAccion('recibir', t)}>Recibir</FormBtn>}
          {acciones.retornar && <FormBtn onClick={() => onAccion('retornar', t)}>Regresó al origen</FormBtn>}
          {acciones.cancelar && <FormBtn onClick={() => onAccion('cancelar', t)}>Cancelar</FormBtn>}
          {acciones.cerrarIncidencia && <FormBtn warning onClick={() => onAccion('incidencia', t)}>Cerrar incidencia</FormBtn>}
        </div>
      </div>
    </div>
  );
}

/** Captura de lo que llegó (o de lo que regresó): por producto, bueno y dañado. Lo faltante se calcula y se muestra. */
export function RecepcionTraspaso({ traspaso, capturas, onCapturas, notas, onNotas, etiquetaNotas = 'Qué pasó (obligatorio si algo llegó dañado o faltó)' }) {
  const vista = construirRecepcion(traspaso, capturas, notas);
  return (
    <div className="space-y-3" data-testid="traspaso-recepcion">
      {(traspaso?.lineas || []).map(l => {
        const c = capturas?.[l.sku] || {};
        const r = (vista.resumen || []).find(x => x.sku === l.sku);
        return (
          <div key={l.sku} className="rounded-[14px] bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">{l.nombre || l.sku} <span className="font-normal text-slate-500">· se despacharon {l.despachada ?? l.cantidad}</span></p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <FormInput label="Llegó bien" inputMode="numeric" value={c.recibida ?? ''} onChange={e => onCapturas({ ...capturas, [l.sku]: { ...c, recibida: e.target.value } })} data-testid={`recibida-${l.sku}`} />
              <FormInput label="Llegó dañado" inputMode="numeric" placeholder="0" value={c.danada ?? ''} onChange={e => onCapturas({ ...capturas, [l.sku]: { ...c, danada: e.target.value } })} data-testid={`danada-${l.sku}`} />
            </div>
            {r && (r.faltante > 0 || r.danada > 0) && <p className="mt-1 text-xs font-semibold text-amber-700">{r.faltante > 0 ? `Faltan ${r.faltante}. ` : ''}{r.danada > 0 ? `${r.danada} dañadas no entran al congelador.` : ''}</p>}
          </div>
        );
      })}
      <FormTextarea label={etiquetaNotas} rows={2} value={notas || ''} onChange={e => onNotas(e.target.value)} />
    </div>
  );
}

export function TraspasosPanel({ data, actions, tiendas, cuartos }) {
  const [filtro, setFiltro] = useState('en_transito');
  const [tiendaId, setTiendaId] = useState('');
  const [c, setC] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [modal, setModal] = useState(null);                 // { tipo, t }
  const [f, setF] = useState({});
  const opId = useRef(null);
  const nuevo = () => ({ direccion: 'abasto', tiendaId: '', cuartoCedis: '', cuartoTienda: '', lineas: [{ sku: '', cantidad: '' }], responsable: '', notas: '' });

  const cargar = useCallback(async () => {
    const r = await actions.traspasosConsulta({ establecimientoId: tiendaId ? Number(tiendaId) : null, estado: filtro });
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setC(r.data);
  }, [actions, filtro, tiendaId]);
  useEffect(() => { cargar(); }, [cargar]);

  const activas = useMemo(() => (tiendas || []).filter(t => t.activo !== false), [tiendas]);
  const productos = useMemo(() => (data?.productos || []).filter(p => p.tipo === 'Producto Terminado').sort((a, b) => String(a.nombre).localeCompare(String(b.nombre))), [data?.productos]);
  const cuartosDe = useCallback((estId) => (cuartos || []).filter(q => String(q.establecimiento_id) === String(estId)), [cuartos]);

  const abrir = (tipo, t = null, inicial = {}) => { opId.current = nuevaOperacionId(); setF(inicial); setAviso(null); setModal({ tipo, t }); };
  const cerrar = () => { if (!ocupado) setModal(null); };
  const ejecutar = async (llamada) => {
    if (ocupado) return;
    setOcupado(true);
    const r = await llamada();
    setOcupado(false);
    if (r?.error) { setAviso({ tono: 'error', texto: r.incierto ? 'No hubo respuesta del servidor. Vuelve a tocar el botón: no se hará dos veces.' : r.error }); return; }
    setAviso(null); setModal(null);
    await cargar();
  };

  const crear = () => {
    const built = construirTraspaso({ operacionId: opId.current, direccion: f.direccion, tiendaId: f.tiendaId ? Number(f.tiendaId) : null, cuartoCedis: f.cuartoCedis, cuartoTienda: f.cuartoTienda,
      lineas: f.lineas, responsable: f.responsable, notas: f.notas });
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    ejecutar(() => actions.crearTraspaso(built.args));
  };
  const despachar = () => ejecutar(() => actions.despacharTraspaso({ p_operacion_id: opId.current, p_traspaso_id: modal.t.traspaso_id }));
  const cancelar = () => ejecutar(() => actions.cancelarTraspaso({ p_operacion_id: opId.current, p_traspaso_id: modal.t.traspaso_id, p_motivo: f.motivo || '' }));
  const cerrarIncidencia = () => ejecutar(() => actions.cerrarIncidenciaTraspaso({ p_operacion_id: opId.current, p_traspaso_id: modal.t.traspaso_id, p_resolucion: f.motivo || '' }));
  const recibir = (retorno) => {
    const built = construirRecepcion(modal.t, f.capturas, f.notas);
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    if (retorno) {
      if (String(f.notas || '').trim().length < 5) { setAviso({ tono: 'error', texto: 'Escribe por qué regresó el producto.' }); return; }
      return ejecutar(() => actions.retornarTraspaso({ p_operacion_id: opId.current, p_traspaso_id: modal.t.traspaso_id, p_items: built.items, p_motivo: String(f.notas).trim() }));
    }
    return ejecutar(() => actions.recibirTraspaso({ p_operacion_id: opId.current, p_traspaso_id: modal.t.traspaso_id, p_items: built.items, p_notas: built.notas }));
  };
  const onAccion = (tipo, t) => abrir(tipo, t, tipo === 'recibir' || tipo === 'retornar' ? { capturas: {}, notas: '' } : { motivo: '' });

  const r = c?.resumen || {};
  const etiquetas = { pendiente: r.pendientes, en_transito: r.en_transito, recibido: r.recibidos, incidencias: r.incidencias_abiertas, retornado: r.retornados, cancelado: r.cancelados };
  const enCamino = Object.entries(c?.en_camino || {});

  return (
    <div className="space-y-3" data-testid="traspasos-panel">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div className="max-w-xs flex-1">
          <FormSelect label="Tienda" value={tiendaId} onChange={e => setTiendaId(e.target.value)} options={[{ value: '', label: 'Todas' }, ...activas.map(t => ({ value: String(t.id), label: t.nombre }))]} />
        </div>
        <FormBtn primary onClick={() => abrir('crear', null, nuevo())} disabled={activas.length === 0}>Nuevo traspaso</FormBtn>
      </div>
      {activas.length === 0 && <AvisoPos tono="aviso">Para traspasar producto primero tiene que existir una tienda activa (pestaña Configuración).</AvisoPos>}
      {enCamino.length > 0 && <AvisoPos tono="aviso" testid="traspasos-en-camino">En camino (ya salió y todavía no llega): {enCamino.map(([sku, q]) => `${q} ${sku}`).join(' · ')}</AvisoPos>}
      {aviso && !modal && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
      <Chips items={ESTADOS_TRASPASO.map(e => ({ id: e.id, label: `${e.label}${etiquetas[e.id] ? ` (${etiquetas[e.id]})` : ''}` }))} value={filtro} onChange={setFiltro} />
      <Card padding="p-0">
        <div className="divide-y divide-slate-100" data-testid="traspasos-lista">
          {(c?.traspasos || []).map(t => <FilaTraspaso key={t.traspaso_id} t={t} acciones={accionesTraspaso(t, { admin: true })} onAccion={onAccion} />)}
          {c && (c.traspasos || []).length === 0 && <p className="p-4 text-sm text-slate-500">No hay traspasos en esta lista.</p>}
          {!c && <p className="p-4 text-sm text-slate-500">Cargando…</p>}
        </div>
      </Card>
      {tiendaId && (c?.movimientos || []).length > 0 && (
        <Card>
          <SectionLabel>Movimientos de inventario por traspaso</SectionLabel>
          <div className="mt-2 space-y-1" data-testid="traspasos-movimientos">
            {c.movimientos.slice(0, 30).map((m, i) => <p key={i} className="text-sm text-slate-600">{hora(m.fecha)} · {m.tipo} · {m.cantidad} {m.sku} · {m.cuarto_id} · {String(m.referencia || '').replace('traspaso/', '')}</p>)}
          </div>
        </Card>
      )}

      {modal?.tipo === 'crear' && (
        <Modal open onClose={cerrar} title="Nuevo traspaso" kicker="Abastecimiento" wide
          footer={<><FormBtn onClick={cerrar}>Cancelar</FormBtn><FormBtn primary onClick={crear} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Crear traspaso'}</FormBtn></>}>
          <div className="space-y-3" data-testid="traspaso-nuevo">
            <FormSelect label="¿Hacia dónde va el producto?" value={f.direccion} onChange={e => setF(x => ({ ...x, direccion: e.target.value }))}
              options={[{ value: 'abasto', label: 'Del CEDIS a la tienda (abasto)' }, { value: 'devolucion', label: 'De la tienda al CEDIS (devolución)' }]} />
            <FormSelect label="Tienda" value={f.tiendaId} onChange={e => setF(x => ({ ...x, tiendaId: e.target.value, cuartoTienda: '' }))}
              options={[{ value: '', label: 'Elige la tienda' }, ...activas.map(t => ({ value: String(t.id), label: t.nombre }))]} />
            <div className="grid gap-2 md:grid-cols-2">
              <FormSelect label="Cuarto del CEDIS" value={f.cuartoCedis} onChange={e => setF(x => ({ ...x, cuartoCedis: e.target.value }))}
                options={[{ value: '', label: 'Elige el cuarto' }, ...cuartosDe(CEDIS_ID).map(q => ({ value: q.id, label: `${q.nombre} (${q.id})` }))]} />
              <FormSelect label="Congelador de la tienda" value={f.cuartoTienda} onChange={e => setF(x => ({ ...x, cuartoTienda: e.target.value }))}
                options={[{ value: '', label: f.tiendaId ? 'Elige el congelador' : 'Primero elige la tienda' }, ...cuartosDe(f.tiendaId).map(q => ({ value: q.id, label: `${q.nombre} (${q.id})` }))]} />
            </div>
            {(f.lineas || []).map((l, i) => (
              <div key={i} className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
                <FormSelect label={i === 0 ? 'Producto' : undefined} value={l.sku} onChange={e => setF(x => ({ ...x, lineas: x.lineas.map((y, j) => (j === i ? { ...y, sku: e.target.value } : y)) }))}
                  options={[{ value: '', label: 'Elige el producto' }, ...productos.map(p => ({ value: p.sku, label: p.nombre }))]} />
                <FormInput label={i === 0 ? 'Cantidad' : undefined} inputMode="numeric" value={l.cantidad} onChange={e => setF(x => ({ ...x, lineas: x.lineas.map((y, j) => (j === i ? { ...y, cantidad: e.target.value } : y)) }))} />
              </div>
            ))}
            <FormBtn onClick={() => setF(x => ({ ...x, lineas: [...x.lineas, { sku: '', cantidad: '' }] }))}>Agregar otro producto</FormBtn>
            <FormInput label="Quién lo transporta" value={f.responsable || ''} onChange={e => setF(x => ({ ...x, responsable: e.target.value }))} maxLength={80} />
            <FormTextarea label="Notas (opcional)" rows={2} value={f.notas || ''} onChange={e => setF(x => ({ ...x, notas: e.target.value }))} />
            <p className="text-xs text-slate-500">Crear el traspaso no mueve inventario. El producto sale al despacharlo y entra a su destino al recibirlo.</p>
            {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
          </div>
        </Modal>
      )}

      <Modal open={modal?.tipo === 'despachar'} onClose={cerrar} title={`Despachar ${modal?.t?.folio || ''}`} kicker="Abastecimiento"
        footer={<><FormBtn onClick={cerrar}>Volver</FormBtn><FormBtn primary onClick={despachar} disabled={ocupado}>{ocupado ? 'Despachando…' : 'Sí, ya salió'}</FormBtn></>}>
        <p className="text-sm text-slate-700">Se descuenta el producto de <strong>{modal?.t?.origen?.cuarto_id}</strong> y queda <strong>en tránsito</strong>. No entra a {modal?.t?.destino?.nombre} hasta que lo reciban. Un traspaso despachado ya no se cancela.</p>
        {aviso && <div className="mt-3"><AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos></div>}
      </Modal>

      <Modal open={modal?.tipo === 'cancelar' || modal?.tipo === 'incidencia'} onClose={cerrar} title={`${modal?.tipo === 'incidencia' ? 'Cerrar incidencia de' : 'Cancelar'} ${modal?.t?.folio || ''}`} kicker="Abastecimiento"
        footer={<><FormBtn onClick={cerrar}>Volver</FormBtn><FormBtn danger={modal?.tipo === 'cancelar'} warning={modal?.tipo === 'incidencia'} onClick={modal?.tipo === 'incidencia' ? cerrarIncidencia : cancelar} disabled={ocupado}>{ocupado ? 'Guardando…' : 'Confirmar'}</FormBtn></>}>
        <div className="space-y-3">
          {modal?.tipo === 'incidencia' && <p className="text-sm text-slate-600">Solo deja constancia de cómo se resolvió. No mueve inventario.</p>}
          <FormTextarea label={modal?.tipo === 'incidencia' ? 'Cómo se resolvió' : 'Motivo de la cancelación'} rows={2} value={f.motivo || ''} onChange={e => setF(x => ({ ...x, motivo: e.target.value }))} />
          {aviso && <AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos>}
        </div>
      </Modal>

      {(modal?.tipo === 'recibir' || modal?.tipo === 'retornar') && (
        <Modal open onClose={cerrar} title={`${modal.tipo === 'retornar' ? 'Regresó al origen' : 'Recibir'} ${modal.t.folio}`} kicker={modal.tipo === 'retornar' ? `Vuelve a ${modal.t.origen?.cuarto_id}` : `Entra a ${modal.t.destino?.cuarto_id}`}
          footer={<><FormBtn onClick={cerrar}>Volver</FormBtn><FormBtn success onClick={() => recibir(modal.tipo === 'retornar')} disabled={ocupado}>{ocupado ? 'Guardando…' : modal.tipo === 'retornar' ? 'Registrar retorno' : 'Registrar recepción'}</FormBtn></>}>
          {modal.tipo === 'retornar' && <div className="mb-3"><AvisoPos tono="aviso">El producto no llegó a la tienda y volvió físicamente al origen. Captura lo que regresó.</AvisoPos></div>}
          <RecepcionTraspaso traspaso={modal.t} capturas={f.capturas} onCapturas={v => setF(x => ({ ...x, capturas: v }))} notas={f.notas} onNotas={v => setF(x => ({ ...x, notas: v }))}
            etiquetaNotas={modal.tipo === 'retornar' ? 'Por qué regresó (obligatorio)' : undefined} />
          {aviso && <div className="mt-3"><AvisoPos tono={aviso.tono}>{aviso.texto}</AvisoPos></div>}
        </Modal>
      )}
    </div>
  );
}
