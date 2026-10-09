// DetalleVentaModal — hoja de detalle de una venta (2026-10-09).
// Solo presenta: productos con precio, total, cobro, pagos, CxC, ruta y
// notas. Las acciones (editar, cancelar, eliminar, devolución, cobrar…) las
// decide la vista que la abre y llegan por `acciones` / `pie`, con los mismos
// manejadores y permisos que ya tenía cada vista.
import Modal from './ui/Modal';
import { StatusBadge, SectionLabel } from './ui/Components';
import { Icons } from './ui/Icons';
import { s, n, fmtMoney, fmtDate } from '../utils/safe';

const Fila = ({ etiqueta, children }) => (
  <div className="flex items-start justify-between gap-3 py-1.5 text-[14px]">
    <span className="flex-shrink-0 text-slate-500">{etiqueta}</span>
    <span className="min-w-0 break-words text-right font-medium text-ink tnum">{children}</span>
  </div>
);

export function lineasDeVenta(orden, productos) {
  const snap = Array.isArray(orden?.preciosSnapshot) ? orden.preciosSnapshot : [];
  if (snap.length > 0) {
    return snap.map(l => {
      const prod = (productos || []).find(p => s(p.sku) === s(l.sku));
      const qty = n(l.qty ?? l.cantidad);
      const unit = n(l.unitPrice ?? l.precio_unit ?? l.precio);
      return { sku: s(l.sku), nombre: prod ? s(prod.nombre) : s(l.sku), qty, unit, total: n(l.lineTotal ?? l.subtotal) || qty * unit };
    });
  }
  // Sin líneas mapeadas: se reconstruye del texto "10×HPC-5K, …" (sin precio).
  return s(orden?.productos).split(',').map(p => p.trim()).filter(Boolean).map(part => {
    const m = part.match(/(\d+)\s*[×x]\s*(\S+)/);
    if (!m) return { sku: part, nombre: part, qty: 0, unit: 0, total: 0 };
    const prod = (productos || []).find(p => s(p.sku) === s(m[2]));
    return { sku: m[2], nombre: prod ? s(prod.nombre) : m[2], qty: n(m[1]), unit: 0, total: 0 };
  });
}

