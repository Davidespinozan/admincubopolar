import { useEffect } from 'react';
import { useState, FormInput, FormSelect, FormBtn, s, useToast } from './viewsCommon';
import { validarRFC } from '../../utils/safe';
import { REGIMENES_OPTIONS } from '../../data/sat/regimenesFiscales';

export function ConfiguracionView({ data, actions, user }) {
  const toast = useToast();
  const isAdmin = s(user?.rol) === 'Admin';

  // ── Datos de la empresa ──
  const [empresaForm, setEmpresaForm] = useState({
    razonSocial: '', rfc: '', direccionFiscal: '', codigoPostal: '',
    // Mig 056: numero_exterior obligatorio para domicilio fiscal en CFDI 4.0.
    numeroExterior: '', numeroInterior: '',
    telefono: '', correo: '', regimenFiscal: '', logoUrl: '',
  });
  const [empresaSaving, setEmpresaSaving] = useState(false);
  const [empresaErrors, setEmpresaErrors] = useState({});

  useEffect(() => {
    const cfg = data?.configEmpresa;
    if (!cfg) return;
    setEmpresaForm({
      razonSocial: s(cfg.razonSocial),
      rfc: s(cfg.rfc),
      direccionFiscal: s(cfg.direccionFiscal),
      codigoPostal: s(cfg.codigoPostal),
      numeroExterior: s(cfg.numeroExterior),
      numeroInterior: s(cfg.numeroInterior),
      telefono: s(cfg.telefono),
      correo: s(cfg.correo),
      regimenFiscal: s(cfg.regimenFiscal),
      logoUrl: s(cfg.logoUrl),
    });
  }, [data?.configEmpresa]);

  const guardarEmpresa = async () => {
    if (empresaSaving) return;
    const e = {};
    if (!empresaForm.razonSocial.trim()) e.razonSocial = 'Requerida';
    if (!empresaForm.rfc.trim()) e.rfc = 'Requerido';
    // RFC de la empresa emisora NUNCA es genérico SAT.
    else if (!validarRFC(empresaForm.rfc, { permitirGenericos: false })) e.rfc = 'Formato inválido (ej: CPO000000XX0)';
    // Mig 056: número exterior obligatorio para domicilio fiscal en CFDI 4.0.
    if (!empresaForm.numeroExterior?.trim()) e.numeroExterior = 'Requerido';
    if (Object.keys(e).length) { setEmpresaErrors(e); return; }
    setEmpresaErrors({});
    setEmpresaSaving(true);
    try {
      const result = await actions.updateConfigEmpresa?.(empresaForm);
      if (result?.error) {
        toast?.error(result.error);
        return;
      }
      toast?.success('Datos de la empresa actualizados');
    } finally {
      setEmpresaSaving(false);
    }
  };


  return (<div className="space-y-6">

    {/* ── Datos de la empresa ── */}
    {isAdmin && (
      <div className="bg-white border border-slate-100 rounded-2xl p-5">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-800">Datos de la empresa</h2>
          <p className="text-xs text-slate-400">Aparecen en facturas, tickets y reportes. Solo Admin puede editar.</p>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <FormInput label="Razón social *" value={empresaForm.razonSocial} onChange={e => setEmpresaForm(f => ({ ...f, razonSocial: e.target.value }))} error={empresaErrors.razonSocial} placeholder="Cubo Polar S.A. de C.V." />
          <FormInput label="RFC *" value={empresaForm.rfc} onChange={e => setEmpresaForm(f => ({ ...f, rfc: e.target.value.toUpperCase() }))} error={empresaErrors.rfc} maxLength={13} placeholder="CPO000000XX0" />
          <div className="sm:col-span-2">
            <FormInput label="Dirección fiscal" value={empresaForm.direccionFiscal} onChange={e => setEmpresaForm(f => ({ ...f, direccionFiscal: e.target.value }))} placeholder="Av. Revolución, Centro, Culiacán" />
          </div>
          <FormInput label="Número exterior *" value={empresaForm.numeroExterior} onChange={e => setEmpresaForm(f => ({ ...f, numeroExterior: e.target.value }))} error={empresaErrors.numeroExterior} placeholder="Ej. 123" />
          <FormInput label="Número interior" value={empresaForm.numeroInterior} onChange={e => setEmpresaForm(f => ({ ...f, numeroInterior: e.target.value }))} placeholder="Ej. Local 3 (opcional)" />
          <FormInput label="Código postal" value={empresaForm.codigoPostal} onChange={e => setEmpresaForm(f => ({ ...f, codigoPostal: e.target.value }))} maxLength={10} placeholder="80000" />
          <FormInput label="Teléfono" type="tel" value={empresaForm.telefono} onChange={e => setEmpresaForm(f => ({ ...f, telefono: e.target.value }))} placeholder="667 123 4567" />
          <FormInput label="Correo" type="email" value={empresaForm.correo} onChange={e => setEmpresaForm(f => ({ ...f, correo: e.target.value }))} placeholder="contacto@cubopolar.com" />
          <FormSelect label="Régimen fiscal SAT *" options={REGIMENES_OPTIONS} value={empresaForm.regimenFiscal} onChange={e => setEmpresaForm(f => ({ ...f, regimenFiscal: e.target.value }))} />
          <div className="sm:col-span-2">
            <FormInput label="URL del logo (opcional)" value={empresaForm.logoUrl} onChange={e => setEmpresaForm(f => ({ ...f, logoUrl: e.target.value }))} placeholder="https://..." />
          </div>
        </div>
        <div className="flex justify-end mt-4">
          <FormBtn primary onClick={guardarEmpresa} loading={empresaSaving}>Guardar datos de la empresa</FormBtn>
        </div>
      </div>
    )}

  </div>);
}
