import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

interface CopyButtonProps {
  value: string;
  /** Что копировать в clipboard (если отличается от того, что показано). */
  className?: string;
  /** Иконка-режим без подписи (для inline в строке). По умолчанию — c подписью. */
  iconOnly?: boolean;
  title?: string;
}

/**
 * Кнопка «Скопировать в буфер». Возвращается из «Скопировано» в обычное состояние
 * через 1.5 сек. Использует navigator.clipboard, на http://-окружениях падает в
 * fallback через document.execCommand('copy') — иначе кнопка не работала бы при
 * разработке без TLS.
 */
export function CopyButton({ value, className, iconOnly = false, title }: CopyButtonProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const handle = async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const ta = document.createElement('textarea');
        ta.value = value;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
      }
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // молча: clipboard может быть недоступен в iframe / некоторых browsers
    }
  };

  const label = copied ? t('actions.copied') : (title ?? t('actions.copyLink'));

  return (
    <button
      type="button"
      onClick={handle}
      className={clsx('cyber-btn cyber-btn-ghost', className)}
      aria-label={label}
      title={label}
    >
      {iconOnly ? (
        <CopyIcon copied={copied} />
      ) : (
        <span className="inline-flex items-center gap-1.5">
          <CopyIcon copied={copied} />
          <span>{label}</span>
        </span>
      )}
    </button>
  );
}

function CopyIcon({ copied }: { copied: boolean }) {
  if (copied) {
    return (
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <title>copied</title>
        <polyline points="20 6 9 17 4 12" />
      </svg>
    );
  }
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <title>copy</title>
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15V5a2 2 0 0 1 2-2h10" />
    </svg>
  );
}
