import { Resolver } from 'node:dns/promises';
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as acme from 'acme-client';
type AcmeAuthz = { identifier: { value: string }; wildcard?: boolean; url?: string };
type AcmeChallenge = { type: string; url?: string; token?: string };
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { CloudflareDnsProvider } from './cloudflare.provider';
import { CryptoService, toBytes } from './crypto.service';

export interface IssueOptions {
  orgId: string;
  domain: string; // apex (e.g. example.com)
  wildcard: boolean; // true → SAN: example.com + *.example.com
  email: string;
  staging: boolean;
  cfApiToken: string;
}

export interface IssueResult {
  certPem: string;
  keyPem: string;
  notBefore: Date;
  notAfter: Date;
  sans: string[];
  issuer: string;
}

// Per-HTTP-request timeout для acme-client (бьёт по ВСЕМ вызовам LE).
// Без него любая зависшая connect/read к ACME подвешивает весь issue navсегда.
// 30s достаточно: LE отвечает за <2s в норме, 30s — запас на сетевой джиттер.
const ACME_HTTP_TIMEOUT_MS = 30_000;
// Видели наблюдаемый hang acme-client.auto() против LE production без явной
// ошибки — кладём общий бюджет, чтобы запрос не висел вечно.
const ACME_FLOW_BUDGET_MS = 8 * 60 * 1000;
// Сколько ждать пропагации TXT в 1.1.1.1 после записи в Cloudflare.
const DNS_PROPAGATION_MAX_MS = 90_000;
const DNS_PROPAGATION_POLL_MS = 3_000;
// Дополнительный grace после того как 1.1.1.1 увидел TXT — у LE свои resolver'ы.
const DNS_PROPAGATION_GRACE_MS = 10_000;

// acme-client использует общий axios под капотом. Выставляем таймаут один раз.
// Делаем это idempotent (модуль может загружаться повторно при HMR).
type AcmeWithAxios = typeof acme & {
  axios?: { defaults: { timeout: number } };
};
const acmeWithAxios = acme as AcmeWithAxios;
if (
  acmeWithAxios.axios?.defaults &&
  acmeWithAxios.axios.defaults.timeout !== ACME_HTTP_TIMEOUT_MS
) {
  acmeWithAxios.axios.defaults.timeout = ACME_HTTP_TIMEOUT_MS;
}

/**
 * ACME-клиент через библиотеку `acme-client` (RFC 8555) + DNS-01 через
 * Cloudflare API напрямую. Без subprocess. Полный pipeline в Node:
 *   accountKey → CSR → order → DNS-01 challenge → poll → finalize → cert.
 *
 * Production по умолчанию (валидные browser-trusted сертификаты).
 * Staging — опция (LE staging, без рейтлимитов; cert не доверяется браузером).
 */
@Injectable()
export class AcmeService {
  private readonly logger = new Logger(AcmeService.name);

