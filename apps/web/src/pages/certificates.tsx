import { ListBox, Select, Spinner } from '@heroui/react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Modal } from '@/components/modal';
import { PageHeader } from '@/components/page-header';
import { ApiError, type Certificate, type DnsProvider, api } from '@/lib/api';

const RESERVED_TLDS = new Set(['local', 'localhost', 'test', 'invalid', 'example']);
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type EmailErr =
  | null
  | { k: 'emailRequired' | 'emailInvalid' | 'emailPublicTld' }
  | { k: 'emailReservedTld'; tld: string };

function validateEmail(value: string): EmailErr {
  const v = value.trim();
  if (!v) return { k: 'emailRequired' };
  if (!EMAIL_REGEX.test(v)) return { k: 'emailInvalid' };
  const tld = v.split('@')[1]?.split('.').pop()?.toLowerCase();
  if (!tld || tld.length < 2) return { k: 'emailPublicTld' };
  if (RESERVED_TLDS.has(tld)) return { k: 'emailReservedTld', tld };
  return null;
}

function emailErrMessage(err: EmailErr, t: TFunction): string {
  if (!err) return '';
  if (err.k === 'emailReservedTld')
    return t('certificates.errors.emailReservedTld', { tld: err.tld });
  return t(`certificates.errors.${err.k}`);
}

export default function CertificatesPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();

  const providersQ = useQuery({
    queryKey: ['cf-providers'],
    queryFn: () => api.certificates.listProviders(),
  });
  const certsQ = useQuery({
    queryKey: ['certs'],
    queryFn: () => api.certificates.list(),
  });

  const providers = providersQ.data ?? [];
  const certificates = certsQ.data ?? [];

  return (
    <div className="flex flex-col gap-10">
      <PageHeader
        kicker={t('certificates.kicker')}
        title={t('certificates.title')}
        subtitle={t('certificates.subtitle')}
      />

      <DnsProvidersSection
        providers={providers}
        loading={providersQ.isLoading}
        onChange={() => qc.invalidateQueries({ queryKey: ['cf-providers'] })}
      />

      <IssueSection
        providers={providers}
        onIssued={() => {
          qc.invalidateQueries({ queryKey: ['certs'] });
        }}
      />

      <UploadSection
        onUploaded={() => {
          qc.invalidateQueries({ queryKey: ['certs'] });
        }}
      />

      <CertificatesSection
        certificates={certificates}
        loading={certsQ.isLoading}
        onChange={() => qc.invalidateQueries({ queryKey: ['certs'] })}
      />
    </div>
  );
}

// ─── DNS Providers ────────────────────────────────────────────────────

