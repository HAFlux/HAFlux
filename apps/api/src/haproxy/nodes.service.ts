import net from 'node:net';
import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { SshTransport } from './transports/ssh.transport';
import { TransportFactory } from './transports/transport.factory';

// Все строки, попадающие в shell-команды транспортов, валидируем жёстко:
// никаких пробелов/кавычек/метасимволов.
const SafeName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/, {
    message: 'allowed: letters, digits, dot, underscore, dash',
  });
const noDotDot = (s: string) => !s.split('/').includes('..');
const SafePath = z
  .string()
  .min(1)
  .max(256)
  .regex(/^\/[a-zA-Z0-9._\/-]*$/, { message: 'must be an absolute path without special chars' })
  .refine(noDotDot, { message: 'path traversal (..) is not allowed' });
const SafeTarget = z
  .string()
  .max(256)
  .regex(/^[a-zA-Z0-9._\/-]*$/, { message: 'no spaces or shell metacharacters allowed' })
  .refine(noDotDot, { message: 'path traversal (..) is not allowed' });
const HostSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9.:_-]+$/, { message: 'must be a hostname or IP' });

const NodeBaseSchema = z.object({
  name: SafeName,
  transport: z.enum(['LOCAL', 'SSH']).default('SSH'),
  sshHost: HostSchema.nullable().optional(),
  sshPort: z.number().int().min(1).max(65535).default(22),
  sshUser: SafeName.default('root'),
  haproxyDataDir: SafePath.default('/etc/haproxy'),
  reloadMode: z.enum(['CONTAINER', 'SYSTEMD', 'SIGNAL', 'MASTER_CLI']).default('SYSTEMD'),
  reloadTarget: SafeTarget.nullable().optional(),
  role: z.enum(['PRIMARY', 'SECONDARY']).default('SECONDARY'),
});

const CreateNodeSchema = NodeBaseSchema.refine((d) => d.transport === 'LOCAL' || !!d.sshHost, {
  message: 'sshHost is required for SSH transport',
  path: ['sshHost'],
});

const UpdateNodeSchema = NodeBaseSchema.partial();

@Injectable()
export class NodesService {
  private readonly logger = new Logger(NodesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly transports: TransportFactory,
  ) {}