export default function DetalleVentaModal({ orden, data, onClose, acciones, pie }) {
  if (!orden) return null;
  const id = String(orden.id);
  const lineas = lineasDeVenta(orden, data?.productos);
  const pagos = (data?.pagos || []).filter(p => String(p?.ordenId ?? p?.orden_id ?? '') === id);
  const cxc = (data?.cuentasPorCobrar || []).find(c => String(c?.ordenId ?? c?.orden_id ?? '') === id) || null;
  const pagado = pagos.reduce((a, p) => a + n(p.monto), 0);
  const ruta = s(orden.ruta);
  const motivoNoEntrega = s(orden.motivoNoEntrega || orden.motivo_no_entrega);

  return (
    <Modal open onClose={onClose} kicker={s(orden.folio)} title={s(orden.cliente) || 'Venta'} wide footer={pie}>
      <div className="space-y-5" data-testid="detalle-venta">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <StatusBadge status={s(orden.estatus)} />
            <p className="mt-2 text-[13px] text-slate-500">{fmtDate(orden.fecha)}{orden.requiereFactura || orden.requiere_factura ? ' · Requiere factura' : ''}</p>
          </div>
          <div className="text-right">
            <p className="erp-kicker text-slate-500">Total</p>
            <p className="font-display text-[1.75rem] font-bold leading-tight text-ink tnum">{fmtMoney(orden.total)}</p>
          </div>
        </div>

        <section>
          <SectionLabel className="mb-2">Productos</SectionLabel>
          <div className="divide-y divide-line rounded-card border border-line">
            {lineas.length === 0 && <p className="px-4 py-3 text-[13px] text-slate-500">Sin productos registrados.</p>}
            {lineas.map((l, i) => (
              <div key={`${l.sku}-${i}`} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[15px] font-semibold text-ink">{l.nombre}</p>
                  <p className="text-[13px] text-slate-500 tnum">{l.qty.toLocaleString()} × {l.unit > 0 ? fmtMoney(l.unit) : s(l.sku)}</p>
                </div>
                {l.total > 0 && <p className="flex-shrink-0 text-[15px] font-semibold text-ink tnum">{fmtMoney(l.total)}</p>}
              </div>
            ))}
          </div>
        </section>

        <section>
          <SectionLabel className="mb-1">Entrega y cobro</SectionLabel>
          <Fila etiqueta="Entrega">{ruta && ruta !== '—' ? `Ruta ${ruta}` : 'Sin ruta (mostrador o por asignar)'}</Fila>
          {(orden.tipoCobro || orden.tipo_cobro) && <Fila etiqueta="Tipo de cobro">{s(orden.tipoCobro || orden.tipo_cobro)}</Fila>}
          {(orden.metodoPago || orden.metodo_pago) && <Fila etiqueta="Método">{s(orden.metodoPago || orden.metodo_pago)}</Fila>}
          {(orden.folioNota || orden.folio_nota) && <Fila etiqueta="Nota">{s(orden.folioNota || orden.folio_nota)}</Fila>}
          {(orden.direccionEntrega || orden.direccion_entrega) && <Fila etiqueta="Dirección">{s(orden.direccionEntrega || orden.direccion_entrega)}</Fila>}
          {motivoNoEntrega && <Fila etiqueta="No entregada">{motivoNoEntrega}</Fila>}
        </section>

        <section>
          <SectionLabel className="mb-1">Pagos</SectionLabel>
          {pagos.length === 0
            ? <p className="py-1.5 text-[13px] text-slate-500">Sin pagos registrados.</p>
            : pagos.map(p => (
              <Fila key={p.id} etiqueta={`${fmtDate(p.fecha)} · ${s(p.metodoPago || p.metodo_pago) || 'Pago'}`}>{fmtMoney(p.monto)}</Fila>
            ))}
          {pagos.length > 0 && <Fila etiqueta="Pagado">{fmtMoney(pagado)}</Fila>}
          {cxc && (
            <div className="mt-2 rounded-field bg-amber-50 px-3 py-2.5 text-[13px] text-amber-900">
              <p className="font-semibold">Crédito: saldo {fmtMoney(cxc.saldoPendiente ?? cxc.saldo_pendiente)}</p>
              <p className="opacity-80">Vence {fmtDate(cxc.fechaVencimiento ?? cxc.fecha_vencimiento)} · {s(cxc.estatus)}</p>
            </div>
          )}
        </section>

        {acciones && acciones.length > 0 && (
          <section>
            <SectionLabel className="mb-2">Acciones</SectionLabel>
            <div className="divide-y divide-line overflow-hidden rounded-card border border-line">
              {acciones.map(a => (
                <button key={a.id} type="button" onClick={a.onClick} disabled={!!a.deshabilitada}
                  className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors active:bg-slate-50 disabled:cursor-not-allowed ${a.tono === 'peligro' ? 'text-red-700' : a.tono === 'aviso' ? 'text-amber-700' : 'text-ink'}`}
                  data-testid={`detalle-accion-${a.id}`}>
                  <span className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full ${a.deshabilitada ? 'bg-slate-50 text-slate-300' : a.tono === 'peligro' ? 'bg-red-50' : a.tono === 'aviso' ? 'bg-amber-50' : 'bg-slate-100'}`}>
                    {a.icono}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[15px] font-semibold ${a.deshabilitada ? 'text-slate-400' : ''}`}>{a.label}</span>
                    {a.nota && <span className="block text-[12px] text-slate-500">{a.nota}</span>}
                  </span>
                  {!a.deshabilitada && <span className="text-slate-400"><Icons.ChevronRight /></span>}
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </Modal>
  );
}
