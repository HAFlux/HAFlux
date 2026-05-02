import { ListBox, Select } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { Help } from '@/components/help';
import { PageHeader } from '@/components/page-header';
import { PanelLoader } from '@/components/panel-loader';
import { Modal } from '@/components/modal';
import {
  ApiError,
  type AccessGroupSummary,
  type Certificate,
  type CreateProxyHostInput,
  type ForwardScheme,
  type ProxyHost,
  api,
} from '@/lib/api';

export default function ProxyHostsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const clustersQ = useQuery({ queryKey: ['clusters'], queryFn: () => api.clusters.list() });
  const certsQ = useQuery({ queryKey: ['certs'], queryFn: () => api.certificates.list() });

  const clusters = clustersQ.data ?? [];
  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeClusterId && clusters.length > 0) {
      setActiveClusterId(clusters[0]!.id);
    }
  }, [activeClusterId, clusters]);

  const hostsQ = useQuery({
    queryKey: ['proxy-hosts', activeClusterId],
    queryFn: () => api.proxyHosts.list(activeClusterId!),
    enabled: !!activeClusterId,
  });

  const accessGroupsQ = useQuery({
    queryKey: ['access-groups', activeClusterId],
    queryFn: () => api.clusters.accessGroups.list(activeClusterId!),
    enabled: !!activeClusterId,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<ProxyHost | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<ProxyHost | null>(null);

  const remove = useMutation({
    mutationFn: (id: string) => api.proxyHosts.delete(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['proxy-hosts', activeClusterId] });
    },
  });

  const toggleEnabled = useMutation({
    mutationFn: (host: ProxyHost) => api.proxyHosts.update(host.id, { enabled: !host.enabled }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proxy-hosts', activeClusterId] }),
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('proxyHosts.kicker')}
        title={t('proxyHosts.title')}
        subtitle={t('proxyHosts.subtitle')}
        right={
          <button
            type="button"
            className="cyber-btn"
            disabled={!activeClusterId}
            onClick={() => setCreateOpen(true)}
          >
            {t('actions.newProxyHost')}
          </button>
        }
      />

      {clusters.length === 0 ? (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('proxyHosts.noClusters')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('proxyHosts.noClustersHint', { clusters: t('nav.clusters') })}
          </p>
        </div>
      ) : (
        <ClusterTabs
          clusters={clusters}
          activeId={activeClusterId}
          onChange={(id) => setActiveClusterId(id)}
        />
      )}

      {hostsQ.isLoading && <PanelLoader message={t('proxyHosts.loadingHosts')} />}

      {hostsQ.data && hostsQ.data.length === 0 && (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('proxyHosts.noHosts')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('proxyHosts.noHostsHint', { addHost: t('actions.newProxyHost') })}
          </p>
        </div>
      )}

      {hostsQ.data && hostsQ.data.length > 0 && (
        <div className="flex flex-col gap-2">
          {hostsQ.data.map((host) => (
            <ProxyHostRow
              key={host.id}
              host={host}
              onEdit={() => setEditing(host)}
              onDelete={() => setConfirmDelete(host)}
              onToggle={() => toggleEnabled.mutate(host)}
            />
          ))}
        </div>
      )}

      {activeClusterId && (
        <ProxyHostFormModal
          open={createOpen}
          mode="create"
          clusterId={activeClusterId}
          certificates={certsQ.data ?? []}
          accessGroups={accessGroupsQ.data ?? []}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['proxy-hosts', activeClusterId] });
          }}
        />
      )}

      {editing && (
        <ProxyHostFormModal
          open={!!editing}
          mode="edit"
          host={editing}
          clusterId={editing.clusterId}
          certificates={certsQ.data ?? []}
          accessGroups={accessGroupsQ.data ?? []}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            qc.invalidateQueries({ queryKey: ['proxy-hosts', activeClusterId] });
          }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t('proxyHosts.deleteModalTitle')}
        description={
          confirmDelete ? t('proxyHosts.deleteModalDesc', { domain: confirmDelete.domain }) : ''
        }
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              onClick={() => setConfirmDelete(null)}
              disabled={remove.isPending}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              className="cyber-btn"
              disabled={remove.isPending}
              onClick={() => confirmDelete && remove.mutate(confirmDelete.id)}
            >
              {remove.isPending ? t('actions.deleting') : t('actions.delete')}
            </button>
          </>
        }
      >
        {remove.isError && (
          <p className="cyber-mono text-sm">
            ! {remove.error instanceof ApiError ? remove.error.message : t('common.failed')}
          </p>
        )}
      </Modal>
    </div>
  );
}

