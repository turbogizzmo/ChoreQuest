/**
 * Floating toast notification system.
 *
 * Usage:
 *   const { showToast } = useToast();
 *   showToast('Quest completed!', 'success');
 *   showToast('Something went wrong.', 'error');
 *   showToast('Checking for updates…', 'info');
 */

import { createContext, useCallback, useContext, useState } from 'react';
import { CheckCircle2, XCircle, Info, X } from 'lucide-react';

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext(null);

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

// ─── Provider ────────────────────────────────────────────────────────────────

let _nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, type = 'info', duration = 4000) => {
    const id = _nextId++;
    setToasts((prev) => {
      // Keep at most 3 toasts visible
      const next = [...prev.slice(-2), { id, message, type }];
      return next;
    });
    setTimeout(() => dismiss(id), duration);
  }, [dismiss]);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

// ─── Toast stack UI ──────────────────────────────────────────────────────────

const STYLES = {
  success: {
    bar: 'bg-surface border border-emerald/40',
    icon: <CheckCircle2 size={16} className="text-emerald flex-shrink-0" />,
    text: 'text-cream',
  },
  error: {
    bar: 'bg-surface border border-crimson/40',
    icon: <XCircle size={16} className="text-crimson flex-shrink-0" />,
    text: 'text-cream',
  },
  info: {
    bar: 'bg-surface border border-accent/40',
    icon: <Info size={16} className="text-accent flex-shrink-0" />,
    text: 'text-cream',
  },
};

function ToastStack({ toasts, onDismiss }) {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-20 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 items-center w-[min(92vw,420px)] pointer-events-none"
      aria-live="polite"
    >
      {toasts.map((toast) => {
        const s = STYLES[toast.type] || STYLES.info;
        return (
          <div
            key={toast.id}
            className={`${s.bar} rounded-xl px-4 py-3 flex items-center gap-3 shadow-lg pointer-events-auto w-full animate-in fade-in slide-in-from-bottom-2 duration-200`}
          >
            {s.icon}
            <p className={`${s.text} text-sm flex-1 leading-snug`}>{toast.message}</p>
            <button
              onClick={() => onDismiss(toast.id)}
              className="text-muted hover:text-cream transition-colors flex-shrink-0 -mr-1"
              aria-label="Dismiss"
            >
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
