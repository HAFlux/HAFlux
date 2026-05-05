import { TerminalTypewriter } from '@/components/terminal-typewriter';
import type { ReactNode } from 'react';

export function PageHeader({
  kicker,
  title,
  subtitle,
  right,
}: {
  kicker: string;
  title: string;
  subtitle?: string;
  right?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:gap-4">
      <div className="flex min-w-0 flex-col gap-2">
        <span className="cyber-label inline-block min-h-[1.25em]">
          <TerminalTypewriter text={kicker} charDelayMs={20} />
        </span>
        <h1 className="cyber-heading inline-block min-h-[1.2em] text-2xl sm:text-3xl">
          <TerminalTypewriter text={title} startDelayMs={280} charDelayMs={42} />
        </h1>
        {subtitle ? (
          <p className="min-h-[1.25em] text-sm" style={{ color: 'var(--color-muted)' }}>
            <TerminalTypewriter text={subtitle} startDelayMs={620} charDelayMs={11} />
          </p>
        ) : null}
      </div>
      {right ? (
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">{right}</div>
      ) : null}
    </div>
  );
}
