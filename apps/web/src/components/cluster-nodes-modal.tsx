import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal } from '@/components/modal';
import { ApiError, type ClusterNode, type ClusterNodeInput, api } from '@/lib/api';

type FormState = {
  name: string;
  transport: 'LOCAL' | 'SSH';
  sshHost: string;
  sshPort: number;
  sshUser: string;
  haproxyDataDir: string;
  reloadMode: 'CONTAINER' | 'SYSTEMD' | 'SIGNAL' | 'MASTER_CLI';
  reloadTarget: string;
  role: 'PRIMARY' | 'SECONDARY';
};

const RELOAD_MODES = ['SYSTEMD', 'CONTAINER', 'SIGNAL', 'MASTER_CLI'] as const;

function emptyForm(): FormState {
  return {
    name: '',
    transport: 'SSH',
    sshHost: '',
    sshPort: 22,
    sshUser: 'root',
    haproxyDataDir: '/etc/haproxy',
    reloadMode: 'SYSTEMD',
    reloadTarget: '',
    role: 'SECONDARY',
  };
}

function formFromNode(n: ClusterNode): FormState {
  return {
    name: n.name,
    transport: n.transport,
    sshHost: n.sshHost ?? '',
    sshPort: n.sshPort ?? 22,
    sshUser: n.sshUser ?? 'root',
    haproxyDataDir: n.haproxyDataDir,
    reloadMode: n.reloadMode,
    reloadTarget: n.reloadTarget ?? '',
    role: n.role,
  };
}

function toInput(f: FormState): ClusterNodeInput {
  return {
    name: f.name.trim(),
    transport: f.transport,
    sshHost: f.transport === 'SSH' ? f.sshHost.trim() : null,
    sshPort: f.sshPort,
    sshUser: f.sshUser.trim() || 'root',
    haproxyDataDir: f.haproxyDataDir.trim() || '/etc/haproxy',
    reloadMode: f.reloadMode,
    reloadTarget: f.reloadTarget.trim() || null,
    role: f.role,
  };
}

