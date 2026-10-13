// TiendaConfigPanel — Tiendas E6: configuración y activación de una tienda de fábrica (solo Admin).
//
// Cada botón llama a UN contrato de la migración 147; la pantalla no escribe nada por su cuenta.
//   · La tienda nace inactiva y solo se activa con la lista de verificación completa (la calcula el servidor).
//   · Los permisos de inventario son DOS y van separados: "vender desde el CEDIS" (cajero) y
//     "traspasar con el CEDIS" (Producción o Administración). Ninguno viene marcado.
//   · El interruptor general de tiendas no está aquí: lo enciende el dueño.
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, SectionLabel, Guia } from '../ui/Components';
import { FormInput, FormSelect, FormTextarea, FormBtn } from '../ui/Modal';
import { AvisoPos } from '../PosTiendaView';
import { nuevaOperacionId, permisosEnTienda, usuariosAsignables, construirAsignacion, resumenVerificacion, normalizarClave, TIPOS_TIENDA } from '../../data/posLogic';

const hora = (iso) => { try { return iso ? new Date(iso).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : ''; } catch { return ''; } };
const TIPO_EVENTO = { alta: 'Alta', activacion: 'Activación', desactivacion: 'Desactivación' };

export function TiendaConfigPanel({ data, actions, tiendas, tiendasHabilitadas, onCambio }) {
  const [sel, setSel] = useState(null);
  const [estado, setEstado] = useState(null);
  const [aviso, setAviso] = useState(null);
  const [ocupado, setOcupado] = useState(false);
  const [nueva, setNueva] = useState({ clave: '', nombre: '', tipo: 'tienda_fabrica' });
  const [receptores, setReceptores] = useState({});
  const [f, setF] = useState({ cuartoId: '', cuartoNombre: '', caja: '', usuarioId: '', vende: false, traspasa: false, cliente: '', motivo: '' });
  const [confirmarRetiro, setConfirmarRetiro] = useState(null);
  // Un operacion_id por intento de activar o desactivar: sin respuesta, el reintento usa el mismo.
  const opActivar = useRef(null);

  const cargar = useCallback(async (id) => {
    if (!id) { setEstado(null); return; }
    const r = await actions.tiendaEstado(id);
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setEstado(r.data);
    // E7: quién puede recibir traspasos en esta tienda (permiso aparte de los dos del CEDIS).
    const t = await actions.traspasosConsulta({ establecimientoId: id, estado: 'pendiente' });
    setReceptores(Object.fromEntries((t?.data?.receptores || []).map(x => [String(x.usuario_id), !!x.recibe_traspasos])));
  }, [actions]);
  useEffect(() => { cargar(sel); }, [sel, cargar]);

  const tienda = estado?.tienda || null;
  const ver = useMemo(() => resumenVerificacion(estado?.verificacion), [estado]);
  const asignables = useMemo(() => usuariosAsignables(data?.usuarios, estado?.personal), [data?.usuarios, estado?.personal]);
  const usuarioSel = asignables.find(u => String(u.id) === String(f.usuarioId)) || null;
  const permisos = permisosEnTienda(usuarioSel?.rol, tienda?.tipo);
  const elegibles = useMemo(() => new Set((estado?.clientes || []).map(c => String(c.id))), [estado]);
  const candidatos = useMemo(() => {
    const t = f.cliente.trim().toLowerCase();
    if (t.length < 2) return [];
    return (data?.clientes || []).filter(c => (c.estatus ?? 'Activo') === 'Activo' && !(c.fusionadoEn ?? c.fusionado_en) && !elegibles.has(String(c.id))
      && String(c.nombre || '').toLowerCase().includes(t)).slice(0, 8);
  }, [data?.clientes, f.cliente, elegibles]);

  const hacer = async (llamada, alTerminar) => {
    if (ocupado) return null;
    setOcupado(true);
    const r = await llamada();
    setOcupado(false);
    if (r?.error) { setAviso({ tono: 'error', texto: r.incierto ? 'No hubo respuesta del servidor. Revisa el estado de la tienda antes de repetir.' : r.error, codigo: r.codigo }); return r; }
    setAviso(null);
    if (alTerminar) alTerminar(r);
    await cargar(sel);
    onCambio?.();
    return r;
  };

  const crear = () => hacer(() => actions.guardarEstablecimiento({ clave: normalizarClave(nueva.clave), nombre: nueva.nombre, tipo: nueva.tipo }),
    (r) => { setNueva({ clave: '', nombre: '', tipo: 'tienda_fabrica' }); setSel(r.data?.id ?? null); });
  const cambiarRecepcion = (p, valor) => hacer(() => actions.definirRecepcionTienda({ establecimientoId: sel, usuarioId: p.usuario_id, recibe: valor }));
  const asignarCuarto = () => hacer(() => actions.asignarCuartoTienda({ establecimientoId: sel, cuartoId: f.cuartoId.trim(), nombre: f.cuartoNombre.trim() || null }),
    () => setF(x => ({ ...x, cuartoId: '', cuartoNombre: '' })));
  const agregarCaja = () => hacer(() => (tienda?.activo ? actions.guardarCaja({ establecimientoId: sel, nombre: f.caja }) : actions.agregarCajaTienda({ establecimientoId: sel, nombre: f.caja })),
    () => setF(x => ({ ...x, caja: '' })));
  const asignarPersona = () => {
    const built = construirAsignacion({ establecimientoId: sel, usuario: usuarioSel, vendeDesdeCedis: permisos.vende ? !!f.vende : false, traspasaConCedis: permisos.traspasa ? !!f.traspasa : false });
    if (built.error) { setAviso({ tono: 'error', texto: built.error }); return; }
    hacer(() => actions.asignarUsuarioTienda(built.args), () => setF(x => ({ ...x, usuarioId: '', vende: false, traspasa: false })));
  };
  const cambiarPermiso = (p, campo, valor) => hacer(() => actions.asignarUsuarioTienda({ p_establecimiento_id: sel, p_usuario_id: p.usuario_id,
    p_vende_desde_cedis: campo === 'vende' ? valor : !!p.vende_desde_cedis, p_traspasa_con_cedis: campo === 'traspasa' ? valor : !!p.traspasa_con_cedis }));
  const retirar = async (p, confirmar = false) => {
    const r = await hacer(() => actions.retirarUsuarioTienda({ establecimientoId: sel, usuarioId: p.usuario_id, confirmarVentasCentral: confirmar }), () => setConfirmarRetiro(null));
    if (r?.codigo === 'QUEDARIA_VENTAS_CENTRAL') setConfirmarRetiro(p);
  };
  const clientes = (cambio) => hacer(() => actions.configurarClientesTienda({ establecimientoId: sel, ...cambio }), () => setF(x => ({ ...x, cliente: '' })));
  const activar = (encender) => {
    if (!opActivar.current || opActivar.current.encender !== encender || opActivar.current.motivo !== f.motivo) opActivar.current = { id: nuevaOperacionId(), encender, motivo: f.motivo };
    return hacer(() => actions.activarTienda({ p_operacion_id: opActivar.current.id, p_establecimiento_id: sel, p_activar: encender, p_motivo: f.motivo.trim() || null }),
      () => { opActivar.current = null; setF(x => ({ ...x, motivo: '' })); });
  };

  if (!tiendasHabilitadas) {
    return (
      <Guia titulo="Las tiendas propias todavía no están habilitadas" testid="tiendas-no-habilitadas">
        Habilitarlas es una decisión del dueño y se hace una sola vez, fuera de esta pantalla. Mientras no lo haga, no se puede crear ni configurar ninguna tienda.
      </Guia>
    );
  }

  return (
    <div className="grid gap-3 lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="tiendas-config">
      <div className="space-y-3">
        <Card>
          <SectionLabel>Tiendas</SectionLabel>
          <div className="mt-2 space-y-2" data-testid="tiendas-lista">
            {(tiendas || []).map(t => (
              <button key={t.id} type="button" onClick={() => { setAviso(null); setSel(t.id); }}
                className={`block w-full rounded-[14px] border p-3 text-left text-sm ${String(sel) === String(t.id) ? 'border-slate-900 bg-slate-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}>
                <span className="font-semibold text-slate-900">{t.nombre}</span>
                <span className={`ml-2 rounded-full px-2 py-0.5 text-xs ${t.activo ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'}`}>{t.activo ? 'Activa' : t.lista_para_activar ? 'Lista para activar' : 'En configuración'}</span>
                <span className="block text-xs text-slate-500">{t.clave}</span>
              </button>
            ))}
            {(tiendas || []).length === 0 && <p className="text-sm text-slate-500">Todavía no hay tiendas.</p>}
          </div>
        </Card>
        <Card>
          <SectionLabel>Nueva tienda</SectionLabel>
          <div className="mt-2 space-y-2">
            <FormSelect label="Tipo" value={nueva.tipo} onChange={e => setNueva(n => ({ ...n, tipo: e.target.value }))} options={TIPOS_TIENDA.map(t => ({ value: t.id, label: t.label }))} />
            <p className="text-xs text-slate-500">{TIPOS_TIENDA.find(t => t.id === nueva.tipo)?.nota} El tipo no se cambia después.</p>
            <FormInput label="Clave" placeholder="TF-DGO" value={nueva.clave} onChange={e => setNueva(n => ({ ...n, clave: normalizarClave(e.target.value) }))} maxLength={20} hint="No se cambia después." />
            <FormInput label="Nombre" placeholder="Tienda de fábrica" value={nueva.nombre} onChange={e => setNueva(n => ({ ...n, nombre: e.target.value }))} maxLength={80} />
            <FormBtn primary className="w-full" onClick={crear} disabled={ocupado}>Crear (nace inactiva)</FormBtn>
          </div>
        </Card>
      </div>

      <div className="space-y-3">
        {aviso && <AvisoPos tono={aviso.tono} testid="tiendas-config-aviso">{aviso.texto}</AvisoPos>}
        {!tienda ? <Card><p className="text-sm text-slate-500">Elige una tienda para configurarla, o crea una nueva.</p></Card> : (
          <>
            <Card tone={tienda.activo ? 'success' : ver.lista ? undefined : 'warning'}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div><SectionLabel>{tienda.clave} · {TIPOS_TIENDA.find(t => t.id === tienda.tipo)?.label || tienda.tipo}</SectionLabel><p className="font-display text-lg font-bold text-slate-900">{tienda.nombre}</p></div>
                <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tienda.activo ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-700'}`} data-testid="tienda-estado">{tienda.activo ? 'ACTIVA' : 'INACTIVA'}</span>
              </div>
              <div className="mt-3 space-y-1" data-testid="tienda-verificacion">
                {(estado.verificacion || []).map(v => (
                  <p key={v.clave} className={`text-sm ${v.ok ? 'text-slate-600' : v.obligatorio ? 'font-semibold text-red-700' : 'text-amber-700'}`}>
                    {v.ok ? 'Listo' : v.obligatorio ? 'Falta' : 'Aviso'} · {v.texto}
                  </p>
                ))}
              </div>
              <div className="mt-3 space-y-2">
                {tienda.activo && <FormTextarea label="Motivo para desactivar" rows={2} value={f.motivo} onChange={e => setF(x => ({ ...x, motivo: e.target.value }))} />}
                {tienda.activo
                  ? <FormBtn danger onClick={() => activar(false)} disabled={ocupado}>Desactivar tienda</FormBtn>
                  : <FormBtn success onClick={() => activar(true)} disabled={ocupado || !ver.lista}>{ver.lista ? 'Activar tienda' : 'Falta configuración para activar'}</FormBtn>}
                {!tienda.activo && <p className="text-xs text-slate-500">Mientras esté inactiva nadie puede abrir caja, vender ni recibir traspasos en ella.</p>}
              </div>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <SectionLabel>Congeladores</SectionLabel>
                <div className="mt-2 space-y-1">
                  {(estado.cuartos || []).map(c => <p key={c.id} className="text-sm text-slate-700"><span className="font-semibold">{c.nombre}</span> <span className="text-slate-500">({c.id}) · {c.piezas} piezas</span></p>)}
                  {(estado.cuartos || []).length === 0 && <p className="text-sm text-slate-500">Sin congelador.</p>}
                </div>
                <div className="mt-3 space-y-2">
                  <FormInput label="Clave del congelador" placeholder="CF-TF1" value={f.cuartoId} onChange={e => setF(x => ({ ...x, cuartoId: e.target.value }))} maxLength={20} hint="Uno nuevo, o un cuarto VACÍO del CEDIS." />
                  <FormInput label="Nombre (obligatorio si es nuevo)" value={f.cuartoNombre} onChange={e => setF(x => ({ ...x, cuartoNombre: e.target.value }))} maxLength={60} />
                  <FormBtn onClick={asignarCuarto} disabled={ocupado || !f.cuartoId.trim()}>Asignar congelador</FormBtn>
                </div>
              </Card>

              <Card>
                <SectionLabel>Cajas</SectionLabel>
                <div className="mt-2 space-y-1">
                  {(estado.cajas || []).map(c => <p key={c.id} className="text-sm text-slate-700"><span className="font-semibold">{c.nombre}</span> <span className="text-slate-500">{!c.activa ? '· desactivada' : c.turno_abierto ? '· turno abierto' : ''}</span></p>)}
                  {(estado.cajas || []).length === 0 && <p className="text-sm text-slate-500">Sin cajas.</p>}
                </div>
                <div className="mt-3 flex gap-2">
                  <div className="flex-1"><FormInput placeholder="Caja 1" value={f.caja} onChange={e => setF(x => ({ ...x, caja: e.target.value }))} maxLength={60} /></div>
                  <FormBtn onClick={agregarCaja} disabled={ocupado || !f.caja.trim()}>Agregar</FormBtn>
                </div>
              </Card>
            </div>

            <Card>
              <SectionLabel>Personal y permisos de inventario</SectionLabel>
              <p className="mt-1 text-xs text-slate-500">{tienda.tipo === 'tienda_fabrica'
                ? 'Cada permiso es aparte y ninguno se da solo: vender desde el CEDIS es del cajero; traspasar directo con el CEDIS, de Producción o Administración; recibir traspasos, del personal de la tienda.'
                : 'Una tienda remota vende solo su inventario: aquí nadie vende ni traspasa directo con el CEDIS. El único permiso es recibir los traspasos que le llegan, y tampoco se da solo.'}</p>
              <div className="mt-2 divide-y divide-slate-100" data-testid="tienda-personal">
                {(estado.personal || []).map(p => {
                  const pr = permisosEnTienda(p.rol, tienda.tipo);
                  return (
                    <div key={p.usuario_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                      <div><p className="font-semibold text-slate-900">{p.nombre}</p><p className="text-xs text-slate-500">{p.rol === 'Ventas' ? 'Cajero (Ventas de tienda)' : p.rol}{p.turno_abierto ? ' · turno abierto' : ''}{p.estatus !== 'Activo' ? ' · dado de baja' : ''}</p></div>
                      <div className="flex flex-wrap items-center gap-3">
                        {pr.vende && <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!p.vende_desde_cedis} disabled={ocupado} onChange={e => cambiarPermiso(p, 'vende', e.target.checked)} /> Vende desde el CEDIS</label>}
                        {pr.traspasa && <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!p.traspasa_con_cedis} disabled={ocupado} onChange={e => cambiarPermiso(p, 'traspasa', e.target.checked)} /> Traspasa con el CEDIS</label>}
                        {pr.recibe && <label className="flex items-center gap-1 text-xs text-slate-700"><input type="checkbox" checked={!!receptores[String(p.usuario_id)]} disabled={ocupado} onChange={e => cambiarRecepcion(p, e.target.checked)} /> Recibe traspasos</label>}
                        <FormBtn onClick={() => retirar(p)} disabled={ocupado}>Retirar</FormBtn>
                      </div>
                    </div>
                  );
                })}
                {(estado.personal || []).length === 0 && <p className="py-2 text-sm text-slate-500">Nadie asignado.</p>}
              </div>
              {confirmarRetiro && (
                <AvisoPos tono="aviso" testid="tienda-confirmar-retiro">
                  <p><strong>{confirmarRetiro.nombre}</strong> se quedaría sin tienda y volvería a ser <strong>Ventas central</strong>: vería y vendería todo lo central. Si ya no trabaja en la empresa, mejor dalo de baja en Usuarios.</p>
                  <div className="mt-2 flex gap-2"><FormBtn onClick={() => setConfirmarRetiro(null)}>Cancelar</FormBtn><FormBtn warning onClick={() => retirar(confirmarRetiro, true)} disabled={ocupado}>Sí, pasa a Ventas central</FormBtn></div>
                </AvisoPos>
              )}
              <div className="mt-3 grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                <div className="space-y-2">
                  <FormSelect label="Asignar persona" value={f.usuarioId} onChange={e => setF(x => ({ ...x, usuarioId: e.target.value, vende: false, traspasa: false }))}
                    options={[{ value: '', label: 'Elige a la persona' }, ...asignables.map(u => ({ value: String(u.id), label: `${u.nombre} · ${u.rol}` }))]} />
                  {usuarioSel && permisos.vende && (
                    <>
                      <AvisoPos tono="aviso">Al asignarla, esta persona deja de ser Ventas central: solo verá y venderá en su tienda.</AvisoPos>
                      <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!f.vende} onChange={e => setF(x => ({ ...x, vende: e.target.checked }))} /> También puede vender producto del CEDIS</label>
                    </>
                  )}
                  {usuarioSel && permisos.traspasa && (
                    <label className="flex items-center gap-2 text-sm text-slate-700"><input type="checkbox" checked={!!f.traspasa} onChange={e => setF(x => ({ ...x, traspasa: e.target.checked }))} /> Puede traspasar producto entre el CEDIS y esta tienda</label>
                  )}
                </div>
                <div className="self-end"><FormBtn primary onClick={asignarPersona} disabled={ocupado || !usuarioSel}>Asignar</FormBtn></div>
              </div>
            </Card>

            <Card>
              <SectionLabel>Clientes que el punto de venta puede elegir</SectionLabel>
              <div className="mt-2 max-w-sm">
                <FormSelect label="Alcance" value={tienda.clientes_pos} onChange={e => clientes({ modo: e.target.value })} disabled={ocupado}
                  options={[{ value: 'lista', label: 'Solo los de esta lista' }, { value: 'todos', label: 'Cualquier cliente vigente' }]} />
              </div>
              <p className="mt-1 text-xs text-slate-500">El cajero solo ve el nombre del cliente y si se le puede facturar; nunca su RFC, domicilio, saldo o crédito. Sin clientes, la tienda vende al público en general.</p>
              {tienda.clientes_pos === 'lista' && (
                <>
                  <div className="mt-2 space-y-1" data-testid="tienda-clientes">
                    {(estado.clientes || []).map(c => (
                      <div key={c.id} className="flex items-center justify-between gap-2 text-sm">
                        <span className={c.vigente ? 'text-slate-800' : 'text-slate-400 line-through'}>{c.nombre}</span>
                        <button type="button" disabled={ocupado} onClick={() => clientes({ quitar: [c.id] })} className="text-xs font-semibold text-slate-500 underline">Quitar</button>
                      </div>
                    ))}
                    {(estado.clientes || []).length === 0 && <p className="text-sm text-slate-500">Lista vacía.</p>}
                  </div>
                  <div className="mt-2"><FormInput label="Agregar cliente" placeholder="Nombre del cliente" value={f.cliente} onChange={e => setF(x => ({ ...x, cliente: e.target.value }))} /></div>
                  <div className="mt-1 space-y-1">
                    {candidatos.map(c => (
                      <button key={c.id} type="button" disabled={ocupado} onClick={() => clientes({ agregar: [c.id] })} className="block w-full rounded-[12px] border border-slate-200 bg-white p-2 text-left text-sm hover:bg-slate-50">{c.nombre}</button>
                    ))}
                  </div>
                </>
              )}
            </Card>

            <Card>
              <SectionLabel>Historia</SectionLabel>
              <div className="mt-2 space-y-1" data-testid="tienda-historia">
                {(estado.historia || []).map((h, i) => <p key={i} className="text-sm text-slate-600"><span className="font-semibold text-slate-800">{TIPO_EVENTO[h.tipo] || h.tipo}</span> · {hora(h.fecha)} · {h.actor}{h.motivo ? ` — ${h.motivo}` : ''}</p>)}
              </div>
            </Card>
          </>
        )}
      </div>
    </div>
  );
}
