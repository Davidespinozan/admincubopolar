import { useState, useCallback, useRef, createContext, useContext } from 'react';
import { Icons } from './Icons';

const ToastCtx = createContext(null);

// El objeto `toast` es estable (useRef): mostrar un aviso no re-renderiza a
// todos los consumidores. El contenedor va en z-[96], por encima de Modal (90)
// y ConfirmDialog (95). Mobile-first: píldora inferior centrada, sobre la
// barra de navegación, con icono SVG según el tipo.
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const add = useCallback((msg, type = "info") => {
    const id = Date.now() + Math.random();
    setToasts(t => [...t, { id, msg, type }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), 3200);
  }, []);

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
      <div className="pointer-events-none fixed inset-x-0 z-[96] flex flex-col items-center gap-2 px-4" style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 84px)" }} aria-live="polite" aria-atomic="true">
        {toasts.map(t => (
          <div key={t.id} role="status"
            className={`pointer-events-auto flex max-w-md items-center gap-2.5 rounded-full px-4 py-3 text-sm font-medium text-white shadow-pop animate-toast-in ${
              t.type === "success" ? "bg-emerald-700" : t.type === "error" ? "bg-red-600" : "bg-ink"}`}>
            <span className="flex-shrink-0 [&>svg]:h-4 [&>svg]:w-4">
              {t.type === "success" ? <Icons.CheckCircle /> : t.type === "error" ? <Icons.XCircle /> : <Icons.Info />}
            </span>
            <span className="min-w-0">{t.msg}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  return useContext(ToastCtx);
}
