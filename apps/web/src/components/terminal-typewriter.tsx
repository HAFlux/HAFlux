import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';

export interface TerminalTypewriterProps {
  text: string;
  className?: string;
  /** ms между символами */
  charDelayMs?: number;
  /** задержка перед первым символом */
  startDelayMs?: number;
  /** мигающий курсор «_» в конце */
  showCursor?: boolean;
}

/**
 * Текст появляется посимвольно, как в терминале; полная строка продублирована в .sr-only для скринридеров.
 */
export function TerminalTypewriter({
  text,
  className,
  charDelayMs = 22,
  startDelayMs = 0,
  showCursor = true,
}: TerminalTypewriterProps) {
  const [len, setLen] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setLen(0);
    if (!text) return;

    let pos = 0;
    let cancelled = false;

    const schedule = (delay: number, fn: () => void) => {
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(fn, delay);
    };

    const step = () => {
      if (cancelled) return;
      pos += 1;
      setLen(Math.min(pos, text.length));
      if (pos < text.length) schedule(charDelayMs, step);
    };

    schedule(startDelayMs, step);

    return () => {
      cancelled = true;
      if (timerRef.current !== undefined) clearTimeout(timerRef.current);
    };
  }, [text, charDelayMs, startDelayMs]);

  const visible = text.slice(0, len);

  return (
    <span className={clsx('relative inline-block', className)}>
      <span aria-hidden="true">
        {visible}
        {showCursor ? <span className="cyber-cursor align-middle" /> : null}
      </span>
      <span className="sr-only">{text}</span>
    </span>
  );
}
