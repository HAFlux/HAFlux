import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { NodesService } from './nodes.service';

/**
 * Фоновый health-check нод: SSH-ноды — TCP-проба до sshHost:sshPort,
 * LOCAL — считается ONLINE, пока жив сам api (он на той же машине).
 * Обновляет Node.status / lastSeenAt.
 *
 * Для кластеров ACTIVE_PASSIVE: если PRIMARY ушла в OFFLINE, а какая-то
 * SECONDARY ONLINE — роли переключаются автоматически (логируется WARN).
 * ВАЖНО: это переключение только меток ролей; перенос трафика требует
 * VIP/keepalived или DNS-failover на стороне инфраструктуры.
 */
@Injectable()
export class NodesHealthService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NodesHealthService.name);
  private readonly intervalMs = 60_000;
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly nodes: NodesService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.tick().catch(() => {}), 10_000);
    this.timer = setInterval(() => {
      this.tick().catch((err) => this.logger.warn(`tick failed: ${(err as Error).message}`));
    }, this.intervalMs);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    const all = await this.prisma.node.findMany();
    if (all.length === 0) return;

    await Promise.all(
      all.map(async (n) => {
        let online: boolean;
        if (n.transport === 'LOCAL') {
          online = true; // api живёт на той же машине
        } else {
          online = n.sshHost ? await this.nodes.tcpProbe(n.sshHost, n.sshPort ?? 22) : false;
        }
        await this.prisma.node.update({
          where: { id: n.id },
          data: {
            status: online ? 'ONLINE' : 'OFFLINE',
            ...(online ? { lastSeenAt: new Date() } : {}),
          },
        });
      }),
    );

    await this.autoFailover();
  }

  private async autoFailover(): Promise<void> {
    const clusters = await this.prisma.cluster.findMany({
      where: { mode: 'ACTIVE_PASSIVE' },
      include: { nodes: true },
    });
    for (const c of clusters) {
      const primary = c.nodes.find((n) => n.role === 'PRIMARY');
      if (!primary || primary.status !== 'OFFLINE') continue;
      const candidate = c.nodes.find((n) => n.role === 'SECONDARY' && n.status === 'ONLINE');
      if (!candidate) continue;
      await this.prisma.$transaction([
        this.prisma.node.update({ where: { id: primary.id }, data: { role: 'SECONDARY' } }),
        this.prisma.node.update({ where: { id: candidate.id }, data: { role: 'PRIMARY' } }),
      ]);
      this.logger.warn(
        `ACTIVE_PASSIVE failover in cluster "${c.name}": ${primary.name} (OFFLINE) → ${candidate.name} promoted to PRIMARY. Traffic failover requires VIP/keepalived on the infrastructure side.`,
      );
    }
  }
}
