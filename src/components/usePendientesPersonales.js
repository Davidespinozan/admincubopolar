// usePendientesPersonales — lo que le toca a la PERSONA, sea cual sea su rol
// (2026-10-09): su asistencia (mi_asistencia) y sus actividades abiertas
// (calendario, solo mías). Solo lectura; se refresca al volver a la app.
import { useCallback, useEffect, useState } from 'react';
import { recordatorioAsistencia } from '../data/asistenciaLogic';
import { diaNegocio, sumarDias } from '../utils/fechas';

export default function usePendientesPersonales(actions) {
  const [p, setP] = useState({ asistencia: null, actividades: [], cargado: false });

  const cargar = useCallback(async () => {
    const hoy = diaNegocio();
    const [a, c] = await Promise.all([
      typeof actions?.miAsistencia === 'function' ? actions.miAsistencia() : null,
      typeof actions?.calendario === 'function' ? actions.calendario(sumarDias(hoy, -60), sumarDias(hoy, 3), { soloMias: true, soloAbiertas: true }) : null,
    ]);
    setP({
      asistencia: a?.error ? null : recordatorioAsistencia(a?.data),
      actividades: c?.error ? [] : (c?.data?.ocurrencias || []),
      cargado: true,
    });
  }, [actions]);

  useEffect(() => {
    cargar();
    const alVolver = () => { if (document.visibilityState === 'visible') cargar(); };
    document.addEventListener('visibilitychange', alVolver);
    return () => document.removeEventListener('visibilitychange', alVolver);
  }, [cargar]);

  return p;
}
