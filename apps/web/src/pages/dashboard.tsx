import { useQueries } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import { DashboardStatBars } from '@/components/dashboard-stat-bars';
import { TerminalTypewriter } from '@/components/terminal-typewriter';
import { api } from '@/lib/api';

export default function DashboardPage() {
  const { t } = useTranslation();

  const queries = useQueries({
    queries: [
      { queryKey: ['clusters'], queryFn: () => api.clusters.list() },
      { queryKey: ['certs'], queryFn: () => api.certificates.list() },
      { queryKey: ['cf-providers'], queryFn: () => api.certificates.listProviders() },
    ],
  });

  const [clustersQ, certsQ, providersQ] = queries;
  const clusters = clustersQ.data ?? [];
  const certs = certsQ.data ?? [];
  const providers = providersQ.data ?? [];

  const hostsQueries = useQueries({
    queries: clusters.map((c) => ({
      queryKey: ['proxy-hosts', c.id],
      queryFn: () => api.proxyHosts.list(c.id),
    })),
  });
  const allHosts = hostsQueries.flatMap((q) => q.data ?? []);
  const enabledHosts = allHosts.filter((h) => h.enabled);

  const expiringSoon = certs.filter((c) => {
    const days = Math.round((new Date(c.notAfter).getTime() - Date.now()) / 86_400_000);
    return days < 14;
  });

  const isLoading = queries.some((q) => q.isLoading) || hostsQueries.some((q) => q.isLoading);

  const overviewChartItems = useMemo(
    () => [
      {
        key: 'clusters',
        label: t('dashboard.metrics.clusters'),
        value: clusters.length,
      },
      {
        key: 'hosts',
        label: t('dashboard.metrics.proxyHosts'),
        value: enabledHosts.length,
      },
      {
        key: 'certs',
        label: t('dashboard.metrics.certificates'),
        value: certs.length,
      },
      {
        key: 'providers',
        label: t('dashboard.metrics.providers'),
        value: providers.length,
      },
    ],
    [clusters.length, enabledHosts.length, certs.length, providers.length, t],
  );

  const healthChartItems = useMemo(() => {
    const counts = {
      HEALTHY: 0,
      DEGRADED: 0,
      UNHEALTHY: 0,
      UNKNOWN: 0,
    } as Record<'HEALTHY' | 'DEGRADED' | 'UNHEALTHY' | 'UNKNOWN', number>;
    for (const h of allHosts) {
      counts[h.healthStatus]++;
    }
    return [
      { key: 'HEALTHY', label: t('dashboard.charts.healthHealthy'), value: counts.HEALTHY },
      { key: 'DEGRADED', label: t('dashboard.charts.healthDegraded'), value: counts.DEGRADED },
      { key: 'UNHEALTHY', label: t('dashboard.charts.healthUnhealthy'), value: counts.UNHEALTHY },
      { key: 'UNKNOWN', label: t('dashboard.charts.healthUnknown'), value: counts.UNKNOWN },
    ];
  }, [allHosts, t]);

  const certExpiryChartItems = useMemo(() => {
    const buckets = {
      expExpired: 0,
      exp0_14: 0,
      exp14_30: 0,
      exp30_90: 0,
      exp90p: 0,
    };
    for (const c of certs) {
      const days = Math.round((new Date(c.notAfter).getTime() - Date.now()) / 86_400_000);
      if (days < 0) buckets.expExpired++;
      else if (days < 14) buckets.exp0_14++;
      else if (days < 30) buckets.exp14_30++;
      else if (days < 90) buckets.exp30_90++;
      else buckets.exp90p++;
    }
    return [
      { key: 'expExpired', label: t('dashboard.charts.expExpired'), value: buckets.expExpired },
      { key: 'exp0_14', label: t('dashboard.charts.exp0_14'), value: buckets.exp0_14 },
      { key: 'exp14_30', label: t('dashboard.charts.exp14_30'), value: buckets.exp14_30 },
      { key: 'exp30_90', label: t('dashboard.charts.exp30_90'), value: buckets.exp30_90 },
      { key: 'exp90p', label: t('dashboard.charts.exp90p'), value: buckets.exp90p },
    ];
  }, [certs, t]);

  const hostsByClusterItems = useMemo(
    () =>
      clusters.map((c) => ({
        key: c.id,
        label: c.name,
        value: allHosts.filter((h) => h.clusterId === c.id).length,
      })),
    [clusters, allHosts],
  );

  const metrics = [
    {
      label: t('dashboard.metrics.clusters'),
      value: clusters.length,
      hint:
        clusters.length === 0
          ? t('dashboard.noClusters')
          : t('dashboard.configured', { count: clusters.length }),
      to: '/clusters',
    },
    {
      label: t('dashboard.metrics.proxyHosts'),
      value: enabledHosts.length,
      hint:
        enabledHosts.length === 0
          ? t('dashboard.noHostsYet')
          : t('dashboard.active', { active: enabledHosts.length, total: allHosts.length }),
      to: '/proxy-hosts',
    },
    {
      label: t('dashboard.metrics.certificates'),
      value: certs.length,
      hint:
        expiringSoon.length > 0
          ? t('dashboard.expiringSoon', { count: expiringSoon.length })
          : certs.length === 0
            ? t('dashboard.noCertsIssued')
            : t('dashboard.allHealthy'),
      to: '/certificates',
    },
    {
      label: t('dashboard.metrics.providers'),
      value: providers.length,
      hint:
        providers.length === 0
          ? t('dashboard.connectCloudflare')
          : t('dashboard.zonesCount', {
              count: providers.reduce((s, p) => s + p.zones.length, 0),
            }),
      to: '/certificates',
    },
  ];

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <span className="cyber-label inline-block min-h-[1.25em]">
          <TerminalTypewriter text={t('dashboard.kicker')} charDelayMs={20} />
        </span>
        <h1 className="cyber-heading inline-block min-h-[1.2em] text-3xl">
          <TerminalTypewriter text={t('dashboard.title')} startDelayMs={280} charDelayMs={42} />
        </h1>
        <p className="min-h-[1.25em] text-sm" style={{ color: 'var(--color-muted)' }}>
          {isLoading ? (
            t('dashboard.loading')
          ) : (
            <TerminalTypewriter
              text={t('dashboard.subtitle')}
              startDelayMs={620}
              charDelayMs={11}
            />
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((m) => (
          <Link
            key={m.label}
            to={m.to}
            className="cyber-card flex flex-col gap-2 p-5 hover:border-[var(--color-fg)]"
          >
            <span className="cyber-label">{m.label}</span>
            <span className="font-mono text-3xl font-semibold tabular-nums tracking-tight">
              {isLoading ? '…' : m.value}
            </span>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {m.hint}
            </span>
          </Link>
        ))}
      </div>

      {!isLoading && (
        <div className="flex flex-col gap-4">
          <span className="cyber-label">{t('dashboard.chartsSection')}</span>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <DashboardStatBars title={t('dashboard.charts.overview')} items={overviewChartItems} />
            <DashboardStatBars
              title={t('dashboard.charts.health')}
              items={allHosts.length === 0 ? [] : healthChartItems}
              emptyHint={t('dashboard.charts.emptyNoHosts')}
            />
            <DashboardStatBars
              title={t('dashboard.charts.certExpiry')}
              items={certs.length === 0 ? [] : certExpiryChartItems}
              emptyHint={t('dashboard.charts.emptyNoCerts')}
            />
            <DashboardStatBars
              title={t('dashboard.charts.hostsByCluster')}
              items={clusters.length === 0 ? [] : hostsByClusterItems}
              emptyHint={t('dashboard.charts.emptyNoClusters')}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="cyber-card">
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--color-separator)' }}
          >
            <span className="cyber-mono text-sm">{t('dashboard.recentHosts')}</span>
            <span className="cyber-tag">{allHosts.length}</span>
          </div>
          <div className="px-5 py-5 text-sm">
            {allHosts.length === 0 ? (
              <span className="cyber-mono" style={{ color: 'var(--color-muted)' }}>
                {t('dashboard.noHosts')}
              </span>
            ) : (
              <ul className="flex flex-col gap-2">
                {allHosts.slice(0, 5).map((h) => (
                  <li
                    key={h.id}
                    className="flex items-center justify-between gap-3"
                    style={{ opacity: h.enabled ? 1 : 0.55 }}
                  >
                    <span className="cyber-mono text-xs">
                      {h.ssl ? 'https://' : 'http://'}
                      {h.domain}
                    </span>
                    <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                      → {h.forwardScheme}://{h.forwardHost}:{h.forwardPort}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="cyber-card">
          <div
            className="flex items-center justify-between px-5 py-4"
            style={{ borderBottom: '1px solid var(--color-separator)' }}
          >
            <span className="cyber-mono text-sm">{t('dashboard.recentCerts')}</span>
            <span className="cyber-tag">{certs.length}</span>
          </div>
          <div className="px-5 py-5 text-sm">
            {certs.length === 0 ? (
              <span className="cyber-mono" style={{ color: 'var(--color-muted)' }}>
                {t('dashboard.noCerts')}
              </span>
            ) : (
              <ul className="flex flex-col gap-2">
                {certs.slice(0, 5).map((c) => {
                  const days = Math.round(
                    (new Date(c.notAfter).getTime() - Date.now()) / 86_400_000,
                  );
                  return (
                    <li key={c.id} className="flex items-center justify-between gap-3">
                      <span className="cyber-mono text-xs">{c.commonName}</span>
                      <span
                        className="cyber-mono text-xs"
                        style={{
                          color: days < 14 ? 'var(--color-fg)' : 'var(--color-muted)',
                        }}
                      >
                        {days}d
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
