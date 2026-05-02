import { useTranslation } from 'react-i18next';

const LANGS: { code: string; label: string }[] = [
  { code: 'en', label: 'EN' },
  { code: 'ru', label: 'RU' },
];

export function LangSwitch({ className }: { className?: string }) {
  const { i18n } = useTranslation();
  const current = (i18n.resolvedLanguage ?? i18n.language ?? 'en').slice(0, 2).toLowerCase();

  return (
    <div className={`flex items-center gap-1 ${className ?? ''}`}>
      {LANGS.map((l) => (
        <button
          key={l.code}
          type="button"
          aria-pressed={current === l.code}
          className="cyber-mono text-xs"
          style={{
            padding: '2px 6px',
            border: '1px solid var(--color-separator)',
            borderRadius: 2,
            background: current === l.code ? 'var(--color-fg)' : 'transparent',
            color: current === l.code ? 'var(--color-bg)' : 'var(--color-muted)',
            cursor: 'pointer',
            transition: 'colors 150ms ease',
          }}
          onClick={() => i18n.changeLanguage(l.code)}
        >
          {l.label}
        </button>
      ))}
    </div>
  );
}
