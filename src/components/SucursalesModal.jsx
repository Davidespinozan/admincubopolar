// SucursalesModal — multisucursal (123): sucursales de un cliente.
//
// La principal es el domicilio del cliente (se edita en "Editar cliente"; aquí
// solo su nombre y teléfono). Las demás se crean y editan por el contrato
// guardar_sucursal (Admin / Ventas). Admin puede además fusionar OTRO cliente
// ya existente como sucursal de este (LEVIN JARDINES → LEVIN · Jardines): su
// historia se reapunta y el cliente origen queda inactivo.

import { useState, useMemo, lazy, Suspense } from 'react';
import Modal, { FormInput, FormSelect, FormBtn } from './ui/Modal';
import { Icons } from './ui/Icons';
import { s, eqId } from '../utils/safe';
import { sucursalesDeCliente, buildSucursalPayload, validarSucursal } from '../data/sucursalLogic';

const DireccionForm = lazy(() => import('./ui/DireccionForm'));

const ZONAS = ['', 'Centro', 'Norte', 'Sur', 'Oriente', 'Poniente', 'Industrial', 'Periférico Norte', 'Periférico Sur'];
const FORM_VACIO = {
  nombre: '', calle: '', numero_exterior: '', numero_interior: '', colonia: '', ciudad: 'Durango', estado: 'Durango',
  codigo_postal: '', latitud: null, longitud: null, zona: '', contacto: '', telefono: '', referencia: '', estatus: 'Activa',
};

