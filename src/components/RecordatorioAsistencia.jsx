// RecordatorioAsistencia — aviso en la pantalla de inicio de CUALQUIER rol
// (2026-10-09): "Marca tu entrada", "Estás en turno: marca tu salida" o "Te
// faltó marcar una salida". Solo lee mi_asistencia() (sin escrituras ni
// ubicación); el botón lleva a "Mi asistencia", donde se marca. Se actualiza
// al volver a la app (pestaña visible) y cada 5 minutos.
import { useCallback, useEffect, useState } from 'react';
import { Icons } from './ui/Icons';
import { recordatorioAsistencia } from '../data/asistenciaLogic';

const TONO = {
  aviso: { caja: 'border-amber-200 bg-amber-50', icono: 'bg-amber-500 text-white', titulo: 'text-amber-900', detalle: 'text-amber-800/80', boton: 'bg-amber-600 text-white hover:bg-amber-700' },
  ok: { caja: 'border-emerald-200 bg-emerald-50', icono: 'bg-emerald-600 text-white', titulo: 'text-emerald-900', detalle: 'text-emerald-800/80', boton: 'bg-white text-emerald-800 border border-emerald-200 hover:bg-emerald-100' },
  error: { caja: 'border-red-200 bg-red-50', icono: 'bg-red-600 text-white', titulo: 'text-red-900', detalle: 'text-red-800/80', boton: 'bg-white text-red-800 border border-red-200 hover:bg-red-100' },
};

export default function RecordatorioAsistencia({ actions, onIr, className = '', envoltura }) {
  const [aviso, setAviso] = useState(null);

  const cargar = useCallback(async () => {
    if (typeof actions?.miAsistencia !== 'function') return;
    const r = await actions.miAsistencia();
    setAviso(r?.error ? null : recordatorioAsistencia(r?.data));
  }, [actions]);

  useEffect(() => {
    cargar();
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    const cada = setInterval(cargar, 5 * 60 * 1000);
    return () => { document.removeEventListener('visibilitychange', alVolver); clearInterval(cada); };
  }, [cargar]);

  if (!aviso) return null;
  const t = TONO[aviso.tono] || TONO.aviso;
  const tarjeta = (
    <div className={`flex items-center gap-3 rounded-card border p-3.5 ${t.caja} ${className}`} role="status" data-testid="recordatorio-asistencia" data-clave={aviso.clave}>
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full ${t.icono}`}><Icons.Clock /></span>
      <div className="min-w-0 flex-1">
        <p className={`text-[15px] font-semibold ${t.titulo}`}>{aviso.titulo}</p>
        <p className={`text-[13px] leading-snug ${t.detalle}`}>{aviso.detalle}</p>
      </div>
      <button type="button" onClick={onIr} className={`min-h-[44px] flex-shrink-0 rounded-field px-3.5 text-[13px] font-semibold transition-colors ${t.boton}`}>
        {aviso.cta}
      </button>
    </div>
  );
  // `envoltura`: contenedor que solo existe cuando hay aviso (modo enfoque del Chofer).
  return envoltura ? <div className={envoltura}>{tarjeta}</div> : tarjeta;
}
