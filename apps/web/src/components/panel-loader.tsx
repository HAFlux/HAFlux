import { useEffect, useState } from 'react';
import { TerminalTypewriter } from '@/components/terminal-typewriter';

export interface PanelLoaderProps {
  /** Текст рядом с курсором; по умолчанию — пустой. */
  message?: string;
  /** Длительность прогресса в мс (по умолчанию 1500). */
  durationMs?: number;
  /** Не пускать выше этого процента, если loader активен (для бесконечной загрузки). */
  ceil?: number;
}

export function PanelLoader({ message = '', durationMs = 1500, ceil = 100 }: PanelLoaderProps) {
  const [pct, setPct] = useState(0);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      const value = Math.round(eased * ceil);
      setPct(value);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [durationMs, ceil]);

  return (
    <div className="cyber-card flex flex-col gap-3 px-5 py-5">
      <div className="cyber-mono text-sm flex items-center gap-2">
        <span style={{ color: 'var(--color-muted)' }}>{'>'}</span>
        <span>
          {message ? (
            <TerminalTypewriter text={message} charDelayMs={28} />
          ) : (
            <TerminalTypewriter text="loading" charDelayMs={28} />
          )}
        </span>
      </div>
      <div className="cyber-progress">
        <div className="cyber-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <div
        className="cyber-mono text-xs flex justify-between"
        style={{ color: 'var(--color-muted)' }}
      >
        <span>[ {String(pct).padStart(3, '0')}% ]</span>
        <span>{pct < 100 ? 'streaming...' : 'ready'}</span>
      </div>
    </div>
  );
}
