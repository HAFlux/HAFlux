import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class BackendsService {
  constructor(private readonly prisma: PrismaService) {}

  list(clusterId: string) {
    return this.prisma.backend.findMany({
      where: { clusterId },
      include: { servers: true },
      orderBy: { name: 'asc' },
    });
  }

  create(
    clusterId: string,
    input: {
      name: string;
      mode: 'http' | 'tcp';
      balance?: 'roundrobin' | 'static_rr' | 'leastconn' | 'source' | 'uri' | 'url_param' | 'hdr' | 'random';
      servers?: Array<{ name: string; address: string; port: number; weight?: number; check?: boolean }>;
      options?: Record<string, unknown>;
      timeouts?: Record<string, string>;
      httpCheck?: { uri?: string; method?: string; expectStatus?: string };
    },
  ) {
    return this.prisma.backend.create({
      data: {
        clusterId,
        name: input.name,
        mode: input.mode,
        balance: input.balance ?? 'roundrobin',
        options: (input.options ?? {}) as object,
        timeouts: (input.timeouts ?? {}) as object,
        httpCheck: (input.httpCheck ?? {}) as object,
        servers: input.servers
          ? {
              create: input.servers.map((s) => ({
                name: s.name,
                address: s.address,
                port: s.port,
                weight: s.weight ?? 1,
                check: s.check ?? true,
              })),
            }
          : undefined,
      },
      include: { servers: true },
    });
  }

  async remove(clusterId: string, name: string) {
    const b = await this.prisma.backend.findUnique({ where: { clusterId_name: { clusterId, name } } });
    if (!b) throw new NotFoundException('Backend not found');
    await this.prisma.backend.delete({ where: { id: b.id } });
    return { ok: true };
  }
}
