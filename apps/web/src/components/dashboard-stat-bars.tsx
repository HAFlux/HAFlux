import clsx from 'clsx';

export interface StatBarItem {
  /** стабильный ключ для React */
  key: string;
  label: string;
  value: number;
}

type Props = {
  title: string;
  items: StatBarItem[];
  emptyHint?: string;
  className?: string;
};

/**
 * Горизонтальные бары для дашборда — монохром, без сторонних chart-lib.
 */
export function DashboardStatBars({ title, items, emptyHint, className }: Props) {
  const max = Math.max(1, ...items.map((i) => i.value));

  return (
    <div className={clsx('cyber-card flex flex-col', className)}>
      <div
        className="flex shrink-0 items-center justify-between px-5 py-4"
        style={{ borderBottom: '1px solid var(--color-separator)' }}
      >
        <span className="cyber-mono text-sm">{title}</span>
      </div>
      <div className="flex flex-col gap-4 px-5 py-5">
        {items.length === 0 && emptyHint ? (
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {emptyHint}
          </span>
        ) : (
          items.map((item) => {
            const pct = (item.value / max) * 100;
            return (
              <div key={item.key} className="flex flex-col gap-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className="cyber-mono min-w-0 truncate text-xs"
                    style={{ color: 'var(--color-muted)' }}
                    title={item.label}
                  >
                    {item.label}
                  </span>
                  <span className="cyber-mono shrink-0 text-xs tabular-nums">{item.value}</span>
                </div>
                <div
                  className="h-2 w-full overflow-hidden"
                  style={{
                    border: '1px solid var(--color-separator)',
                    borderRadius: 2,
                    background: 'color-mix(in srgb, var(--color-muted) 12%, transparent)',
                  }}
                  role="presentation"
                  aria-hidden
                >
                  <div
                    className="h-full transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{
                      width: `${pct}%`,
                      background: 'var(--color-fg)',
                      borderRadius: 1,
                      minWidth: item.value > 0 ? 2 : 0,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
