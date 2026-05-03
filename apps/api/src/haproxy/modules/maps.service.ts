import { Injectable, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MapsService {
  constructor(private readonly prisma: PrismaService) {}

  list(clusterId: string) {
    return this.prisma.mapFile.findMany({ where: { clusterId }, orderBy: { name: 'asc' } });
  }

  create(
    clusterId: string,
    input: { name: string; description?: string; entries?: Array<{ key: string; value: string }> },
  ) {
    return this.prisma.mapFile.create({
      data: {
        clusterId,
        name: input.name,
        description: input.description ?? null,
        entries: input.entries ?? [],
      },
    });
  }

  async update(
    clusterId: string,
    name: string,
    input: { description?: string; entries?: Array<{ key: string; value: string }> },
  ) {
    const m = await this.prisma.mapFile.findUnique({
      where: { clusterId_name: { clusterId, name } },
    });
    if (!m) throw new NotFoundException('Map not found');
    return this.prisma.mapFile.update({
      where: { id: m.id },
      data: {
        ...(input.description !== undefined && { description: input.description }),
        ...(input.entries !== undefined && { entries: input.entries }),
      },
    });
  }

  async remove(clusterId: string, name: string) {
    const m = await this.prisma.mapFile.findUnique({
      where: { clusterId_name: { clusterId, name } },
    });
    if (!m) throw new NotFoundException('Map not found');
    await this.prisma.mapFile.delete({ where: { id: m.id } });
    return { ok: true };
  }
}
