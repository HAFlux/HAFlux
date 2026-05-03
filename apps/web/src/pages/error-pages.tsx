import { ListBox, Select, Spinner } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { PanelLoader } from '@/components/panel-loader';
import { ApiError, api } from '@/lib/api';

const HTTP_ERROR_CODES = [400, 403, 408, 500, 502, 503, 504] as const;

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

export default function ErrorPagesPage() {
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

  const [selectedCode, setSelectedCode] = useState<number>(503);
  const [draftHtml, setDraftHtml] = useState('');

  const filesQ = useQuery({
    queryKey: ['cluster-error-files', activeClusterId],
    queryFn: () => api.clusters.errorFiles.list(activeClusterId!),
    enabled: !!activeClusterId,
  });

  const items = filesQ.data ?? [];

  useEffect(() => {
    const row = items.find((i) => i.code === selectedCode);
    if (row) setDraftHtml(row.html);
  }, [selectedCode, items]);

  const activeItem = useMemo(
    () => items.find((i) => i.code === selectedCode),
    [items, selectedCode],
  );

  const dirty = !!(activeItem && draftHtml !== activeItem.html);

  const save = useMutation({
    mutationFn: () => {
      if (!activeClusterId) throw new Error('no cluster');
      return api.clusters.errorFiles.update(activeClusterId, selectedCode, { html: draftHtml });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cluster-error-files', activeClusterId] });
    },
  });

  const reset = useMutation({
    mutationFn: () => {
      if (!activeClusterId) throw new Error('no cluster');
      return api.clusters.errorFiles.reset(activeClusterId, selectedCode);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cluster-error-files', activeClusterId] });
    },
  });

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('errorPages.kicker')}
        title={t('errorPages.title')}
        subtitle={t('errorPages.subtitle')}
      />

      {clusters.length === 0 ? (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('errorPages.noClusters')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('errorPages.noClustersHint', { clusters: t('nav.clusters') })}
          </p>
        </div>
      ) : (
        <ClusterTabs
          clusters={clusters}
          activeId={activeClusterId}
          onChange={(id) => setActiveClusterId(id)}
        />
      )}

      {activeClusterId && filesQ.isLoading && <PanelLoader message={t('errorPages.loading')} />}

      {activeClusterId && filesQ.isError && (
        <p className="cyber-mono text-sm">
          ! {filesQ.error instanceof ApiError ? filesQ.error.message : t('errorPages.loadFailed')}
        </p>
      )}

      {activeClusterId && filesQ.data && activeItem && (
        <div className="cyber-card flex flex-col gap-4 px-6 py-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="cyber-label">{t('errorPages.codeLabel')}</span>
              <Select
                className="w-full max-w-xs"
                fullWidth
                selectedKey={String(selectedCode)}
                variant="secondary"
                onSelectionChange={(key) =>
                  setSelectedCode(Number.parseInt(key == null ? '503' : String(key), 10))
                }
              >
                <Select.Trigger className="cyber-input flex min-h-10 w-full items-center justify-between gap-2 text-left font-mono text-sm">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover>
                  <ListBox>
                    {HTTP_ERROR_CODES.map((code) => (
                      <ListBox.Item
                        key={code}
                        className="font-mono text-sm"
                        id={String(code)}
                        textValue={String(code)}
                      >
                        {code}
                      </ListBox.Item>
                    ))}
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <span
              className="cyber-tag shrink-0 self-start md:self-auto"
              style={activeItem.isCustom ? { borderColor: 'var(--color-fg)' } : { opacity: 0.75 }}
            >
              {activeItem.isCustom ? t('errorPages.badgeCustom') : t('errorPages.badgeDefault')}
            </span>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('errorPages.htmlLabel')}</span>
            <textarea
              className="cyber-input min-h-[280px] resize-y font-mono text-xs"
              spellCheck={false}
              value={draftHtml}
              onChange={(e) => setDraftHtml(e.target.value)}
            />
          </label>

          <p className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('errorPages.hintReload')}
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              className="cyber-btn"
              disabled={!dirty || save.isPending || !draftHtml.trim()}
              onClick={() => save.mutate()}
            >
              {save.isPending ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" /> {t('actions.saving')}
                </span>
              ) : (
                t('actions.save')
              )}
            </button>
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              disabled={!activeItem.isCustom || reset.isPending}
              onClick={() => reset.mutate()}
            >
              {reset.isPending ? (
                <span className="flex items-center gap-2">
                  <Spinner size="sm" /> {t('errorPages.resetting')}
                </span>
              ) : (
                t('errorPages.reset')
              )}
            </button>
          </div>

          {save.isError && (
            <p className="cyber-mono text-sm">
              ! {save.error instanceof ApiError ? save.error.message : t('errorPages.saveFailed')}
            </p>
          )}
          {reset.isError && (
            <p className="cyber-mono text-sm">
              !{' '}
              {reset.error instanceof ApiError ? reset.error.message : t('errorPages.resetFailed')}
            </p>
          )}
          {save.isSuccess && <p className="cyber-mono text-sm">{t('errorPages.saveSuccess')}</p>}
          {reset.isSuccess && <p className="cyber-mono text-sm">{t('errorPages.resetSuccess')}</p>}
        </div>
      )}
    </div>
  );
}
