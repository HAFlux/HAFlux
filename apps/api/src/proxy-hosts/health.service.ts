import * as http from 'node:http';
import * as https from 'node:https';
import net from 'node:net';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyHostsService } from './proxy-hosts.service';

function probePathFromDb(healthCheckPath: string | null | undefined): string {
  const raw = healthCheckPath?.trim();
  if (!raw) return '/';
  const p = raw.startsWith('/') ? raw : `/${raw}`;
  return p.replace(/\/{2,}/g, '/') || '/';
}

/**
 * api-контейнер живёт в своей network namespace, поэтому 127.0.0.1 / localhost
 * там — это сам api, а не хост, на котором HAProxy слушает свои upstream'ы.
 * На реальном пути (клиент → HAProxy → upstream) HAProxy подключается к
 * host loopback, потому что он в `network_mode: host`. Чтобы health-probe
 * совпал с реальным маршрутом, переписываем loopback на host.docker.internal,
 * который Docker резолвит в gateway хоста (для этого compose добавляет
 * `extra_hosts: host.docker.internal:host-gateway`).
 */
const HOST_LOOPBACK_REWRITE = process.env.HOST_LOOPBACK_REWRITE ?? 'host.docker.internal';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '0.0.0.0']);

function rewriteLoopback(host: string): string {
  if (LOOPBACK_HOSTS.has(host.toLowerCase())) return HOST_LOOPBACK_REWRITE;
  return host;
}

function buildProbeUrl(
  scheme: string,
  host: string,
  port: number,
  healthCheckPath: string | null | undefined,
): string {
  const path = probePathFromDb(healthCheckPath);
  return `${scheme}://${rewriteLoopback(host)}:${port}${path}`;
}

/**
 * Link-local диапазон (169.254.0.0/16 и fe80::/10) включает cloud-metadata
 * эндпоинт 169.254.169.254 — он никогда не легитимный upstream, но классический
 * SSRF-таргет. Приватные сети (10/172.16/192.168) НЕ режем: upstream'ы прокси
 * там живут штатно.
 */
function isLinkLocalTarget(host: string): boolean {
  const h = host.trim().toLowerCase();
  if (/^169\.254\.\d{1,3}\.\d{1,3}$/.test(h)) return true;
  if (h === 'fd00:ec2::254') return true; // IMDSv6 (AWS)
  if (/^fe80:/.test(h)) return true;
  return false;
}

