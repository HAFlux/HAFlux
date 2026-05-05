import { type ChildProcess, spawn } from 'node:child_process';
import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Парсер HAProxy httplog access-log строк.
 *
 * Пример строки:
 *   May  2 08:07:58 haproxy[7]: 127.0.0.1:60820 [02/May/2026:08:07:58.182]
 *   fe_https~ be_proxy_xyz/srv1 0/0/0/4/4 200 1234 - - ---- 1/1/0/0/0 0/0 "GET / HTTP/1.1" "Mozilla/5.0..."
 *
 * Backend имя содержит 'be_proxy_<id>' для нашего рендера.
 */
/**
 * Захватывает максимум из httplog. Renderer добавляет
 * `capture request header User-Agent len 200`, поэтому в строке между
 * queue-счётчиками и request-line появляется блок `{<captured-headers>}`.
 * Без поддержки этой формы регекс не матчил ни одну строку и UI получал
 * пустые логи.
 *
 *   <client_ip>:<port> [time] frontend backend/server Tq/Tw/Tc/Tr/Tt
 *   status bytes - - termState <conns> <queue> [{captured}] "METHOD URL HTTP/x" ["User-Agent"]
 */
const LOG_REGEX =
  /(?<clientIp>\d{1,3}(?:\.\d{1,3}){3}|[0-9a-fA-F:]+):(?<clientPort>\d+)\s+\[(?<time>[^\]]+)\]\s+(?<frontend>\S+)\s+(?<backend>[^/]+)\/(?<server>\S+)\s+(?<timers>\S+)\s+(?<status>\d+)\s+(?<bytes>\d+)\s+\S+\s+\S+\s+(?<termState>\S+)\s+\S+\s+\S+(?:\s+\{(?<capturedReq>[^}]*)\})?(?:\s+\{(?<capturedRes>[^}]*)\})?\s+"(?<method>\S+)\s+(?<url>[^"]*?)\s+\S+"(?:\s+"(?<userAgent>[^"]*)")?/;

/** Экспортируется только для тестов — чтобы не дублировать regex. */
export const __LOG_REGEX_FOR_TESTS = LOG_REGEX;

export interface LogEntry {
  time: string;
  clientIp: string;
  clientPort: number;
  frontend: string;
  backend: string;
  server: string;
  status: number;
  bytes: number;
  method: string;
  url: string;
  /** Полный путь+query (часть URL после первого / или просто URL). */
  path: string;
  /** Tt — общая длительность в мс (от accept до конца). */
  durationMs: number;
  /** Tr — backend response time в мс. */
  backendMs: number;
  /** Termination state, e.g., '----', 'SC--' (см. HAProxy docs). */
  termState: string;
  /** Заголовок User-Agent (если есть в log-format). */
  userAgent: string;
}

export interface HostStats {
  /** Всего обработанных запросов с момента старта api. */
  total: number;
  /** Распределение по группам статусов. */
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  /** Запросов за последние 1 / 5 / 60 минут. */
  rpm1: number;
  rpm5: number;
  rpm60: number;
  /** Время последнего запроса. */
  lastSeen: string | null;
}

const MAX_LOGS_PER_HOST = 200;
const STATS_BUCKETS = 60; // минутные корзины за последний час

interface HostState {
  logs: LogEntry[];
  /** ring buffer: индекс ↔ минута UTC % 60, value — count. */
  buckets: number[];
  bucketEpochs: number[]; // epoch минута для каждой корзины (для очистки старых)
  total: number;
  status2xx: number;
  status3xx: number;
  status4xx: number;
  status5xx: number;
  lastSeen: string | null;
}

@Injectable()
export class HaproxyLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(HaproxyLogsService.name);
  private readonly perHost = new Map<string, HostState>();
  private proc?: ChildProcess;
  private readonly haproxyContainer: string;

  constructor(cfg: ConfigService) {
    this.haproxyContainer = cfg.get<string>('HAPROXY_CONTAINER_NAME') ?? 'haproxy-balancer';
  }

  onModuleInit() {
    this.start();
  }

  onModuleDestroy() {
    this.stop();
  }

  private start() {
    if (this.proc) return;
    this.logger.log(`tailing 'docker logs -f ${this.haproxyContainer}'`);
    const p = spawn('docker', ['logs', '-f', '--tail', '0', this.haproxyContainer], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    this.proc = p;
    let buffer = '';
    const onChunk = (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        const idx = buffer.indexOf('\n');
        if (idx === -1) break;
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 1);
        if (line) this.processLine(line);
      }
    };
    p.stdout?.on('data', onChunk);
    p.stderr?.on('data', onChunk);
    this.proc.on('exit', (code) => {
      this.logger.warn(`docker logs exited code=${code} — restart in 5s`);
      this.proc = undefined;
      setTimeout(() => this.start(), 5_000);
    });
  }

  private stop() {
    if (this.proc) {
      this.proc.kill('SIGTERM');
      this.proc = undefined;
    }
  }

  private processLine(raw: string) {
    const m = LOG_REGEX.exec(raw);
    if (!m || !m.groups) return;
    const g = m.groups as Record<string, string>;

    const backend = g.backend ?? '';
    if (!backend.startsWith('be_proxy_')) return;
    const hostId = backend.slice('be_proxy_'.length);

    const status = Number.parseInt(g.status ?? '', 10);
    if (Number.isNaN(status)) return;

    // Timers: 'Tq/Tw/Tc/Tr/Tt' — берём Tr и Tt
    const timers = (g.timers ?? '').split('/');
    const backendMs = Number.parseInt(timers[3] ?? '0', 10) || 0;
    const durationMs = Number.parseInt(timers[4] ?? '0', 10) || 0;

    // Path: если URL — абсолютный (https://..), берём от первого '/' после хоста.
    const url = g.url ?? '';
    let pathOnly = url;
    const m2 = /^[a-z][a-z0-9+.-]*:\/\/[^/]+(\/.*)?$/i.exec(url);
    if (m2) pathOnly = m2[1] ?? '/';

    // User-Agent: рендерер кладёт его в первый capture-блок ({...}); если когда-нибудь
    // включат второй quoted UA в log-format — он уйдёт в g.userAgent. Берём первый
    // непустой источник.
    const ua = (g.userAgent ?? g.capturedReq ?? '').trim();

    const entry: LogEntry = {
      time: g.time ?? '',
      clientIp: g.clientIp ?? '',
      clientPort: Number.parseInt(g.clientPort ?? '0', 10) || 0,
      frontend: g.frontend ?? '',
      backend,
      server: g.server ?? '',
      status,
      bytes: Number.parseInt(g.bytes ?? '0', 10) || 0,
      method: g.method ?? '',
      url,
      path: pathOnly,
      durationMs,
      backendMs,
      termState: g.termState ?? '',
      userAgent: ua,
    };

    let state = this.perHost.get(hostId);
    if (!state) {
      state = {
        logs: [],
        buckets: new Array(STATS_BUCKETS).fill(0),
        bucketEpochs: new Array(STATS_BUCKETS).fill(0),
        total: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        lastSeen: null,
      };
      this.perHost.set(hostId, state);
    }

    state.logs.unshift(entry);
    if (state.logs.length > MAX_LOGS_PER_HOST) state.logs.length = MAX_LOGS_PER_HOST;
    state.total += 1;
    state.lastSeen = entry.time;
    if (status >= 500) state.status5xx++;
    else if (status >= 400) state.status4xx++;
    else if (status >= 300) state.status3xx++;
    else if (status >= 200) state.status2xx++;

    const minute = Math.floor(Date.now() / 60_000);
    const slot = minute % STATS_BUCKETS;
    if ((state.bucketEpochs[slot] ?? 0) !== minute) {
      state.buckets[slot] = 0;
      state.bucketEpochs[slot] = minute;
    }
    state.buckets[slot] = (state.buckets[slot] ?? 0) + 1;
  }

  getLogs(hostId: string, limit = 50): LogEntry[] {
    const s = this.perHost.get(hostId);
    if (!s) return [];
    return s.logs.slice(0, Math.max(1, Math.min(limit, MAX_LOGS_PER_HOST)));
  }

  getStats(hostId: string): HostStats {
    const s = this.perHost.get(hostId);
    if (!s) {
      return {
        total: 0,
        status2xx: 0,
        status3xx: 0,
        status4xx: 0,
        status5xx: 0,
        rpm1: 0,
        rpm5: 0,
        rpm60: 0,
        lastSeen: null,
      };
    }
    const nowMin = Math.floor(Date.now() / 60_000);
    let rpm1 = 0;
    let rpm5 = 0;
    let rpm60 = 0;
    for (let i = 0; i < STATS_BUCKETS; i++) {
      const epoch = s.bucketEpochs[i] ?? 0;
      if (!epoch) continue;
      const age = nowMin - epoch;
      if (age < 0 || age >= STATS_BUCKETS) continue;
      const v = s.buckets[i] ?? 0;
      rpm60 += v;
      if (age < 5) rpm5 += v;
      if (age < 1) rpm1 += v;
    }
    return {
      total: s.total,
      status2xx: s.status2xx,
      status3xx: s.status3xx,
      status4xx: s.status4xx,
      status5xx: s.status5xx,
      rpm1,
      rpm5,
      rpm60,
      lastSeen: s.lastSeen,
    };
  }
}
