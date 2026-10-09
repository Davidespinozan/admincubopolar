// AsistenciaView — WF-0 + PD-01 (mig 116), solo Admin.
// Día: tabla Empleado | Turno | Entrada | Estado | Salida, evidencia y
// corrección (motivo obligatorio; el valor original y el historial quedan).
// Turnos, centro de trabajo y accesos (empleado ↔ usuario) se configuran aquí;
// nada se inventa: sin centro ni turnos el empleado ve "configuración pendiente".
import { useEffect } from 'react';
import { useState, useCallback, useMemo, Modal, FormInput, FormSelect, FormBtn, PageHeader, EmptyState, Guia, Chips } from './viewsCommon';
import { nuevoOperacionId } from '../../data/stockContratosLogic';
import { FormTextarea } from '../ui/Modal';
import {
  estadoDia, horaNegocio, fechaHoraNegocio, datetimeLocalNegocio, textoTurno, textoDias, horaCorta, enlaceMapa,
  DIAS_SEMANA, GEO_OPCIONES, mensajeErrorGeo, pasosConfigAsistencia,
} from '../../data/asistenciaLogic';
import { diaNegocio } from '../../utils/fechas';

const TONO_CHIP = {
  ok: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  aviso: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-800',
  neutro: 'border-slate-200 bg-slate-50 text-slate-700',
};
const TABS = [
  { k: 'dia', l: 'Día' }, { k: 'turnos', l: 'Turnos' }, { k: 'centro', l: 'Centro de trabajo' }, { k: 'accesos', l: 'Accesos' },
];
const m = (v) => (v == null ? '—' : `${Math.round(Number(v)).toLocaleString('es-MX')} m`);

