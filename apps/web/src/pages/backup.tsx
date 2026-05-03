import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ApiError, api } from '@/lib/api';

export default function BackupPage() {
  const { t } = useTranslation();
  const fileRef = useRef<HTMLInputElement>(null);
  const [restored, setRestored] = useState<Record<string, number> | null>(null);
  const [confirmRestore, setConfirmRestore] = useState<unknown | null>(null);

  const download = useMutation({
    mutationFn: () => api.backup.download(),
    onSuccess: ({ blob, filename }) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },
  });

  const restore = useMutation({
    mutationFn: (payload: unknown) => api.backup.restore(payload),
    onSuccess: (res) => {
      setRestored(res.restored);
      setConfirmRestore(null);
    },
  });

  const onPick = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = reader.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || parsed.version !== 1 || !parsed.data) {
          throw new Error(t('backup.invalidFile'));
        }
        setConfirmRestore(parsed);
      } catch (err) {
        alert(err instanceof Error ? err.message : t('common.failed'));
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('backup.kicker')}
        title={t('backup.title')}
        subtitle={t('backup.subtitle')}
      />

      <div
        className="cyber-card flex flex-col gap-3 px-5 py-4"
        style={{ borderLeftWidth: 4, borderLeftStyle: 'solid', borderLeftColor: 'var(--color-fg)' }}
      >
        <span className="cyber-label">{t('backup.exportTitle')}</span>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('backup.exportDesc')}
        </p>
        <button
          type="button"
          className="cyber-btn self-start"
          disabled={download.isPending}
          onClick={() => download.mutate()}
        >
          {download.isPending ? t('backup.preparing') : t('backup.downloadBtn')}
        </button>
        {download.isError && (
          <p className="cyber-mono text-sm">
            ! {download.error instanceof ApiError ? download.error.message : t('common.failed')}
          </p>
        )}
      </div>

      <div className="cyber-card flex flex-col gap-3 px-5 py-4">
        <span className="cyber-label">{t('backup.importTitle')}</span>
        <p className="text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('backup.importDesc')}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="cyber-btn cyber-btn-ghost self-start"
            onClick={() => fileRef.current?.click()}
            disabled={restore.isPending}
          >
            {t('backup.pickFile')}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          />
        </div>
        {restored && (
          <pre
            className="cyber-mono whitespace-pre-wrap break-words text-xs"
            style={{ color: 'var(--color-muted)' }}
          >
            {Object.entries(restored)
              .map(([k, v]) => `${k}: ${v}`)
              .join('\n')}
          </pre>
        )}
      </div>

      {confirmRestore != null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="cyber-card flex w-full max-w-md flex-col gap-4 px-5 py-5">
            <span className="cyber-label">{t('backup.confirmTitle')}</span>
            <p className="text-sm">{t('backup.confirmBody')}</p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="cyber-btn cyber-btn-ghost"
                onClick={() => setConfirmRestore(null)}
                disabled={restore.isPending}
              >
                {t('actions.cancel')}
              </button>
              <button
                type="button"
                className="cyber-btn"
                onClick={() => restore.mutate(confirmRestore)}
                disabled={restore.isPending}
              >
                {restore.isPending ? t('backup.restoring') : t('backup.restoreBtn')}
              </button>
            </div>
            {restore.isError && (
              <p className="cyber-mono text-sm">
                ! {restore.error instanceof ApiError ? restore.error.message : t('common.failed')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
