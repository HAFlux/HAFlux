import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AppException, ErrorCode } from '../common/errors';
import { certCovers } from '../common/san-match';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyHostsRenderApplyService } from './render-apply.service';

export interface CreateProxyHostInput {
  clusterId: string;
  domain: string;
  forwardScheme: 'http' | 'https' | 'tcp' | 'udp';
  forwardHost: string;
  forwardPort: number;
  listenPort?: number | null;
  ssl?: boolean;
  certificateId?: string | null;
  accessGroupIds?: string[];
  httpToHttps?: boolean;
  hsts?: boolean;
  blockExploits?: boolean;
  wsSupport?: boolean;
  http2?: boolean;
  http3?: boolean;
  notes?: string | null;
  customHeaders?: Record<string, string> | null;
  /** Путь GET для health probe; пустой/null = «/». */
  healthCheckPath?: string | null;
}

export type UpdateProxyHostInput = Partial<Omit<CreateProxyHostInput, 'clusterId'>> & {
  enabled?: boolean;
};

@Injectable()
export class ProxyHostsService {
  private readonly logger = new Logger(ProxyHostsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderApply: ProxyHostsRenderApplyService,
  ) {}

  /** Полный объект хоста для API (после health-check и т.п.). */
  async getOneForApi(id: string) {
    const h = await this.prisma.proxyHost.findUnique({
      where: { id },
      include: {
        certificate: { select: { id: true, commonName: true, sans: true } },
        accessGroupMemberships: {
          orderBy: { accessGroupId: 'asc' },
          include: { accessGroup: { select: { id: true, name: true } } },
        },
      },
    });
    if (!h) return null;
    return this.mapHostResponse(h);
  }

  list(clusterId: string) {
    return this.prisma.proxyHost
      .findMany({
        where: { clusterId },
        orderBy: { createdAt: 'desc' },
        include: {
          certificate: { select: { id: true, commonName: true, sans: true } },
          accessGroupMemberships: {
            orderBy: { accessGroupId: 'asc' },
            include: { accessGroup: { select: { id: true, name: true } } },
          },
        },
      })
      .then((rows) => rows.map((h) => this.mapHostResponse(h)));
  }