/** Заголовок Host как у клиентов за HAProxy (vhost на upstream). Wildcard в UI не подставляем. */
function hostHeaderForProbe(publicDomain: string): string | undefined {
  const d = publicDomain.trim();
  if (!d || d.startsWith('*.')) return undefined;
  return d;
}

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
        domain: true,
        forwardScheme: true,
        forwardHost: true,
        forwardPort: true,
        healthCheckPath: true,
      },
    });
    if (hosts.length === 0) return;

    await Promise.all(
      hosts.map(async (h) => {
        if (h.forwardScheme === 'tcp' || h.forwardScheme === 'udp') {
          return;
        }
        const url = buildProbeUrl(h.forwardScheme, h.forwardHost, h.forwardPort, h.healthCheckPath);
        const hostHdr = hostHeaderForProbe(h.domain);
        const result = await this.probe(url, hostHdr);
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

  /**
   * Ad-hoc probe несохранённого upstream'а (кнопка «проверить» в модалке).
   * Ничего не пишет в БД. Для tcp — проверка TCP connect, udp не проверяем.
   */
  async probeAdHoc(
    scheme: 'http' | 'https' | 'tcp' | 'udp',
    host: string,
    port: number,
  ): Promise<{
    status: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED' | 'UNKNOWN';
    code: number | null;
    latencyMs: number | null;
    error: string | null;
  }> {
    if (scheme === 'udp') {
      return { status: 'UNKNOWN', code: null, latencyMs: null, error: 'UDP probe not supported' };
    }
    if (isLinkLocalTarget(host)) {
      return {
        status: 'UNKNOWN',
        code: null,
        latencyMs: null,
        error: 'link-local / metadata addresses are not allowed',
      };
    }
    if (scheme === 'tcp') {
      return this.probeTcp(host, port);
    }
    return this.probe(`${scheme}://${host}:${port}/`);
  }

  private probeTcp(host: string, port: number) {
    const t0 = Date.now();
    return new Promise<{
      status: 'HEALTHY' | 'UNHEALTHY';
      code: null;
      latencyMs: number;
      error: string | null;
    }>((resolve) => {
      const socket = net.connect({ host, port, timeout: this.probeTimeoutMs });
      const done = (status: 'HEALTHY' | 'UNHEALTHY', error: string | null) => {
        socket.destroy();
        resolve({ status, code: null, latencyMs: Date.now() - t0, error });
      };
      socket.once('connect', () => done('HEALTHY', null));
      socket.once('timeout', () => done('UNHEALTHY', 'connect timeout'));
      socket.once('error', (err) => done('UNHEALTHY', err.message.slice(0, 200)));
    });
  }

  /** Manual probe (для refresh-кнопки в UI). */
  async probeOne(id: string) {
    const h = await this.prisma.proxyHost.findUnique({
      where: { id },
      select: {
        id: true,
        domain: true,
        forwardScheme: true,
        forwardHost: true,
        forwardPort: true,
        healthCheckPath: true,
      },
    });
    if (!h) return null;
    if (h.forwardScheme === 'tcp' || h.forwardScheme === 'udp') {
      return this.hosts.getOneForApi(id);
    }
    const url = buildProbeUrl(h.forwardScheme, h.forwardHost, h.forwardPort, h.healthCheckPath);
    const hostHdr = hostHeaderForProbe(h.domain);
    const result = await this.probe(url, hostHdr);
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

  /**
   * GET по URL. `Host` задаём явно для совпадения с vhost на upstream (в Node `fetch`
   * подменяет Host по URL и игнорирует переданный заголовок).
   */
  private async probe(
    urlStr: string,
    /** Публичный FQDN хоста — как у клиента за HAProxy. */
    hostHeader?: string,
  ): Promise<{
    status: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED';
    code: number | null;
    latencyMs: number;
    error: string | null;
  }> {
    const t0 = Date.now();
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), this.probeTimeoutMs);
    try {
      const u = new URL(urlStr);
      const isHttps = u.protocol === 'https:';
      const mod = isHttps ? https : http;
      const port = u.port ? Number(u.port) : isHttps ? 443 : 80;
      const headers: http.OutgoingHttpHeaders = {};
      if (hostHeader) {
        headers.Host = hostHeader;
      }

      const code = await new Promise<number | null>((resolve, reject) => {
        const req = mod.request(
          {
            hostname: u.hostname,
            port,
            path: `${u.pathname}${u.search}`,
            method: 'GET',
            headers,
            signal: ac.signal,
            timeout: this.probeTimeoutMs,
            ...(isHttps ? { rejectUnauthorized: false } : {}),
          },
          (res) => {
            res.resume();
            resolve(res.statusCode ?? null);
          },
        );
        req.on('error', reject);
        req.on('timeout', () => {
          req.destroy();
          reject(new Error('socket timeout'));
        });
        req.end();
      });

      const latencyMs = Date.now() - t0;
      let status: 'HEALTHY' | 'UNHEALTHY' | 'DEGRADED' = 'HEALTHY';
      if (code != null && code >= 500) status = 'UNHEALTHY';
      else if (code != null && code >= 400) status = 'DEGRADED';
      return { status, code, latencyMs, error: null };
    } catch (err) {
      const latencyMs = Date.now() - t0;
      const message = err instanceof Error ? err.message : String(err);
      return {
        status: 'UNHEALTHY',
        code: null,
        latencyMs,
        error: message.slice(0, 200),
      };
    } finally {
      clearTimeout(timer);
    }
  }
}
