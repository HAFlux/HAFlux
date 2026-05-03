import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { PageHeader } from '@/components/page-header';
import { ApiError, api } from '@/lib/api';

export default function ProfilePage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const meQ = useQuery({ queryKey: ['me'], queryFn: () => api.me.get() });

  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (meQ.data) {
      setEmail(meQ.data.email);
      setDisplayName(meQ.data.displayName ?? '');
    }
  }, [meQ.data]);

  const update = useMutation({
    mutationFn: () => {
      const body: {
        currentPassword: string;
        email?: string;
        displayName?: string;
        newPassword?: string;
      } = { currentPassword };
      if (meQ.data && email !== meQ.data.email) body.email = email;
      if (meQ.data && displayName !== (meQ.data.displayName ?? '')) body.displayName = displayName;
      if (newPassword) body.newPassword = newPassword;
      return api.me.update(body);
    },
    onSuccess: () => {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      qc.invalidateQueries({ queryKey: ['me'] });
    },
  });

  const passMismatch = newPassword.length > 0 && newPassword !== confirmPassword;
  const passTooShort = newPassword.length > 0 && newPassword.length < 8;
  const hasChanges =
    !!meQ.data &&
    (email !== meQ.data.email ||
      displayName !== (meQ.data.displayName ?? '') ||
      newPassword.length > 0);
  const canSubmit = !!currentPassword && hasChanges && !passMismatch && !passTooShort;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        kicker={t('profile.kicker')}
        title={t('profile.title')}
        subtitle={t('profile.subtitle')}
      />

      {meQ.isLoading && (
        <div className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('profile.loading')}
        </div>
      )}

      {meQ.data && (
        <form
          className="cyber-card flex flex-col gap-5 px-6 py-6 max-w-2xl"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) update.mutate();
          }}
        >
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t('profile.userIdLabel')}>
              <input
                className="cyber-input"
                value={meQ.data.id}
                readOnly
                style={{ color: 'var(--color-muted)' }}
              />
            </Field>
            <Field label={t('profile.displayNameLabel')}>
              <input
                className="cyber-input"
                value={displayName}
                placeholder="Root"
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </Field>
          </div>

          <Field label={t('profile.emailLabel')}>
            <input
              className="cyber-input"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </Field>

          <div
            className="cyber-divider"
            style={{ borderTop: '1px solid var(--color-separator)', marginTop: 4 }}
          />

          <Field label={t('profile.currentPasswordLabel')}>
            <input
              className="cyber-input"
              type="password"
              autoComplete="current-password"
              placeholder={t('profile.currentPasswordHint')}
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Field label={t('profile.newPasswordLabel')}>
              <input
                className="cyber-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('profile.newPasswordHint')}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                aria-invalid={passTooShort}
                style={
                  passTooShort
                    ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                    : undefined
                }
              />
              {passTooShort && (
                <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                  ! {t('profile.minChars')}
                </span>
              )}
            </Field>
            <Field label={t('profile.confirmPasswordLabel')}>
              <input
                className="cyber-input"
                type="password"
                autoComplete="new-password"
                placeholder={t('profile.confirmPasswordHint')}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                aria-invalid={passMismatch}
                disabled={!newPassword}
                style={
                  passMismatch
                    ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                    : undefined
                }
              />
              {passMismatch && (
                <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                  ! {t('profile.noMatch')}
                </span>
              )}
            </Field>
          </div>

          {update.isError && (
            <p className="cyber-mono text-sm">
              ! {update.error instanceof ApiError ? update.error.message : 'Update failed'}
            </p>
          )}
          {update.isSuccess && (
            <p className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
              {t('profile.saved')}
              {update.data.passwordChanged ? ` ${t('profile.savedReLogin')}` : ''}
            </p>
          )}

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              onClick={() => {
                if (meQ.data) {
                  setEmail(meQ.data.email);
                  setDisplayName(meQ.data.displayName ?? '');
                }
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');
                update.reset();
              }}
              disabled={update.isPending}
            >
              {t('profile.reset')}
            </button>
            <button type="submit" className="cyber-btn" disabled={!canSubmit || update.isPending}>
              {update.isPending ? t('actions.saving') : t('profile.saveChanges')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="cyber-label">{label}</span>
      {children}
    </label>
  );
}
