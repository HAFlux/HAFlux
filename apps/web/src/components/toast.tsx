import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

export type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** Не auto-dismiss до клика. По умолчанию false (3.5 сек). */
  sticky?: boolean;
}

interface ToastContextValue {
  push: (message: string, kind?: ToastKind, opts?: { sticky?: boolean }) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

const AUTO_DISMISS_MS = 3500;
let nextId = 1;

/**
 * Минимальный toast-runtime. Без зависимостей. Один глобальный stack
 * (нижний правый угол). Тема — монохром, `kind` отличается только префиксом
 * `OK` / `ERR` / `INFO` в cyber-моно стиле.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const remove = useCallback((id: number) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const push = useCallback<ToastContextValue['push']>(
    (message, kind, opts) => {
      const id = nextId++;
      const t: Toast = { id, kind: kind ?? 'info', message, sticky: opts?.sticky };
      setToasts((cur) => [...cur, t]);
      if (!t.sticky) {
        setTimeout(() => remove(id), AUTO_DISMISS_MS);
      }
    },
    [remove],
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      push,
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error', { sticky: true }),
      info: (m) => push(m, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={remove} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast must be used within <ToastProvider>');
  }
  return ctx;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  if (toasts.length === 0) return null;
  return createPortal(
    <div
      aria-live="polite"
      aria-atomic="true"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2"
      style={{ maxWidth: 'min(92vw, 28rem)' }}
    >
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={() => onDismiss(t.id)} />
      ))}
    </div>,
    document.body,
  );
}

function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  // Простая анимация появления через CSS (opacity + translateY)
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const r = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(r);
  }, []);

  const tag = toast.kind === 'success' ? 'OK' : toast.kind === 'error' ? 'ERR' : 'INFO';

  return (
    <button
      type="button"
      onClick={onDismiss}
      className="cyber-card pointer-events-auto flex items-start gap-3 px-4 py-3 text-left transition-all"
      style={{
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(8px)',
        // Хайлайт error через тонкую вторую рамку, не цвет
        boxShadow: toast.kind === 'error' ? '0 0 0 1px var(--color-fg) inset' : undefined,
      }}
    >
      <span className="cyber-label shrink-0" aria-label={tag} style={{ minWidth: '2.5rem' }}>
        [{tag}]
      </span>
      <span className="cyber-mono text-sm leading-snug">{toast.message}</span>
    </button>
  );
}
