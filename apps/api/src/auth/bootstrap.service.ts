import { Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
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
  }

  private async bootstrap(): Promise<void> {
    const email = (this.cfg.get<string>('BOOTSTRAP_ROOT_EMAIL') ?? 'admin@hapilot.local').toLowerCase();

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
    this.logger.log(' HAPilot bootstrap');
    this.logger.log(`   email:    ${user.email}`);
    if (!this.cfg.get<string>('BOOTSTRAP_ROOT_PASSWORD')) {
      this.logger.log(`   password: ${password}   (generated, save it now)`);
    } else {
      this.logger.log('   password: (from BOOTSTRAP_ROOT_PASSWORD env)');
    }
    this.logger.log('────────────────────────────────────────────────');
  }
}
