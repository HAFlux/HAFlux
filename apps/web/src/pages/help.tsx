import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { siteConfig } from '@/config/site';
import { APP_VERSION } from '@/version';

export default function HelpPage() {
  const { t } = useTranslation();
  const terms = ['cluster', 'proxyHost', 'certificate', 'dns', 'health'] as const;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader kicker={t('help.kicker')} title={t('help.title')} subtitle={t('help.lead')} />

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
        {t('help.versionLine', { version: APP_VERSION })}
      </p>
    </div>
  );
}
