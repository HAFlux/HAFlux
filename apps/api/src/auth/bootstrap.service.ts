import { randomBytes } from 'node:crypto';
import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from './auth.service';

/**
 * При первом старте api создаём:
 *   - дефолтную организацию,
 *   - роль "owner" с полными правами,
 *   - root-пользователя с email из BOOTSTRAP_ROOT_EMAIL
 *     (пароль из BOOTSTRAP_ROOT_PASSWORD, или генерится и печатается в логах).
 *
 * Идемпотентно: если пользователь уже есть — ничего не делаем.
 */
@Injectable()
export class BootstrapService implements OnModuleInit {
  private readonly logger = new Logger('Bootstrap');

  constructor(
    private readonly prisma: PrismaService,
    private readonly cfg: ConfigService,
    private readonly auth: AuthService,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.bootstrap();
    } catch (err) {
      this.logger.error('Bootstrap failed', err as Error);
    }
    try {
      await this.ensureLocalNode();
    } catch (err) {
      this.logger.error('ensureLocalNode failed', err as Error);
    }
  }

  /**
   * Миграция к node-aware деплою: у старых инсталляций нет ни одной Node,
   * а конфиг исторически писался в локальный /haproxy-data. Привязываем
   * LOCAL-ноду к самому старому кластеру, чтобы поведение не изменилось.
   */
  private async ensureLocalNode(): Promise<void> {
    const existingLocal = await this.prisma.node.findFirst({ where: { transport: 'LOCAL' } });
    if (existingLocal) return;
    const oldest = await this.prisma.cluster.findFirst({ orderBy: { createdAt: 'asc' } });
    if (!oldest) return; // кластеров ещё нет — нода создастся вместе с первым кластером
    await this.prisma.node.create({
      data: {
        clusterId: oldest.id,
        name: 'local',
        transport: 'LOCAL',
        haproxyDataDir: this.cfg.get<string>('HAPROXY_DATA_DIR') ?? '/haproxy-data',
        reloadMode: 'CONTAINER',
        reloadTarget: this.cfg.get<string>('HAPROXY_CONTAINER_NAME') ?? 'haproxy-balancer',
        role: 'PRIMARY',
        status: 'ONLINE',
        lastSeenAt: new Date(),
      },
    });
    this.logger.log(`Created LOCAL node for cluster "${oldest.name}" (node-aware deploy migration)`);
  }

  private async bootstrap(): Promise<void> {
    const email = (
      this.cfg.get<string>('BOOTSTRAP_ROOT_EMAIL') ?? 'admin@haflux.local'
    ).toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      this.logger.log(`Root user already exists (${email}). Skipping bootstrap.`);
      return;
    }

    const ownerRole = await this.prisma.role.upsert({
      where: { name: 'owner' },
      update: {},
      create: {
        name: 'owner',
        permissions: { '*': true },
      },
    });

    const org = await this.prisma.organization.upsert({
      where: { slug: 'default' },
      update: {},
      create: { name: 'Default', slug: 'default' },
    });

    const password =
      this.cfg.get<string>('BOOTSTRAP_ROOT_PASSWORD') || randomBytes(12).toString('base64url');
    const passwordHash = await this.auth.hashPassword(password);

    const user = await this.prisma.user.create({
      data: {
        email,
        displayName: 'Root',
        passwordHash,
        isActive: true,
        memberships: {
          create: { orgId: org.id, roleId: ownerRole.id },
        },
      },
    });

    this.logger.log('────────────────────────────────────────────────');
    this.logger.log(' HAFlux bootstrap');
    this.logger.log(`   email:    ${user.email}`);
    if (!this.cfg.get<string>('BOOTSTRAP_ROOT_PASSWORD')) {
      this.logger.log(`   password: ${password}   (generated, save it now)`);
    } else {
      this.logger.log('   password: (from BOOTSTRAP_ROOT_PASSWORD env)');
    }
    this.logger.log('────────────────────────────────────────────────');
  }
}
