import clsx from 'clsx';
import { type InputHTMLAttributes, forwardRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Поле пароля с тогглом show/hide. Сохраняет все поведения нативного
 * <input type="password">: autoComplete, required, aria-invalid и т.д.
 * Тоггл — иконка справа внутри инпута, не кнопкой снаружи (чтобы не ломать
 * существующую сетку и Field-обёртку).
 */
export const PasswordInput = forwardRef<HTMLInputElement, Props>(function PasswordInput(
  { className, ...rest },
  ref,
) {
  const { t } = useTranslation();
  const [shown, setShown] = useState(false);
  const label = shown ? t('actions.hidePassword') : t('actions.showPassword');

  return (
    <div className="relative">
      <input
        ref={ref}
        type={shown ? 'text' : 'password'}
        className={clsx('cyber-input', className)}
        style={{ paddingRight: '2.5rem' }}
        {...rest}
      />
      <button
        type="button"
        onClick={() => setShown((v) => !v)}
        aria-label={label}
        title={label}
        className="absolute inset-y-0 right-0 flex items-center px-3"
        style={{ color: 'var(--color-muted)' }}
        tabIndex={-1}
      >
        {shown ? <EyeOffIcon /> : <EyeIcon />}
      </button>
    </div>
  );
});

function EyeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <title>show password</title>
      <path
        d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <title>hide password</title>
      <path
        d="M3 3l18 18M10.6 10.6a3 3 0 0 0 4.2 4.2M9.9 5.1A10.7 10.7 0 0 1 12 5c6.5 0 10 7 10 7a18.4 18.4 0 0 1-3.2 4M6.3 6.3A18.4 18.4 0 0 0 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
