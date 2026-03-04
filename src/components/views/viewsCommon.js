// Shared imports and utilities for all module views
import { useState, useMemo, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { Icons } from '../ui/Icons';
import { StatusBadge, DataTable, PageHeader, CapacityBar } from '../ui/Components';
import Modal, { FormInput, FormSelect, FormBtn, useConfirm } from '../ui/Modal';
import { EmptyState } from '../ui/Skeleton';
import { s, n, money, eqId, fmtDate, fmtDateTime, useDebounce, today } from '../../utils/safe';
import { useToast } from '../ui/Toast';
import { reporteVentas, reporteProduccion, reporteInventario, reporteClientes, reporteRutas, reporteFinanciero } from '../../utils/exportReports';

// Re-export everything for views to consume
export {
  useState, useMemo, useCallback,
  supabase,
  Icons,
  StatusBadge, DataTable, PageHeader, CapacityBar,
  Modal, FormInput, FormSelect, FormBtn, useConfirm,
  EmptyState,
  s, n, money, eqId, fmtDate, fmtDateTime, useDebounce, today,
  useToast,
  reporteVentas, reporteProduccion, reporteInventario, reporteClientes, reporteRutas, reporteFinanciero
};

export const PAGE_SIZE = 50;

// ── Pagination helper ──
export function Paginator({ page, total, onPage }) {
  const pages = Math.ceil(total / PAGE_SIZE);
  if (pages <= 1) return null;
  return (
    <div className="flex items-center justify-between mt-4 pt-3 border-t border-slate-100 gap-2">
      <span className="text-xs text-slate-400 truncate min-w-0">{total} reg. · {page + 1}/{pages}</span>
      <div className="flex gap-1 flex-shrink-0">
        <button disabled={page === 0} onClick={() => onPage(page - 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50 min-h-[44px] md:min-h-0">←</button>
        <button disabled={page >= pages - 1} onClick={() => onPage(page + 1)}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 disabled:opacity-30 hover:bg-slate-50 min-h-[44px] md:min-h-0">→</button>
      </div>
    </div>
  );
}
