type HelpProps = {
  text: string;
};

export function Help({ text }: HelpProps) {
  return (
    <span className="group relative inline-flex align-middle">
      <button
        type="button"
        className="cyber-mono cursor-help border text-[11px] leading-none transition-colors hover:border-[var(--color-fg)] hover:text-[var(--color-fg)]"
        style={{
          borderColor: 'var(--color-separator)',
          color: 'var(--color-muted)',
          width: 18,
          height: 18,
          borderRadius: 2,
          padding: 0,
        }}
        aria-label={text}
        tabIndex={0}
      >
        ?
      </button>
      <span
        className="invisible pointer-events-none absolute left-0 top-full z-50 mt-1 min-w-[220px] max-w-[min(92vw,360px)] text-left text-xs opacity-0 transition-opacity group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100"
        style={{ color: 'var(--color-fg)' }}
        role="tooltip"
      >
        <span
          className="cyber-card block font-mono shadow-lg"
          style={{ border: '1px solid var(--color-fg)' }}
        >
          {text}
        </span>
      </span>
    </span>
  );
}
