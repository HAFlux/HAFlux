import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class FrontendsService {
  constructor(private readonly prisma: PrismaService) {}

  list(clusterId: string) {
    return this.prisma.frontend.findMany({
      where: { clusterId },
      include: { binds: true, acls: true, httpRules: true, tcpRules: true },
      orderBy: { name: 'asc' },
    });
  }

  create(
    clusterId: string,
    input: {
      name: string;
      mode: 'http' | 'tcp';
      defaultBackend?: string | null;
      options?: Record<string, unknown>;
      timeouts?: Record<string, string>;
      logFormat?: string;
      rawExtra?: string;
    },
  ) {
    return this.prisma.frontend.create({
      data: {
        clusterId,
        name: input.name,
        mode: input.mode,
        defaultBackend: input.defaultBackend ?? null,
        options: (input.options ?? {}) as object,
        timeouts: (input.timeouts ?? {}) as object,
        logFormat: input.logFormat ?? null,
        rawExtra: input.rawExtra ?? null,
      },
    });
  }

  async remove(clusterId: string, name: string) {
    const f = await this.prisma.frontend.findUnique({ where: { clusterId_name: { clusterId, name } } });
    if (!f) throw new NotFoundException('Frontend not found');
    await this.prisma.frontend.delete({ where: { id: f.id } });
    return { ok: true };
  }
}
