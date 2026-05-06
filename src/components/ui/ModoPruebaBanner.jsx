// ModoPruebaBanner — banner permanente cuando la app está conectada al
// sandbox de Facturama. Tanda 14.
//
// Visible en TOP del shell de cada rol. NO dismissible (no se debe
// poder ocultar: si alguien lo cierra, sigue creyendo que las facturas
// son válidas — exactamente lo que queremos evitar).

import { isSandboxMode } from '../../lib/facturamaMode';

export default function ModoPruebaBanner() {
  if (!isSandboxMode()) return null;
  return (
    <div
      data-testid="modo-prueba-banner"
      role="status"
      aria-live="polite"
      className="w-full bg-amber-500 text-amber-950 text-center px-3 py-2 text-xs sm:text-sm font-semibold shadow-[0_2px_4px_rgba(0,0,0,0.08)] sticky top-0 z-[100]"
    >
      ⚠ <span className="font-bold">MODO PRUEBA</span> — Las facturas generadas no son válidas ante SAT.
    </div>
  );
}
