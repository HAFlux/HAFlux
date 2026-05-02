import { useTranslation } from 'react-i18next';

import pkg from '../../package.json';
import { siteConfig } from '@/config/site';

export default function HelpPage() {
  const { t } = useTranslation();
  const terms = ['cluster', 'proxyHost', 'certificate', 'dns', 'health'] as const;

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="cyber-label">{t('help.kicker')}</span>
        <h1 className="cyber-heading text-3xl">{t('help.title')}</h1>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('help.lead')}
        </p>
      </div>

      <section className="cyber-card px-5 py-5">
        <h2 className="cyber-heading text-lg">{t('help.glossaryTitle')}</h2>
        <dl className="mt-4 flex flex-col gap-4">
          {terms.map((key) => (
            <div key={key}>
              <dt className="cyber-mono text-sm font-medium">{t(`help.terms.${key}.term`)}</dt>
              <dd className="mt-1 text-sm" style={{ color: 'var(--color-muted)' }}>
                {t(`help.terms.${key}.def`)}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      <p className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
        <a
          className="underline decoration-dotted underline-offset-2 hover:text-[var(--color-fg)]"
          href={siteConfig.links.github}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t('help.repoLink')}
        </a>
        {' · '}
        {t('help.versionLine', { version: pkg.version })}
      </p>
    </div>
  );
}