  list(clusterId: string) {
    return this.prisma.node.findMany({
      where: { clusterId },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  async create(clusterId: string, body: unknown) {
    await this.assertCluster(clusterId);
    const parsed = CreateNodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        parsed.error.issues[0]?.message ?? 'Validation failed',
        400,
      );
    }
    const d = parsed.data;

    // Локальный haproxy один на инсталляцию: вторая LOCAL-нода (в любом
    // кластере) перезаписывала бы тот же /haproxy-data.
    if (d.transport === 'LOCAL') {
      const existingLocal = await this.prisma.node.findFirst({ where: { transport: 'LOCAL' } });
      if (existingLocal) {
        throw new AppException(
          ErrorCode.CONFLICT,
          `A LOCAL node already exists (cluster ${existingLocal.clusterId}). Only one LOCAL node per installation.`,
          409,
        );
      }
    }

    const taken = await this.prisma.node.findUnique({
      where: { clusterId_name: { clusterId, name: d.name } },
    });
    if (taken) {
      throw new AppException(ErrorCode.CONFLICT, `Node '${d.name}' already exists`, 409);
    }

    return this.prisma.node.create({
      data: {
        clusterId,
        name: d.name,
        transport: d.transport,
        sshHost: d.sshHost ?? null,
        sshPort: d.sshPort,
        sshUser: d.sshUser,
        haproxyDataDir: d.haproxyDataDir,
        reloadMode: d.reloadMode,
        reloadTarget: d.reloadTarget ?? null,
        role: d.role,
      },
    });
  }

  async update(clusterId: string, nodeId: string, body: unknown) {
    const node = await this.getNode(clusterId, nodeId);
    const parsed = UpdateNodeSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        parsed.error.issues[0]?.message ?? 'Validation failed',
        400,
      );
    }
    const d = parsed.data;
    const transport = d.transport ?? node.transport;
    const sshHost = d.sshHost !== undefined ? d.sshHost : node.sshHost;
    if (transport === 'SSH' && !sshHost) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'sshHost is required for SSH', 400);
    }
    if (transport === 'LOCAL' && node.transport !== 'LOCAL') {
      const existingLocal = await this.prisma.node.findFirst({
        where: { transport: 'LOCAL', id: { not: nodeId } },
      });
      if (existingLocal) {
        throw new AppException(ErrorCode.CONFLICT, 'A LOCAL node already exists', 409);
      }
    }

    return this.prisma.node.update({
      where: { id: nodeId },
      data: {
        name: d.name,
        transport: d.transport,
        sshHost: d.sshHost,
        sshPort: d.sshPort,
        sshUser: d.sshUser,
        haproxyDataDir: d.haproxyDataDir,
        reloadMode: d.reloadMode,
        reloadTarget: d.reloadTarget,
        role: d.role,
      },
    });
  }

  async remove(clusterId: string, nodeId: string) {
    await this.getNode(clusterId, nodeId);
    await this.prisma.node.delete({ where: { id: nodeId } });
    return { ok: true as const };
  }

  /**
   * Проверка доступности ноды: SSH — connect + `haproxy -v`, LOCAL — TCP до
   * docker.sock не нужен, просто наличие контейнера через транспорт validate
   * слишком тяжело; используем быстрый probe. Обновляет status/lastSeenAt.
   */
  async test(clusterId: string, nodeId: string) {
    const node = await this.getNode(clusterId, nodeId);
    const t0 = Date.now();
    let ok = false;
    let detail: string | null = null;

    const transport = await this.transports.forNode(node);
    try {
      if (transport instanceof SshTransport) {
        const { stdout } = await transport.exec(
          'haproxy -v 2>/dev/null | head -1 || echo no-haproxy',
        );
        ok = true;
        detail = stdout.trim().slice(0, 200);
      } else {
        // LOCAL: validate уже проверяет и docker, и сам конфиг.
        const res = await transport.validate();
        ok = true;
        detail = (res.stdout || res.stderr || 'ok').trim().slice(0, 200);
      }
    } catch (err) {
      detail = err instanceof Error ? err.message : String(err);
    } finally {
      await transport.close();
    }

    const haproxyVersion =
      ok && detail && /haproxy version/i.test(detail) ? detail.slice(0, 64) : undefined;
    const updated = await this.prisma.node.update({
      where: { id: node.id },
      data: {
        status: ok ? 'ONLINE' : 'OFFLINE',
        ...(ok ? { lastSeenAt: new Date() } : {}),
        ...(haproxyVersion ? { haproxyVersion } : {}),
      },
    });
    return { ok, detail, durationMs: Date.now() - t0, node: updated };
  }

  /** Назначить ноду PRIMARY (остальные в кластере становятся SECONDARY). */
  async promote(clusterId: string, nodeId: string) {
    await this.getNode(clusterId, nodeId);
    await this.prisma.$transaction([
      this.prisma.node.updateMany({
        where: { clusterId, id: { not: nodeId } },
        data: { role: 'SECONDARY' },
      }),
      this.prisma.node.update({ where: { id: nodeId }, data: { role: 'PRIMARY' } }),
    ]);
    this.logger.log(`node ${nodeId} promoted to PRIMARY in cluster ${clusterId}`);
    return this.list(clusterId);
  }

  /** Быстрый TCP-пинг (для health-чекера SSH-нод). */
  tcpProbe(host: string, port: number, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.connect({ host, port, timeout: timeoutMs });
      const done = (v: boolean) => {
        socket.destroy();
        resolve(v);
      };
      socket.once('connect', () => done(true));
      socket.once('timeout', () => done(false));
      socket.once('error', () => done(false));
    });
  }

  private async getNode(clusterId: string, nodeId: string) {
    const node = await this.prisma.node.findFirst({ where: { id: nodeId, clusterId } });
    if (!node) throw new AppException(ErrorCode.NOT_FOUND, 'Node not found', 404);
    return node;
  }

  private async assertCluster(clusterId: string) {
    const c = await this.prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { id: true },
    });
    if (!c) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
  }
}
