import type { CloudflareCredentials } from '@haflux/contracts';
import { Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';

interface CfTokenStatus {
  status: 'active' | 'disabled' | 'expired';
}

interface CfZone {
  id: string;
  name: string;
  status: string;
  account?: { id: string; name: string };
}

interface CfDnsRecord {
  id: string;
  type: string;
  name: string;
  content: string;
}

export interface VerifyResult {
  ok: boolean;
  tokenStatus: CfTokenStatus['status'];
  zones: { id: string; name: string }[];
  warnings: string[];
}

@Injectable()
export class CloudflareDnsProvider {
  private readonly logger = new Logger(CloudflareDnsProvider.name);
  private readonly apiBase = 'https://api.cloudflare.com/client/v4';

  async verifyCredentials(creds: CloudflareCredentials): Promise<VerifyResult> {
    const warnings: string[] = [];
    const verify = await this.cf<CfTokenStatus>('/user/tokens/verify', creds.apiToken);
    if (verify.status !== 'active') {
      throw new AppException(
        ErrorCode.CLOUDFLARE_TOKEN_INACTIVE,
        `Cloudflare token status: ${verify.status}`,
        401,
      );
    }
    const zones = await this.cf<CfZone[]>('/zones?per_page=50', creds.apiToken);
    if (zones.length === 0) {
      warnings.push('Token is valid but has no accessible zones — check Zone Resources scope.');
    }
    return {
      ok: true,
      tokenStatus: verify.status,
      zones: zones.map((z) => ({ id: z.id, name: z.name })),
      warnings,
    };
  }

  async resolveZoneId(token: string, fqdn: string): Promise<{ id: string; name: string }> {
    const parts = fqdn.split('.');
    while (parts.length >= 2) {
      const candidate = parts.join('.');
      const zones = await this.cf<CfZone[]>(`/zones?name=${encodeURIComponent(candidate)}`, token);
      const first = zones[0];
      if (first) {
        return { id: first.id, name: first.name };
      }
      parts.shift();
    }
    throw new AppException(ErrorCode.ZONE_NOT_FOUND, `No Cloudflare zone covers ${fqdn}`, 404);
  }

  async addTxtRecord(
    token: string,
    zoneId: string,
    name: string,
    content: string,
  ): Promise<string> {
    const res = await this.cf<CfDnsRecord>(`/zones/${zoneId}/dns_records`, token, {
      method: 'POST',
      body: JSON.stringify({ type: 'TXT', name, content, ttl: 60 }),
    });
    this.logger.log(`Cloudflare: added TXT ${name}`);
    return res.id;
  }

  async removeTxtRecord(token: string, zoneId: string, recordId: string): Promise<void> {
    await this.cf<{ id: string }>(`/zones/${zoneId}/dns_records/${recordId}`, token, {
      method: 'DELETE',
    });
    this.logger.log(`Cloudflare: removed TXT record ${recordId}`);
  }

  async findTxtRecord(token: string, zoneId: string, name: string): Promise<CfDnsRecord | null> {
    const arr = await this.cf<CfDnsRecord[]>(
      `/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(name)}`,
      token,
    );
    return arr[0] ?? null;
  }

  private async cf<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const json = (await res.json().catch(() => ({}))) as {
      success?: boolean;
      result?: T;
      errors?: { code: number; message: string }[];
    };
    if (!res.ok || json.success === false) {
      const msg = json.errors?.map((e) => `${e.code}: ${e.message}`).join('; ') ?? res.statusText;
      this.logger.warn(`Cloudflare API ${path} failed: ${msg}`);
      const code =
        res.status === 401 || res.status === 403
          ? ErrorCode.CLOUDFLARE_TOKEN_INVALID
          : ErrorCode.CLOUDFLARE_API_ERROR;
      throw new AppException(code, `Cloudflare API: ${msg}`, res.status === 401 ? 401 : 502);
    }
    return json.result as T;
  }
}
