import type { ReactNode } from 'react';
import { TerminalTypewriter } from '@/components/terminal-typewriter';

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
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-2">
        <span className="cyber-label inline-block min-h-[1.25em]">
          <TerminalTypewriter text={kicker} charDelayMs={20} />
        </span>
        <h1 className="cyber-heading inline-block min-h-[1.2em] text-3xl">
          <TerminalTypewriter text={title} startDelayMs={280} charDelayMs={42} />
        </h1>
        {subtitle ? (
          <p className="min-h-[1.25em] text-sm" style={{ color: 'var(--color-muted)' }}>
            <TerminalTypewriter text={subtitle} startDelayMs={620} charDelayMs={11} />
          </p>
        ) : null}
      </div>
      {right}
    </div>
  );
}
