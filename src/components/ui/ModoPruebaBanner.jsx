// ModoPruebaBanner — banner permanente cuando la app está conectada al
// sandbox de Facturama. Tanda 14 + Tanda 16-fix.
//
// Visible en TOP del shell de cada rol. NO dismissible (no se debe
// poder ocultar: si alguien lo cierra, sigue creyendo que las facturas
// son válidas — exactamente lo que queremos evitar).
//
// Props:
//   - sidebarOffset (bool): true sólo cuando se monta dentro de un
//     shell con sidebar fijo en lg+ (CuboPolarERP). Aplica
//     lg:ml-[300px] xl:ml-[320px] para que el banner NO tape el logo
//     del sidebar. Sin la prop, el banner es full-width (Login,
//     ChoferView, VentasStandaloneView).

import { isSandboxMode } from '../../lib/facturamaMode';

export default function ModoPruebaBanner({ sidebarOffset = false }) {
  if (!isSandboxMode()) return null;
  return (
    <div
      data-testid="modo-prueba-banner"
      role="status"
      aria-live="polite"
      className={[
        'bg-amber-500 text-amber-950 text-center px-3 pb-2 text-xs sm:text-sm font-semibold',
        'shadow-[0_2px_4px_rgba(0,0,0,0.08)] sticky top-0 z-[100]',
        // Tanda 16-fix: en lg+ con sidebar fijo (300px), el banner
        // empieza después del aside para no taparlo.
        sidebarOffset ? 'lg:ml-[300px] xl:ml-[320px]' : 'w-full',
      ].join(' ')}
      style={{
        // Tanda 16-fix: respetar safe-area en iPhone con notch /
        // dynamic island. Mínimo 0.5rem de padding-top para mantener
        // legibilidad cuando no hay notch.
        paddingTop: 'max(env(safe-area-inset-top, 0px), 0.5rem)',
      }}
    >
      ⚠ <span className="font-bold">MODO PRUEBA</span> — Las facturas generadas no son válidas ante SAT.
    </div>
  );
}
