import { Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyHostsRenderApplyService } from '../proxy-hosts/render-apply.service';

@Injectable()
export class ClustersService {
  private readonly logger = new Logger(ClustersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderApply: ProxyHostsRenderApplyService,
  ) {}

  list() {
    return this.prisma.cluster.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async update(
    id: string,
    input: {
      name?: string;
      mode?: 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE';
      logFormat?: string | null;
    },
  ) {
    const existing = await this.prisma.cluster.findUnique({ where: { id } });
    if (!existing) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);

    if (input.name && input.name !== existing.name) {
      const taken = await this.prisma.cluster.findUnique({
        where: { orgId_name: { orgId: existing.orgId, name: input.name } },
      });
      if (taken)
        throw new AppException(
          ErrorCode.CLUSTER_NAME_TAKEN,
          `Cluster '${input.name}' already exists`,
          409,
        );
    }

    const logFormatChanged =
      input.logFormat !== undefined && (input.logFormat || null) !== existing.logFormat;

    const updated = await this.prisma.cluster.update({
      where: { id },
      data: {
        name: input.name,
        mode: input.mode,
        ...(input.logFormat !== undefined ? { logFormat: input.logFormat || null } : {}),
      },
    });

    // log-format попадает в haproxy.cfg → нужен re-apply. apply() сам
    // валидирует конфиг (haproxy -c) и откатывает при ошибке.
    if (logFormatChanged) {
      await this.renderApply.apply(id);
    }

    return updated;
  }

  /** Расширенная инфа для UI: счётчики ProxyHost / Node. */
  async listWithCounts() {
    const items = await this.prisma.cluster.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        _count: {
          select: {
            nodes: true,
            proxyHosts: true,
          },
        },
      },
    });
    return items.map((c) => ({
      id: c.id,
      name: c.name,
      mode: c.mode,
      logFormat: c.logFormat,
      orgId: c.orgId,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      nodesCount: c._count.nodes,
      proxyHostsCount: c._count.proxyHosts,
    }));
  }

  async create(input: {
    orgId?: string;
    name: string;
    mode?: 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE';
  }) {
    const orgId = input.orgId ?? (await this.defaultOrgId());

    const exists = await this.prisma.cluster.findUnique({
      where: { orgId_name: { orgId, name: input.name } },
    });
    if (exists)
      throw new AppException(
        ErrorCode.CLUSTER_NAME_TAKEN,
        `Cluster '${input.name}' already exists`,
        409,
      );

    const created = await this.prisma.cluster.create({
      data: {
        orgId,
        name: input.name,
        mode: input.mode ?? 'STANDALONE',
      },
    });

    // Первый кластер инсталляции получает LOCAL-ноду автоматически —
    // это сохраняет однокомандный single-host опыт (install.sh).
    const localExists = await this.prisma.node.findFirst({ where: { transport: 'LOCAL' } });
    if (!localExists) {
      await this.prisma.node.create({
        data: {
          clusterId: created.id,
          name: 'local',
          transport: 'LOCAL',
          haproxyDataDir: process.env.HAPROXY_DATA_DIR ?? '/haproxy-data',
          reloadMode: 'CONTAINER',
          reloadTarget: process.env.HAPROXY_CONTAINER_NAME ?? 'haproxy-balancer',
          role: 'PRIMARY',
          status: 'ONLINE',
          lastSeenAt: new Date(),
        },
      });
    }

    return created;
  }

  async get(id: string) {
    const cluster = await this.prisma.cluster.findUnique({
      where: { id },
      include: { nodes: true },
    });
    if (!cluster) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
    return cluster;
  }

  listNodes(clusterId: string) {
    return this.prisma.node.findMany({
      where: { clusterId },
      orderBy: { name: 'asc' },
    });
  }

  async remove(id: string) {
    const cluster = await this.prisma.cluster.findUnique({ where: { id } });
    if (!cluster) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
    await this.prisma.cluster.delete({ where: { id } });
    return { ok: true };
  }

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
}
