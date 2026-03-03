import { useState, useEffect } from 'react';

// ── Null-safe string: ANY non-string value → ""
// PostgreSQL can return: null, undefined, false, 0, [], {}
// All must become "" for safe .toLowerCase()/.includes()
export const s = (v) => (typeof v === 'string' ? v : (v == null ? '' : String(v)));

// ── Null-safe number: null/undefined/NaN/Infinity → 0, clamped
// For stock, precio, cantidad — always ≥ 0
export const n = (v, min = 0, max = 999999) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  return Math.min(max, Math.max(min, num));
};

// ── FIX F1: Centavo-safe rounding for all monetary operations.
// JavaScript floats accumulate errors: 5000.33 * 3 = 15000.990000000002
// This rounds to 2 decimal places using integer math to avoid IEEE 754 drift.
// USE THIS for every saldo, total, precio, pago calculation.
export const centavos = (v) => {
  const num = Number(v);
  if (!Number.isFinite(num)) return 0;
  return Math.round(num * 100) / 100;
};

// ── Monetary parser: "$2,125.50" | "2125.50" | 2125.50 → number
// PostgreSQL numeric/decimal columns come as strings ("2125.50")
// Our mock data has "$2,125" format. Must handle both.
export const money = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const cleaned = String(v ?? '').replace(/[$,\s]/g, '');
  const num = parseFloat(cleaned);
  return Number.isFinite(num) ? num : 0;
};

// ── ID comparison: PostgreSQL serial → int, UUID → string
// Supabase JS client returns numbers for serial PKs but strings for UUIDs.
// form selects always store strings. Comparing 1 === "1" → false.
// eqId(row.id, formValue) handles both.
export const eqId = (a, b) => String(a) === String(b);

// ── Safe array accessor: if Supabase returns null instead of []
export const arr = (v) => (Array.isArray(v) ? v : []);

// ── Today's date formatted DD/MM/YYYY
export const today = () => {
  const d = new Date();
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};

// ── ISO date → display (Supabase returns "2026-03-02T09:15:00.000Z")
export const fmtDate = (v) => {
  if (!v) return '—';
  // Already formatted? (DD/MM/YYYY or similar)
  if (typeof v === 'string' && /^\d{2}\/\d{2}/.test(v)) return v;
  const d = new Date(v);
  if (isNaN(d.getTime())) return s(v); // can't parse, show raw
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
};

// ── ISO datetime → short display
export const fmtDateTime = (v) => {
  if (!v) return '—';
  if (typeof v === 'string' && !/^\d{4}-\d{2}-\d{2}/.test(v)) return s(v); // already formatted
  const d = new Date(v);
  if (isNaN(d.getTime())) return s(v);
  return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")} ${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}`;
};

// ── Debounce hook for search inputs
export function useDebounce(value, delay = 300) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}
