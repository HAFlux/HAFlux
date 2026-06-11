import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppException, ErrorCode } from '../common/errors';

/** Список стран обновляем, если файл старше недели. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Скачивает и кэширует агрегированные CIDR-списки стран (ipdeny.com) в
 * ${dataDir}/acl/geo_<cc>.lst для гео-блокировок HAProxy (`src -f`).
 *
 * В один файл складываем и IPv4, и IPv6 диапазоны — HAProxy src ACL
 * понимает смешанные списки. Недоступность v6-списка не фатальна
 * (у ipdeny они есть не для всех стран).
 */
@Injectable()
export class GeoListsService {
  private readonly logger = new Logger(GeoListsService.name);
  private readonly dataDir: string;

  constructor(cfg: ConfigService) {
    this.dataDir = cfg.get<string>('HAPROXY_DATA_DIR') ?? '/haproxy-data';
  }

  /** Гарантирует наличие geo_<cc>.lst для каждого кода. Бросает 502, если список недоступен. */
  async ensure(codes: string[]): Promise<void> {
    if (codes.length === 0) return;
    const aclDir = path.join(this.dataDir, 'acl');
    await fs.mkdir(aclDir, { recursive: true });
    await Promise.all(codes.map((cc) => this.ensureOne(aclDir, cc.toLowerCase())));
  }

  private async ensureOne(aclDir: string, cc: string): Promise<void> {
    if (!/^[a-z]{2}$/.test(cc)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, `Invalid country code: ${cc}`, 400);
    }
    const file = path.join(aclDir, `geo_${cc}.lst`);
    const stat = await fs.stat(file).catch(() => null);
    if (stat && Date.now() - stat.mtimeMs < MAX_AGE_MS && stat.size > 0) return;

    const v4 = await this.fetchZone(
      `https://www.ipdeny.com/ipblocks/data/aggregated/${cc}-aggregated.zone`,
    );
    if (v4 === null) {
      // Файл уже есть (хоть и старый) — оставляем его, лучше stale чем отказ.
      if (stat && stat.size > 0) {
        this.logger.warn(`geo list refresh failed for "${cc}", keeping stale file`);
        return;
      }
      throw new AppException(
        ErrorCode.INTERNAL,
        `Failed to download IP list for country "${cc}" (ipdeny.com unreachable?)`,
        502,
      );
    }
    const v6 =
      (await this.fetchZone(
        `https://www.ipdeny.com/ipv6/ipaddresses/aggregated/${cc}-aggregated.zone`,
      )) ?? '';

    const body = `${[v4, v6].join('\n').trim()}\n`;
    await fs.writeFile(file, body, { mode: 0o644 });
    this.logger.log(`geo list updated: ${cc} (${body.split('\n').length - 1} ranges)`);
  }

  private async fetchZone(url: string): Promise<string | null> {
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
      try {
        const res = await fetch(url, { signal: ac.signal });
        if (!res.ok) return null;
        const text = await res.text();
        // sanity: строки вида CIDR, отбрасываем мусор
        const lines = text
          .split('\n')
          .map((l) => l.trim())
          .filter((l) => l && /^[0-9a-fA-F:./]+$/.test(l));
        return lines.join('\n');
      } finally {
        clearTimeout(timer);
      }
    } catch {
      return null;
    }
  }
}
