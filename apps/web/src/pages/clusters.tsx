import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ClusterNodesModal } from '@/components/cluster-nodes-modal';
import { Help } from '@/components/help';
import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { PanelLoader } from '@/components/panel-loader';
import { type ApplyResult, ApiError, api } from '@/lib/api';

type ClusterMode = 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE';
const MODE_VALUES: ClusterMode[] = ['STANDALONE', 'ACTIVE_PASSIVE', 'ACTIVE_ACTIVE'];

export default function ClustersPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['clusters'],
    queryFn: () => api.clusters.list(),
  });

  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{
    id: string;
    name: string;
    mode: ClusterMode;
    logFormat: string | null;
  } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; name: string } | null>(null);
  const [nodesTarget, setNodesTarget] = useState<{ id: string; name: string } | null>(null);
  const [applyResult, setApplyResult] = useState<{ clusterName: string; res: ApplyResult } | null>(
    null,
  );

  const apply = useMutation({
    mutationFn: (c: { id: string; name: string }) =>
      api.clusters.apply(c.id).then((res) => ({ clusterName: c.name, res })),
    onSuccess: (data) => setApplyResult(data),
    onError: (err, c) =>
      setApplyResult({
        clusterName: c.name,
        res: {
          hostsApplied: 0,
          certsLoaded: 0,
          reloadOk: false,
          reloadError: err instanceof ApiError ? err.message : String(err),
          nodes: [],
        },
      }),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.clusters.delete(id),
    onSuccess: () => {
      setConfirmDelete(null);
      qc.invalidateQueries({ queryKey: ['clusters'] });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('clusters.kicker')}
        title={t('clusters.title')}
        subtitle={t('clusters.subtitle')}
        right={
          <button type="button" className="cyber-btn" onClick={() => setCreateOpen(true)}>
            {t('actions.newCluster')}
          </button>
        }
      />

      {isLoading && <PanelLoader message={t('common.loading')} />}
      {error && (
        <p className="cyber-mono text-sm">
          {t('common.error', { message: (error as Error).message })}
        </p>
      )}

      {data && data.length === 0 && (
        <div className="cyber-card flex flex-col items-start gap-3 px-5 py-5">
          <span className="cyber-mono text-sm">{t('clusters.noClusters')}</span>
          <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('clusters.noClustersHint')}
          </p>
          <button type="button" className="cyber-btn" onClick={() => setCreateOpen(true)}>
            {t('actions.newCluster')}
          </button>
        </div>
      )}

      {data && data.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {data.map((cluster) => (
            <div key={cluster.id} className="cyber-card px-5 py-5">
              <div className="flex items-center justify-between gap-3">
                <span className="cyber-mono text-sm font-medium">{cluster.name}</span>
                <span className="cyber-tag">{cluster.mode}</span>
              </div>
              <div
                className="cyber-mono mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-3"
                style={{ color: 'var(--color-muted)' }}
              >
                <div className="flex flex-col">
                  <span>{t('clusters.info.nodes')}</span>
                  <span className="text-base" style={{ color: 'var(--color-fg)' }}>
                    {cluster.nodesCount ?? 0}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span>{t('clusters.info.proxyHosts')}</span>
                  <span className="text-base" style={{ color: 'var(--color-fg)' }}>
                    {cluster.proxyHostsCount ?? 0}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span>{t('clusters.info.created')}</span>
                  <span className="text-xs" style={{ color: 'var(--color-fg)' }}>
                    {new Date(cluster.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <span
                  className="cyber-mono block min-w-0 truncate text-xs"
                  style={{ color: 'var(--color-muted)' }}
                  title={cluster.id}
                >
                  {cluster.id}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => setNodesTarget({ id: cluster.id, name: cluster.name })}
                  >
                    {t('clusters.nodesBtn')}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    disabled={apply.isPending}
                    onClick={() => apply.mutate({ id: cluster.id, name: cluster.name })}
                  >
                    {apply.isPending ? t('actions.applying') : t('actions.apply')}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() =>
                      setEditTarget({
                        id: cluster.id,
                        name: cluster.name,
                        mode: cluster.mode as ClusterMode,
                        logFormat: cluster.logFormat ?? null,
                      })
                    }
                  >
                    {t('actions.edit')}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => setConfirmDelete({ id: cluster.id, name: cluster.name })}
                  >
                    {t('actions.delete')}
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <CreateClusterModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={() => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ['clusters'] });
        }}
      />

      <EditClusterModal
        target={editTarget}
        onClose={() => setEditTarget(null)}
        onSaved={() => {
          setEditTarget(null);
          qc.invalidateQueries({ queryKey: ['clusters'] });
        }}
      />

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t('clusters.deleteModalTitle')}
        description={
          confirmDelete ? t('clusters.deleteModalDesc', { name: confirmDelete.name }) : ''
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
            ! {remove.error instanceof ApiError ? remove.error.message : 'Failed'}
          </p>
        )}
      </Modal>

      {nodesTarget && (
        <ClusterNodesModal
          clusterId={nodesTarget.id}
          clusterName={nodesTarget.name}
          open
          onClose={() => setNodesTarget(null)}
        />
      )}

      <Modal
        open={!!applyResult}
        onClose={() => setApplyResult(null)}
        title={applyResult ? t('clusters.applyResultTitle', { name: applyResult.clusterName }) : ''}
        description={t('clusters.applyResultDesc')}
        size="sm"
        footer={
          <button type="button" className="cyber-btn" onClick={() => setApplyResult(null)}>
            {t('actions.close')}
          </button>
        }
      >
        {applyResult && (
          <div className="cyber-mono flex flex-col gap-2 text-sm">
            <span>
              {applyResult.res.reloadOk
                ? t('clusters.applyOk')
                : t('clusters.applyFailed', {
                    error: applyResult.res.reloadError ?? 'unknown error',
                  })}
            </span>
            <span style={{ color: 'var(--color-muted)' }}>
              {t('clusters.applyHosts', { count: applyResult.res.hostsApplied })}
            </span>
            <span style={{ color: 'var(--color-muted)' }}>
              {t('clusters.applyCerts', { count: applyResult.res.certsLoaded })}
            </span>
            {applyResult.res.nodes.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <span className="cyber-label">{t('clusters.applyNodesLabel')}</span>
                {applyResult.res.nodes.map((n) => (
                  <div
                    key={n.nodeId}
                    className="flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2"
                    style={{ borderColor: 'var(--color-separator)' }}
                  >
                    <span>{n.ok ? '✓' : '✗'}</span>
                    <span>{n.nodeName}</span>
                    <span className="cyber-tag">{n.transport}</span>
                    {n.error && (
                      <span className="break-all text-xs" style={{ color: 'var(--color-muted)' }}>
                        {n.error}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}

function CreateClusterModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ClusterMode>('STANDALONE');
  const [touched, setTouched] = useState(false);

  const nameError = validateClusterName(name);
  const showError = touched && nameError !== null;
  const canSubmit = nameError === null;

  const create = useMutation({
    mutationFn: () => api.clusters.create({ name: name.trim(), mode }),
    onSuccess: () => {
      setName('');
      setMode('STANDALONE');
      setTouched(false);
      onCreated();
    },
  });

  const reset = () => {
    setName('');
    setMode('STANDALONE');
    setTouched(false);
    create.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={reset}
      title={t('clusters.newClusterModalTitle')}
      description={t('clusters.newClusterModalDesc')}
      footer={
        <>
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost"
            onClick={reset}
            disabled={create.isPending}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || create.isPending}
            onClick={() => {
              setTouched(true);
              if (canSubmit) create.mutate();
            }}
          >
            {create.isPending ? t('actions.saving') : `${t('actions.create')} ▸`}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (canSubmit) create.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">
            {t('clusters.nameLabel')} <span style={{ color: 'var(--color-fg)' }}>*</span>
          </span>
          <input
            className="cyber-input"
            placeholder="prod-edge"
            value={name}
            onBlur={() => setTouched(true)}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={showError}
            style={
              showError
                ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                : undefined
            }
          />
          {showError ? (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
              ! {nameError}
            </span>
          ) : (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('clusters.nameHint')}
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="cyber-label flex items-center gap-2">
            {t('clusters.modeLabel')}
            <Help text={t('clusters.modeHelpSummary')} />
          </span>
          <div className="flex flex-col gap-1.5">
            {MODE_VALUES.map((value) => (
              <label
                key={value}
                className="cyber-card flex cursor-pointer items-start gap-3 px-4 py-3"
                style={{
                  borderColor: mode === value ? 'var(--color-fg)' : 'var(--color-separator)',
                  boxShadow: mode === value ? '0 0 0 1px var(--color-fg)' : 'none',
                }}
              >
                <input
                  type="radio"
                  name="cluster-mode"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  style={{ accentColor: 'var(--color-fg)', marginTop: 2 }}
                />
                <div className="flex flex-col">
                  <span className="cyber-mono text-sm">{t(`clusters.modes.${value}`)}</span>
                  <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t(`clusters.modeHints.${value}`)}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        {create.isError && (
          <p className="cyber-mono text-sm">
            ! {create.error instanceof ApiError ? create.error.message : 'Failed'}
          </p>
        )}
      </form>
    </Modal>
  );
}

function EditClusterModal({
  target,
  onClose,
  onSaved,
}: {
  target: { id: string; name: string; mode: ClusterMode; logFormat: string | null } | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [mode, setMode] = useState<ClusterMode>('STANDALONE');
  const [logFormat, setLogFormat] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (target) {
      setName(target.name);
      setMode(target.mode);
      setLogFormat(target.logFormat ?? '');
      setTouched(false);
    }
  }, [target?.id]);

  const nameError = validateClusterName(name);
  const showError = touched && nameError !== null;
  const dirty =
    !!target &&
    (name.trim() !== target.name ||
      mode !== target.mode ||
      (logFormat.trim() || null) !== (target.logFormat ?? null));
  const canSubmit = nameError === null && dirty;

  const save = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('no target');
      return api.clusters.update(target.id, {
        name: name.trim(),
        mode,
        logFormat: logFormat.trim() || null,
      });
    },
    onSuccess: () => {
      setName('');
      setTouched(false);
      onSaved();
    },
  });

  const reset = () => {
    setName('');
    setMode('STANDALONE');
    setTouched(false);
    save.reset();
    onClose();
  };

  return (
    <Modal
      open={!!target}
      onClose={reset}
      title={t('clusters.editModalTitle')}
      description={target ? t('clusters.editModalDesc', { id: target.id }) : ''}
      footer={
        <>
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost"
            onClick={reset}
            disabled={save.isPending}
          >
            {t('actions.cancel')}
          </button>
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || save.isPending}
            onClick={() => {
              setTouched(true);
              if (canSubmit) save.mutate();
            }}
          >
            {save.isPending ? t('actions.saving') : `${t('actions.save')} ▸`}
          </button>
        </>
      }
    >
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (canSubmit) save.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">
            {t('clusters.nameLabel')} <span style={{ color: 'var(--color-fg)' }}>*</span>
          </span>
          <input
            className="cyber-input"
            value={name}
            onBlur={() => setTouched(true)}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={showError}
            style={
              showError
                ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                : undefined
            }
          />
          {showError ? (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
              ! {nameError}
            </span>
          ) : (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('clusters.nameHint')}
            </span>
          )}
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="cyber-label flex items-center gap-2">
            {t('clusters.modeLabel')}
            <Help text={t('clusters.modeHelpSummary')} />
          </span>
          <div className="flex flex-col gap-1.5">
            {MODE_VALUES.map((value) => (
              <label
                key={value}
                className="cyber-card flex cursor-pointer items-start gap-3 px-4 py-3"
                style={{
                  borderColor: mode === value ? 'var(--color-fg)' : 'var(--color-separator)',
                  boxShadow: mode === value ? '0 0 0 1px var(--color-fg)' : 'none',
                }}
              >
                <input
                  type="radio"
                  name="cluster-mode-edit"
                  value={value}
                  checked={mode === value}
                  onChange={() => setMode(value)}
                  style={{ accentColor: 'var(--color-fg)', marginTop: 2 }}
                />
                <div className="flex flex-col">
                  <span className="cyber-mono text-sm">{t(`clusters.modes.${value}`)}</span>
                  <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t(`clusters.modeHints.${value}`)}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">{t('clusters.logFormatLabel')}</span>
          <input
            className="cyber-input font-mono text-xs"
            spellCheck={false}
            value={logFormat}
            onChange={(e) => setLogFormat(e.target.value)}
            placeholder={t('clusters.logFormatPlaceholder')}
          />
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('clusters.logFormatHint')}
          </span>
        </label>

        {save.isError && (
          <p className="cyber-mono text-sm">
            ! {save.error instanceof ApiError ? save.error.message : 'Failed'}
          </p>
        )}
      </form>
    </Modal>
  );
}

function validateClusterName(value: string): string | null {
  const v = value.trim();
  if (!v) return 'name is required';
  if (v.length > 64) return 'name is too long';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(v))
    return 'must start with letter/digit; allowed: letters, digits, space, _, -';
  return null;
}