export default function SucursalesModal({ open, onClose, cliente, data, actions, toast, esAdmin = false }) {
  const [modo, setModo] = useState('lista'); // lista | editar | fusionar
  const [form, setForm] = useState(FORM_VACIO);
  const [editando, setEditando] = useState(null); // sucursal en edición (null = nueva)
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [fusion, setFusion] = useState({ origenId: '', nombre: '' });

  const sucursales = useMemo(
    () => sucursalesDeCliente(data?.sucursales, cliente?.id, { incluirInactivas: true }),
    [data?.sucursales, cliente]
  );
  // Candidatos a fusionar: otros clientes activos, no fusionados, con RFC genérico o igual al de este.
  const candidatos = useMemo(() => {
    if (!cliente) return [];
    const rfc = s(cliente.rfc).toUpperCase();
    return (data?.clientes || [])
      .filter(c => !eqId(c.id, cliente.id) && s(c.estatus) !== 'Inactivo' && !c.fusionado_en)
      .filter(c => { const r = s(c.rfc).toUpperCase(); return !r || r === 'XAXX010101000' || r === 'XEXX010101000' || r === rfc; })
      .sort((a, b) => s(a.nombre).localeCompare(s(b.nombre), 'es'));
  }, [data?.clientes, cliente]);

  const cerrar = () => { if (saving) return; setModo('lista'); setEditando(null); setErrors({}); onClose?.(); };
  const abrirNueva = () => { setForm(FORM_VACIO); setEditando(null); setErrors({}); setModo('editar'); };
  const abrirEditar = (x) => {
    setForm({
      nombre: s(x.nombre), calle: s(x.calle), numero_exterior: s(x.numero_exterior), numero_interior: s(x.numero_interior),
      colonia: s(x.colonia), ciudad: s(x.ciudad) || 'Durango', estado: s(x.estado) || 'Durango', codigo_postal: s(x.codigo_postal),
      latitud: x.latitud ?? null, longitud: x.longitud ?? null, zona: s(x.zona), contacto: s(x.contacto), telefono: s(x.telefono),
      referencia: s(x.referencia), estatus: s(x.estatus) || 'Activa',
    });
    setEditando(x); setErrors({}); setModo('editar');
  };

  const guardar = async () => {
    if (saving) return;
    const e = validarSucursal(form);
    if (Object.keys(e).length) { setErrors(e); return; }
    setSaving(true);
    try {
      const r = await actions.guardarSucursal(editando?.id || null, cliente.id, buildSucursalPayload(form));
      if (r?.error) return;
      toast?.success(editando ? 'Sucursal actualizada' : 'Sucursal creada');
      setModo('lista'); setEditando(null);
    } finally { setSaving(false); }
  };

  const cambiarEstatus = async (x) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await actions.guardarSucursal(x.id, cliente.id, { estatus: s(x.estatus) === 'Inactiva' ? 'Activa' : 'Inactiva' });
      if (!r?.error) toast?.success(s(x.estatus) === 'Inactiva' ? 'Sucursal activada' : 'Sucursal desactivada');
    } finally { setSaving(false); }
  };

  const fusionar = async () => {
    if (saving || !fusion.origenId) { setErrors({ origenId: 'Elige el cliente que pasa a ser sucursal' }); return; }
    const origen = candidatos.find(c => eqId(c.id, fusion.origenId));
    if (!window.confirm(`"${s(origen?.nombre)}" dejará de ser un cliente y pasará a ser la sucursal "${fusion.nombre || s(origen?.nombre)}" de "${s(cliente.nombre)}". Sus ventas, adeudos, pagos y precios se moverán a "${s(cliente.nombre)}". Esta operación no se deshace. ¿Continuar?`)) return;
    setSaving(true);
    try {
      const r = await actions.fusionarClienteEnSucursal(fusion.origenId, cliente.id, fusion.nombre || null);
      if (r?.error) return;
      toast?.success(`Fusionado: ${r.ordenes || 0} ventas, ${r.cxc || 0} adeudos y ${r.precios || 0} precios ahora son de ${s(cliente.nombre)}`);
      setFusion({ origenId: '', nombre: '' }); setErrors({}); setModo('lista');
    } finally { setSaving(false); }
  };

  if (!cliente) return null;
  const titulo = modo === 'lista' ? `Sucursales de ${s(cliente.nombre)}` : modo === 'fusionar' ? 'Fusionar un cliente como sucursal' : (editando ? `Editar sucursal · ${s(editando.nombre)}` : 'Nueva sucursal');

  return (
    <Modal open={!!open} onClose={cerrar} title={titulo} kicker="Clientes" wide>
      {modo === 'lista' && (
        <div className="space-y-3" data-testid="sucursales-lista">
          <p className="text-xs text-slate-500">
            Una sucursal es un punto de entrega con su propia dirección, contacto y zona de ruta. El crédito, el saldo y la factura siguen siendo del cliente.
          </p>
          <div className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {sucursales.map(x => {
              const principal = x.esPrincipal ?? x.es_principal;
              const inactiva = s(x.estatus) === 'Inactiva';
              return (
                <div key={x.id} className={`flex items-start justify-between gap-3 px-3 py-2.5 ${inactiva ? 'opacity-60' : ''}`}>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-slate-800">
                      {s(x.nombre)}
                      {principal && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500">principal</span>}
                      {inactiva && <span className="ml-1.5 rounded-full bg-red-50 px-1.5 py-0.5 text-[10px] font-bold text-red-600">inactiva</span>}
                    </p>
                    <p className="text-xs text-slate-500">{x.direccion || <span className="italic text-slate-400">Sin dirección</span>}</p>
                    {(x.contacto || x.telefono || x.zona) && (
                      <p className="text-[11px] text-slate-400">{[x.contacto, x.telefono, x.zona ? `Zona ${x.zona}` : ''].filter(Boolean).map(s).join(' · ')}</p>
                    )}
                  </div>
                  <div className="flex flex-shrink-0 gap-1">
                    <button onClick={() => abrirEditar(x)} title="Editar" aria-label="Editar sucursal" className="p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-500 hover:text-blue-600 hover:bg-slate-100"><Icons.Edit /></button>
                    {!principal && (
                      <button onClick={() => cambiarEstatus(x)} title={inactiva ? 'Activar' : 'Desactivar'} aria-label={inactiva ? 'Activar sucursal' : 'Desactivar sucursal'} className={`p-2 min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg ${inactiva ? 'text-emerald-600 hover:bg-emerald-50' : 'text-red-500 hover:bg-red-50'}`}>
                        {inactiva ? <Icons.UserCheck /> : <Icons.Pause />}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <FormBtn primary onClick={abrirNueva} className="flex-1"><span className="inline-flex items-center gap-1"><Icons.Plus /> Nueva sucursal</span></FormBtn>
            {esAdmin && candidatos.length > 0 && (
              <FormBtn onClick={() => { setFusion({ origenId: '', nombre: '' }); setErrors({}); setModo('fusionar'); }} className="flex-1">Fusionar un cliente existente</FormBtn>
            )}
          </div>
        </div>
      )}

      {modo === 'editar' && (
        <div className="space-y-3">
          <FormInput label="Nombre de la sucursal *" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} error={errors.nombre} placeholder="Ej: Jardines, Canatlán, Carretera" />
          {editando && (editando.esPrincipal ?? editando.es_principal) ? (
            <p className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500">
              La sucursal principal usa la dirección del cliente. Para cambiarla, edita el cliente (paso "Dirección").
            </p>
          ) : (
            <Suspense fallback={<p className="text-xs text-slate-400">Cargando dirección…</p>}>
              <DireccionForm value={form} onChange={v => setForm(f => ({ ...f, ...v }))} error={errors.codigo_postal ? { codigo_postal: errors.codigo_postal } : null} />
            </Suspense>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {!(editando && (editando.esPrincipal ?? editando.es_principal)) && (
              <FormSelect label="Zona (para agrupar rutas)" options={ZONAS.map(z => ({ value: z, label: z || 'Sin zona' }))} value={form.zona} onChange={e => setForm({ ...form, zona: e.target.value })} />
            )}
            <FormInput label="Teléfono" value={form.telefono} onChange={e => setForm({ ...form, telefono: e.target.value })} placeholder="618 123 4567" />
            {!(editando && (editando.esPrincipal ?? editando.es_principal)) && (
              <FormInput label="Contacto" value={form.contacto} onChange={e => setForm({ ...form, contacto: e.target.value })} placeholder="Quién recibe" />
            )}
            <FormInput label="Referencias para el chofer" value={form.referencia} onChange={e => setForm({ ...form, referencia: e.target.value })} placeholder="Frente al parque" />
          </div>
          {errors.latitud && <p className="text-xs text-red-600">{errors.latitud}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <FormBtn onClick={() => { setModo('lista'); setEditando(null); }}>Cancelar</FormBtn>
            <FormBtn primary onClick={guardar} loading={saving}>{editando ? 'Guardar cambios' : 'Crear sucursal'}</FormBtn>
          </div>
        </div>
      )}

      {modo === 'fusionar' && (
        <div className="space-y-3">
          <p className="text-xs text-slate-500">
            Elige un cliente que en realidad es una sucursal de <b>{s(cliente.nombre)}</b>. Sus ventas, adeudos, pagos y precios especiales pasarán a este cliente; el cliente elegido quedará inactivo. Solo se muestran clientes sin RFC propio (o con el mismo RFC).
          </p>
          <FormSelect label="Cliente que pasa a ser sucursal *" options={[{ value: '', label: 'Seleccionar...' }, ...candidatos.map(c => ({ value: String(c.id), label: s(c.nombre) }))]} value={fusion.origenId} onChange={e => setFusion({ ...fusion, origenId: e.target.value })} error={errors.origenId} />
          <FormInput label="Nombre de la sucursal" value={fusion.nombre} onChange={e => setFusion({ ...fusion, nombre: e.target.value })} placeholder="Si lo dejas vacío, se usa el nombre del cliente elegido" />
          <div className="flex justify-end gap-2 pt-2">
            <FormBtn onClick={() => setModo('lista')}>Cancelar</FormBtn>
            <FormBtn primary onClick={fusionar} loading={saving}>Fusionar</FormBtn>
          </div>
        </div>
      )}
    </Modal>
  );
}