function DnsProvidersSection({
  providers,
  loading,
  onChange,
}: {
  providers: DnsProvider[];
  loading: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [accountId, setAccountId] = useState('');
  const [showHelp, setShowHelp] = useState(false);

  const save = useMutation({
    mutationFn: () =>
      api.certificates.saveCloudflareProvider({
        name: name || t('certificates.placeholderProviderName'),
        apiToken: token,
        accountId: accountId || undefined,
      }),
    onSuccess: () => {
      setToken('');
      setAccountId('');
      onChange();
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => api.certificates.deleteProvider(id),
    onSuccess: () => onChange(),
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="cyber-label">{t('certificates.providers')}</span>
        <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
          {t('certificates.providersConfigured', { count: providers.length })}
        </span>
      </div>

      {loading ? (
        <div className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('certificates.loadingProviders')}
        </div>
      ) : providers.length === 0 ? (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('certificates.providerNoneConnected')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('certificates.providerNoneHint')}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {providers.map((p) => (
            <div key={p.id} className="cyber-card px-5 py-5">
              <div className="flex items-center justify-between gap-2">
                <div className="flex flex-col">
                  <span className="cyber-mono text-sm font-medium">{p.name}</span>
                  <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                    {t('certificates.providerZones', { kind: p.kind, count: p.zones.length })}
                  </span>
                </div>
                <button
                  type="button"
                  className="cyber-btn cyber-btn-ghost"
                  onClick={() => del.mutate(p.id)}
                  disabled={del.isPending}
                >
                  {t('actions.remove')}
                </button>
              </div>
              <ul className="cyber-mono mt-3 grid grid-cols-1 gap-1 text-xs md:grid-cols-2">
                {p.zones.slice(0, 12).map((z) => (
                  <li key={z.id}>· {z.name}</li>
                ))}
                {p.zones.length > 12 && (
                  <li style={{ color: 'var(--color-muted)' }}>
                    {t('certificates.zonesMore', { count: p.zones.length - 12 })}
                  </li>
                )}
              </ul>
            </div>
          ))}
        </div>
      )}

      <details
        className="group px-4 py-3"
        style={{ border: '1px solid var(--color-separator)', borderRadius: 2 }}
        open={showHelp}
        onToggle={(e) => setShowHelp((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cyber-mono flex cursor-pointer items-center justify-between text-sm select-none">
          ▸ {t('certificates.connectCloudflare')}
          <span className="cyber-label transition-transform group-open:rotate-180">▾</span>
        </summary>
        <div className="mt-4 flex flex-col gap-4">
          <ol
            className="list-decimal space-y-1 pl-5 text-sm"
            style={{ color: 'var(--color-muted)' }}
          >
            <li>{t('certificates.cfHelp1')}</li>
            <li>{t('certificates.cfHelp2')}</li>
            <li>{t('certificates.cfHelp3')}</li>
            <li>{t('certificates.cfHelp4')}</li>
          </ol>

          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.providerNameLabel')}</span>
            <input
              className="cyber-input"
              placeholder={t('certificates.placeholderProviderName')}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.apiTokenLabel')}</span>
            <input
              className="cyber-input"
              type="password"
              placeholder={t('certificates.placeholderApiToken')}
              value={token}
              onChange={(e) => setToken(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.accountIdOptionalLabel')}</span>
            <input
              className="cyber-input"
              placeholder={t('certificates.placeholderAccountId')}
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
            />
          </label>

          <div>
            <button
              type="button"
              className="cyber-btn"
              disabled={token.length < 20 || save.isPending}
              aria-disabled={token.length < 20 || save.isPending}
              onClick={() => save.mutate()}
            >
              {save.isPending
                ? t('certificates.connectVerifying')
                : t('certificates.connectAction')}
            </button>
          </div>
          {save.isError && (
            <p className="cyber-mono text-xs">
              !{' '}
              {save.error instanceof ApiError
                ? save.error.message
                : t('certificates.failedToConnect')}
            </p>
          )}
        </div>
      </details>
    </section>
  );
}

// ─── Issue wildcard ───────────────────────────────────────────────────

function IssueSection({
  providers,
  onIssued,
}: {
  providers: DnsProvider[];
  onIssued: () => void;
}) {
  const { t } = useTranslation();
  const allZones = useMemo(() => {
    const seen = new Map<string, { providerId: string; zoneId: string; zoneName: string }>();
    for (const p of providers) {
      for (const z of p.zones) {
        const key = z.name;
        if (!seen.has(key)) seen.set(key, { providerId: p.id, zoneId: z.id, zoneName: z.name });
      }
    }
    return Array.from(seen.values()).sort((a, b) => a.zoneName.localeCompare(b.zoneName));
  }, [providers]);

  const [providerId, setProviderId] = useState('');
  const [domain, setDomain] = useState('');
  const [wildcard, setWildcard] = useState(true);
  // Production по умолчанию (валидные сертификаты, доверяемые браузерами).
  // staging=true — для тестов / без рейтлимитов LE.
  const [staging, setStaging] = useState(false);
  const [email, setEmail] = useState('');
  const [emailTouched, setEmailTouched] = useState(false);

  // Auto-fill providerId when zone is picked
  const setZone = (zoneName: string) => {
    setDomain(zoneName);
    const match = allZones.find((z) => z.zoneName === zoneName);
    if (match) setProviderId(match.providerId);
  };

  const emailError = validateEmail(email);
  const showEmailError = emailTouched && emailError !== null;
  const canSubmit = !!domain && !!providerId && emailError === null;

  const issue = useMutation({
    mutationFn: () =>
      api.certificates.issue({
        providerId,
        domain,
        wildcard,
        email,
        staging,
      }),
    onSuccess: () => {
      onIssued();
    },
  });

  if (providers.length === 0) return null;

  const placeholderDom = t('certificates.issuePlaceholderDomain');
  const issueDomainLabel =
    domain.trim() === '' ? placeholderDom : wildcard ? `*.${domain}` : domain;

  return (
    <section className="flex flex-col gap-4">
      <span className="cyber-label">{t('certificates.issueWildcardKicker')}</span>
      <div className="cyber-card px-6 py-5 flex flex-col gap-5">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_140px]">
          <div className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.domainLabel')}</span>
            <Select
              className="w-full"
              fullWidth
              placeholder={t('certificates.selectZone')}
              selectedKey={domain || undefined}
              variant="secondary"
              onSelectionChange={(key) => setZone(key == null ? '' : String(key))}
            >
              <Select.Trigger className="cyber-input flex min-h-10 w-full items-center justify-between gap-2 text-left font-mono text-sm">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="cyber-popover">
                <ListBox>
                  {allZones.map((z) => (
                    <ListBox.Item
                      key={z.zoneId}
                      className="font-mono text-sm"
                      id={z.zoneName}
                      textValue={z.zoneName}
                    >
                      {z.zoneName}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          </div>
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.sanLabel')}</span>
            <label
              className="cyber-mono flex h-10 cursor-pointer items-center gap-2 px-3 text-sm"
              style={{ border: '1px solid var(--color-separator)', borderRadius: 2 }}
            >
              <input
                type="checkbox"
                checked={wildcard}
                onChange={(e) => setWildcard(e.target.checked)}
                style={{ accentColor: 'var(--color-fg)' }}
              />
              {t('certificates.wildcard')}
            </label>
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_180px]">
          <label className="flex flex-col gap-1.5">
            <span className="cyber-label">
              {t('certificates.emailLabel')} <span style={{ color: 'var(--color-fg)' }}>*</span>
            </span>
            <input
              className="cyber-input"
              type="email"
              required
              autoComplete="email"
              placeholder={t('certificates.emailPlaceholder')}
              value={email}
              onBlur={() => setEmailTouched(true)}
              onChange={(e) => setEmail(e.target.value)}
              aria-invalid={showEmailError}
              style={
                showEmailError
                  ? { borderColor: 'var(--color-fg)', boxShadow: '0 0 0 1px var(--color-fg)' }
                  : undefined
              }
            />
            {showEmailError ? (
              <span className="cyber-mono text-xs" style={{ color: 'var(--color-fg)' }}>
                ! {emailErrMessage(emailError, t)}
              </span>
            ) : (
              <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
                {t('certificates.emailHint')}
              </span>
            )}
          </label>
          <div className="flex flex-col gap-1.5">
            <span className="cyber-label">{t('certificates.endpointLabel')}</span>
            <Select
              className="w-full"
              fullWidth
              selectedKey={staging ? 'staging' : 'production'}
              variant="secondary"
              onSelectionChange={(key) => setStaging(String(key) === 'staging')}
            >
              <Select.Trigger className="cyber-input flex min-h-10 w-full items-center justify-between gap-2 text-left font-mono text-sm">
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover className="cyber-popover">
                <ListBox>
                  <ListBox.Item
                    className="font-mono text-sm"
                    id="production"
                    textValue={t('certificates.endpointProd')}
                  >
                    {t('certificates.endpointProd')}
                  </ListBox.Item>
                  <ListBox.Item
                    className="font-mono text-sm"
                    id="staging"
                    textValue={t('certificates.endpointStaging')}
                  >
                    {t('certificates.endpointStaging')}
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {staging ? t('certificates.endpointStagingHint') : t('certificates.endpointProdHint')}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || issue.isPending}
            aria-disabled={!canSubmit || issue.isPending}
            onClick={() => {
              setEmailTouched(true);
              if (canSubmit) issue.mutate();
            }}
          >
            {issue.isPending ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" /> {t('actions.issuing')}
              </span>
            ) : (
              t('certificates.issueButton', { domain: issueDomainLabel })
            )}
          </button>
          {issue.isPending && (
            <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
              {t('certificates.delayHint')}
            </span>
          )}
        </div>

        {issue.isError && (
          <p className="cyber-mono text-sm">
            !{' '}
            {issue.error instanceof ApiError ? issue.error.message : t('certificates.issueFailed')}
          </p>
        )}
        {issue.isSuccess && (
          <p className="cyber-mono text-sm">
            {t('certificates.issueSuccess', {
              commonName: issue.data.commonName,
              sans: issue.data.sans.join(', '),
              date: new Date(issue.data.notAfter).toLocaleDateString(),
            })}
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Upload PEM ───────────────────────────────────────────────────────

function UploadSection({ onUploaded }: { onUploaded: () => void }) {
  const { t } = useTranslation();
  const [certPem, setCertPem] = useState('');
  const [keyPem, setKeyPem] = useState('');

  const canSubmit = certPem.trim().length > 0 && keyPem.trim().length > 0;

  const upload = useMutation({
    mutationFn: () => api.certificates.upload({ certPem, keyPem }),
    onSuccess: () => {
      setCertPem('');
      setKeyPem('');
      onUploaded();
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <span className="cyber-label">{t('certificates.uploadKicker')}</span>
      <div className="cyber-card flex flex-col gap-4 px-6 py-5">
        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">{t('certificates.uploadCertPem')}</span>
          <textarea
            className="cyber-input min-h-[140px] resize-y font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            value={certPem}
            onChange={(e) => setCertPem(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="cyber-label">{t('certificates.uploadKeyPem')}</span>
          <textarea
            className="cyber-input min-h-[100px] resize-y font-mono text-xs"
            spellCheck={false}
            autoComplete="off"
            value={keyPem}
            onChange={(e) => setKeyPem(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="cyber-btn"
            disabled={!canSubmit || upload.isPending}
            aria-disabled={!canSubmit || upload.isPending}
            onClick={() => upload.mutate()}
          >
            {upload.isPending ? (
              <span className="flex items-center gap-2">
                <Spinner size="sm" /> {t('certificates.uploadUploading')}
              </span>
            ) : (
              t('certificates.uploadButton')
            )}
          </button>
        </div>
        {upload.isError && (
          <p className="cyber-mono text-sm">
            !{' '}
            {upload.error instanceof ApiError
              ? upload.error.message
              : t('certificates.uploadFailed')}
          </p>
        )}
        {upload.isSuccess && upload.data && (
          <p className="cyber-mono text-sm">
            {t('certificates.uploadSuccess', {
              commonName: upload.data.commonName,
              date: new Date(upload.data.notAfter).toLocaleDateString(),
            })}
          </p>
        )}
      </div>
    </section>
  );
}

// ─── Certificates list ────────────────────────────────────────────────

function CertCard({
  cert,
  isSelected,
  onSelect,
  onDelete,
  onChange,
  deleteDisabled,
}: {
  cert: Certificate;
  isSelected: boolean;
  onSelect: () => void;
  onDelete: () => void;
  onChange: () => void;
  deleteDisabled: boolean;
}) {
  const { t } = useTranslation();
  const renew = useMutation({
    mutationFn: () => api.certificates.renew(cert.id),
    onSuccess: onChange,
  });

  const issued = new Date(cert.notBefore);
  const expires = new Date(cert.notAfter);
  const total = expires.getTime() - issued.getTime();
  const elapsed = Date.now() - issued.getTime();
  const pct = Math.max(0, Math.min(100, (elapsed / total) * 100));
  const daysLeft = Math.round((expires.getTime() - Date.now()) / 86_400_000);
  const renewAt = new Date(expires.getTime() - 10 * 86_400_000);
  const renewSoon = daysLeft <= 10;
  const renewOverdue = daysLeft <= 0;

  return (
    <label
      className="cyber-card flex cursor-pointer flex-col gap-3 px-5 py-4"
      style={{
        borderColor: isSelected ? 'var(--color-fg)' : 'var(--color-separator)',
        boxShadow: isSelected ? '0 0 0 1px var(--color-fg)' : 'none',
      }}
    >
      <div className="flex items-center gap-4">
        <input
          type="radio"
          name="cert"
          checked={isSelected}
          onChange={onSelect}
          style={{ accentColor: 'var(--color-fg)' }}
        />
        <div className="flex flex-1 flex-col">
          <span className="cyber-mono text-sm font-medium">{cert.commonName}</span>
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('certificates.sanLine', { list: cert.sans.join(', ') })}
          </span>
          <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
            {t('certificates.certMeta', {
              issuer: cert.issuer,
              source: cert.source,
              fp: cert.fingerprintSha256.slice(0, 12),
            })}
          </span>
        </div>
        <button
          type="button"
          className="cyber-btn cyber-btn-ghost"
          disabled={renew.isPending || cert.source !== 'ACME'}
          title={
            cert.source !== 'ACME' ? t('certificates.renewOnlyAcme') : t('certificates.renewNow')
          }
          onClick={(e) => {
            e.preventDefault();
            renew.mutate();
          }}
        >
          {renew.isPending ? t('actions.renewing') : t('actions.renew')}
        </button>
        <button
          type="button"
          className="cyber-btn cyber-btn-ghost"
          onClick={(e) => {
            e.preventDefault();
            onDelete();
          }}
          disabled={deleteDisabled}
        >
          {t('actions.delete')}
        </button>
      </div>

      {/* Прогресс-бар срока действия */}
      <div className="flex flex-col gap-1.5">
        <div
          style={{
            height: 6,
            border: '1px solid var(--color-separator)',
            borderRadius: 2,
            overflow: 'hidden',
            background: 'var(--color-bg)',
          }}
        >
          <div
            style={{
              width: `${pct.toFixed(1)}%`,
              height: '100%',
              background: renewOverdue ? '#dc2626' : renewSoon ? '#eab308' : 'var(--color-fg)',
              transition: 'width 200ms ease',
            }}
          />
        </div>
        <div
          className="cyber-mono flex items-center justify-between text-xs"
          style={{ color: 'var(--color-muted)' }}
        >
          <span>{t('certificates.issued', { date: issued.toLocaleDateString() })}</span>
          <span>
            {renewOverdue
              ? t('certificates.expiredAgo', { days: -daysLeft })
              : renewSoon
                ? t('certificates.renewDue', { days: daysLeft })
                : t('certificates.renewAt', {
                    date: renewAt.toLocaleDateString(),
                    days: daysLeft - 10,
                  })}
          </span>
          <span>{t('certificates.expires', { date: expires.toLocaleDateString() })}</span>
        </div>
      </div>

      {renew.isError && (
        <p className="cyber-mono text-xs">
          ! {renew.error instanceof ApiError ? renew.error.message : t('certificates.renewFailed')}
        </p>
      )}
    </label>
  );
}

function CertificatesSection({
  certificates,
  loading,
  onChange,
}: {
  certificates: Certificate[];
  loading: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Certificate | null>(null);
  const del = useMutation({
    mutationFn: (id: string) => api.certificates.delete(id),
    onSuccess: () => {
      setSelectedId(null);
      setConfirmDelete(null);
      onChange();
    },
  });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="cyber-label">{t('certificates.issuedCertsKicker')}</span>
        <span className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
          {t('certificates.totalCerts', {
            total: certificates.length,
            selected: selectedId ? '1' : '0',
          })}
        </span>
      </div>

      {loading ? (
        <div className="cyber-mono text-sm" style={{ color: 'var(--color-muted)' }}>
          {t('certificates.loadingCerts')}
        </div>
      ) : certificates.length === 0 ? (
        <div className="cyber-card px-5 py-5">
          <span className="cyber-mono text-sm">{t('certificates.noCertsYet')}</span>
          <p className="mt-2 text-sm" style={{ color: 'var(--color-muted)' }}>
            {t('certificates.noCertsHint')}
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {certificates.map((c) => (
            <CertCard
              key={c.id}
              cert={c}
              isSelected={selectedId === c.id}
              onSelect={() => setSelectedId(c.id)}
              onDelete={() => setConfirmDelete(c)}
              onChange={onChange}
              deleteDisabled={del.isPending}
            />
          ))}
        </div>
      )}

      <Modal
        open={!!confirmDelete}
        onClose={() => setConfirmDelete(null)}
        title={t('certificates.deleteCertTitle')}
        description={
          confirmDelete
            ? t('certificates.deleteCertDesc', {
                commonName: confirmDelete.commonName,
                sans: confirmDelete.sans.join(', '),
              })
            : ''
        }
        size="sm"
        footer={
          <>
            <button
              type="button"
              className="cyber-btn cyber-btn-ghost"
              onClick={() => setConfirmDelete(null)}
              disabled={del.isPending}
            >
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              className="cyber-btn"
              disabled={del.isPending}
              onClick={() => confirmDelete && del.mutate(confirmDelete.id)}
            >
              {del.isPending ? t('actions.deleting') : t('actions.delete')}
            </button>
          </>
        }
      >
        {del.isError && (
          <p className="cyber-mono text-sm">
            ! {del.error instanceof ApiError ? del.error.message : t('common.failed')}
          </p>
        )}
      </Modal>

      {selectedId && (
        <p className="cyber-mono text-xs" style={{ color: 'var(--color-muted)' }}>
          {t('certificates.selectionNote')}
        </p>
      )}
    </section>
  );
}
