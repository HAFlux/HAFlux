import { Injectable } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ClustersService {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.cluster.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async update(
    id: string,
    input: { name?: string; mode?: 'STANDALONE' | 'ACTIVE_PASSIVE' | 'ACTIVE_ACTIVE' },
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

    return this.prisma.cluster.update({
      where: { id },
      data: {
        name: input.name,
        mode: input.mode,
      },
    });
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

    return this.prisma.cluster.create({
      data: {
        orgId,
        name: input.name,
        mode: input.mode ?? 'STANDALONE',
      },
    });
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