  constructor(
    private readonly cf: CloudflareDnsProvider,
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /**
   * Достаёт существующий ACME-аккаунт для (orgId, directoryUrl) или создаёт
   * новый и сохраняет в `AcmeAccount`. Без переиспользования каждый issue()
   * создаёт свежий аккаунт, и за день диагностики/повторов мы упираемся в
   * лимит LE prod «10 регистраций с IP за 3ч» — `client.auto()` начинает
   * висеть на createAccount, ожидая Retry-After.
   */
  private async resolveAccount(
    orgId: string,
    directoryUrl: string,
    email: string,
  ): Promise<{ accountKey: Buffer; accountUrl?: string; isNew: boolean }> {
    const existing = await this.prisma.acmeAccount.findFirst({
      where: { orgId, directoryUrl },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      try {
        const pem = this.crypto.decrypt(Buffer.from(existing.encryptedKey));
        return { accountKey: pem, accountUrl: existing.kid ?? undefined, isNew: false };
      } catch (err) {
        // ENCRYPTION_KEY мог поменяться — выкидываем стухшую запись и идём
        // создавать новую (потеряем только KID, не сами сертификаты).
        this.logger.warn(
          `AcmeAccount ${existing.id} decrypt failed, recreating: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await this.prisma.acmeAccount.delete({ where: { id: existing.id } });
      }
    }
    const fresh = await acme.crypto.createPrivateKey();
    return { accountKey: fresh, accountUrl: undefined, isNew: true };
  }

  private async persistAccount(
    orgId: string,
    directoryUrl: string,
    email: string,
    accountKey: Buffer,
    kid: string,
  ): Promise<void> {
    await this.prisma.acmeAccount.create({
      data: {
        orgId,
        provider: 'letsencrypt',
        email,
        directoryUrl,
        kid,
        encryptedKey: toBytes(this.crypto.encrypt(accountKey)),
      },
    });
  }

  async issue(opts: IssueOptions): Promise<IssueResult> {
    const directoryUrl = opts.staging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production;

    const altNames = opts.wildcard ? [opts.domain, `*.${opts.domain}`] : [opts.domain];
    const tag = `${altNames.join(',')} (${opts.staging ? 'staging' : 'production'})`;
    this.logger.log(`ACME issue: ${tag}`);

    const t0 = Date.now();
    const elapsed = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;

    // Map authz.identifier.value (e.g. 'fstgm1.com' / '*.fstgm1.com') →
    // ID созданной нами TXT-записи в Cloudflare. Нужен потому, что для wildcard
    // обе authz используют один FQDN `_acme-challenge.<apex>` с разными
    // keyAuthorization, и acme-client обрабатывает их параллельно. Каждая
    // challengeRemoveFn должна снять ИМЕННО свою запись, а не «все TXT по имени» —
    // иначе removeFn первой завершившейся authz убивает TXT второй, и LE
    // получает NXDOMAIN при валидации.
    const ourTxtIds = new Map<string, { zoneId: string; recordId: string }>();

    let certPem: string;
    let keyPem: string;
    try {
      const { accountKey, accountUrl, isNew } = await this.resolveAccount(
        opts.orgId,
        directoryUrl,
        opts.email,
      );
      this.logger.log(
        `[${elapsed()}] account: ${isNew ? 'NEW (will register)' : `reuse kid=${accountUrl?.slice(-12) ?? '?'}`}`,
      );
      // Если есть kid — acme-client пропускает newAccount и сразу JWS-кид всё подписывает.
      const client = new acme.Client({ directoryUrl, accountKey, accountUrl });

      const [keyBuf, csrBuf] = await acme.crypto.createCsr({
        commonName: opts.domain,
        altNames,
      });
      keyPem = keyBuf.toString();
      this.logger.log(`[${elapsed()}] CSR ready, calling client.auto()`);

      const certBuf = await this.withBudget(
        client.auto({
          csr: csrBuf,
          email: opts.email,
          termsOfServiceAgreed: true,
          challengePriority: ['dns-01'],
          challengeCreateFn: (authz, challenge, keyAuthorization) =>
            this.handleChallengeCreate(
              opts.cfApiToken,
              authz,
              challenge,
              keyAuthorization,
              ourTxtIds,
              elapsed,
            ),
          challengeRemoveFn: (authz, challenge) =>
            this.handleChallengeRemove(opts.cfApiToken, authz, challenge, ourTxtIds, elapsed),
        }),
        ACME_FLOW_BUDGET_MS,
        `ACME flow exceeded ${ACME_FLOW_BUDGET_MS / 1000}s budget`,
      );
      certPem = certBuf.toString();
      this.logger.log(`[${elapsed()}] cert issued for ${tag}`);

      // Если это был свежий аккаунт — auto() уже зарегистрировал его в LE,
      // KID лежит в client.getAccountUrl(). Сохраняем чтобы следующий issue()
      // переиспользовал его и не упирался в «10 регистраций с IP за 3ч».
      if (isNew) {
        try {
          const kid = client.getAccountUrl();
          await this.persistAccount(opts.orgId, directoryUrl, opts.email, accountKey, kid);
          this.logger.log(`[${elapsed()}] persisted ACME account kid=${kid.slice(-12)}`);
        } catch (e) {
          // Сертификат уже выдан — некритично, просто следующий issue
          // зарегистрирует свежий аккаунт.
          this.logger.warn(
            `[${elapsed()}] failed to persist ACME account: ${e instanceof Error ? e.message : String(e)}`,
          );
        }
      }
    } catch (err) {
      if (err instanceof AppException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`[${elapsed()}] ACME failed for ${tag}: ${message}`);
      throw new AppException(
        ErrorCode.ACME_FAILED,
        `ACME (${opts.staging ? 'staging' : 'production'}) failed after ${elapsed()}: ${message}`,
        502,
      );
    } finally {
      // Если acme-client упал до challengeRemoveFn (или мы аборнулись по бюджету)
      // — сами вычистим оставшиеся наши TXT, чтобы не засорять зону.
      if (ourTxtIds.size > 0) {
        for (const [fqdn, ours] of ourTxtIds) {
          try {
            await this.cf.removeTxtRecord(opts.cfApiToken, ours.zoneId, ours.recordId);
            this.logger.log(`[${elapsed()}] post-flight cleanup: removed TXT for ${fqdn}`);
          } catch (e) {
            this.logger.warn(
              `[${elapsed()}] post-flight cleanup ${ours.recordId} failed: ${
                e instanceof Error ? e.message : String(e)
              }`,
            );
          }
        }
        ourTxtIds.clear();
      }
    }

    const info = acme.crypto.readCertificateInfo(certPem);
    return {
      certPem,
      keyPem,
      notBefore: info.notBefore,
      notAfter: info.notAfter,
      sans: info.domains?.altNames?.length ? info.domains.altNames : altNames,
      issuer:
        info.issuer?.commonName ?? (opts.staging ? "(STAGING) Let's Encrypt" : "Let's Encrypt"),
    };
  }

  private async handleChallengeCreate(
    cfApiToken: string,
    authz: AcmeAuthz,
    challenge: AcmeChallenge,
    keyAuthorization: string,
    ourTxtIds: Map<string, { zoneId: string; recordId: string }>,
    elapsed: () => string,
  ): Promise<void> {
    if (challenge.type !== 'dns-01') {
      throw new Error(`Unsupported challenge type ${challenge.type}`);
    }
    const fqdn = authz.identifier.value;
    const apex = fqdn.replace(/^\*\./, '');
    const txtName = `_acme-challenge.${apex}`;
    const zone = await this.cf.resolveZoneId(cfApiToken, apex);
    const recordId = await this.cf.addTxtRecord(cfApiToken, zone.id, txtName, keyAuthorization);
    // Per RFC 8555, для wildcard authz `identifier.value` это apex без `*.`
    // (отличаются только флагом authz.wildcard). Поэтому ключом Map берём
    // (apex, wildcard) — иначе wildcard-authz перетирает apex-authz.
    const label = `${fqdn}/${authz.wildcard ? 'wildcard' : 'apex'}`;
    ourTxtIds.set(label, { zoneId: zone.id, recordId });
    this.logger.log(`[${elapsed()}] TXT для ${label} записан (id=${recordId}), жду пропагации`);

    // Опрос recursive resolver (1.1.1.1) пока наша конкретная keyAuthorization не появится.
    // Для wildcard в одном FQDN живут ДВЕ TXT (apex + *.apex с разными keyAuth) — поэтому
    // фильтруем по ИМЕННО НАШЕМУ значению, а не "хотя бы одна TXT появилась".
    const visible = await this.waitForTxtVisible(txtName, keyAuthorization);
    if (!visible) {
      this.logger.warn(
        `[${elapsed()}] TXT ${txtName} не виден через 1.1.1.1 за ${DNS_PROPAGATION_MAX_MS / 1000}s — продолжаю, LE может всё равно успеть`,
      );
    } else {
      this.logger.log(`[${elapsed()}] TXT ${txtName} виден на 1.1.1.1`);
    }
    // Дополнительная пауза: у LE свои geo-распределённые resolver'ы. 10s обычно хватает.
    await new Promise((r) => setTimeout(r, DNS_PROPAGATION_GRACE_MS));
  }

  private async handleChallengeRemove(
    cfApiToken: string,
    authz: AcmeAuthz,
    challenge: AcmeChallenge,
    ourTxtIds: Map<string, { zoneId: string; recordId: string }>,
    elapsed: () => string,
  ): Promise<void> {
    if (challenge.type !== 'dns-01') return;
    const fqdn = authz.identifier.value;
    const label = `${fqdn}/${authz.wildcard ? 'wildcard' : 'apex'}`;
    const ours = ourTxtIds.get(label);
    if (!ours) {
      this.logger.warn(`[${elapsed()}] cleanup: no TXT recorded for ${label}, skipping`);
      return;
    }
    try {
      await this.cf.removeTxtRecord(cfApiToken, ours.zoneId, ours.recordId);
      ourTxtIds.delete(label);
      this.logger.log(`[${elapsed()}] cleanup: removed TXT ${ours.recordId} for ${label}`);
    } catch (err) {
      this.logger.warn(
        `[${elapsed()}] cleanup TXT ${ours.recordId} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  private async waitForTxtVisible(fqdn: string, expectedContent: string): Promise<boolean> {
    const resolver = new Resolver();
    resolver.setServers(['1.1.1.1', '8.8.8.8']);
    const deadline = Date.now() + DNS_PROPAGATION_MAX_MS;
    while (Date.now() < deadline) {
      try {
        const records = await resolver.resolveTxt(fqdn);
        // resolveTxt возвращает string[][] — каждая запись это массив фрагментов.
        const flat = records.map((parts) => parts.join(''));
        if (flat.includes(expectedContent)) return true;
      } catch {
        // NXDOMAIN/SERVFAIL пока — запись ещё не пропагировалась, ждём.
      }
      await new Promise((r) => setTimeout(r, DNS_PROPAGATION_POLL_MS));
    }
    return false;
  }

  private async withBudget<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    const guard = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), ms);
    });
    try {
      return await Promise.race([p, guard]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
