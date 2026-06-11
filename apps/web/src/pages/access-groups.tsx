import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { PanelLoader } from '@/components/panel-loader';
import { type AccessGroupSummary, ApiError, api } from '@/lib/api';
import { COUNTRY_CODES, countryName } from '@/lib/countries';

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

type AuthRow = { username: string; password: string };

export default function AccessGroupsPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const clustersQ = useQuery({ queryKey: ['clusters'], queryFn: () => api.clusters.list() });
  const clusters = clustersQ.data ?? [];

  const [activeClusterId, setActiveClusterId] = useState<string | null>(null);
  useEffect(() => {
    if (!activeClusterId && clusters.length > 0) {
      setActiveClusterId(clusters[0]?.id);
    }
  }, [activeClusterId, clusters]);

  const groupsQ = useQuery({
    queryKey: ['access-groups', activeClusterId],
    queryFn: () => api.clusters.accessGroups.list(activeClusterId!),
    enabled: !!activeClusterId,
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<AccessGroupSummary | null>(null);

  const remove = useMutation({
    mutationFn: (g: AccessGroupSummary) => api.clusters.accessGroups.delete(activeClusterId!, g.id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['access-groups', activeClusterId] });
      qc.invalidateQueries({ queryKey: ['clusters'] });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('accessGroups.kicker')}
        title={t('accessGroups.title')}
        subtitle={t('accessGroups.subtitle')}
        right={
          <button
            type="button"
            className="cyber-btn"
            disabled={!activeClusterId}
            onClick={() => setCreateOpen(true)}
          >
            {t('accessGroups.newGroup')}
          </button>
        }
      />

      {clusters.length === 0 ? (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('accessGroups.noClusters')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('accessGroups.noClustersHint', { clusters: t('nav.clusters') })}
          </p>
        </div>
      ) : (
        <ClusterTabs
          clusters={clusters}
          activeId={activeClusterId}
          onChange={(id) => setActiveClusterId(id)}
        />
      )}

      {activeClusterId && clusters.length > 0 ? (
        <div
          className="cyber-card flex flex-col gap-3 px-5 py-4"
          style={{
            borderLeftWidth: 4,
            borderLeftStyle: 'solid',
            borderLeftColor: 'var(--color-fg)',
          }}
        >
          <span className="cyber-label">{t('accessGroups.calloutTitle')}</span>
          <div className="flex flex-col gap-3 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('accessGroups.calloutBody')
              .split('\n\n')
              .filter(Boolean)
              .map((para, i) => (
                <p key={i} className="leading-relaxed">
                  {para}
                </p>
              ))}
          </div>
        </div>
      ) : null}

      {groupsQ.isLoading && activeClusterId && <PanelLoader message={t('common.loading')} />}

      {groupsQ.data && groupsQ.data.length === 0 && (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('accessGroups.empty')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('accessGroups.emptyHint')}
          </p>
        </div>
      )}

      {groupsQ.data && groupsQ.data.length > 0 && (
        <div className="flex flex-col gap-2">
          {groupsQ.data.map((g) => (
            <div
              key={g.id}
              className="cyber-card flex flex-wrap items-center justify-between gap-3 px-5 py-4"
            >
              <div className="flex min-w-0 flex-col gap-1">
                <span className="cyber-mono text-sm font-medium">{g.name}</span>
                <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                  {t('accessGroups.metaLine', {
                    ips: g.ipCount,
                    denies: g.denyCount,
                    geo: g.geoCount,
                    users: g.userCount,
                    hosts: g.proxyHostCount,
                  })}
                </span>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  className="cyber-btn cyber-btn-ghost"
                  onClick={() => setEditingId(g.id)}
                >
                  {t('actions.edit')}
                </button>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-ghost"
                  onClick={() => setConfirmDelete(g)}
                >
                  {t('actions.delete')}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeClusterId && (
        <AccessGroupFormModal
          open={createOpen}
          mode="create"
          clusterId={activeClusterId}
          onClose={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['access-groups', activeClusterId] });
          }}
        />
      )}

      {activeClusterId && editingId && (
        <AccessGroupFormModal
          open={!!editingId}
          mode="edit"
          clusterId={activeClusterId}
          groupId={editingId}
          onClose={() => setEditingId(null)}
          onSaved={() => {
            setEditingId(null);
            qc.invalidateQueries({ queryKey: ['access-groups', activeClusterId] });
          }}
        />
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t('accessGroups.deleteTitle')}
        description={
          confirmDelete ? t('accessGroups.deleteDesc', { name: confirmDelete.name }) : ''
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
              onClick={() => confirmDelete && remove.mutate(confirmDelete)}
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

function AccessGroupFormModal({
  open,
  mode,
  clusterId,
  groupId,
  onClose,
  onSaved,
}: {
  open: boolean;
  mode: 'create' | 'edit';
  clusterId: string;
  groupId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const detailQ = useQuery({
    queryKey: ['access-group', clusterId, groupId],
    queryFn: () => api.clusters.accessGroups.get(clusterId, groupId!),
    enabled: open && mode === 'edit' && !!groupId,
  });

  const [name, setName] = useState('');
  const [ipText, setIpText] = useState('');
  const [denyText, setDenyText] = useState('');
  const [geoCodes, setGeoCodes] = useState<string[]>([]);
  const [geoSearch, setGeoSearch] = useState('');
  const [authRows, setAuthRows] = useState<AuthRow[]>([{ username: '', password: '' }]);

  useEffect(() => {
    if (!open) return;
    if (mode === 'create') {
      setName('');
      setIpText('');
      setDenyText('');
      setGeoCodes([]);
      setGeoSearch('');
      setAuthRows([{ username: '', password: '' }]);
      return;
    }
    const d = detailQ.data;
    if (!d) return;
    setName(d.name);
    setIpText(d.ipAllowlist.join('\n'));
    setDenyText(d.ipDenylist.join('\n'));
    setGeoCodes(d.geoDenylist);
    setGeoSearch('');
    setAuthRows(
      d.users.length > 0
        ? d.users.map((u) => ({ username: u.username, password: '' }))
        : [{ username: '', password: '' }],
    );
  }, [open, mode, detailQ.data]);

  const linesOf = (text: string) =>
    text
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

  const create = useMutation({
    mutationFn: () => {
      const users = authRows
        .filter((r) => r.username.trim() && r.password)
        .map((r) => ({ username: r.username.trim(), password: r.password }));
      return api.clusters.accessGroups.create(clusterId, {
        name: name.trim(),
        ipAllowlist: linesOf(ipText),
        ipDenylist: linesOf(denyText),
        geoDenylist: geoCodes,
        users,
      });
    },
    onSuccess: onSaved,
  });

  const update = useMutation({
    mutationFn: () => {
      if (!groupId) throw new Error('groupId');
      const users = authRows
        .filter((r) => r.username.trim())
        .map((r) => ({
          username: r.username.trim(),
          ...(r.password ? { password: r.password } : {}),
        }));
      return api.clusters.accessGroups.update(clusterId, groupId, {
        name: name.trim(),
        ipAllowlist: linesOf(ipText),
        ipDenylist: linesOf(denyText),
        geoDenylist: geoCodes,
        users,
      });
    },
    onSuccess: onSaved,
  });

  const mutation = mode === 'edit' ? update : create;
  const hasIp = ipText.split('\n').some((l) => l.trim());
  const hasDeny = denyText.split('\n').some((l) => l.trim());
  const hasUsers =
    mode === 'create'
      ? authRows.some((r) => r.username.trim() && r.password)
      : authRows.some((r) => r.username.trim());
  const canSubmit = name.trim().length > 0 && (hasIp || hasDeny || geoCodes.length > 0 || hasUsers);

  const { i18n } = useTranslation();
  const visibleCountries = COUNTRY_CODES.filter((cc) => {
    const q = geoSearch.trim().toLowerCase();
    if (!q) return true;
    return cc.includes(q) || countryName(cc, i18n.language).toLowerCase().includes(q);
  });
  const toggleGeo = (cc: string) =>
    setGeoCodes((prev) => (prev.includes(cc) ? prev.filter((x) => x !== cc) : [...prev, cc]));

  const loadingDetail = mode === 'edit' && detailQ.isLoading;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={
        mode === 'create' ? t('accessGroups.modalCreateTitle') : t('accessGroups.modalEditTitle')
      }
      description={t('accessGroups.modalDesc')}
      size="lg"
      footer={
        <>
          <button type="button" className="cyber-btn cyber-btn-ghost" onClick={onClose}>
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || mutation.isPending || loadingDetail}
            onClick={() => mutation.mutate()}
          >
            {mutation.isPending ? t('actions.saving') : t('actions.save')}
          </button>
        </>
      }
    >
      {loadingDetail ? (
        <PanelLoader message={t('common.loading')} />
      ) : (
        <form className="flex flex-col gap-5">
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('accessGroups.nameLabel')}</span>
            <input
              className="cyber-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('accessGroups.namePlaceholder')}
            />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('accessGroups.ipLabel')}</span>
            <textarea
              className="cyber-input min-h-[120px] resize-y font-mono text-xs"
              spellCheck={false}
              value={ipText}
              onChange={(e) => setIpText(e.target.value)}
              placeholder={t('accessGroups.ipPlaceholder')}
            />
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('accessGroups.ipHint')}
            </span>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('accessGroups.denyLabel')}</span>
            <textarea
              className="cyber-input min-h-[120px] resize-y font-mono text-xs"
              spellCheck={false}
              value={denyText}
              onChange={(e) => setDenyText(e.target.value)}
              placeholder={t('accessGroups.denyPlaceholder')}
            />
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('accessGroups.denyHint')}
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <span className="cyber-label">
              {t('accessGroups.geoLabel')}
              {geoCodes.length > 0 ? ` · ${geoCodes.length}` : ''}
            </span>
            <input
              className="cyber-input font-mono text-xs"
              placeholder={t('accessGroups.geoSearchPlaceholder')}
              value={geoSearch}
              onChange={(e) => setGeoSearch(e.target.value)}
            />
            <div
              className="grid max-h-[180px] grid-cols-2 gap-x-3 gap-y-1 overflow-y-auto rounded-sm border p-2 md:grid-cols-3"
              style={{ borderColor: 'var(--color-separator)' }}
            >
              {visibleCountries.map((cc) => (
                <label key={cc} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={geoCodes.includes(cc)}
                    onChange={() => toggleGeo(cc)}
                    style={{ accentColor: 'var(--color-fg)' }}
                  />
                  <span
                    className="cyber-mono truncate text-xs"
                    title={countryName(cc, i18n.language)}
                  >
                    {cc.toUpperCase()} · {countryName(cc, i18n.language)}
                  </span>
                </label>
              ))}
              {visibleCountries.length === 0 && (
                <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                  —
                </span>
              )}
            </div>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('accessGroups.geoHint')}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="cyber-label">{t('accessGroups.authLabel')}</span>
            {authRows.map((row, idx) => (
              <div key={idx} className="flex flex-wrap gap-2 md:flex-nowrap">
                <input
                  className="cyber-input flex-1 font-mono text-sm"
                  placeholder={t('accessGroups.authUser')}
                  value={row.username}
                  onChange={(e) => {
                    const next = [...authRows];
                    next[idx] = { ...next[idx]!, username: e.target.value };
                    setAuthRows(next);
                  }}
                />
                <input
                  className="cyber-input flex-1 font-mono text-sm"
                  type="password"
                  placeholder={
                    mode === 'edit' ? t('accessGroups.authPassKeep') : t('accessGroups.authPass')
                  }
                  autoComplete="new-password"
                  value={row.password}
                  onChange={(e) => {
                    const next = [...authRows];
                    next[idx] = { ...next[idx]!, password: e.target.value };
                    setAuthRows(next);
                  }}
                />
                <button
                  type="button"
                  className="cyber-btn cyber-btn-ghost shrink-0"
                  onClick={() => setAuthRows(authRows.filter((_, i) => i !== idx))}
                >
                  {t('actions.remove')}
                </button>
              </div>
            ))}
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost self-start"
              onClick={() => setAuthRows([...authRows, { username: '', password: '' }])}
            >
              {t('accessGroups.addUser')}
            </button>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('accessGroups.authHint')}
            </span>
          </div>

          {mutation.isError && (
            <p className="cyber-mono text-sm">
              ! {mutation.error instanceof ApiError ? mutation.error.message : t('common.failed')}
            </p>
          )}
        </form>
      )}
    </Modal>
  );
}
