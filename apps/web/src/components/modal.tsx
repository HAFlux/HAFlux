import { type ReactNode, useEffect } from 'react';
import { createPortal } from 'react-dom';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  /** Кнопки в футере (если null — нет футера). */
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZE_CLASS: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-3xl',
};

/**
 * Cyberpunk-стилизованная модалка. Без HeroUI Collection-API: чистый
 * portal + bg/fg CSS-vars + cyber-card стиль.
 */
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="haflux-modal-backdrop absolute inset-0"
        style={{
          background: 'color-mix(in srgb, var(--color-bg) 70%, transparent)',
          backdropFilter: 'blur(4px)',
        }}
      />
      <div
        className={`haflux-modal-panel relative cyber-card w-full ${SIZE_CLASS[size]} flex min-h-0 flex-col`}
        style={{ maxHeight: 'calc(100vh - 2rem)' }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header — фиксированный, не скроллится */}
        <div
          className="flex shrink-0 items-start justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6 sm:py-4"
          style={{ borderBottom: '1px solid var(--color-separator)' }}
        >
          <div className="flex min-w-0 flex-col gap-1">
            <span className="cyber-label">{'// modal'}</span>
            <h2 className="cyber-heading text-base sm:text-lg">{title}</h2>
            {description && (
              <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="cyber-mono shrink-0 text-lg"
            style={{ color: 'var(--color-muted)' }}
            onClick={onClose}
          >
            ✕
          </button>
        </div>

        {/* Body — скроллится при overflow */}
        <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">{children}</div>

        {/* Footer — sticky внизу, не скроллится. На мобильном — кнопки во всю ширину
             вертикальным стеком, чтобы Cancel/Save не толпились. */}
        {footer && (
          <div
            className="flex shrink-0 flex-col-reverse items-stretch gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-end sm:px-6 sm:py-4"
            style={{ borderTop: '1px solid var(--color-separator)' }}
          >
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