function Chip({ estado }) {
  const e = estadoDia(estado);
  return <span className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${TONO_CHIP[e.tono]}`}>{e.label}</span>;
}

export function AsistenciaView({ data, actions }) {
  const [tab, setTab] = useState('dia');
  const { cfg, cargar: recargarCfg } = useConfig(actions);
  // La guía se actualiza al cambiar de pestaña (tras guardar centro/turnos/accesos).
  const irA = (k) => { setTab(k); recargarCfg(); };
  const pasos = cfg ? pasosConfigAsistencia({ centros: cfg.centros, turnos: cfg.turnos, empleados: data.empleados }) : null;
  const listo = !!pasos && pasos.every(p => p.hecho);
  return (
    <div>
      <PageHeader title="Asistencia" subtitle="Reloj checador: entradas, salidas, turnos y centro de trabajo" />
      {pasos && (
        <Guia className="mb-4" testid="guia-asistencia"
          titulo={listo ? 'Reloj checador listo' : 'Pon en marcha el reloj checador'}
          pasos={listo ? undefined : pasos.map(p => ({ ...p, onClick: () => irA(p.k) }))}>
          {listo
            ? 'Cada empleado marca su entrada y salida en “Mi asistencia” desde su teléfono, dentro del centro de trabajo. Aquí ves el día y corriges con motivo.'
            : 'Los empleados marcan en “Mi asistencia” desde su teléfono. Antes, completa estos pasos aquí:'}
        </Guia>
      )}
      <Chips className="mb-4" items={TABS} value={tab} onChange={irA} />
      {tab === 'dia' && <Dia actions={actions} />}
      {tab === 'turnos' && <Turnos data={data} actions={actions} />}
      {tab === 'centro' && <Centro actions={actions} />}
      {tab === 'accesos' && <Accesos data={data} actions={actions} />}
    </div>
  );
}

// ── Día ────────────────────────────────────────────────────────────
function Dia({ actions }) {
  const [fecha, setFecha] = useState(diaNegocio());
  const [res, setRes] = useState(null);
  const [error, setError] = useState(null);
  const [detalle, setDetalle] = useState(null);

  const cargar = useCallback(async () => {
    const r = await actions.asistenciaDia(fecha);
    if (r?.error) { setError(r.error); return; }
    setError(null);
    setRes(r.data);
  }, [actions, fecha]);
  useEffect(() => { cargar(); }, [cargar]);

  const filas = res?.empleados || [];
  const sel = detalle ? filas.find(f => f.empleado_id === detalle) : null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48"><FormInput label="Fecha" type="date" value={fecha} onChange={e => setFecha(e.target.value)} /></div>
        <FormBtn onClick={cargar}>Actualizar</FormBtn>
      </div>
      {error && <p className="rounded-[14px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {res && filas.length === 0 && <EmptyState message="No hay empleados activos." />}
      {filas.length > 0 && (
        <div className="overflow-x-auto rounded-[20px] border border-slate-200 bg-white">
          <table className="w-full text-sm" data-testid="asistencia-tabla">
            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
              <tr><th className="px-3 py-2">Empleado</th><th className="px-3 py-2">Turno</th><th className="px-3 py-2">Entrada</th><th className="px-3 py-2">Estado</th><th className="px-3 py-2">Salida</th></tr>
            </thead>
            <tbody>
              {filas.map(f => {
                const a = f.asistencia;
                return (
                  <tr key={f.empleado_id} onClick={() => setDetalle(f.empleado_id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-3 py-2"><p className="font-semibold text-slate-900">{f.nombre}</p><p className="text-xs text-slate-500">{f.puesto}{!f.con_usuario ? ' · sin acceso' : ''}</p></td>
                    <td className="px-3 py-2 whitespace-nowrap">{f.turno ? textoTurno(f.turno) : '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{horaNegocio(a?.entrada_at)}{a?.entrada_estado === 'retardo' ? <span className="ml-1 text-xs text-amber-700">+{a.minutos_retardo} min</span> : null}</td>
                    <td className="px-3 py-2"><Chip estado={f.estado} />{a?.corregida && <span className="ml-1 text-xs text-slate-500">corregida</span>}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{horaNegocio(a?.salida_at)}{a?.salida_at && a?.salida_dentro === false ? <span className="ml-1 text-xs text-amber-700">fuera</span> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <DetalleModal fila={sel} onClose={() => setDetalle(null)} actions={actions} onCorregido={cargar} />
    </div>
  );
}

function DetalleModal({ fila, onClose, actions, onCorregido }) {
  const a = fila?.asistencia;
  const [form, setForm] = useState(null);
  const [error, setError] = useState(null);
  const [enviando, setEnviando] = useState(false);
  useEffect(() => { setForm(null); setError(null); }, [fila?.empleado_id]);

  const abrir = (campo) => {
    setError(null);
    setForm({ campo, local: datetimeLocalNegocio(campo === 'entrada' ? a?.entrada_at : (a?.salida_at || a?.salida_programada)), motivo: '' });
  };
  const guardar = async () => {
    if (enviando) return;
    setEnviando(true);
    const r = await actions.corregirAsistencia({ operacionId: nuevoOperacionId(), asistenciaId: a.id, campo: form.campo, local: form.local, motivo: form.motivo });
    setEnviando(false);
    if (r?.error) { setError(r.error); return; }
    setForm(null);
    onCorregido();
  };

  return (
    <Modal open={!!fila} onClose={onClose} title={fila?.nombre || ''} kicker="Asistencia" wide>
      {fila && (
        <div className="space-y-3 text-sm">
          <p><Chip estado={fila.estado} /> <span className="ml-2 text-slate-500">{fila.turno ? `Turno ${textoTurno(fila.turno)}` : 'Sin turno'}</span></p>
          {fila.intentos > 0 && (
            <p className="rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-amber-900">
              {fila.intentos} intento(s) de entrada rechazado(s); el último: {fila.ultimo_intento === 'fuera_de_rango' ? `fuera del centro (a ${m(fila.ultima_distancia_m)})` : 'precisión insuficiente'}. Los intentos rechazados no guardan coordenadas.
            </p>
          )}
          {!a && <p className="text-slate-500">Sin registro de asistencia este día.</p>}
          {a && (
            <div className="grid gap-3 sm:grid-cols-2">
              <Evidencia titulo="Entrada" ts={a.entrada_at} original={a.entrada_original_at} dist={a.entrada_distancia_m} prec={a.entrada_precision_m}
                lat={a.entrada_lat} lng={a.entrada_lng} extra={a.entrada_estado === 'retardo' ? `Retardo ${a.minutos_retardo} min` : 'A tiempo'} />
              <Evidencia titulo="Salida" ts={a.salida_at} original={a.salida_original_at} dist={a.salida_distancia_m} prec={a.salida_precision_m}
                lat={a.salida_lat} lng={a.salida_lng} extra={a.salida_at ? (a.salida_dentro === false ? 'FUERA del centro de trabajo' : (a.salida_dentro ? 'Dentro del centro' : 'Corregida por Admin')) : 'Sin salida'} />
            </div>
          )}
          {a?.minutos_trabajados != null && <p className="text-slate-600">Tiempo registrado: {Math.floor(a.minutos_trabajados / 60)} h {a.minutos_trabajados % 60} min (informativo; no modifica la nómina).</p>}
          {a && !form && (
            <div className="flex flex-wrap gap-2">
              <FormBtn onClick={() => abrir('entrada')}>Corregir entrada</FormBtn>
              <FormBtn onClick={() => abrir('salida')}>Corregir salida</FormBtn>
            </div>
          )}
          {form && (
            <div className="space-y-3 rounded-[18px] border border-slate-200 bg-slate-50 p-3">
              <p className="font-semibold text-slate-800">Corregir {form.campo} (hora de Mazatlán)</p>
              <FormInput label="Fecha y hora" type="datetime-local" value={form.local} onChange={e => setForm({ ...form, local: e.target.value })} />
              <FormTextarea label="Motivo (obligatorio)" value={form.motivo} onChange={e => setForm({ ...form, motivo: e.target.value })} rows={2} />
              {error && <p className="text-red-700">{error}</p>}
              <div className="flex gap-2">
                <FormBtn primary onClick={guardar} loading={enviando}>Guardar corrección</FormBtn>
                <FormBtn ghost onClick={() => setForm(null)}>Cancelar</FormBtn>
              </div>
              <p className="text-xs text-slate-500">El valor original no se borra: la corrección queda en el historial con tu nombre, la hora y el motivo.</p>
            </div>
          )}
          {a?.correcciones?.length > 0 && (
            <div>
              <p className="mb-1 font-semibold text-slate-800">Historial de correcciones</p>
              <ul className="space-y-1">
                {a.correcciones.map((c, i) => (
                  <li key={i} className="rounded-[12px] border border-slate-200 bg-white p-2 text-xs text-slate-600">
                    {fechaHoraNegocio(c.created_at)} · {c.actor}: {c.campo} {fechaHoraNegocio(c.valor_anterior)} → {fechaHoraNegocio(c.valor_nuevo)} · “{c.motivo}”
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

function Evidencia({ titulo, ts, original, dist, prec, lat, lng, extra }) {
  const url = enlaceMapa(lat, lng);
  return (
    <div className="rounded-[16px] border border-slate-200 bg-white p-3">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">{titulo}</p>
      <p className="mt-1 text-base font-semibold text-slate-900">{horaNegocio(ts)}</p>
      {original && ts && original !== ts && <p className="text-xs text-slate-500">Original: {fechaHoraNegocio(original)}</p>}
      <p className="text-xs text-slate-600">{extra}</p>
      {dist != null && <p className="text-xs text-slate-500">A {m(dist)} del centro · precisión ±{m(prec)}</p>}
      {url && <a href={url} target="_blank" rel="noreferrer" className="text-xs font-semibold text-cyan-700 underline">Ver en mapa</a>}
    </div>
  );
}

// ── Configuración compartida ───────────────────────────────────────
function useConfig(actions) {
  const [cfg, setCfg] = useState(null);
  const [error, setError] = useState(null);
  const cargar = useCallback(async () => {
    const r = await actions.configAsistencia();
    if (r?.error) { setError(r.error); return; }
    setError(null);
    setCfg(r.data);
  }, [actions]);
  useEffect(() => { cargar(); }, [cargar]);
  return { cfg, error, cargar };
}

// ── Centro de trabajo ──────────────────────────────────────────────
function Centro({ actions }) {
  const { cfg, error, cargar } = useConfig(actions);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const [ubicando, setUbicando] = useState(false);

  const usarMiUbicacion = () => {
    if (!navigator.geolocation) { setMsg(mensajeErrorGeo('no_soportado')); return; }
    setUbicando(true);
    navigator.geolocation.getCurrentPosition(p => {
      setUbicando(false);
      setForm(f => ({ ...f, latitud: p.coords.latitude.toFixed(6), longitud: p.coords.longitude.toFixed(6) }));
      setMsg(`Ubicación tomada (precisión ±${Math.round(p.coords.accuracy)} m). Revisa y guarda.`);
    }, e => { setUbicando(false); setMsg(mensajeErrorGeo(e)); }, GEO_OPCIONES);
  };
  const guardar = async () => {
    const r = await actions.guardarCentroTrabajo(form);
    if (r?.error) { setMsg(r.error); return; }
    setForm(null); setMsg(null); cargar();
  };

  const centros = cfg?.centros || [];
  return (
    <div className="space-y-3">
      {error && <p className="rounded-[14px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {cfg && centros.length === 0 && !form && (
        <p className="rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Configuración pendiente: no hay centro de trabajo. Sin él nadie puede marcar asistencia.
        </p>
      )}
      {centros.map(c => (
        <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-slate-200 bg-white p-3 text-sm">
          <div>
            <p className="font-semibold text-slate-900">{c.nombre} {!c.activo && <span className="text-xs text-slate-500">(inactivo)</span>}</p>
            <p className="text-xs text-slate-500">{Number(c.latitud).toFixed(6)}, {Number(c.longitud).toFixed(6)} · radio {c.radio_m} m · precisión máx. ±{c.precision_max_m} m</p>
          </div>
          <FormBtn onClick={() => { setMsg(null); setForm({ ...c }); }}>Editar</FormBtn>
        </div>
      ))}
      {!form && <FormBtn primary onClick={() => { setMsg(null); setForm({ nombre: '', latitud: '', longitud: '', radio_m: 100, precision_max_m: 50, activo: true }); }}>Nuevo centro de trabajo</FormBtn>}
      {form && (
        <div className="space-y-3 rounded-[18px] border border-slate-200 bg-white p-4">
          <FormInput label="Nombre" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
          <div className="grid gap-3 sm:grid-cols-2">
            <FormInput label="Latitud" inputMode="decimal" value={form.latitud} onChange={e => setForm({ ...form, latitud: e.target.value })} />
            <FormInput label="Longitud" inputMode="decimal" value={form.longitud} onChange={e => setForm({ ...form, longitud: e.target.value })} />
            <FormInput label="Radio permitido (m)" type="number" min="10" max="2000" value={form.radio_m} onChange={e => setForm({ ...form, radio_m: e.target.value })} />
            <FormInput label="Precisión máxima del GPS (m)" type="number" min="5" max="500" value={form.precision_max_m} onChange={e => setForm({ ...form, precision_max_m: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo !== false} onChange={e => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
          <FormBtn onClick={usarMiUbicacion} loading={ubicando}>Usar mi ubicación actual</FormBtn>
          {msg && <p className="text-sm text-slate-700">{msg}</p>}
          <div className="flex gap-2"><FormBtn primary onClick={guardar}>Guardar</FormBtn><FormBtn ghost onClick={() => { setForm(null); setMsg(null); }}>Cancelar</FormBtn></div>
          <p className="text-xs text-slate-500">La entrada es válida solo si la precisión del teléfono es igual o mejor que la máxima y la distancia al punto es igual o menor que el radio.</p>
        </div>
      )}
    </div>
  );
}

// ── Turnos ─────────────────────────────────────────────────────────
function Turnos({ data, actions }) {
  const { cfg, error, cargar } = useConfig(actions);
  const [form, setForm] = useState(null);
  const [msg, setMsg] = useState(null);
  const empleados = useMemo(() => (data.empleados || []).filter(e => (e.estatus || 'Activo') === 'Activo'), [data.empleados]);
  const centros = (cfg?.centros || []).filter(c => c.activo);

  const nuevo = () => {
    setMsg(null);
    setForm({ empleado_id: empleados[0]?.id || '', centro_id: centros[0]?.id || '', dias: [1, 2, 3, 4, 5, 6], hora_entrada: '07:00', hora_salida: '15:00', tolerancia_min: 10, vigente_desde: diaNegocio(), vigente_hasta: '', activo: true });
  };
  const guardar = async () => {
    const r = await actions.guardarTurno(form);
    if (r?.error) { setMsg(r.error); return; }
    setForm(null); setMsg(null); cargar();
  };
  const toggleDia = (d) => setForm(f => ({ ...f, dias: f.dias.includes(d) ? f.dias.filter(x => x !== d) : [...f.dias, d] }));

  return (
    <div className="space-y-3">
      {error && <p className="rounded-[14px] border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {cfg && centros.length === 0 && <p className="rounded-[14px] border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Primero configura un centro de trabajo.</p>}
      {(cfg?.turnos || []).map(t => (
        <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-[18px] border border-slate-200 bg-white p-3 text-sm">
          <div>
            <p className="font-semibold text-slate-900">{t.empleado} {!t.activo && <span className="text-xs text-slate-500">(inactivo)</span>}</p>
            <p className="text-xs text-slate-500">{textoTurno(t)} · {textoDias(t.dias)} · tolerancia {t.tolerancia_min} min · desde {t.vigente_desde}{t.vigente_hasta ? ` hasta ${t.vigente_hasta}` : ''}</p>
          </div>
          <FormBtn onClick={() => { setMsg(null); setForm({ ...t, hora_entrada: horaCorta(t.hora_entrada), hora_salida: horaCorta(t.hora_salida), vigente_hasta: t.vigente_hasta || '' }); }}>Editar</FormBtn>
        </div>
      ))}
      {cfg && (cfg.turnos || []).length === 0 && <EmptyState message="Sin turnos: los empleados verán “sin turno (configuración pendiente)”." />}
      {!form && centros.length > 0 && <FormBtn primary onClick={nuevo}>Nuevo turno</FormBtn>}
      {form && (
        <div className="space-y-3 rounded-[18px] border border-slate-200 bg-white p-4">
          <FormSelect label="Empleado" value={form.empleado_id} onChange={e => setForm({ ...form, empleado_id: e.target.value })}
            options={empleados.map(e => ({ value: e.id, label: e.nombre }))} />
          <FormSelect label="Centro de trabajo" value={form.centro_id} onChange={e => setForm({ ...form, centro_id: e.target.value })}
            options={centros.map(c => ({ value: c.id, label: c.nombre }))} />
          <div>
            <p className="mb-1.5 text-sm font-medium text-slate-700">Días</p>
            <div className="flex flex-wrap gap-2">
              {DIAS_SEMANA.map(d => (
                <button key={d.n} type="button" onClick={() => toggleDia(d.n)}
                  className={`min-h-[40px] min-w-[52px] rounded-[12px] px-3 text-sm font-semibold ${form.dias.includes(d.n) ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>{d.corto}</button>
              ))}
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <FormInput label="Entrada" type="time" value={form.hora_entrada} onChange={e => setForm({ ...form, hora_entrada: e.target.value })} />
            <FormInput label="Salida" type="time" value={form.hora_salida} onChange={e => setForm({ ...form, hora_salida: e.target.value })}
              hint="Si es menor que la entrada, el turno termina al día siguiente." />
            <FormInput label="Tolerancia (min)" type="number" min="0" max="120" value={form.tolerancia_min} onChange={e => setForm({ ...form, tolerancia_min: e.target.value })} />
            <FormInput label="Vigente desde" type="date" value={form.vigente_desde} onChange={e => setForm({ ...form, vigente_desde: e.target.value })} />
            <FormInput label="Vigente hasta (opcional)" type="date" value={form.vigente_hasta} onChange={e => setForm({ ...form, vigente_hasta: e.target.value })} />
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.activo !== false} onChange={e => setForm({ ...form, activo: e.target.checked })} /> Activo</label>
          {msg && <p className="text-sm text-red-700">{msg}</p>}
          <div className="flex gap-2"><FormBtn primary onClick={guardar}>Guardar</FormBtn><FormBtn ghost onClick={() => { setForm(null); setMsg(null); }}>Cancelar</FormBtn></div>
        </div>
      )}
    </div>
  );
}

