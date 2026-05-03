import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProxyHostsService } from './proxy-hosts.service';

/**
 * Периодический probing upstream'ов всех proxy host'ов.
 *
 *  Healthy   — 2xx/3xx
 *  UNHEALTHY — 5xx, timeout, connection refused
 *  DEGRADED  — 4xx (upstream отвечает, но ошибки)
 *
 * Запускается setInterval каждые 60s + ручной probe через POST endpoint.
 */
@Injectable()
export class ProxyHostsHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ProxyHostsHealthService.name);
  private readonly probeTimeoutMs = 5_000;
  private readonly intervalMs = 60_000;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly hosts: ProxyHostsService,
  ) {}

  onModuleInit() {
    // Первый прогон через 5s после старта
    setTimeout(() => this.tick().catch(() => {}), 5_000);
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`tick failed: ${(err as Error).message}`));
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const hosts = await this.prisma.proxyHost.findMany({
      where: { enabled: true },
      select: {
        id: true,
        forwardScheme: true,
        forwardHost: true,
        forwardPort: true,
      },
    });
    if (hosts.length === 0) return;

    await Promise.all(
      hosts.map(async (h) => {
        if (h.forwardScheme === 'tcp' || h.forwardScheme === 'udp') {
          return;
        }
        const url = `${h.forwardScheme}://${h.forwardHost}:${h.forwardPort}/`;
        const result = await this.probe(url);
        await this.prisma.proxyHost.update({
          where: { id: h.id },
          data: {
            healthStatus: result.status,
            healthCheckedAt: new Date(),
            healthHttpCode: result.code,
            healthLatencyMs: result.latencyMs,
            healthError: result.error,
          },
        });
      }),
    );
    this.logger.debug(`probed ${hosts.length} proxy hosts`);
  }

  /** Manual probe (для refresh-кнопки в UI). */
  async probeOne(id: string) {
    const h = await this.prisma.proxyHost.findUnique({
      where: { id },
      select: {
        id: true,
        forwardScheme: true,
        forwardHost: true,
        forwardPort: true,
      },
    });
    if (!h) return null;
    if (h.forwardScheme === 'tcp' || h.forwardScheme === 'udp') {
      return this.hosts.getOneForApi(id);
    }
    const url = `${h.forwardScheme}://${h.forwardHost}:${h.forwardPort}/`;
    const result = await this.probe(url);
    await this.prisma.proxyHost.update({
      where: { id },
      data: {
        healthStatus: result.status,
        healthCheckedAt: new Date(),
        healthHttpCode: result.code,
        healthLatencyMs: result.latencyMs,
        healthError: result.error,
      },
    });
    return this.hosts.getOneForApi(id);
  }

  private async probe(url: string): Promise<{
    status: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED';
    code: number | null;
    latencyMs: number;
    error: string | null;
  }> {
    const t0 = Date.now();
    try {
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), this.probeTimeoutMs);
      try {
        const res = await fetch(url, {
          method: 'GET',
          signal: ac.signal,
          redirect: 'manual',
        });
        const latencyMs = Date.now() - t0;
        const code = res.status;
        let status: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED' = 'HEALTHY';
        if (code >= 500) status = 'UNHEALTHY';
        else if (code >= 400) status = 'DEGRADED';
        return { status, code, latencyMs, error: null };
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'UNHEALTHY',
        code: null,
        latencyMs,
        error: message.slice(0, 200),
      };
    }
  }
}
