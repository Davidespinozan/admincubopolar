// CalendarioView — PD-02 (mig 118): calendario operativo.
// Admin: calendario completo (Mes / Próximas / Vencidas / Completadas), crear,
// editar solo una ocurrencia, editar de aquí en adelante (versión nueva) y
// desactivar. `personal`: "Mis actividades" (solo lo asignado a la sesión; sin
// edición). Estado, fechas y permisos los decide el servidor (calendario()).
import { useEffect, useRef } from 'react';
import { useState, useCallback, useMemo, Modal, FormInput, FormSelect, FormBtn, PageHeader, EmptyState } from './viewsCommon';
import { FormTextarea } from '../ui/Modal';
import {
  estadoActividad, textoClasificacion, textoRecurrencia, textoResponsable, fechaCorta, rangoVista, filtrarVista, celdasDeMes,
  mesSiguiente, MESES_LARGOS, CATEGORIAS, ROLES_RESPONSABLES, MAQUINAS, mensajeCompletar, formDesdeOcurrencia, claveOcurrencia,
} from '../../data/calendarioLogic';
import { fechaHoraNegocio } from '../../data/asistenciaLogic';
import { diaNegocio } from '../../utils/fechas';

const TONO = {
  neutro: 'border-slate-200 bg-slate-50 text-slate-700',
  amarillo: 'border-amber-300 bg-amber-50 text-amber-900',
  rojo: 'border-red-300 bg-red-50 text-red-800',
  verde: 'border-emerald-300 bg-emerald-50 text-emerald-800',
};
const AVISO = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-900', aviso: 'border-amber-200 bg-amber-50 text-amber-900',
  error: 'border-red-200 bg-red-50 text-red-900', info: 'border-sky-200 bg-sky-50 text-sky-900',
};
const VISTAS = [{ k: 'mes', l: 'Mes' }, { k: 'proximas', l: 'Próximas' }, { k: 'vencidas', l: 'Vencidas' }, { k: 'completadas', l: 'Completadas' }];
const categoriaLabel = (c) => CATEGORIAS.find(x => x.value === c)?.label || c;

function Estado({ o }) {
  const e = estadoActividad(o.estado);
  return <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONO[e.tono]}`} data-estado={o.estado}>{e.label}</span>;
}

export function CalendarioView({ data, actions, personal = false, onVolver }) {
  const [vista, setVista] = useState(personal ? 'proximas' : 'mes');
  const [ym, setYm] = useState(diaNegocio().slice(0, 7));
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [sel, setSel] = useState(null);
  const [form, setForm] = useState(null);

  const cargar = useCallback(async () => {
    // Solo define el rango a pedir; el estado de cada ocurrencia lo calcula el servidor.
    const { desde, hasta } = rangoVista(vista, diaNegocio(), ym);
    const r = await actions.calendario(desde, hasta, { soloMias: personal });
    if (r?.error) { setError(r.error); return; }
    setError(null);
    setRes(r.data);
  }, [actions, vista, ym, personal]);
  useEffect(() => { cargar(); }, [cargar]);

  const esAdmin = !!res?.es_admin && !personal;
  const lista = useMemo(() => filtrarVista(res?.ocurrencias, vista), [res, vista]);
  const actual = sel ? (res?.ocurrencias || []).find(o => claveOcurrencia(o) === sel) : null;

  return (
    <div>
      {onVolver && (
        <button type="button" onClick={onVolver} className="mb-3 inline-flex min-h-[44px] items-center rounded-[14px] border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700">
          ← Volver a mi ruta
        </button>
      )}
      <PageHeader title={personal ? 'Mis actividades' : 'Calendario'}
        subtitle={personal ? 'Lo que tienes asignado: pendientes, próximas y completadas' : 'Mantenimientos, pagos y obligaciones con su ventana de ejecución'}
        action={esAdmin ? () => setForm({ recurrencia: 'mensual', categoria: 'mantenimiento', visibilidad: 'asignado', asignado_puede_completar: true, responsable_tipo: 'ninguno', dia_inicio: 1, dia_fin: 5 }) : undefined}
        actionLabel={esAdmin ? 'Nueva actividad' : undefined} />
      <div className="-mx-3 mb-4 flex gap-2 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0" data-testid="calendario-pestanas">
        {VISTAS.filter(v => !personal || v.k !== 'mes').map(v => (
          <button key={v.k} type="button" onClick={() => setVista(v.k)}
            className={`min-h-[40px] flex-shrink-0 rounded-[14px] px-4 text-sm font-semibold ${vista === v.k ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>
            {v.l}
          </button>
        ))}
      </div>
      {error && <p className="mb-3 rounded-[14px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {vista === 'mes' && res && <Mes ym={ym} setYm={setYm} hoy={res.hoy} ocurrencias={res.ocurrencias} onSel={o => setSel(claveOcurrencia(o))} />}
      {vista === 'mes' && res && (res.ocurrencias || []).length > 0 && (
        <div className="mt-4 space-y-2 sm:hidden" data-testid="calendario-mes-lista">
          {[...res.ocurrencias].sort((a, b) => String(a.ventana_fin).localeCompare(String(b.ventana_fin))).map(o => <Fila key={claveOcurrencia(o)} o={o} onClick={() => setSel(claveOcurrencia(o))} />)}
        </div>
      )}
      {vista !== 'mes' && res && lista.length === 0 && (
        <EmptyState message={vista === 'vencidas' ? 'Nada vencido' : vista === 'completadas' ? 'Sin actividades completadas' : 'Sin actividades próximas'}
          hint={personal ? 'Aquí aparecen solo las actividades que Admin te asigna.' : undefined} />
      )}
      {vista !== 'mes' && lista.length > 0 && (
        <div className="space-y-2" data-testid="calendario-lista">
          {lista.map(o => <Fila key={claveOcurrencia(o)} o={o} onClick={() => setSel(claveOcurrencia(o))} />)}
        </div>
      )}
      <Detalle o={actual} esAdmin={esAdmin} actions={actions} onClose={() => setSel(null)} onCambio={cargar}
        onEditarFuturas={o => { setSel(null); setForm(formDesdeOcurrencia(o)); }} />
      {form && <FormActividad inicial={form} data={data} actions={actions} onClose={() => setForm(null)} onGuardada={() => { setForm(null); cargar(); }} />}
    </div>
  );
}

