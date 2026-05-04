// DireccionForm.jsx — captura de dirección estructurada con número exterior
// obligatorio. Envuelve AddressAutocomplete (Google Places) + inputs
// adicionales para los campos que Google no provee (numero_interior) o que
// pueden faltar (numero_exterior frecuentemente vacío en direcciones imprecisas).
//
// Props:
//   value     - { calle, numero_exterior, numero_interior, colonia, ciudad,
//                 estado, codigo_postal, latitud, longitud }
//   onChange  - (newValue) => void  // siempre con shape completo
//   error     - string|object  // error general o por campo { numero_exterior }
//
// Filosofía: el componente NO valida internamente — eso lo hace el form
// padre antes de guardar (usa validateDireccion de direccionLogic). Aquí
// solo se muestra el error si el padre lo pasa.

import { lazy, Suspense } from 'react';
import { FormInput } from './Modal';

const AddressAutocomplete = lazy(() => import('./AddressAutocomplete'));

const EMPTY = {
  calle: '',
  numero_exterior: '',
  numero_interior: '',
  colonia: '',
  ciudad: '',
  estado: '',
  codigo_postal: '',
  latitud: null,
  longitud: null,
};

export default function DireccionForm({ value, onChange, error = null }) {
  // Normalizamos value: aceptamos null/undefined y exponemos shape completo.
  const v = { ...EMPTY, ...(value || {}) };

  const setField = (field, val) => {
    onChange?.({ ...v, [field]: val });
  };

  const onPlaceSelect = (selection) => {
    // selection = { fullAddress, components, latitud, longitud }
    const c = selection?.components || {};
    onChange?.({
      ...v,
      // Pre-llenar con lo que Google identificó. Si numero_exterior viene
      // null, dejamos el actual (admin puede haberlo capturado a mano antes).
      calle: c.calle ?? v.calle,
      numero_exterior: c.numero_exterior ?? v.numero_exterior,
      colonia: c.colonia ?? v.colonia,
      ciudad: c.ciudad ?? v.ciudad,
      estado: c.estado ?? v.estado,
      codigo_postal: c.codigo_postal ?? v.codigo_postal,
      latitud: selection?.latitud ?? v.latitud,
      longitud: selection?.longitud ?? v.longitud,
    });
  };

  // Error general en banner + error por campo (numero_exterior es el único
  // por-campo que mostramos hoy).
  const errorGeneral = typeof error === 'string' ? error : null;
  const errorNumExt = error && typeof error === 'object' ? error.numero_exterior : null;

  return (
    <div className="space-y-3">
      {errorGeneral && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
          ⚠️ {errorGeneral}
        </div>
      )}

      <Suspense fallback={<p className="text-xs text-slate-400">Cargando autocompletar…</p>}>
        <AddressAutocomplete onSelect={onPlaceSelect} />
      </Suspense>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <FormInput
            label="Calle"
            value={v.calle || ''}
            onChange={e => setField('calle', e.target.value)}
            placeholder="Ej. Av. Revolución"
          />
        </div>
        <FormInput
          label="Número exterior *"
          value={v.numero_exterior || ''}
          onChange={e => setField('numero_exterior', e.target.value)}
          placeholder="Ej. 123"
          error={errorNumExt}
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <FormInput
          label="Número interior"
          value={v.numero_interior || ''}
          onChange={e => setField('numero_interior', e.target.value)}
          placeholder="Ej. Local 3, Depto 4 (opcional)"
        />
        <FormInput
          label="Colonia"
          value={v.colonia || ''}
          onChange={e => setField('colonia', e.target.value)}
          placeholder="Ej. Centro"
        />
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <FormInput
          label="Ciudad"
          value={v.ciudad || ''}
          onChange={e => setField('ciudad', e.target.value)}
          placeholder="Ej. Culiacán"
        />
        <FormInput
          label="Estado"
          value={v.estado || ''}
          onChange={e => setField('estado', e.target.value)}
          placeholder="Ej. Sinaloa"
        />
        <FormInput
          label="Código postal"
          value={v.codigo_postal || ''}
          onChange={e => setField('codigo_postal', e.target.value)}
          placeholder="80000"
          maxLength={5}
        />
      </div>

      {(v.latitud != null || v.longitud != null) && (
        <p className="text-[11px] text-slate-400">
          📍 GPS: {v.latitud != null && v.longitud != null
            ? `${Number(v.latitud).toFixed(5)}, ${Number(v.longitud).toFixed(5)}`
            : 'Sin coordenadas — el chofer no podrá rutear con mapa'}
        </p>
      )}
    </div>
  );
}
