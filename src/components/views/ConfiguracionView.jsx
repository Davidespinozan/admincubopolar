import { useEffect } from 'react';
import { useState, FormInput, FormSelect, FormBtn, s, useToast } from './viewsCommon';
import { validarRFC } from '../../utils/safe';
import { REGIMENES_OPTIONS } from '../../data/sat/regimenesFiscales';
import { buildDatosBancarios, datosBancarios, formatoClabe } from '../../data/ticketLogic';

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

  // ── Datos bancarios para transferencias (mig 132): solo los cambia el Dueño ──
  const esDueno = Boolean(user?.esDueno ?? user?.es_dueno);
  const [bancoForm, setBancoForm] = useState({ banco: '', clabe: '', beneficiario: '', cuentaBancaria: '' });
  const [bancoSaving, setBancoSaving] = useState(false);
  const [bancoError, setBancoError] = useState('');
  useEffect(() => {
    const cfg = data?.configEmpresa;
    if (!cfg) return;
    setBancoForm({ banco: s(cfg.banco), clabe: s(cfg.clabe), beneficiario: s(cfg.beneficiario), cuentaBancaria: s(cfg.cuentaBancaria) });
  }, [data?.configEmpresa]);
  const guardarBanco = async () => {
    if (bancoSaving) return;
    const built = buildDatosBancarios(bancoForm);
    if (built.error) { setBancoError(built.error); return; }
    setBancoError('');
    setBancoSaving(true);
    try {
      const r = await actions.updateConfigEmpresa?.(built.datos);
      if (r?.error) { setBancoError(r.error); return; }
      toast?.success('Datos bancarios guardados');
    } finally { setBancoSaving(false); }
  };
  const bancoActual = datosBancarios(data?.configEmpresa);

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

    {/* ── Datos para transferencias ── */}
    {isAdmin && (
      <div className="bg-white border border-slate-100 rounded-2xl p-5" data-testid="datos-bancarios">
        <div className="mb-4">
          <h2 className="text-lg font-bold text-slate-800">Datos para transferencias</h2>
          <p className="text-xs text-slate-400">El vendedor y el chofer se los mandan al cliente por WhatsApp para que pague y regrese su comprobante. Solo el dueño puede cambiarlos.</p>
        </div>
        {esDueno ? (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormInput label="Banco" value={bancoForm.banco} maxLength={60} onChange={e => setBancoForm(f => ({ ...f, banco: e.target.value }))} placeholder="BBVA" />
              <FormInput label="CLABE (18 números)" inputMode="numeric" value={bancoForm.clabe} maxLength={22} onChange={e => setBancoForm(f => ({ ...f, clabe: e.target.value.replace(/[^0-9 ]/g, '') }))} placeholder="012180012345678901" />
              <FormInput label="Beneficiario" value={bancoForm.beneficiario} maxLength={120} onChange={e => setBancoForm(f => ({ ...f, beneficiario: e.target.value }))} placeholder="Como aparece en la cuenta" hint="Vacío = se usa la razón social." />
              <FormInput label="Número de cuenta (opcional)" inputMode="numeric" value={bancoForm.cuentaBancaria} maxLength={30} onChange={e => setBancoForm(f => ({ ...f, cuentaBancaria: e.target.value.replace(/\D/g, '') }))} />
            </div>
            {bancoError && <p className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">{bancoError}</p>}
            <div className="flex justify-end mt-4">
              <FormBtn primary onClick={guardarBanco} loading={bancoSaving}>Guardar datos bancarios</FormBtn>
            </div>
          </>
        ) : bancoActual.completos ? (
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div><dt className="text-xs text-slate-400">Banco</dt><dd className="font-semibold text-slate-800">{bancoActual.banco || '—'}</dd></div>
            <div><dt className="text-xs text-slate-400">CLABE</dt><dd className="font-mono font-semibold text-slate-800">{formatoClabe(bancoActual.clabe)}</dd></div>
            <div><dt className="text-xs text-slate-400">Beneficiario</dt><dd className="font-semibold text-slate-800">{bancoActual.beneficiario || '—'}</dd></div>
          </dl>
        ) : (
          <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">Todavía no hay datos bancarios. Pídele al dueño que los capture aquí.</p>
        )}
      </div>
    )}

  </div>);
}
