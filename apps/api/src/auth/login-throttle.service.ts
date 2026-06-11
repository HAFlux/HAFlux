import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/** Окно подсчёта неудачных попыток и время блокировки. */
const WINDOW_SEC = 15 * 60;
/** Максимум неудачных попыток на email за окно. */
const MAX_FAILS_PER_EMAIL = 5;
/** Максимум неудачных попыток с одного IP за окно (защита от перебора аккаунтов). */
const MAX_FAILS_PER_IP = 20;

interface MemEntry {
  count: number;
  resetAt: number; // epoch ms
}

/**
 * Анти-брутфорс для /auth/login: фиксированное окно по двум ключам —
 * email (распределённый брут одного аккаунта) и IP (перебор аккаунтов).
 * Хранилище — Redis (REDIS_URL), при его отсутствии/недоступности —
 * in-memory fallback (для single-process инсталляции этого достаточно).
 */
@Injectable()
export class LoginThrottleService implements OnModuleDestroy {
  private readonly logger = new Logger(LoginThrottleService.name);
  private readonly redis: Redis | null;
  private redisHealthy = false;
  private readonly mem = new Map<string, MemEntry>();

  constructor(cfg: ConfigService) {
    const url = cfg.get<string>('REDIS_URL');
    if (url) {
      this.redis = new Redis(url, { maxRetriesPerRequest: 1, enableOfflineQueue: false });
      this.redis.on('ready', () => {
        this.redisHealthy = true;
      });
      this.redis.on('error', (err) => {
        if (this.redisHealthy) this.logger.warn(`redis error, using in-memory throttle: ${err.message}`);
        this.redisHealthy = false;
      });
    } else {
      this.redis = null;
    }
  }

  onModuleDestroy(): void {
    this.redis?.disconnect();
  }

  /** Сколько секунд осталось до разблокировки, либо null если можно логиниться. */
  async blockedFor(ip: string, email: string): Promise<number | null> {
    const [byEmail, byIp] = await Promise.all([
      this.get(this.emailKey(email)),
      this.get(this.ipKey(ip)),
    ]);
    if (byEmail && byEmail.count >= MAX_FAILS_PER_EMAIL) return byEmail.ttlSec;
    if (byIp && byIp.count >= MAX_FAILS_PER_IP) return byIp.ttlSec;
    return null;
  }

  async registerFailure(ip: string, email: string): Promise<void> {
    await Promise.all([this.incr(this.emailKey(email)), this.incr(this.ipKey(ip))]);
  }

  /** Успешный логин сбрасывает счётчик по email (IP-счётчик пусть истекает сам). */
  async registerSuccess(_ip: string, email: string): Promise<void> {
    await this.del(this.emailKey(email));
  }

  private emailKey(email: string): string {
    return `haflux:auth:bf:email:${email.toLowerCase()}`;
  }

  private ipKey(ip: string): string {
    return `haflux:auth:bf:ip:${ip}`;
  }

  private async get(key: string): Promise<{ count: number; ttlSec: number } | null> {
    if (this.redis && this.redisHealthy) {
      try {
        const [count, ttl] = await Promise.all([this.redis.get(key), this.redis.ttl(key)]);
        if (!count) return null;
        return { count: Number(count), ttlSec: Math.max(ttl, 1) };
      } catch {
        /* fallthrough to mem */
      }
    }
    this.pruneMem();
    const e = this.mem.get(key);
    if (!e || e.resetAt <= Date.now()) return null;
    return { count: e.count, ttlSec: Math.ceil((e.resetAt - Date.now()) / 1000) };
  }

  private async incr(key: string): Promise<void> {
    if (this.redis && this.redisHealthy) {
      try {
        const n = await this.redis.incr(key);
        if (n === 1) await this.redis.expire(key, WINDOW_SEC);
        return;
      } catch {
        /* fallthrough to mem */
      }
    }
    const now = Date.now();
    const e = this.mem.get(key);
    if (!e || e.resetAt <= now) {
      this.mem.set(key, { count: 1, resetAt: now + WINDOW_SEC * 1000 });
    } else {
      e.count += 1;
    }
  }

  private async del(key: string): Promise<void> {
    if (this.redis && this.redisHealthy) {
      try {
        await this.redis.del(key);
        return;
      } catch {
        /* fallthrough to mem */
      }
    }
    this.mem.delete(key);
  }

  /** Чистим протухшие записи, чтобы Map не рос бесконечно. */
  private pruneMem(): void {
    if (this.mem.size < 1000) return;
    const now = Date.now();
    for (const [k, v] of this.mem) {
      if (v.resetAt <= now) this.mem.delete(k);
    }
  }
}
