// ModoPruebaBanner — banner permanente cuando la app está conectada al
// sandbox de Facturama. Tanda 14 + 16-fix + 19-fix.
//
// Visible en TOP del shell de cada rol. NO dismissible.
//
// Props:
//   - sidebarOffset (bool): true sólo cuando se monta dentro de un
//     shell con sidebar fijo en lg+ (CuboPolarERP). En mobile el banner
//     SIEMPRE es full-width; en lg+ se recalcula `width` para no taparse
//     contra el aside fijo de 300px (xl: 320px). 19-fix: antes el banner
//     desaparecía en mobile porque solo tenía `lg:ml-[300px]` (sin
//     `w-full` por default).

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
        // SIEMPRE full width en mobile.
        'w-full',
        // En lg+ con sidebar, mover y recalcular ancho para no taparse
        // ni desbordar el viewport (ml + width sumadas = 100%).
        sidebarOffset
          ? 'lg:ml-[300px] lg:w-[calc(100%-300px)] xl:ml-[320px] xl:w-[calc(100%-320px)]'
          : '',
      ].join(' ')}
      style={{
        // Tanda 16-fix: respetar safe-area en iPhone con notch /
        // Dynamic Island. Mínimo 0.5rem cuando no hay safe-area
        // (Android, desktop).
        paddingTop: 'max(env(safe-area-inset-top, 0px), 0.5rem)',
      }}
    >
      ⚠ <span className="font-bold">MODO PRUEBA</span> — Las facturas generadas no son válidas ante SAT.
    </div>
  );
}