function ClusterTabs({
  clusters,
  activeId,
  onChange,
}: {
  clusters: { id: string; name: string }[];
  activeId: string | null;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {clusters.map((c) => (
        <button
          key={c.id}
          type="button"
          className="cyber-btn cyber-btn-ghost"
          style={
            activeId === c.id
              ? { borderColor: 'var(--color-fg)', color: 'var(--color-fg)' }
              : undefined
          }
          onClick={() => onChange(c.id)}
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}

function ProxyHostRow({
  host,
  onEdit,
  onDelete,
  onToggle,
}: {
  host: ProxyHost;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const isL7 = host.forwardScheme === 'http' || host.forwardScheme === 'https';
  const target = `${host.forwardScheme}://${host.forwardHost}:${host.forwardPort}`;
  const [statsOpen, setStatsOpen] = useState(false);
  const probe = useMutation({
    mutationFn: () => api.proxyHosts.healthCheck(host.id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['proxy-hosts', host.clusterId] }),
  });

  return (
    <div
      className="cyber-card flex flex-col gap-3 px-5 py-4"
      style={{ opacity: host.enabled ? 1 : 0.55 }}
    >
      <div className="flex flex-col gap-4 min-[900px]:grid min-[900px]:grid-cols-[1fr_auto] min-[900px]:items-start">
        <div className="min-w-0 flex flex-col gap-1.5">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <HealthDot status={host.healthStatus} />
            <span className="cyber-mono text-sm font-medium">
              {isL7 ? (
                <>
                  {host.ssl ? 'https://' : 'http://'}
                  {host.domain}
                </>
              ) : (
                <>
                  <span className="cyber-tag">{host.forwardScheme}</span> {host.domain}
                </>
              )}
            </span>
            <span style={{ color: 'var(--color-muted)' }}>→</span>
            <span className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
              {target}
            </span>
            {!isL7 && host.listenPort != null ? (
              <span className="cyber-tag">{t('proxyHosts.tagListen', { port: host.listenPort })}</span>
            ) : null}
            {host.healthCheckedAt && (
              <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                · {host.healthHttpCode ?? '—'} ·{' '}
                {host.healthLatencyMs != null ? `${host.healthLatencyMs}ms` : ''}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {isL7 && host.ssl && <span className="cyber-tag">{t('proxyHosts.tagTls')}</span>}
            {isL7 && host.certificate && (
              <span className="cyber-tag">
                {t('proxyHosts.tagCert', { name: host.certificate.commonName })}
              </span>
            )}
            {isL7 && host.httpToHttps && <span className="cyber-tag">{t('proxyHosts.tag443')}</span>}
            {isL7 && host.hsts && <span className="cyber-tag">{t('proxyHosts.tagHsts')}</span>}
            {isL7 && host.http2 && host.ssl && <span className="cyber-tag">{t('proxyHosts.tagH2')}</span>}
            {isL7 && host.http3 && host.ssl && <span className="cyber-tag">{t('proxyHosts.tagH3')}</span>}
            {isL7 && host.wsSupport && <span className="cyber-tag">{t('proxyHosts.tagWs')}</span>}
            {isL7 && host.blockExploits && (
              <span className="cyber-tag">{t('proxyHosts.tagBlockExploits')}</span>
            )}
            {isL7 &&
              host.accessGroups.map((g) => (
                <span key={g.id} className="cyber-tag max-w-[140px] truncate" title={g.name}>
                  {g.name}
                </span>
              ))}
            {!host.enabled && <span className="cyber-tag">{t('proxyHosts.tagDisabled')}</span>}
          </div>
        </div>
        <div className="flex min-w-0 flex-wrap items-start justify-end gap-2">
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost"
            onClick={() => setStatsOpen((v) => !v)}
          >
            {statsOpen
              ? t('proxyHosts.statsCollapse', { stats: t('proxyHosts.stats') })
              : t('proxyHosts.statsExpand', { stats: t('proxyHosts.stats') })}
          </button>
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost"
            onClick={() => probe.mutate()}
            disabled={probe.isPending}
          >
            {probe.isPending ? '…' : t('actions.check')}
          </button>
          <button type="button" className="cyber-btn cyber-btn-ghost" onClick={onEdit}>
            {t('actions.edit')}
          </button>
          <button type="button" className="cyber-btn cyber-btn-ghost" onClick={onToggle}>
            {host.enabled ? t('actions.disable') : t('actions.enable')}
          </button>
          <button type="button" className="cyber-btn cyber-btn-ghost" onClick={onDelete}>
            {t('actions.delete')}
          </button>
        </div>
      </div>
      {statsOpen && <ProxyHostStatsPanel hostId={host.id} />}
    </div>
  );
}

function ProxyHostStatsPanel({ hostId }: { hostId: string }) {
  const { t } = useTranslation();
  const refreshOptions = useMemo(
    () => [
      { value: 5_000, label: t('proxyHosts.refresh5s') },
      { value: 10_000, label: t('proxyHosts.refresh10s') },
      { value: 30_000, label: t('proxyHosts.refresh30s') },
      { value: 60_000, label: t('proxyHosts.refresh60s') },
      { value: 0, label: t('proxyHosts.refreshOff') },
    ],
    [t],
  );
  const [interval, setIntervalMs] = useState(5_000);
  const stats = useQuery({
    queryKey: ['proxy-host-stats', hostId],
    queryFn: () => api.proxyHosts.stats(hostId),
    refetchInterval: interval || false,
  });
  const logs = useQuery({
    queryKey: ['proxy-host-logs', hostId],
    queryFn: () => api.proxyHosts.logs(hostId),
    refetchInterval: interval || false,
  });
  const s = stats.data;
  const l = logs.data ?? [];

  const exportCsv = () => {
    const headers = [
      'time',
      'client_ip',
      'method',
      'status',
      'bytes',
      'duration_ms',
      'backend_ms',
      'term_state',
      'path',
      'url',
      'user_agent',
    ];
    const rows = l.map((line) => [
      line.time,
      line.clientIp,
      line.method,
      String(line.status),
      String(line.bytes),
      String(line.durationMs),
      String(line.backendMs),
      line.termState,
      line.path,
      line.url,
      line.userAgent ?? '',
    ]);
    const csv = [headers, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proxy-host-${hostId}-logs-${new Date().toISOString().slice(0, 19)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <div
      className="flex flex-col gap-4 pt-3"
      style={{ borderTop: '1px solid var(--color-separator)' }}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label={t('proxyHosts.metricRpm1')} value={s?.rpm1 ?? 0} />
        <Metric label={t('proxyHosts.metricRpm5')} value={s?.rpm5 ?? 0} />
        <Metric label={t('proxyHosts.metricRpm60')} value={s?.rpm60 ?? 0} />
        <Metric label={t('proxyHosts.metricTotal')} value={s?.total ?? 0} />
      </div>
      <div className="grid grid-cols-4 gap-3">
        <StatusMetric label={t('proxyHosts.status2xx')} value={s?.status2xx ?? 0} color="#16a34a" />
        <StatusMetric
          label={t('proxyHosts.status3xx')}
          value={s?.status3xx ?? 0}
          color="var(--color-muted)"
        />
        <StatusMetric label={t('proxyHosts.status4xx')} value={s?.status4xx ?? 0} color="#eab308" />
        <StatusMetric label={t('proxyHosts.status5xx')} value={s?.status5xx ?? 0} color="#dc2626" />
      </div>
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="cyber-label">{t('proxyHosts.logsWithCount', { count: l.length })}</span>
          <div className="flex items-center gap-2">
            <span className="cyber-label">{t('proxyHosts.refreshLabel')}</span>
            <Select
              className="w-20"
              selectedKey={String(interval)}
              variant="secondary"
              onSelectionChange={(key) => {
                if (key != null) setIntervalMs(Number(key));
              }}
            >
              <Select.Trigger
                className="cyber-input flex h-7 min-h-7 w-20 min-w-20 items-center justify-between gap-1 px-2 py-0 text-left font-mono text-xs"
                style={{ width: 80, height: 28 }}
              >
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="cyber-popover">
                <ListBox>
                  {refreshOptions.map((o) => (
                    <ListBox.Item
                      key={o.value}
                      className="font-mono text-xs"
                      id={String(o.value)}
                      textValue={o.label}
                    >
                      {o.label}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              onClick={() => {
                stats.refetch();
                logs.refetch();
              }}
            >
              {t('proxyHosts.refreshNow')}
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              onClick={exportCsv}
              disabled={l.length === 0}
              title={t('proxyHosts.exportCsvTitle')}
            >
              {t('proxyHosts.exportCsv')}
            </button>
          </div>
        </div>
        {l.length === 0 ? (
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('proxyHosts.noTraffic')}
          </span>
        ) : (
          <div
            className="cyber-mono"
            style={{
              maxHeight: 320,
              overflowY: 'auto',
              fontSize: 11,
              lineHeight: 1.6,
              border: '1px solid var(--color-separator)',
              borderRadius: 2,
              padding: 8,
            }}
          >
            {l.map((line, i) => {
              const c =
                line.status >= 500
                  ? '#dc2626'
                  : line.status >= 400
                    ? '#eab308'
                    : line.status >= 200
                      ? 'var(--color-fg)'
                      : 'var(--color-muted)';
              return (
                <div
                  key={i}
                  style={{
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  <span style={{ color: 'var(--color-muted)' }}>
                    {formatHaproxyTime(line.time)}
                  </span>{' '}
                  <span style={{ color: 'var(--color-muted)' }}>{line.clientIp}</span>{' '}
                  <span style={{ color: c }}>{line.status}</span>{' '}
                  <span style={{ color: 'var(--color-muted)' }}>{line.bytes}b</span>{' '}
                  <span style={{ color: 'var(--color-muted)' }}>{line.durationMs}ms</span>{' '}
                  {line.method} <span style={{ color: 'var(--color-fg)' }}>{line.path}</span>
                  {line.userAgent ? (
                    <>
                      {' '}
                      <span style={{ color: 'var(--color-muted)' }} title={line.userAgent}>
                        · {line.userAgent}
                      </span>
                    </>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div
      className="flex flex-col gap-1 px-3 py-2"
      style={{ border: '1px solid var(--color-separator)', borderRadius: 2 }}
    >
      <span className="cyber-label">{label}</span>
      <span className="font-mono text-xl font-semibold tabular-nums tracking-tight">{value}</span>
    </div>
  );
}

function StatusMetric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div
      className="flex items-center justify-between px-3 py-2"
      style={{ border: '1px solid var(--color-separator)', borderRadius: 2 }}
    >
      <span className="cyber-label">{label}</span>
      <span className="font-mono text-base tabular-nums" style={{ color }}>
        {value}
      </span>
    </div>
  );
}

function HealthDot({ status }: { status: ProxyHost['healthStatus'] }) {
  const { t } = useTranslation();
  const map: Record<ProxyHost['healthStatus'], { labelKey: string; bg: string; border: string }> = {
    HEALTHY: { labelKey: 'proxyHosts.healthHealthy', bg: '#16a34a', border: '#16a34a' },
    DEGRADED: { labelKey: 'proxyHosts.healthDegraded', bg: '#eab308', border: '#eab308' },
    UNHEALTHY: { labelKey: 'proxyHosts.healthDown', bg: '#dc2626', border: '#dc2626' },
    UNKNOWN: {
      labelKey: 'proxyHosts.healthUnknown',
      bg: 'transparent',
      border: 'var(--color-separator)',
    },
  };
  const v = map[status];
  const label = t(v.labelKey);
  return (
    <span
      title={t('proxyHosts.healthUpstreamTitle', { status: label })}
      style={{
        display: 'inline-block',
        width: 8,
        height: 8,
        borderRadius: 999,
        background: v.bg,
        border: `1px solid ${v.border}`,
      }}
    />
  );
}

// ─── Universal create + edit form ─────────────────────────────────────

function headerRowsFromHost(host: ProxyHost): { key: string; value: string }[] {
  const ch = host.customHeaders;
  if (!ch || typeof ch !== 'object' || Array.isArray(ch)) return [{ key: '', value: '' }];
  const entries = Object.entries(ch);
  if (entries.length === 0) return [{ key: '', value: '' }];
  return entries.map(([key, value]) => ({ key, value }));
}

function rowsToCustomHeaders(rows: { key: string; value: string }[]): Record<string, string> | null {
  const out: Record<string, string> = {};
  for (const r of rows) {
    const k = r.key.trim().toLowerCase();
    if (!k) continue;
    out[k] = r.value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

interface FormState {
  domain: string;
  forwardScheme: ForwardScheme;
  forwardHost: string;
  forwardPort: number;
  listenPort: number | null;
  ssl: boolean;
  certificateId: string | null;
  accessGroupIds: string[];
  httpToHttps: boolean;
  hsts: boolean;
  blockExploits: boolean;
  wsSupport: boolean;
  http2: boolean;
  http3: boolean;
  enabled: boolean;
  customHeaderRows: { key: string; value: string }[];
  notes: string;
}

function defaultFormState(): FormState {
  return {
    domain: '',
    forwardScheme: 'http',
    forwardHost: '',
    forwardPort: 80,
    listenPort: null,
    ssl: true,
    certificateId: null,
    accessGroupIds: [],
    httpToHttps: true,
    hsts: false,
    blockExploits: true,
    wsSupport: true,
    http2: true,
    http3: false,
    enabled: true,
    customHeaderRows: [{ key: '', value: '' }],
    notes: '',
  };
}

function fromHost(host: ProxyHost): FormState {
  return {
    domain: host.domain,
    forwardScheme: host.forwardScheme,
    forwardHost: host.forwardHost,
    forwardPort: host.forwardPort,
    listenPort: host.listenPort ?? null,
    ssl: host.ssl,
    certificateId: host.certificateId,
    accessGroupIds: host.accessGroups.map((g) => g.id),
    httpToHttps: host.httpToHttps,
    hsts: host.hsts,
    blockExploits: host.blockExploits,
    wsSupport: host.wsSupport,
    http2: host.http2,
    http3: host.http3,
    enabled: host.enabled,
    customHeaderRows: headerRowsFromHost(host),
    notes: host.notes ?? '',
  };
}

function ProxyHostFormModal({
  open,
  mode,
  host,
  clusterId,
  certificates,
  accessGroups,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  host?: ProxyHost;
  clusterId: string;
  certificates: Certificate[];
  accessGroups: AccessGroupSummary[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<FormState>(() => (host ? fromHost(host) : defaultFormState()));
  const [touched, setTouched] = useState({ domain: false, forwardHost: false });

  // При открытии модалки — синхронизируем стейт с host'ом (для edit) или
  // ресетим (для create). Зависим от host?.id, не от ссылки host — иначе
  // лишние срабатывания сбрасывают accessGroupIds и чекбоксы «не держатся».
  useEffect(() => {
    if (!open) return;
    setState(host ? fromHost(host) : defaultFormState());
    setTouched({ domain: false, forwardHost: false });
    // host в замыкании обновляется при смене id; при той же ссылке host не сбрасываем форму
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, host?.id, mode]);

  // Сертификаты, покрывающие выбранный домен
  const matchingCerts = useMemo(() => {
    return certificates.filter(
      (c) =>
        c.sans.some((s) => sanMatches(s, state.domain)) || sanMatches(c.commonName, state.domain),
    );
  }, [certificates, state.domain]);

  // Авто-выбор первого подходящего cert при включении SSL
  useEffect(() => {
    if (!open || !state.ssl) return;
    if (state.certificateId && matchingCerts.find((c) => c.id === state.certificateId)) return;
    if (matchingCerts[0]) setState((s) => ({ ...s, certificateId: matchingCerts[0]!.id }));
    else setState((s) => ({ ...s, certificateId: null }));
  }, [open, matchingCerts, state.ssl, state.certificateId]);

  const isL7 = state.forwardScheme === 'http' || state.forwardScheme === 'https';
  const domainErrorKey = validateDomain(state.domain);
  const forwardHostErrorKey = validateForwardHost(state.forwardHost);
  const listenOk =
    state.forwardScheme === 'tcp' || state.forwardScheme === 'udp'
      ? state.listenPort != null && state.listenPort >= 1 && state.listenPort <= 65535
      : true;
  const canSubmit =
    !domainErrorKey &&
    !forwardHostErrorKey &&
    state.forwardPort >= 1 &&
    state.forwardPort <= 65535 &&
    listenOk;

  const create = useMutation({
    mutationFn: () =>
      api.proxyHosts.create({
        clusterId,
        domain: state.domain.trim(),
        forwardScheme: state.forwardScheme,
        forwardHost: state.forwardHost.trim(),
        forwardPort: state.forwardPort,
        listenPort: isL7 ? null : state.listenPort,
        ssl: isL7 && state.ssl,
        certificateId: isL7 && state.ssl ? state.certificateId : null,
        httpToHttps: isL7 && state.ssl && state.httpToHttps,
        hsts: isL7 && state.ssl && state.hsts,
        blockExploits: isL7 ? state.blockExploits : true,
        wsSupport: isL7 ? state.wsSupport : true,
        http2: isL7 && state.ssl && state.http2,
        http3: isL7 && state.ssl && state.http3,
        accessGroupIds: isL7 ? state.accessGroupIds : [],
        notes: state.notes.trim() || null,
        customHeaders: isL7 ? rowsToCustomHeaders(state.customHeaderRows) : null,
      } satisfies CreateProxyHostInput),
    onSuccess: onSaved,
  });

  const update = useMutation({
    mutationFn: () => {
      if (!host) throw new Error('host required for edit');
      return api.proxyHosts.update(host.id, {
        domain: state.domain.trim(),
        forwardScheme: state.forwardScheme,
        forwardHost: state.forwardHost.trim(),
        forwardPort: state.forwardPort,
        listenPort: isL7 ? null : state.listenPort,
        ssl: isL7 && state.ssl,
        certificateId: isL7 && state.ssl ? state.certificateId : null,
        httpToHttps: isL7 && state.ssl && state.httpToHttps,
        hsts: isL7 && state.ssl && state.hsts,
        blockExploits: isL7 ? state.blockExploits : true,
        wsSupport: isL7 ? state.wsSupport : true,
        http2: isL7 && state.ssl && state.http2,
        http3: isL7 && state.ssl && state.http3,
        enabled: state.enabled,
        accessGroupIds: isL7 ? state.accessGroupIds : [],
        notes: state.notes.trim() || null,
        customHeaders: isL7 ? rowsToCustomHeaders(state.customHeaderRows) : null,
      });
    },
    onSuccess: onSaved,
  });

  const mutation = mode === 'edit' ? update : create;

  const submit = () => {
    setTouched({ domain: true, forwardHost: true });
    if (canSubmit) mutation.mutate();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'edit' ? t('proxyHosts.editHostTitle') : t('proxyHosts.newHostTitle')}
      description={
        mode === 'edit'
          ? t('proxyHosts.editHostDesc', { domain: host?.domain ?? '' })
          : t('proxyHosts.newHostDesc')
      }
      size="lg"
      footer={
        <>
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost"
            onClick={onClose}
            disabled={mutation.isPending}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || mutation.isPending}
            onClick={submit}
          >
            {mutation.isPending
              ? mode === 'edit'
                ? t('actions.updating')
                : t('actions.saving')
              : mode === 'edit'
                ? t('proxyHosts.updateButton')
                : t('proxyHosts.saveButton')}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">
            {t('proxyHosts.domainLabel')} <span style={{ color: 'var(--color-fg)' }}>*</span>
          </span>
          <input
            className="cyber-input"
            autoFocus
            placeholder={t('proxyHosts.domainPlaceholder')}
            value={state.domain}
            onBlur={() => setTouched((prev) => ({ ...prev, domain: true }))}
            onChange={(e) => setState((s) => ({ ...s, domain: e.target.value }))}
            aria-invalid={touched.domain && !!domainErrorKey}
            style={
              touched.domain && domainErrorKey
                ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                : undefined
            }
          />
          {touched.domain && domainErrorKey ? (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
              ! {t(`proxyHosts.errors.${domainErrorKey}`)}
            </span>
          ) : (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('proxyHosts.domainHint')}
            </span>
          )}
        </label>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(5.5rem,8rem)_minmax(0,1fr)_minmax(5.5rem,8rem)]">
          <div className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('proxyHosts.schemeLabel')}</span>
            <Select
              className="w-full"
              fullWidth
              selectedKey={state.forwardScheme}
              variant="secondary"
              onSelectionChange={(key) => {
                const sch = (key != null ? String(key) : 'http') as ForwardScheme;
                setState((s) => ({
                  ...s,
                  forwardScheme: sch,
                  ...(sch === 'tcp' || sch === 'udp'
                    ? { ssl: false, listenPort: s.listenPort ?? null }
                    : { listenPort: null }),
                }));
              }}
            >
              <Select.Trigger className="cyber-input flex min-h-10 w-full items-center justify-between gap-2 text-left font-mono text-sm">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="cyber-popover">
                <ListBox>
                  <ListBox.Item className="font-mono text-sm" id="http" textValue="http">
                    http
                  </ListBox.Item>
                  <ListBox.Item className="font-mono text-sm" id="https" textValue="https">
                    https
                  </ListBox.Item>
                  <ListBox.Item className="font-mono text-sm" id="tcp" textValue="tcp">
                    tcp
                  </ListBox.Item>
                  <ListBox.Item className="font-mono text-sm" id="udp" textValue="udp">
                    udp
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">
              {t('proxyHosts.forwardHostLabel')} <span style={{ color: 'var(--color-fg)' }}>*</span>
            </span>
            <input
              className="cyber-input"
              placeholder={t('proxyHosts.forwardPlaceholder')}
              value={state.forwardHost}
              onBlur={() => setTouched((prev) => ({ ...prev, forwardHost: true }))}
              onChange={(e) => setState((s) => ({ ...s, forwardHost: e.target.value }))}
              aria-invalid={touched.forwardHost && !!forwardHostErrorKey}
              style={
                touched.forwardHost && forwardHostErrorKey
                  ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                  : undefined
              }
            />
            {touched.forwardHost && forwardHostErrorKey && (
              <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                ! {t(`proxyHosts.errors.${forwardHostErrorKey}`)}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('proxyHosts.portLabel')}</span>
            <input
              className="cyber-input"
              type="number"
              min={1}
              max={65535}
              value={state.forwardPort}
              onChange={(e) => setState((s) => ({ ...s, forwardPort: Number(e.target.value) }))}
            />
          </label>
        </div>

        {!isL7 && (
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1.5">
              <span className="cyber-label">{t('proxyHosts.listenPortLabel')}</span>
              <input
                className="cyber-input"
                type="number"
                min={1}
                max={65535}
                value={state.listenPort ?? ''}
                onChange={(e) => {
                  const raw = e.target.value;
                  setState((s) => ({
                    ...s,
                    listenPort: raw === '' ? null : Number(raw),
                  }));
                }}
              />
            </label>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('proxyHosts.listenPortHint')}
            </span>
            {state.forwardScheme === 'udp' && (
              <p className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                {t('proxyHosts.udpExperimental')}
              </p>
            )}
          </div>
        )}

        {isL7 && (
          <div className="flex flex-col gap-2">
            <span className="cyber-label">{t('proxyHosts.accessGroupLabel')}</span>
            {accessGroups.length === 0 ? (
              <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                {t('proxyHosts.accessGroupEmpty')}
              </span>
            ) : (
              <div className="flex flex-col gap-2">
                {accessGroups.map((g) => {
                  const inputId = `proxy-host-ag-${g.id}`;
                  const selected = state.accessGroupIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      htmlFor={inputId}
                      className="cyber-card relative z-0 flex cursor-pointer items-start gap-3 px-4 py-3"
                      style={{
                        borderColor: selected ? 'var(--color-fg)' : 'var(--color-separator)',
                        boxShadow: selected ? '0 0 0 1px var(--color-fg)' : 'none',
                      }}
                      onMouseDown={(e) => e.stopPropagation()}
                    >
                      <input
                        id={inputId}
                        type="checkbox"
                        className="shrink-0"
                        checked={selected}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            accessGroupIds: e.target.checked
                              ? [...s.accessGroupIds, g.id]
                              : s.accessGroupIds.filter((id) => id !== g.id),
                          }))
                        }
                        style={{ accentColor: 'var(--color-fg)', marginTop: 2 }}
                      />
                      <div className="flex min-w-0 flex-col gap-0.5">
                        <span className="cyber-mono break-words text-sm">{g.name}</span>
                        <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                          {t('accessGroups.metaLine', {
                            ips: g.ipCount,
                            users: g.userCount,
                            hosts: g.proxyHostCount,
                          })}
                        </span>
                      </div>
                    </label>
                  );
                })}
              </div>
            )}
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
              {t('proxyHosts.accessGroupMustAssign')}
            </span>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('proxyHosts.accessGroupHint')}
            </span>
          </div>
        )}

        {isL7 && (
        <div className="flex flex-col gap-3">
          <span className="cyber-label">{t('proxyHosts.ssl')}</span>
          <CheckboxRow
            checked={state.ssl}
            onChange={(v) => setState((s) => ({ ...s, ssl: v }))}
            title={t('proxyHosts.enableHttps')}
            hint={t('proxyHosts.enableHttpsHint')}
          />
          {state.ssl && (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="cyber-label">{t('proxyHosts.certificate')}</span>
                {matchingCerts.length === 0 ? (
                  <div className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t('proxyHosts.noMatchingCert', {
                      domain: state.domain || t('proxyHosts.placeholderDomain'),
                      certificates: t('nav.certificates'),
                    })}
                  </div>
                ) : (
                  <Select
                    className="w-full"
                    fullWidth
                    placeholder={t('proxyHosts.pickCert')}
                    selectedKey={state.certificateId ?? '__none__'}
                    variant="secondary"
                    onSelectionChange={(key) =>
                      setState((s) => ({
                        ...s,
                        certificateId:
                          key == null || String(key) === '__none__' ? null : String(key),
                      }))
                    }
                  >
                    <Select.Trigger className="cyber-input flex min-h-10 w-full items-center justify-between gap-2 text-left font-mono text-sm">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover className="cyber-popover">
                      <ListBox>
                        <ListBox.Item
                          className="font-mono text-sm"
                          id="__none__"
                          textValue={t('proxyHosts.pickCert')}
                        >
                          {t('proxyHosts.pickCert')}
                        </ListBox.Item>
                        {matchingCerts.map((c) => (
                          <ListBox.Item
                            key={c.id}
                            className="font-mono text-sm"
                            id={c.id}
                            textValue={t('proxyHosts.certOption', {
                              commonName: c.commonName,
                              sans: c.sans.join(', '),
                            })}
                          >
                            {t('proxyHosts.certOption', {
                              commonName: c.commonName,
                              sans: c.sans.join(', '),
                            })}
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                )}
              </div>
              <CheckboxRow
                checked={state.httpToHttps}
                onChange={(v) => setState((s) => ({ ...s, httpToHttps: v }))}
                title={t('proxyHosts.forceHttps')}
                hint={t('proxyHosts.forceHttpsHint')}
              />
              <CheckboxRow
                checked={state.hsts}
                onChange={(v) => setState((s) => ({ ...s, hsts: v }))}
                title={t('proxyHosts.hsts')}
                hint={t('proxyHosts.hstsHint')}
              />
              <CheckboxRow
                checked={state.http2}
                onChange={(v) => setState((s) => ({ ...s, http2: v }))}
                title={t('proxyHosts.http2')}
                hint={t('proxyHosts.http2Hint')}
              />
              <CheckboxRow
                checked={state.http3}
                onChange={(v) => setState((s) => ({ ...s, http3: v }))}
                title={
                  <span className="flex items-center gap-2">
                    {t('proxyHosts.http3')}
                    <Help text={t('proxyHosts.helpHttp3')} />
                  </span>
                }
                hint={t('proxyHosts.http3Hint')}
              />
            </>
          )}
        </div>
        )}

        <div className="flex flex-col gap-3">
          <span className="cyber-label">{t('proxyHosts.behaviour')}</span>
          {isL7 && (
            <>
              <CheckboxRow
                checked={state.wsSupport}
                onChange={(v) => setState((s) => ({ ...s, wsSupport: v }))}
                title={t('proxyHosts.wsSupport')}
                hint={t('proxyHosts.wsSupportHint')}
              />
              <CheckboxRow
                checked={state.blockExploits}
                onChange={(v) => setState((s) => ({ ...s, blockExploits: v }))}
                title={t('proxyHosts.blockExploits')}
                hint={t('proxyHosts.blockExploitsHint')}
              />
            </>
          )}
          {mode === 'edit' && (
            <CheckboxRow
              checked={state.enabled}
              onChange={(v) => setState((s) => ({ ...s, enabled: v }))}
              title={t('proxyHosts.enabled')}
              hint={t('proxyHosts.enabledHint')}
            />
          )}
        </div>

        {isL7 && (
          <div className="flex flex-col gap-3">
            <span className="cyber-label flex items-center gap-2">
              {t('proxyHosts.customHeadersSection')}
              <Help text={t('proxyHosts.helpCustomHeaders')} />
            </span>
            <div className="flex flex-col gap-2">
              {state.customHeaderRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1fr_auto] md:items-end">
                  <label className="flex flex-col gap-1">
                    <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                      {t('proxyHosts.headerName')}
                    </span>
                    <input
                      className="cyber-input font-mono text-sm"
                      placeholder={t('proxyHosts.headerNamePlaceholder')}
                      value={row.key}
                      onChange={(e) =>
                        setState((s) => {
                          const next = [...s.customHeaderRows];
                          next[idx] = { ...next[idx]!, key: e.target.value };
                          return { ...s, customHeaderRows: next };
                        })
                      }
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                      {t('proxyHosts.headerValue')}
                    </span>
                    <input
                      className="cyber-input font-mono text-sm"
                      value={row.value}
                      onChange={(e) =>
                        setState((s) => {
                          const next = [...s.customHeaderRows];
                          next[idx] = { ...next[idx]!, value: e.target.value };
                          return { ...s, customHeaderRows: next };
                        })
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost justify-self-start md:justify-self-end"
                    onClick={() =>
                      setState((s) => ({
                        ...s,
                        customHeaderRows:
                          s.customHeaderRows.length <= 1
                            ? [{ key: '', value: '' }]
                            : s.customHeaderRows.filter((_, i) => i !== idx),
                      }))
                    }
                  >
                    {t('actions.remove')}
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="cyber-btn cyber-btn-ghost self-start"
                onClick={() =>
                  setState((s) => ({
                    ...s,
                    customHeaderRows: [...s.customHeaderRows, { key: '', value: '' }],
                  }))
                }
              >
                {t('proxyHosts.addHeader')}
              </button>
            </div>
          </div>
        )}

        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">{t('proxyHosts.notesLabel')}</span>
          <textarea
            className="cyber-input min-h-[72px] resize-y font-mono text-sm"
            value={state.notes}
            onChange={(e) => setState((s) => ({ ...s, notes: e.target.value }))}
            placeholder={t('proxyHosts.notesPlaceholder')}
          />
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('proxyHosts.notesHint')}
          </span>
        </label>

        {mutation.isError && (
          <p className="cyber-mono text-sm">
            ! {mutation.error instanceof ApiError ? mutation.error.message : t('common.failed')}
          </p>
        )}
      </form>
    </Modal>
  );
}

function CheckboxRow({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  title: ReactNode;
  hint: string;
}) {
  return (
    <label
      className="cyber-card flex cursor-pointer items-start gap-3 px-4 py-3"
      style={{
        borderColor: checked ? 'var(--color-fg)' : 'var(--color-separator)',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: 'var(--color-fg)', marginTop: 2 }}
      />
      <div className="flex flex-col">
        <span className="cyber-mono text-sm">{title}</span>
        <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
          {hint}
        </span>
      </div>
    </label>
  );
}

// ─── helpers ──────────────────────────────────────────────────────────

function validateDomain(value: string): 'domainRequired' | 'domainInvalid' | null {
  const v = value.trim();
  if (!v) return 'domainRequired';
  if (!/^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i.test(v)) {
    return 'domainInvalid';
  }
  return null;
}

function validateForwardHost(value: string): 'forwardRequired' | 'forwardInvalid' | null {
  const v = value.trim();
  if (!v) return 'forwardRequired';
  if (!/^([a-z0-9_-]+(\.[a-z0-9_-]+)+|[0-9]{1,3}(\.[0-9]{1,3}){3}|localhost)$/i.test(v)) {
    return 'forwardInvalid';
  }
  return null;
}

/**
 * HAProxy логирует время в формате '02/May/2026:08:07:58.182' (UTC).
 * Конвертим в локальный часовой пояс браузера через Intl.DateTimeFormat.
 */
function formatHaproxyTime(t: string): string {
  if (!t) return '';
  // Пытаемся распарсить '02/May/2026:08:07:58.182'
  const m = /^(\d{1,2})\/(\w{3})\/(\d{4}):(\d{2}):(\d{2}):(\d{2})\.?(\d+)?$/.exec(t.trim());
  if (!m) return t;
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  };
  const mo = months[m[2]!];
  if (mo === undefined) return t;
  const d = new Date(Date.UTC(+m[3]!, mo, +m[1]!, +m[4]!, +m[5]!, +m[6]!, +(m[7] ?? 0)));
  if (Number.isNaN(d.getTime())) return t;
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return (
    d.toLocaleString(undefined, {
      year: '2-digit',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }) + `.${ms}`
  );
}

function sanMatches(san: string, domain: string): boolean {
  const d = domain.trim();
  if (!d || !san) return false;
  if (san === d) return true;
  if (san.startsWith('*.') && d.startsWith('*.')) return san === d;
  if (san.startsWith('*.')) {
    const base = san.slice(2);
    const parts = d.split('.');
    if (parts.length < 2) return false;
    return parts.slice(1).join('.') === base;
  }
  return false;
}
