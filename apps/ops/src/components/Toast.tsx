import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

type ToastRecord = {
  id: string;
  title: string;
  message: string;
  tone: ToastTone;
};

export type ToastInput = Omit<ToastRecord, 'id'>;

type ToastContextValue = {
  toasts: ToastRecord[];
  showToast: (toast: ToastInput) => string;
  dismissToast: (id: string) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timersRef = useRef(new Map<string, number>());

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);

    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const showToast = useCallback(
    (toast: ToastInput) => {
      const id = createToastId();
      const nextToast: ToastRecord = { id, ...toast };

      setToasts((current) => [...current, nextToast]);

      const timer = window.setTimeout(() => {
        dismissToast(id);
      }, 5000);
      timersRef.current.set(id, timer);

      return id;
    },
    [dismissToast]
  );

  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        window.clearTimeout(timer);
      }

      timersRef.current.clear();
    };
  }, []);

  const value = useMemo<ToastContextValue>(
    () => ({ toasts, showToast, dismissToast }),
    [dismissToast, showToast, toasts]
  );

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error('useToast must be used within a ToastProvider.');
  }

  return context.showToast;
}

export function ToastViewport() {
  const context = useContext(ToastContext);

  if (!context) {
    return null;
  }

  return (
    <div aria-label="Notifications" aria-live="polite" className="toast-viewport">
      {context.toasts.map((toast) => (
        <article
          className={`toast toast-${toast.tone}`}
          key={toast.id}
          role={toast.tone === 'danger' ? 'alert' : 'status'}
        >
          <div className="toast-copy">
            <p className="toast-title">{toast.title}</p>
            <p className="toast-message">{toast.message}</p>
          </div>
          <button
            aria-label="Dismiss notification"
            className="toast-close"
            onClick={() => context.dismissToast(toast.id)}
            type="button"
          >
            x
          </button>
        </article>
      ))}
    </div>
  );
}

function createToastId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
