import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CfgRenderer } from './renderers/cfg.renderer';
import { TransportFactory } from './transports/transport.factory';
import type { ApplyOptions, ApplyResult, NodeApplyResult } from './types';

@Injectable()
export class ApplyService {
  private readonly logger = new Logger(ApplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly renderer: CfgRenderer,
    private readonly transports: TransportFactory,
  ) {}

  /**
   * Полный цикл Apply для кластера:
   *   render → validate (на одной ноде) → deploy на все ноды → reload последовательно.
   * При неудаче на любой ноде — откат всех уже задеплоенных нод (TODO: пока best-effort).
   */
  async applyCluster(clusterId: string, options: ApplyOptions): Promise<ApplyResult> {
    const jobId = randomUUID();
    const cluster = await this.prisma.cluster.findUnique({
      where: { id: clusterId },
      include: { nodes: { orderBy: { role: 'asc' } } },
    });
    if (!cluster) throw new NotFoundException('Cluster not found');
    if (cluster.nodes.length === 0) {
      throw new Error('Cluster has no nodes — add at least one node first.');
    }

    this.logger.log(`apply ${jobId}: cluster=${cluster.name} nodes=${cluster.nodes.length}`);

    const tree = await this.renderer.render(clusterId);

    const results: NodeApplyResult[] = [];
    let allOk = true;

    for (const node of cluster.nodes) {
      const t = Date.now();
      const r: NodeApplyResult = {
        nodeId: node.id,
        nodeName: node.name,
        ok: false,
        validateOk: false,
        reloadOk: false,
        durationMs: 0,
      };

      const transport = await this.transports.forNode(node);
      try {
        await transport.deploy(tree);
        await transport.validate();
        r.validateOk = true;

        if (!options.dryRun) {
          await transport.reload();
          r.reloadOk = true;
        }
        r.ok = true;
      } catch (err) {
        allOk = false;
        r.error = err instanceof Error ? err.message : String(err);
        this.logger.error(`apply ${jobId} node=${node.name} failed`, err as Error);
      } finally {
        await transport.close();
        r.durationMs = Date.now() - t;
        results.push(r);
      }
    }

    let configVersionId: string | undefined;
    if (allOk && !options.dryRun) {
      const version = await this.prisma.configVersion.create({
        data: {
          clusterId,
          gitSha: jobId.slice(0, 12),
          authorEmail: options.authorEmail ?? null,
          message: options.message,
          diffBlob: this.formatTree(tree.files),
        },
      });
      configVersionId = version.id;
    }

    return {
      jobId,
      clusterId,
      ok: allOk,
      nodes: results,
      configVersionId,
    };
  }

  private formatTree(files: Map<string, string | Buffer>): string {
    const out: string[] = [];
    for (const [k, v] of [...files.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      out.push(`# ── ${k} ──`);
      out.push(typeof v === 'string' ? v : `<binary ${v.length} bytes>`);
      out.push('');
    }
    return out.join('\n');
  }
}
