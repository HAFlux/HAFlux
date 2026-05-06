import { createHash } from 'node:crypto';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AcmeService } from './acme.service';
import { CryptoService, toBytes } from './crypto.service';

const RENEW_THRESHOLD_DAYS = 10;
const TICK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

/**
 * Auto-renew сертификатов:
 *  - Каждые 6 часов проверяем все ACME-сертификаты.
 *  - Если до notAfter осталось < 10 дней — повторно запускаем acme.issue
 *    с теми же параметрами (domain/wildcard/staging) через тот же
 *    DnsProvider и заменяем cert+key+notBefore/notAfter в БД.
 *  - Manual renew через POST /certificates/:id/renew.
 */
@Injectable()
export class CertificateRenewService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CertificateRenewService.name);
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly acme: AcmeService,
    private readonly crypto: CryptoService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.tick().catch((err) => this.logErr(err)), 30_000);
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logErr(err));
    }, TICK_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const expiringSoon = await this.prisma.certificate.findMany({
      where: {
        source: 'ACME',
        notAfter: { lte: new Date(Date.now() + RENEW_THRESHOLD_DAYS * 86_400_000) },
      },
    });
    if (expiringSoon.length === 0) return;
    this.logger.log(`auto-renew: ${expiringSoon.length} certs нуждаются в продлении`);
    for (const c of expiringSoon) {
      try {
        await this.renew(c.id);
      } catch (err) {
        this.logger.warn(`auto-renew failed for ${c.commonName}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Renew конкретного сертификата. Использует первый CLOUDFLARE-провайдер
   * в той же организации (прозрачное предположение для self-host).
   */
  async renew(id: string) {
    const cert = await this.prisma.certificate.findUnique({ where: { id } });
    if (!cert) throw new AppException(ErrorCode.CERT_NOT_FOUND, 'Certificate not found', 404);
    if (cert.source !== 'ACME') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Only ACME certificates can be renewed');
    }

    const provider = await this.prisma.dnsProvider.findFirst({
      where: { orgId: cert.orgId, kind: 'CLOUDFLARE' },
    });
    if (!provider)
      throw new AppException(
        ErrorCode.PROVIDER_NOT_FOUND,
        'No Cloudflare provider configured for renewal',
        404,
      );

    const credsRaw = this.crypto.decryptToString(Buffer.from(provider.encryptedCredentials));
    const creds = JSON.parse(credsRaw) as { apiToken: string };

    // Угадываем wildcard по SAN: если есть запись начинающаяся на *. — wildcard.
    const wildcard = cert.sans.some((s) => s.startsWith('*.'));
    const apex = cert.commonName.replace(/^\*\./, '');

    this.logger.log(`renew start: ${cert.commonName} (wildcard=${wildcard})`);
    const result = await this.acme.issue({
      orgId: cert.orgId,
      domain: apex,
      wildcard,
      email: `admin@${apex}`, // best-effort, можно сделать настройкой org
      staging: false, // renew всегда production
      cfApiToken: creds.apiToken,
    });

    const fullPem = `${result.certPem}\n${result.keyPem}`;
    const encryptedPemBlob = this.crypto.encrypt(fullPem);
    const fingerprint = createHash('sha256').update(result.certPem).digest('hex');

    const updated = await this.prisma.certificate.update({
      where: { id },
      data: {
        notBefore: result.notBefore,
        notAfter: result.notAfter,
        fingerprintSha256: fingerprint,
        issuer: result.issuer,
        sans: result.sans,
        encryptedPemBlob: toBytes(encryptedPemBlob),
      },
    });

    this.logger.log(`renew ok: ${cert.commonName} valid until ${updated.notAfter.toISOString()}`);
    return {
      id: updated.id,
      commonName: updated.commonName,
      notBefore: updated.notBefore,
      notAfter: updated.notAfter,
      sans: updated.sans,
    };
  }

  private logErr(err: unknown) {
    this.logger.warn(`tick failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
