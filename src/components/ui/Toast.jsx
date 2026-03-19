import { useState, useCallback, useRef, createContext, useContext } from 'react';

const ToastCtx = createContext(null);

// ── FIX P2: TOAST CONTEXT RE-RENDER BOMB ──
// BEFORE: `toast` object { success, error, info } was created inline every render.
// New ref on every render → ToastCtx.Provider value changes → EVERY useToast()
// consumer re-renders. With 8 views calling useToast(), every toast display
// re-rendered the entire app.
//
// AFTER: toast object is stable via useRef. Only the render container uses
// the toasts array state. Consumer components get a stable ref that never changes.

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3000);
  }, []);

  // Stable ref — never changes identity
  const toastRef = useRef(null);
  if (!toastRef.current) {
    toastRef.current = {
      success: (m) => add(m, "success"),
      error: (m) => add(m, "error"),
      info: (m) => add(m, "info"),
    };
  }

  return (
    <ToastCtx.Provider value={toastRef.current}>
      {children}
      <div className="fixed top-16 right-4 left-4 sm:left-auto z-[60] space-y-2 sm:w-72 pointer-events-none" aria-live="polite" aria-atomic="true">
        {toasts.map(t => (
          <div key={t.id} className={`pointer-events-auto px-4 py-3 rounded-xl shadow-lg text-sm font-medium animate-slide-in ${
            t.type === "success" ? "bg-emerald-600 text-white" :
            t.type === "error" ? "bg-red-600 text-white" :
            "bg-slate-800 text-white"
          }`} role="status">
            {t.msg}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