export function ClusterNodesModal({
  clusterId,
  clusterName,
  open,
  onClose,
}: {
  clusterId: string;
  clusterName: string;
  open: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const nodesQ = useQuery({
    queryKey: ['nodes', clusterId],
    queryFn: () => api.clusters.nodes.list(clusterId),
    enabled: open,
  });
  const sshKeyQ = useQuery({
    queryKey: ['ssh-key'],
    queryFn: () => api.sshKey.get(),
    enabled: open,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [keyCopied, setKeyCopied] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['nodes', clusterId] });
    qc.invalidateQueries({ queryKey: ['clusters'] });
  };

  const save = useMutation({
    mutationFn: () =>
      editing === 'new'
        ? api.clusters.nodes.create(clusterId, toInput(form))
        : api.clusters.nodes.update(clusterId, editing as string, toInput(form)),
    onSuccess: () => {
      setEditing(null);
      invalidate();
    },
  });
  const del = useMutation({
    mutationFn: (nodeId: string) => api.clusters.nodes.delete(clusterId, nodeId),
    onSuccess: invalidate,
  });
  const test = useMutation({
    mutationFn: (nodeId: string) => api.clusters.nodes.test(clusterId, nodeId),
    onSuccess: (res, nodeId) => {
      setTestResult((prev) => ({
        ...prev,
        [nodeId]: `${res.ok ? '✓' : '✗'} ${res.detail ?? ''} (${res.durationMs}ms)`,
      }));
      invalidate();
    },
  });
  const promote = useMutation({
    mutationFn: (nodeId: string) => api.clusters.nodes.promote(clusterId, nodeId),
    onSuccess: invalidate,
  });

  const startEdit = (n?: ClusterNode) => {
    setForm(n ? formFromNode(n) : emptyForm());
    setEditing(n ? n.id : 'new');
    save.reset();
  };

  const canSubmit =
    form.name.trim().length > 0 && (form.transport === 'LOCAL' || form.sshHost.trim().length > 0);

  const copyKey = async () => {
    if (!sshKeyQ.data) return;
    await navigator.clipboard.writeText(sshKeyQ.data.publicKey).catch(() => {});
    setKeyCopied(true);
    setTimeout(() => setKeyCopied(false), 1500);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={t('nodes.title', { name: clusterName })}
      description={t('nodes.desc')}
      size="lg"
      footer={
        <button type="button" className="cyber-btn cyber-btn-ghost" onClick={onClose}>
          {t('actions.close')}
        </button>
      }
    >
      <div className="flex flex-col gap-5">
        {/* SSH public key — для authorized_keys на удалённых нодах */}
        <div className="flex flex-col gap-1.5">
          <span className="cyber-label">{t('nodes.sshKeyLabel')}</span>
          {sshKeyQ.data ? (
            <div className="flex items-start gap-2">
              <code
                className="cyber-mono block max-h-[72px] flex-1 overflow-y-auto break-all rounded-sm border p-2 text-xs"
                style={{ borderColor: 'var(--color-separator)' }}
              >
                {sshKeyQ.data.publicKey}
              </code>
              <button
                type="button"
                className="cyber-btn cyber-btn-ghost shrink-0"
                onClick={copyKey}
              >
                {keyCopied ? '✓' : t('actions.copy')}
              </button>
            </div>
          ) : (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              …
            </span>
          )}
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('nodes.sshKeyHint')}
          </span>
        </div>

        {/* Список нод */}
        <div className="flex flex-col gap-2">
          {(nodesQ.data ?? []).map((n) => (
            <div key={n.id} className="cyber-card flex flex-col gap-2 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="cyber-mono text-sm font-medium">{n.name}</span>
                  <span className="cyber-tag">{n.transport}</span>
                  <span className="cyber-tag">{n.role}</span>
                  <span className="cyber-tag">
                    {n.status}
                    {n.lastSeenAt ? ` · ${new Date(n.lastSeenAt).toLocaleTimeString()}` : ''}
                  </span>
                  {n.transport === 'SSH' && (
                    <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                      {n.sshUser}@{n.sshHost}:{n.sshPort}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    disabled={test.isPending}
                    onClick={() => test.mutate(n.id)}
                  >
                    {t('nodes.test')}
                  </button>
                  {n.role !== 'PRIMARY' && (
                    <button
                      type="button"
                      className="cyber-btn cyber-btn-ghost"
                      onClick={() => promote.mutate(n.id)}
                    >
                      {t('nodes.promote')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => startEdit(n)}
                  >
                    {t('actions.edit')}
                  </button>
                  <button
                    type="button"
                    className="cyber-btn cyber-btn-ghost"
                    onClick={() => del.mutate(n.id)}
                  >
                    {t('actions.delete')}
                  </button>
                </div>
              </div>
              {testResult[n.id] && (
                <span className="cyber-mono break-all text-xs">{testResult[n.id]}</span>
              )}
            </div>
          ))}
          {nodesQ.data && nodesQ.data.length === 0 && (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('nodes.empty')}
            </span>
          )}
        </div>

        {editing === null ? (
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost self-start"
            onClick={() => startEdit()}
          >
            {t('nodes.add')}
          </button>
        ) : (
          <form
            className="flex flex-col gap-3 rounded-sm border p-3"
            style={{ borderColor: 'var(--color-separator)' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (canSubmit) save.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.name')}</span>
                <input
                  className="cyber-input"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="edge-1"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.transport')}</span>
                <select
                  className="cyber-input"
                  value={form.transport}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, transport: e.target.value as 'LOCAL' | 'SSH' }))
                  }
                >
                  <option value="SSH">SSH</option>
                  <option value="LOCAL">LOCAL</option>
                </select>
              </label>
              {form.transport === 'SSH' && (
                <>
                  <label className="flex flex-col gap-1">
                    <span className="cyber-label">{t('nodes.sshHost')}</span>
                    <input
                      className="cyber-input"
                      value={form.sshHost}
                      onChange={(e) => setForm((f) => ({ ...f, sshHost: e.target.value }))}
                      placeholder="10.0.0.2"
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="cyber-label">{t('nodes.sshPort')}</span>
                    <input
                      className="cyber-input"
                      type="number"
                      min={1}
                      max={65535}
                      value={form.sshPort}
                      onChange={(e) => setForm((f) => ({ ...f, sshPort: Number(e.target.value) }))}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="cyber-label">{t('nodes.sshUser')}</span>
                    <input
                      className="cyber-input"
                      value={form.sshUser}
                      onChange={(e) => setForm((f) => ({ ...f, sshUser: e.target.value }))}
                    />
                  </label>
                </>
              )}
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.dataDir')}</span>
                <input
                  className="cyber-input"
                  value={form.haproxyDataDir}
                  onChange={(e) => setForm((f) => ({ ...f, haproxyDataDir: e.target.value }))}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.reloadMode')}</span>
                <select
                  className="cyber-input"
                  value={form.reloadMode}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      reloadMode: e.target.value as FormState['reloadMode'],
                    }))
                  }
                >
                  {RELOAD_MODES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.reloadTarget')}</span>
                <input
                  className="cyber-input"
                  value={form.reloadTarget}
                  onChange={(e) => setForm((f) => ({ ...f, reloadTarget: e.target.value }))}
                  placeholder={t('nodes.reloadTargetPlaceholder')}
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="cyber-label">{t('nodes.role')}</span>
                <select
                  className="cyber-input"
                  value={form.role}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, role: e.target.value as FormState['role'] }))
                  }
                >
                  <option value="PRIMARY">PRIMARY</option>
                  <option value="SECONDARY">SECONDARY</option>
                </select>
              </label>
            </div>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('nodes.layoutHint')}
            </span>
            {save.isError && (
              <span className="cyber-mono text-xs">
                ! {save.error instanceof ApiError ? save.error.message : 'Failed'}
              </span>
            )}
            <div className="flex gap-2">
              <button type="submit" className="cyber-btn" disabled={!canSubmit || save.isPending}>
                {save.isPending ? t('actions.saving') : t('actions.save')}
              </button>
              <button
                type="button"
                className="cyber-btn cyber-btn-ghost"
                onClick={() => setEditing(null)}
              >
                {t('actions.cancel')}
              </button>
            </div>
          </form>
        )}
      </div>
    </Modal>
  );
}