function Fila({ o, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-start justify-between gap-3 rounded-[18px] border border-slate-200 bg-white p-3 text-left hover:border-slate-300">
      <div className="min-w-0">
        <p className="font-semibold text-slate-900">{o.titulo}</p>
        <p className="text-xs text-slate-500">
          {categoriaLabel(o.categoria)} · {fechaCorta(o.ventana_inicio)} → {fechaCorta(o.ventana_fin)} · {textoResponsable(o)}
          {o.relacionado_etiqueta ? ` · ${o.relacionado_etiqueta}` : ''}
        </p>
        {o.estado === 'completada' && <p className="text-xs text-slate-500">{textoClasificacion(o.clasificacion)} · {o.completada_por}</p>}
      </div>
      <Estado o={o} />
    </button>
  );
}

function Mes({ ym, setYm, hoy, ocurrencias, onSel }) {
  const celdas = celdasDeMes(ym);
  const [y, m] = ym.split('-').map(Number);
  const porDia = useMemo(() => {
    const acc = {};
    for (const o of ocurrencias || []) {
      const dia = String(o.ventana_fin).slice(0, 7) === ym ? o.ventana_fin : o.ventana_inicio;
      (acc[dia] = acc[dia] || []).push(o);
    }
    return acc;
  }, [ocurrencias, ym]);
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <FormBtn onClick={() => setYm(mesSiguiente(ym, -1))}>←</FormBtn>
        <p className="font-display text-lg font-bold capitalize text-slate-900">{MESES_LARGOS[m - 1]} {y}</p>
        <FormBtn onClick={() => setYm(mesSiguiente(ym, 1))}>→</FormBtn>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-semibold uppercase text-slate-400">
        {['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'].map(d => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1" data-testid="calendario-mes">
        {celdas.map((dia, i) => (
          <div key={i} className={`min-h-[64px] rounded-[10px] border p-1 text-left ${dia === hoy ? 'border-slate-900' : 'border-slate-100'} ${dia ? 'bg-white' : 'bg-transparent border-transparent'}`}>
            {dia && <p className="text-[11px] font-semibold text-slate-500">{Number(dia.slice(8))}</p>}
            {(porDia[dia] || []).map(o => (
              <button key={claveOcurrencia(o)} type="button" onClick={() => onSel(o)} title={o.titulo} aria-label={o.titulo}
                className={`mt-0.5 block h-2 w-full rounded-full border sm:h-auto sm:truncate sm:rounded-[6px] sm:px-1 sm:text-left sm:text-[10px] sm:font-semibold ${TONO[estadoActividad(o.estado).tono]}`}>
                <span className="hidden sm:inline">{o.titulo}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-500">Cada actividad aparece en su fecha límite. Gris: próxima · Amarillo: pendiente · Rojo: vencida · Verde: completada.</p>
    </div>
  );
}

function Detalle({ o, esAdmin, actions, onClose, onCambio, onEditarFuturas }) {
  const [notas, setNotas] = useState('');
  const [aviso, setAviso] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const [edit, setEdit] = useState(null);       // { inicio, fin, motivo } | { desactivar: true, motivo }
  const pendiente = useRef(null);
  useEffect(() => { setNotas(''); setAviso(null); setEdit(null); pendiente.current = null; }, [o?.actividad_id, o?.periodo]);
  if (!o) return null;

  const completar = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await actions.completarOcurrencia({ operacionId: pendiente.current || undefined, actividadId: o.actividad_id, periodo: o.periodo, notas });
    setEnviando(false);
    if (r?.error) { pendiente.current = r.red ? r.operacionId : null; setAviso({ tono: 'error', texto: r.error }); return; }
    pendiente.current = null;
    setAviso(mensajeCompletar(r.data));
    onCambio();
  };
  const guardarEdicion = async () => {
    const r = edit.desactivar
      ? await actions.desactivarActividad(o.actividad_id, edit.motivo)
      : await actions.editarOcurrencia({ actividadId: o.actividad_id, periodo: o.periodo, inicio: edit.inicio, fin: edit.fin, motivo: edit.motivo });
    if (r?.error) { setAviso({ tono: 'error', texto: r.error }); return; }
    setEdit(null); onCambio();
  };

  return (
    <Modal open={!!o} onClose={onClose} title={o.titulo} kicker="Actividad" wide>
      <div className="space-y-3 text-sm" data-testid="actividad-detalle">
        <p><Estado o={o} /> {o.estado === 'completada' && <span className="ml-2 text-slate-600">{textoClasificacion(o.clasificacion)}</span>}</p>
        {o.descripcion && <p className="whitespace-pre-line text-slate-700">{o.descripcion}</p>}
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <Dato t="Categoría" v={categoriaLabel(o.categoria)} />
          <Dato t="Responsable" v={textoResponsable(o)} />
          <Dato t="Relacionado" v={o.relacionado_etiqueta ? `${o.relacionado_etiqueta}` : '—'} />
          <Dato t="Ventana de ejecución" v={`${fechaCorta(o.ventana_inicio)} → ${fechaCorta(o.ventana_fin)}`} />
          <Dato t="Fecha límite" v={fechaCorta(o.ventana_fin)} />
          <Dato t="Recurrencia" v={textoRecurrencia(o)} />
          {o.editada && <Dato t="Ventana original" v={`${fechaCorta(o.ventana_inicio_original)} → ${fechaCorta(o.ventana_fin_original)} (editada: ${o.motivo_edicion})`} />}
          {o.estado === 'completada' && <Dato t="Completada" v={`${fechaHoraNegocio(o.completada_at)} · ${o.completada_por}`} />}
          {o.notas && <Dato t="Notas" v={o.notas} />}
          {esAdmin && <Dato t="Visibilidad" v={o.visibilidad === 'admin' ? 'Solo Admin' : 'Responsable y Admin'} />}
        </dl>
        {aviso && <p className={`rounded-[14px] border p-3 ${AVISO[aviso.tono] || AVISO.info}`} role="status">{aviso.texto}</p>}
        {o.puede_completar && (
          <div className="space-y-2 rounded-[18px] border border-slate-200 bg-slate-50 p-3">
            <FormTextarea label="Notas (opcional)" value={notas} onChange={e => setNotas(e.target.value)} rows={2} />
            <FormBtn success size="lg" onClick={completar} loading={enviando}>Completar actividad</FormBtn>
            <p className="text-xs text-slate-500">La hora y la fecha las registra el servidor; si es antes o después de la ventana, queda marcado.</p>
          </div>
        )}
        {esAdmin && !edit && (
          <div className="flex flex-wrap gap-2">
            {o.estado !== 'completada' && <FormBtn onClick={() => setEdit({ inicio: o.ventana_inicio, fin: o.ventana_fin, motivo: '' })}>Editar solo esta</FormBtn>}
            {o.actividad_activa && o.recurrencia !== 'unica' && <FormBtn onClick={() => onEditarFuturas(o)}>Editar de aquí en adelante</FormBtn>}
            {o.actividad_activa && o.recurrencia === 'unica' && o.estado !== 'completada' && <FormBtn onClick={() => onEditarFuturas(o)}>Editar actividad</FormBtn>}
            {o.actividad_activa && <FormBtn danger onClick={() => setEdit({ desactivar: true, motivo: '' })}>Desactivar</FormBtn>}
          </div>
        )}
        {edit && (
          <div className="space-y-2 rounded-[18px] border border-slate-200 bg-white p-3">
            {!edit.desactivar && (
              <div className="grid gap-2 sm:grid-cols-2">
                <FormInput label="Inicio" type="date" value={edit.inicio} onChange={e => setEdit({ ...edit, inicio: e.target.value })} />
                <FormInput label="Fecha límite" type="date" value={edit.fin} onChange={e => setEdit({ ...edit, fin: e.target.value })} />
              </div>
            )}
            <FormTextarea label="Motivo (obligatorio)" value={edit.motivo} onChange={e => setEdit({ ...edit, motivo: e.target.value })} rows={2} />
            <p className="text-xs text-slate-500">{edit.desactivar
              ? 'Deja de generar periodos futuros. Lo ya iniciado, vencido o completado se conserva.'
              : 'Cambia solo este periodo; la ventana original queda registrada.'}</p>
            <div className="flex gap-2">
              <FormBtn primary={!edit.desactivar} danger={edit.desactivar} onClick={guardarEdicion}>{edit.desactivar ? 'Desactivar' : 'Guardar'}</FormBtn>
              <FormBtn ghost onClick={() => setEdit(null)}>Cancelar</FormBtn>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Dato({ t, v }) {
  return (
    <div className="rounded-[12px] bg-slate-50 p-2">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-400">{t}</dt>
      <dd className="text-slate-800">{v}</dd>
    </div>
  );
}

function FormActividad({ inicial, data, actions, onClose, onGuardada }) {
  const [f, setF] = useState(inicial);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  const usuarios = (data.usuarios || []).filter(u => u.estatus === 'Activo' && !u.isTestAccount && !u.is_test_account);
  const editando = !!inicial.id;
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const guardar = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await actions.guardarActividad(inicial.id, f);
    setEnviando(false);
    if (r?.error) { setError(r.error); return; }
    onGuardada();
  };
  const opcionesRel = f.relacionado_tipo === 'camion' ? (data.camiones || []).map(c => ({ value: String(c.id), label: c.nombre }))
    : f.relacionado_tipo === 'costo_fijo' ? (data.costosFijos || []).map(c => ({ value: String(c.id), label: c.nombre }))
    : f.relacionado_tipo === 'maquina' ? MAQUINAS.map(x => ({ value: x, label: x })) : [];
  const dias = Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
  const diasSemana = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'].map((d, i) => ({ value: String(i + 1), label: d }));

  return (
    <Modal open onClose={onClose} title={editando ? 'Editar de aquí en adelante' : 'Nueva actividad'} kicker="Calendario" wide>
      <div className="space-y-3 text-sm">
        {editando && <p className="rounded-[14px] border border-sky-200 bg-sky-50 p-3 text-sky-900">Se crea una versión nueva que aplica a los periodos que todavía no empiezan. Lo ya iniciado o completado no cambia.</p>}
        <FormInput label="Título" value={f.titulo || ''} onChange={set('titulo')} />
        <FormTextarea label="Descripción" value={f.descripcion || ''} onChange={set('descripcion')} rows={2} />
        <div className="grid gap-3 sm:grid-cols-2">
          <FormSelect label="Categoría" value={f.categoria} onChange={set('categoria')} options={CATEGORIAS} />
          <FormSelect label="Recurrencia" value={f.recurrencia} onChange={set('recurrencia')} disabled={editando}
            options={[{ value: 'unica', label: 'Una vez' }, { value: 'semanal', label: 'Semanal' }, { value: 'mensual', label: 'Mensual' }, { value: 'anual', label: 'Anual' }]} />
        </div>
        {f.recurrencia === 'unica' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormInput label="Inicio" type="date" value={f.fecha_inicio || ''} onChange={set('fecha_inicio')} />
            <FormInput label="Fecha límite" type="date" value={f.fecha_fin || ''} onChange={set('fecha_fin')} />
          </div>
        )}
        {f.recurrencia === 'semanal' && (
          <div className="grid gap-3 sm:grid-cols-2">
            <FormSelect label="Desde (día)" value={String(f.dia_semana_inicio || '')} onChange={set('dia_semana_inicio')} options={[{ value: '', label: '—' }, ...diasSemana]} />
            <FormSelect label="Hasta (día límite)" value={String(f.dia_semana_fin || '')} onChange={set('dia_semana_fin')} options={[{ value: '', label: '—' }, ...diasSemana]} />
          </div>
        )}
        {(f.recurrencia === 'mensual' || f.recurrencia === 'anual') && (
          <div className="grid gap-3 sm:grid-cols-3">
            {f.recurrencia === 'anual' && <FormSelect label="Mes" value={String(f.mes || '')} onChange={set('mes')} options={[{ value: '', label: '—' }, ...MESES_LARGOS.map((x, i) => ({ value: String(i + 1), label: x }))]} />}
            <FormSelect label="Desde el día" value={String(f.dia_inicio || '')} onChange={set('dia_inicio')} options={[{ value: '', label: '—' }, ...dias]} />
            <FormSelect label="Hasta el día (límite)" value={String(f.dia_fin || '')} onChange={set('dia_fin')} options={[{ value: '', label: '—' }, ...dias]} />
          </div>
        )}
        {f.recurrencia !== 'unica' && (
          <p className="text-xs text-slate-500">Si el día límite es menor que el de inicio, la ventana termina en el periodo siguiente (por ejemplo 28 → 3). Un día que no existe en el mes se ajusta al último día.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <FormSelect label="Responsable" value={f.responsable_tipo || 'ninguno'} onChange={set('responsable_tipo')}
            options={[{ value: 'ninguno', label: 'Sin responsable (Admin)' }, { value: 'usuario', label: 'Una persona' }, { value: 'rol', label: 'Un rol' }]} />
          {f.responsable_tipo === 'usuario' && <FormSelect label="Persona" value={String(f.responsable_usuario_id || '')} onChange={set('responsable_usuario_id')}
            options={[{ value: '', label: '—' }, ...usuarios.map(u => ({ value: String(u.id), label: `${u.nombre} (${u.rol})` }))]} />}
          {f.responsable_tipo === 'rol' && <FormSelect label="Rol" value={f.responsable_rol || ''} onChange={set('responsable_rol')} options={[{ value: '', label: '—' }, ...ROLES_RESPONSABLES]} />}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <FormSelect label="Relacionado con" value={f.relacionado_tipo || ''} onChange={e => setF({ ...f, relacionado_tipo: e.target.value, relacionado_ref: '' })}
            options={[{ value: '', label: 'Nada' }, { value: 'maquina', label: 'Máquina' }, { value: 'camion', label: 'Camión' }, { value: 'costo_fijo', label: 'Costo fijo' }]} />
          {f.relacionado_tipo && <FormSelect label="Elemento" value={String(f.relacionado_ref || '')} onChange={set('relacionado_ref')} options={[{ value: '', label: '—' }, ...opcionesRel]} />}
        </div>
        <FormSelect label="Visibilidad" value={f.visibilidad} onChange={set('visibilidad')}
          options={[{ value: 'asignado', label: 'El responsable y Admin' }, { value: 'admin', label: 'Solo Admin (pagos, administrativas)' }]} />
        <label className="flex items-center gap-2"><input type="checkbox" checked={f.asignado_puede_completar !== false} onChange={set('asignado_puede_completar')} /> El responsable puede completarla</label>
        {f.recurrencia !== 'unica' && !editando && <FormInput label="Empieza a contar desde (opcional)" type="date" value={f.vigente_desde || ''} onChange={set('vigente_desde')} />}
        <p className="text-xs text-slate-500">Completar una actividad solo registra que se hizo: no crea pagos ni movimientos ni cambia máquinas o camiones.</p>
        {error && <p className="text-red-700">{error}</p>}
        <div className="flex gap-2"><FormBtn primary onClick={guardar} loading={enviando}>Guardar</FormBtn><FormBtn ghost onClick={onClose}>Cancelar</FormBtn></div>
      </div>
    </Modal>
  );
}