  async create(input: CreateProxyHostInput) {
    if (
      (input.forwardScheme === 'tcp' || input.forwardScheme === 'udp') &&
      (input.listenPort == null || input.listenPort < 1)
    ) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'listenPort is required for TCP and UDP proxy hosts',
        400,
      );
    }
    await this.assertClusterExists(input.clusterId);
    await this.assertAccessGroups(input.clusterId, input.accessGroupIds);
    if (input.certificateId) await this.assertCertExists(input.certificateId, input.domain);

    const existing = await this.prisma.proxyHost.findUnique({
      where: { clusterId_domain: { clusterId: input.clusterId, domain: input.domain } },
    });
    if (existing) {
      throw new AppException(
        ErrorCode.PROXY_HOST_DOMAIN_TAKEN,
        `Domain '${input.domain}' is already used in this cluster`,
        409,
      );
    }

    const created = await this.prisma.proxyHost.create({
      data: {
        clusterId: input.clusterId,
        domain: input.domain,
        forwardScheme: input.forwardScheme,
        forwardHost: input.forwardHost,
        forwardPort: input.forwardPort,
        listenPort: input.listenPort ?? null,
        ssl: input.ssl ?? true,
        certificateId: input.certificateId ?? null,
        httpToHttps: input.httpToHttps ?? true,
        hsts: input.hsts ?? false,
        blockExploits: input.blockExploits ?? true,
        wsSupport: input.wsSupport ?? true,
        http2: input.http2 ?? true,
        http3: input.http3 ?? false,
        notes: input.notes ?? null,
        ...(() => {
          const ch = this.normalizeCustomHeadersJson(input.customHeaders);
          if (ch === undefined) return {};
          return { customHeaders: ch === null ? Prisma.JsonNull : ch };
        })(),
        healthCheckPath: this.coerceHealthCheckPath(input.healthCheckPath),
        accessGroupMemberships: {
          create: (input.accessGroupIds ?? []).map((accessGroupId) => ({ accessGroupId })),
        },
      },
      include: {
        certificate: { select: { id: true, commonName: true, sans: true } },
        accessGroupMemberships: {
          orderBy: { accessGroupId: 'asc' },
          include: { accessGroup: { select: { id: true, name: true } } },
        },
      },
    });

    await this.applySafe(input.clusterId);
    return this.mapHostResponse(created as never);
  }

  async update(id: string, input: UpdateProxyHostInput) {
    const existing = await this.findOrThrow(id);
    const nextScheme = input.forwardScheme ?? existing.forwardScheme;
    const nextListen = input.listenPort !== undefined ? input.listenPort : existing.listenPort;
    if ((nextScheme === 'tcp' || nextScheme === 'udp') && (nextListen == null || nextListen < 1)) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'listenPort is required for TCP and UDP proxy hosts',
        400,
      );
    }
    if (input.certificateId) {
      await this.assertCertExists(input.certificateId, input.domain ?? existing.domain);
    }
    if (input.accessGroupIds !== undefined) {
      await this.assertAccessGroups(existing.clusterId, input.accessGroupIds);
    }

    const updated = await this.prisma.proxyHost.update({
      where: { id },
      data: {
        domain: input.domain,
        forwardScheme: input.forwardScheme,
        forwardHost: input.forwardHost,
        forwardPort: input.forwardPort,
        listenPort: input.listenPort,
        ssl: input.ssl,
        certificateId: input.certificateId,
        httpToHttps: input.httpToHttps,
        hsts: input.hsts,
        blockExploits: input.blockExploits,
        wsSupport: input.wsSupport,
        http2: input.http2,
        http3: input.http3,
        enabled: input.enabled,
        notes: input.notes,
        ...(input.customHeaders !== undefined
          ? {
              customHeaders: (() => {
                const ch = this.normalizeCustomHeadersJson(input.customHeaders);
                if (ch === undefined) return undefined;
                return ch === null ? Prisma.JsonNull : ch;
              })(),
            }
          : {}),
        ...(input.healthCheckPath !== undefined
          ? { healthCheckPath: this.coerceHealthCheckPath(input.healthCheckPath) }
          : {}),
        ...(input.accessGroupIds !== undefined
          ? {
              accessGroupMemberships: {
                deleteMany: {},
                create: input.accessGroupIds.map((accessGroupId) => ({ accessGroupId })),
              },
            }
          : {}),
      } as Prisma.ProxyHostUpdateInput,
      include: {
        certificate: { select: { id: true, commonName: true, sans: true } },
        accessGroupMemberships: {
          orderBy: { accessGroupId: 'asc' },
          include: { accessGroup: { select: { id: true, name: true } } },
        },
      },
    });

    await this.applySafe(existing.clusterId);
    return this.mapHostResponse(updated as never);
  }

  async remove(id: string) {
    const host = await this.findOrThrow(id);
    await this.prisma.proxyHost.delete({ where: { id } });
    await this.applySafe(host.clusterId);
    return { ok: true };
  }

  private async findOrThrow(id: string) {
    const host = await this.prisma.proxyHost.findUnique({ where: { id } });
    if (!host) throw new AppException(ErrorCode.PROXY_HOST_NOT_FOUND, 'Proxy host not found', 404);
    return host;
  }

  private async assertClusterExists(clusterId: string) {
    const c = await this.prisma.cluster.findUnique({ where: { id: clusterId } });
    if (!c) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
  }

  private mapHostResponse<
    T extends {
      accessGroupMemberships: { accessGroup: { id: string; name: string } }[];
    },
  >(
    h: T,
  ): Omit<T, 'accessGroupMemberships'> & {
    accessGroups: { id: string; name: string }[];
  } {
    const { accessGroupMemberships, ...rest } = h;
    return {
      ...rest,
      accessGroups: accessGroupMemberships.map((m) => m.accessGroup),
    };
  }

  private async assertAccessGroups(clusterId: string, ids: string[] | undefined) {
    if (ids == null || ids.length === 0) return;
    const uniq = [...new Set(ids)];
    if (uniq.length !== ids.length) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Duplicate access groups', 400);
    }
    const found = await this.prisma.accessGroup.findMany({
      where: { clusterId, id: { in: uniq } },
      select: { id: true },
    });
    if (found.length !== uniq.length) {
      throw new AppException(ErrorCode.NOT_FOUND, 'Access group not found in this cluster', 404);
    }
  }

  private async assertCertExists(certId: string, domain: string) {
    const c = await this.prisma.certificate.findUnique({ where: { id: certId } });
    if (!c) throw new AppException(ErrorCode.CERT_NOT_FOUND, 'Certificate not found', 404);
    if (!certCovers(c, domain)) {
      throw new AppException(
        ErrorCode.PROXY_HOST_DOMAIN_INVALID,
        `Certificate does not cover '${domain}' (CN=${c.commonName}, SAN=${c.sans.join(',')})`,
      );
    }
  }

  /** null/пусто в БД = при probe используется «/». */
  private coerceHealthCheckPath(value: string | null | undefined): string | null {
    if (value == null) return null;
    const t = value.trim();
    if (!t) return null;
    const p = t.startsWith('/') ? t : `/${t}`;
    return p.replace(/\/{2,}/g, '/') || '/';
  }

  private normalizeCustomHeadersJson(
    value: Record<string, string> | null | undefined,
  ): Record<string, string> | null | undefined {
    if (value === undefined) return undefined;
    if (value === null || Object.keys(value).length === 0) return null;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k.toLowerCase()] = v;
    }
    return out;
  }

  /**
   * Авто-apply: НЕ ломаем CRUD-ответ если render/reload свалится — только
   * залогируем. Юзер на UI увидит host созданным; ошибки render видны в
   * логах api.
   */
  private async applySafe(clusterId: string): Promise<void> {
    try {
      const r = await this.renderApply.apply(clusterId);
      this.logger.log(
        `auto-apply ok: cluster=${clusterId} hosts=${r.hostsApplied} certs=${r.certsLoaded} reload=${r.reloadOk}`,
      );
    } catch (err) {
      this.logger.error(
        `auto-apply FAILED for cluster=${clusterId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
