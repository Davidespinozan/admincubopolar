// CamionesPanel — CAM-1 (mig 154). Entregas → "Camiones": la flotilla con su ficha (unidad, número económico, marca,
// modelo, número de serie, placas, estatus, kilometraje, chofer asignado y observaciones), alta y edición. Toda escritura
// pasa por el contrato `guardar_camion` (Administración); la pantalla solo valida lo mismo para avisar antes.
import { useMemo, useState } from 'react';
import { Modal, FormBtn, FormInput, FormSelect, EmptyState, fmtDateTime } from './views/viewsCommon';
import { FormTextarea } from './ui/Modal';
import { ESTATUS_CAMION, formDesdeCamion, validarCamion, choferesAsignables } from '../data/camionesLogic';

const num = (v) => (v == null || v === '' ? '—' : Number(v).toLocaleString('es-MX'));
const TONO = { Activo: 'bg-emerald-50 text-emerald-800', 'En taller': 'bg-amber-50 text-amber-800', Inactivo: 'bg-slate-100 text-slate-600' };

export default function CamionesPanel({ data, actions, puedeEditar = true }) {
  const camiones = useMemo(() => [...(data?.camiones || [])].sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es', { numeric: true })), [data?.camiones]);
  const usuarios = data?.usuarios || [];
  const choferes = useMemo(() => choferesAsignables(usuarios), [usuarios]);
  const nombreUsuario = (id) => usuarios.find(u => String(u.id) === String(id))?.nombre || (id ? `#${id}` : '—');
  const [edicion, setEdicion] = useState(null); // { id, form, errores }
  const [guardando, setGuardando] = useState(false);

  const abrir = (c = null) => setEdicion({ id: c?.id ?? null, form: formDesdeCamion(c), errores: {} });
  const cambiar = (k, v) => setEdicion(e => ({ ...e, form: { ...e.form, [k]: v }, errores: { ...e.errores, [k]: undefined } }));
  const guardar = async () => {
    if (guardando) return;
    const v = validarCamion(edicion.form, { camiones, id: edicion.id });
    if (v.errores) { setEdicion(e => ({ ...e, errores: v.errores })); return; }
    setGuardando(true);
    const r = await actions.guardarCamion({ id: edicion.id, datos: v.datos });
    setGuardando(false);
    if (r?.error) { setEdicion(e => ({ ...e, errores: { general: r.error } })); return; }
    setEdicion(null);
  };

  const f = edicion?.form;
  return (
    <div data-testid="camiones-panel">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm text-slate-600">{camiones.length} camión(es)</p>
        {puedeEditar && <FormBtn primary onClick={() => abrir(null)}>Nuevo camión</FormBtn>}
      </div>
      {camiones.length === 0 ? <EmptyState message="Sin camiones" /> : (
        <div className="overflow-x-auto rounded-2xl border border-slate-100 bg-white">
          <table className="min-w-full text-xs" data-testid="tabla-camiones">
            <thead className="bg-slate-50 text-slate-500 uppercase">
              <tr>{['Unidad', 'No. económico', 'Marca', 'Modelo', 'No. de serie / VIN', 'Placas', 'Estatus', 'Kilometraje', 'Chofer asignado', 'Observaciones', ''].map(h => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>)}</tr>
            </thead>
            <tbody>
              {camiones.map(c => (
                <tr key={c.id} className="border-t border-slate-100 align-top">
                  <td className="px-3 py-2 font-mono">{c.nombre}</td>
                  <td className="px-3 py-2 font-semibold">{c.numeroEconomico ?? c.numero_economico ?? ''}</td>
                  <td className="px-3 py-2">{c.marca}</td>
                  <td className="px-3 py-2">{c.modelo}</td>
                  <td className="px-3 py-2 font-mono">{c.vin}</td>
                  <td className="px-3 py-2 font-mono">{c.placas}</td>
                  <td className="px-3 py-2"><span className={`rounded-md px-2 py-0.5 font-semibold ${TONO[c.estatus] || TONO.Inactivo}`}>{c.estatus}</span></td>
                  <td className="px-3 py-2 text-right whitespace-nowrap" title={c.kilometrajeAt ? `capturado ${fmtDateTime(c.kilometrajeAt)}` : ''}>{num(c.kilometraje)}</td>
                  <td className="px-3 py-2">{c.choferId ?? c.chofer_id ? nombreUsuario(c.choferId ?? c.chofer_id) : '—'}</td>
                  <td className="px-3 py-2 max-w-[220px]">{c.observaciones}</td>
                  <td className="px-3 py-2">{puedeEditar && <FormBtn onClick={() => abrir(c)}>Editar</FormBtn>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={!!edicion} onClose={() => !guardando && setEdicion(null)} title={edicion?.id ? 'Editar camión' : 'Nuevo camión'}>
        {f && (
          <div className="space-y-3" data-testid="form-camion">
            <div className="grid grid-cols-2 gap-2">
              <FormInput label="Unidad *" placeholder="0001" value={f.nombre} error={edicion.errores.nombre} onChange={e => cambiar('nombre', e.target.value)} />
              <FormInput label="No. económico" placeholder="CP01" value={f.numero_economico} error={edicion.errores.numero_economico} onChange={e => cambiar('numero_economico', e.target.value)} />
              <FormInput label="Marca" placeholder="Isuzu" value={f.marca} onChange={e => cambiar('marca', e.target.value)} />
              <FormInput label="Modelo (año)" placeholder="2010" value={f.modelo} onChange={e => cambiar('modelo', e.target.value)} />
            </div>
            <FormInput label="No. de serie / VIN" placeholder="17 caracteres" value={f.vin} error={edicion.errores.vin} onChange={e => cambiar('vin', e.target.value)} />
            <div className="grid grid-cols-2 gap-2">
              <FormInput label="Placas" value={f.placas} error={edicion.errores.placas} onChange={e => cambiar('placas', e.target.value)} />
              <FormSelect label="Estatus" value={f.estatus} error={edicion.errores.estatus} onChange={e => cambiar('estatus', e.target.value)} options={ESTATUS_CAMION} />
              <FormInput label="Kilometraje actual" inputMode="numeric" value={f.kilometraje} error={edicion.errores.kilometraje} onChange={e => cambiar('kilometraje', e.target.value)} />
              <FormSelect label="Chofer asignado" value={f.chofer_id} onChange={e => cambiar('chofer_id', e.target.value)}
                options={[{ value: '', label: 'Sin chofer asignado' }, ...choferes.map(u => ({ value: String(u.id), label: u.nombre }))]} />
            </div>
            <FormTextarea label="Observaciones" rows={2} value={f.observaciones} onChange={e => cambiar('observaciones', e.target.value)} />
            {edicion.errores.general && <p role="alert" className="text-sm font-medium text-red-700 bg-red-50 rounded-lg p-2">{edicion.errores.general}</p>}
            <div className="flex justify-end gap-2">
              <FormBtn onClick={() => setEdicion(null)} disabled={guardando}>Cancelar</FormBtn>
              <FormBtn primary onClick={guardar} loading={guardando}>Guardar</FormBtn>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
