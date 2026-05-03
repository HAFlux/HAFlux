import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { AcmeService } from './acme.service';
import { CloudflareDnsProvider } from './cloudflare.provider';
import { CryptoService } from './crypto.service';

@Injectable()
export class CertificatesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly cf: CloudflareDnsProvider,
    private readonly acme: AcmeService,
  ) {}

  private async defaultOrgId(): Promise<string> {
    const org = await this.prisma.organization.findUnique({ where: { slug: 'default' } });
    if (!org)
      throw new AppException(
        ErrorCode.ORG_NOT_BOOTSTRAPPED,
        'Default organization not bootstrapped',
        500,
      );
    return org.id;
  }

  async listProviders() {
    const orgId = await this.defaultOrgId();
    const items = await this.prisma.dnsProvider.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      zones: (p.zonesCache as { id: string; name: string }[] | null) ?? [],
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));
  }

  async saveCloudflareProvider(input: { name: string; apiToken: string; accountId?: string }) {
    const orgId = await this.defaultOrgId();
    const verified = await this.cf.verifyCredentials({
      apiToken: input.apiToken,
      accountId: input.accountId,
    });

    const credsBlob = this.crypto.encrypt(
      JSON.stringify({ apiToken: input.apiToken, accountId: input.accountId ?? null }),
    );

    const existing = await this.prisma.dnsProvider.findUnique({
      where: { orgId_name: { orgId, name: input.name } },
    });

    const data = {
      orgId,
      kind: 'CLOUDFLARE' as const,
      name: input.name,
      encryptedCredentials: credsBlob,
      zonesCache: verified.zones,
    };

    const saved = existing
      ? await this.prisma.dnsProvider.update({ where: { id: existing.id }, data })
      : await this.prisma.dnsProvider.create({ data });

    return { id: saved.id, zones: verified.zones };
  }

  async deleteProvider(id: string) {
    const orgId = await this.defaultOrgId();
    const p = await this.prisma.dnsProvider.findFirst({ where: { id, orgId } });
    if (!p) throw new AppException(ErrorCode.PROVIDER_NOT_FOUND, 'Provider not found', 404);
    await this.prisma.dnsProvider.delete({ where: { id } });
    return { ok: true };
  }

  async listCertificates() {
    const orgId = await this.defaultOrgId();
    const items = await this.prisma.certificate.findMany({
      where: { orgId },
      orderBy: { createdAt: 'desc' },
    });
    return items.map((c) => ({
      id: c.id,
      commonName: c.commonName,
      sans: c.sans,
      issuer: c.issuer,
      notBefore: c.notBefore,
      notAfter: c.notAfter,
      source: c.source,
      fingerprintSha256: c.fingerprintSha256,
      createdAt: c.createdAt,
    }));
  }

  async issueWildcard(input: {
    providerId: string;
    domain: string;
    wildcard: boolean;
    email: string;
    staging: boolean;
  }) {
    const orgId = await this.defaultOrgId();
    const provider = await this.prisma.dnsProvider.findFirst({
      where: { id: input.providerId, orgId },
    });
    if (!provider)
      throw new AppException(ErrorCode.PROVIDER_NOT_FOUND, 'DNS provider not found', 404);
    if (provider.kind !== 'CLOUDFLARE') {
      throw new AppException(
        ErrorCode.PROVIDER_KIND_UNSUPPORTED,
        `Provider kind ${provider.kind} is not supported yet`,
      );
    }

    const credsRaw = this.crypto.decryptToString(Buffer.from(provider.encryptedCredentials));
    const creds = JSON.parse(credsRaw) as { apiToken: string };

    let result: Awaited<ReturnType<typeof this.acme.issue>>;
    try {
      result = await this.acme.issue({
        domain: input.domain,
        wildcard: input.wildcard,
        email: input.email,
        staging: input.staging,
        cfApiToken: creds.apiToken,
      });
    } catch (err) {
      if (err instanceof AppException) throw err;
      const message = err instanceof Error ? err.message : String(err);
      throw new AppException(ErrorCode.ACME_FAILED, `ACME failed: ${message}`, 502);
    }

    const fullPem = `${result.certPem}\n${result.keyPem}`;
    const encryptedPemBlob = this.crypto.encrypt(fullPem);
    const fingerprint = await this.fingerprint(result.certPem);

    const cert = await this.prisma.certificate.create({
      data: {
        orgId,
        commonName: input.domain,
        sans: result.sans,
        issuer: result.issuer,
        notBefore: result.notBefore,
        notAfter: result.notAfter,
        fingerprintSha256: fingerprint,
        source: 'ACME',
        encryptedPemBlob,
      },
    });

    return {
      id: cert.id,
      commonName: cert.commonName,
      sans: cert.sans,
      issuer: cert.issuer,
      notAfter: cert.notAfter,
    };
  }

  async deleteCertificate(id: string) {
    const orgId = await this.defaultOrgId();
    const c = await this.prisma.certificate.findFirst({ where: { id, orgId } });
    if (!c) throw new AppException(ErrorCode.CERT_NOT_FOUND, 'Certificate not found', 404);
    await this.prisma.certificate.delete({ where: { id } });
    return { ok: true };
  }

  private async fingerprint(certPem: string): Promise<string> {
    const { createHash } = await import('node:crypto');
    return createHash('sha256').update(certPem).digest('hex');
  }

  async uploadCertificate(input: { certPem: string; keyPem: string }) {
    const orgId = await this.defaultOrgId();
    const cert = this.parseLeafCert(input.certPem);
    const fullPem = `${input.certPem.trim()}\n${input.keyPem.trim()}`;
    const encryptedPemBlob = this.crypto.encrypt(fullPem);
    const fingerprintHex = await this.fingerprint(input.certPem);
    return this.prisma.certificate.create({
      data: {
        orgId,
        commonName: cert.commonName,
        sans: cert.sans,
        issuer: cert.issuer,
        notBefore: cert.notBefore,
        notAfter: cert.notAfter,
        fingerprintSha256: fingerprintHex,
        source: 'UPLOAD',
        encryptedPemBlob,
      },
      select: { id: true, commonName: true, sans: true, notAfter: true, source: true },
    });
  }

  private parseLeafCert(pem: string): {
    commonName: string;
    sans: string[];
    issuer: string;
    notBefore: Date;
    notAfter: Date;
  } {
    const begin = pem.indexOf('-----BEGIN CERTIFICATE-----');
    const end = pem.indexOf('-----END CERTIFICATE-----');
    if (begin < 0 || end < 0) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'PEM must contain at least one BEGIN/END CERTIFICATE block',
      );
    }
    const leaf = pem.slice(begin, end + '-----END CERTIFICATE-----'.length);
    const cryptoMod = require('node:crypto') as typeof import('node:crypto');
    const X509 = cryptoMod.X509Certificate;
    let x509: import('node:crypto').X509Certificate;
    try {
      x509 = new X509(leaf);
    } catch (err) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        `Invalid certificate PEM: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const subjectCN = this.cnFromDN(x509.subject);
    const issuerCN = this.cnFromDN(x509.issuer);
    const sans: string[] = [];
    if (x509.subjectAltName) {
      for (const part of x509.subjectAltName.split(',')) {
        const v = part.trim();
        if (v.startsWith('DNS:')) sans.push(v.slice(4).trim());
      }
    }
    if (sans.length === 0 && subjectCN) sans.push(subjectCN);
    return {
      commonName: subjectCN ?? sans[0] ?? 'unknown',
      sans,
      issuer: issuerCN ?? 'unknown',
      notBefore: new Date(x509.validFrom),
      notAfter: new Date(x509.validTo),
    };
  }

  private cnFromDN(dn: string): string | undefined {
    for (const part of dn.split(/[,\n]/)) {
      const [k, ...v] = part.trim().split('=');
      if ((k ?? '').toUpperCase() === 'CN') return v.join('=').trim();
    }
    return undefined;
  }
}