// ── Accesos (WF-0: empleado ↔ usuario, 1 a 1) ──────────────────────
function Accesos({ data, actions }) {
  const empleados = useMemo(() => (data.empleados || []).filter(e => (e.estatus || 'Activo') === 'Activo'), [data.empleados]);
  const usuarios = useMemo(() => (data.usuarios || []).filter(u => u.estatus === 'Activo' && !u.isTestAccount && !u.is_test_account), [data.usuarios]);
  const ligados = new Map((data.empleados || []).filter(e => e.usuarioId).map(e => [String(e.usuarioId), e]));
  const [enviando, setEnviando] = useState(null);

  const cambiar = async (empleado, usuarioId) => {
    setEnviando(empleado.id);
    await actions.vincularEmpleadoUsuario(empleado.id, usuarioId || null);
    setEnviando(null);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600">
        Cada empleado se liga a UN usuario para marcar asistencia con su propio teléfono. Para alguien que solo marca asistencia, crea su usuario con el rol
        <b> Empleado</b> en Ajustes → Usuarios (no ve nada del sistema fuera de “Mi asistencia”).
      </p>
      {empleados.length === 0 && <EmptyState message="No hay empleados activos." />}
      {empleados.map(e => (
        <div key={e.id} className="flex flex-wrap items-end justify-between gap-3 rounded-[18px] border border-slate-200 bg-white p-3 text-sm">
          <div className="min-w-0">
            <p className="font-semibold text-slate-900">{e.nombre}</p>
            <p className="text-xs text-slate-500">{e.puesto}</p>
          </div>
          <div className="w-72 max-w-full">
            <FormSelect label="Usuario del sistema" value={e.usuarioId || ''} disabled={enviando === e.id}
              onChange={ev => cambiar(e, ev.target.value)}
              options={[{ value: '', label: 'Sin acceso' }, ...usuarios
                .filter(u => !ligados.has(String(u.id)) || String(u.id) === String(e.usuarioId))
                .map(u => ({ value: u.id, label: `${u.nombre} (${u.rol})` }))]} />
          </div>
        </div>
      ))}
    </div>
  );
}
