import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/no-require-imports
import * as acme from 'acme-client';
type AcmeAuthz = { identifier: { value: string } };
type AcmeChallenge = { type: string };
import { AppException, ErrorCode } from '../common/errors';
import type { CloudflareDnsProvider } from './cloudflare.provider';

export interface IssueOptions {
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

  constructor(private readonly cf: CloudflareDnsProvider) {}

  async issue(opts: IssueOptions): Promise<IssueResult> {
    const directoryUrl = opts.staging
      ? acme.directory.letsencrypt.staging
      : acme.directory.letsencrypt.production;

    const altNames = opts.wildcard ? [opts.domain, `*.${opts.domain}`] : [opts.domain];
    this.logger.log(
      `ACME issue: ${altNames.join(',')} (${opts.staging ? 'staging' : 'production'})`,
    );

    let certPem: string;
    let keyPem: string;
    try {
      const accountKey = await acme.crypto.createPrivateKey();
      const client = new acme.Client({ directoryUrl, accountKey });

      const [keyBuf, csrBuf] = await acme.crypto.createCsr({
        commonName: opts.domain,
        altNames,
      });
      keyPem = keyBuf.toString();

      const certBuf = await client.auto({
        csr: csrBuf,
        email: opts.email,
        termsOfServiceAgreed: true,
        challengePriority: ['dns-01'],
        challengeCreateFn: async (
          authz: AcmeAuthz,
          challenge: AcmeChallenge,
          keyAuthorization: string,
        ) => {
          if (challenge.type !== 'dns-01') {
            throw new Error(`Unsupported challenge type ${challenge.type}`);
          }
          const fqdn = authz.identifier.value;
          const apex = fqdn.replace(/^\*\./, '');
          const txtName = `_acme-challenge.${apex}`;
          const zone = await this.cf.resolveZoneId(opts.cfApiToken, apex);
          await this.cf.addTxtRecord(opts.cfApiToken, zone.id, txtName, keyAuthorization);
          // Cloudflare обычно пропагирует <30s, ждём 20s для надёжности.
          await new Promise((r) => setTimeout(r, 20_000));
        },
        challengeRemoveFn: async (authz: AcmeAuthz, challenge: AcmeChallenge) => {
          if (challenge.type !== 'dns-01') return;
          const fqdn = authz.identifier.value;
          const apex = fqdn.replace(/^\*\./, '');
          const txtName = `_acme-challenge.${apex}`;
          try {
            const zone = await this.cf.resolveZoneId(opts.cfApiToken, apex);
            const rec = await this.cf.findTxtRecord(opts.cfApiToken, zone.id, txtName);
            if (rec) await this.cf.removeTxtRecord(opts.cfApiToken, zone.id, rec.id);
          } catch (err) {
            this.logger.warn(
              `cleanup TXT failed for ${txtName}: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        },
      });
      certPem = certBuf.toString();
    } catch (err) {
      if (err instanceof AppException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`ACME failed for ${opts.domain}: ${message}`);
      throw new AppException(
        ErrorCode.ACME_FAILED,
        `ACME (${opts.staging ? 'staging' : 'production'}) failed: ${message}`,
        502,
      );
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
}
