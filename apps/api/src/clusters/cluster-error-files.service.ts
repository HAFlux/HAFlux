import { Injectable } from '@nestjs/common';
import type { ErrorFile } from '@prisma/client';
import { AppException, ErrorCode } from '../common/errors';
import type { PrismaService } from '../prisma/prisma.service';
import type { ProxyHostsRenderApplyService } from '../proxy-hosts/render-apply.service';

export const CLUSTER_ERROR_PAGE_CODES = [400, 403, 408, 500, 502, 503, 504] as const;

export type ClusterErrorPageCode = (typeof CLUSTER_ERROR_PAGE_CODES)[number];

export function extractHtmlFromErrorFileContent(full: string): string {
  const rn = full.indexOf('\r\n\r\n');
  if (rn >= 0) return full.slice(rn + 4);
  const n = full.indexOf('\n\n');
  if (n >= 0) return full.slice(n + 2);
  return full;
}

export function parseClusterErrorPageCode(raw: string): number {
  const code = Number.parseInt(raw, 10);
  if (!Number.isFinite(code) || !(CLUSTER_ERROR_PAGE_CODES as readonly number[]).includes(code)) {
    throw new AppException(
      ErrorCode.VALIDATION_FAILED,
      `Unsupported status code. Allowed: ${CLUSTER_ERROR_PAGE_CODES.join(', ')}`,
      400,
    );
  }
  return code;
}

@Injectable()
export class ClusterErrorFilesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly renderApply: ProxyHostsRenderApplyService,
  ) {}

  async list(clusterId: string) {
    await this.assertCluster(clusterId);
    const rows = await this.prisma.errorFile.findMany({
      where: { clusterId },
    });
    const byStatus = new Map<number, ErrorFile>(rows.map((r) => [r.status, r]));

    return CLUSTER_ERROR_PAGE_CODES.map((code) => {
      const row = byStatus.get(code);
      const fallbackHtml = this.renderApply.defaultErrorPageHtml(code);
      if (row?.content?.trim()) {
        const html = extractHtmlFromErrorFileContent(row.content);
        return { code, isCustom: true, html };
      }
      return { code, isCustom: false, html: fallbackHtml };
    });
  }

  async upsert(clusterId: string, code: number, html: string) {
    await this.assertCluster(clusterId);
    const trimmed = html.trim();
    if (!trimmed) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'HTML body is required', 400);
    }
    const full = this.renderApply.buildHttpErrorFilePayload(code, trimmed);

    await this.prisma.errorFile.upsert({
      where: {
        clusterId_name: {
          clusterId,
          name: String(code),
        },
      },
      create: {
        clusterId,
        name: String(code),
        status: code,
        content: full,
      },
      update: {
        content: full,
      },
    });

    await this.renderApply.apply(clusterId);
    return { ok: true as const };
  }

  async reset(clusterId: string, code: number) {
    await this.assertCluster(clusterId);
    const removed = await this.prisma.errorFile.deleteMany({
      where: { clusterId, status: code },
    });
    if (removed.count === 0) {
      throw new AppException(ErrorCode.NOT_FOUND, 'No custom error page for this status code', 404);
    }
    await this.renderApply.apply(clusterId);
    return { ok: true as const };
  }

  private async assertCluster(clusterId: string): Promise<void> {
    const c = await this.prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { id: true },
    });
    if (!c) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
  }
}
