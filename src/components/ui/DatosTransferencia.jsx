// DatosTransferencia — los datos bancarios de la empresa (mig 132) listos para
// mandárselos al cliente: WhatsApp con banco, CLABE, beneficiario, importe y
// concepto, o copiar. Se usa donde se cobra por transferencia (Chofer, Ventas
// y Admin). Sin CLABE capturada avisa dónde se captura; no inventa datos.
import { datosBancarios, formatoClabe, mensajeTransferencia, enlaceWhatsApp } from '../../data/ticketLogic';
import { useToast } from './Toast';

export default function DatosTransferencia({ config, total, folio, telefono, className = '' }) {
  const toast = useToast();
  const b = datosBancarios(config);
  if (!b.completos) {
    return (
      <p data-testid="datos-transferencia" className={`rounded-field border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 ${className}`}>
        Aún no hay datos bancarios para mandarle al cliente. El dueño los captura en Ajustes → Datos para transferencias.
      </p>
    );
  }
  const msg = mensajeTransferencia(config, { total, folio });
  const copiar = async () => {
    try { await navigator.clipboard.writeText(msg); toast?.success('Datos copiados'); }
    catch { toast?.info('No se pudo copiar: usa WhatsApp'); }
  };
  return (
    <div data-testid="datos-transferencia" className={`rounded-field border border-sky-200 bg-sky-50/70 p-3 ${className}`}>
      <p className="text-xs font-semibold text-sky-900">Datos para que el cliente transfiera</p>
      <p className="mt-0.5 text-sm text-slate-800"><span className="tnum font-mono font-semibold">{formatoClabe(b.clabe)}</span>{b.banco ? ` · ${b.banco}` : ''}</p>
      {b.beneficiario && <p className="truncate text-xs text-slate-600">{b.beneficiario}</p>}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a href={enlaceWhatsApp(telefono, msg)} target="_blank" rel="noopener noreferrer"
          className="flex min-h-[44px] items-center justify-center rounded-field bg-emerald-600 px-3 text-[13px] font-semibold text-white">Enviar por WhatsApp</a>
        <button type="button" onClick={copiar} className="min-h-[44px] rounded-field border border-line bg-white px-3 text-[13px] font-semibold text-ink">Copiar datos</button>
      </div>
    </div>
  );
}
