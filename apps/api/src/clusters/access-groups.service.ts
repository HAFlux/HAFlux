import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { CryptoService } from '../certificates/crypto.service';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { ProxyHostsRenderApplyService } from '../proxy-hosts/render-apply.service';

const NameSchema = z
  .string()
  .min(1, 'name is required')
  .max(64, 'name is too long')
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9 _-]*$/, {
    message: 'allowed: letters, digits, space, _, -',
  });

const UserCreateSchema = z.object({
  username: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-zA-Z0-9_]+$/, { message: 'username: letters, digits, underscore only' }),
  password: z.string().min(1).max(512),
});

const CountryCodeSchema = z
  .string()
  .length(2)
  .regex(/^[a-zA-Z]{2}$/, { message: 'country code must be ISO 3166-1 alpha-2' })
  .transform((s) => s.toLowerCase());

const CreateAccessGroupSchema = z
  .object({
    name: NameSchema,
    ipAllowlist: z.array(z.string().min(1).max(128)).max(500),
    ipDenylist: z.array(z.string().min(1).max(128)).max(500).default([]),
    geoDenylist: z.array(CountryCodeSchema).max(250).default([]),
    users: z.array(UserCreateSchema).max(50),
  })
  .refine(
    (d) =>
      d.ipAllowlist.length > 0 ||
      d.ipDenylist.length > 0 ||
      d.geoDenylist.length > 0 ||
      d.users.length > 0,
    {
      message: 'At least one IP/CIDR, country, or Basic Auth user is required',
    },
  );

const UpdateAccessGroupSchema = z.object({
  name: NameSchema.optional(),
  ipAllowlist: z.array(z.string().min(1).max(128)).max(500).optional(),
  ipDenylist: z.array(z.string().min(1).max(128)).max(500).optional(),
  geoDenylist: z.array(CountryCodeSchema).max(250).optional(),
  users: z
    .array(
      z.object({
        username: z
          .string()
          .min(1)
          .max(64)
          .regex(/^[a-zA-Z0-9_]+$/, { message: 'username: letters, digits, underscore only' }),
        password: z.string().min(1).max(512).optional(),
      }),
    )
    .max(50)
    .optional(),
});

export function validateIpOrCidr(line: string): boolean {
  const s = line.trim();
  if (!s || s.length > 128) return false;
  const parts = s.split('/');
  if (parts.length > 2) return false;
  const addr = parts[0] ?? '';
  if (addr.includes('.')) {
    const m = addr.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!m) return false;
    for (let i = 1; i <= 4; i++) {
      const n = Number(m[i]);
      if (n > 255) return false;
    }
    if (parts.length === 2) {
      const pfx = Number(parts[1]);
      return Number.isInteger(pfx) && pfx >= 0 && pfx <= 32;
    }
    return true;
  }
  if (addr.includes(':')) {
    if (parts.length === 2) {
      const pfx = Number(parts[1]);
      if (!Number.isInteger(pfx) || pfx < 0 || pfx > 128) return false;
    }
    return addr.length >= 2 && addr.length <= 128 && /^[0-9a-fA-F:]+$/.test(addr.replace(/:/g, ''));
  }
  return false;
}

function normalizeIpLines(lines: string[]): string[] {
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw.trim();
    if (!t) continue;
    if (!validateIpOrCidr(t)) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, `Invalid IP or CIDR: ${t}`, 400);
    }
    out.push(t);
  }
  return out;
}

export type AccessGroupListItem = {
  id: string;
  name: string;
  ipCount: number;
  denyCount: number;
  geoCount: number;
  userCount: number;
  proxyHostCount: number;
  createdAt: Date;
  updatedAt: Date;
};

export type AccessGroupDetail = AccessGroupListItem & {
  ipAllowlist: string[];
  ipDenylist: string[];
  geoDenylist: string[];
  users: { username: string; hasPassword: boolean }[];
};

@Injectable()
export class AccessGroupsService {
  private readonly logger = new Logger(AccessGroupsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly renderApply: ProxyHostsRenderApplyService,
  ) {}

  async list(clusterId: string): Promise<AccessGroupListItem[]> {
    await this.assertCluster(clusterId);
    const rows = await this.prisma.accessGroup.findMany({
      where: { clusterId },
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { proxyHostMemberships: true } },
      },
    });
    return rows.map((r) => {
      const ips = (r.ipAllowlist as string[]) ?? [];
      const denies = (r.ipDenylist as string[]) ?? [];
      const geo = (r.geoDenylist as string[]) ?? [];
      const users = (r.authUsers as { username: string }[]) ?? [];
      return {
        id: r.id,
        name: r.name,
        ipCount: ips.length,
        denyCount: denies.length,
        geoCount: geo.length,
        userCount: users.length,
        proxyHostCount: r._count.proxyHostMemberships,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      };
    });
  }

  async get(clusterId: string, id: string): Promise<AccessGroupDetail> {
    await this.assertCluster(clusterId);
    const r = await this.prisma.accessGroup.findFirst({
      where: { id, clusterId },
      include: { _count: { select: { proxyHostMemberships: true } } },
    });
    if (!r) throw new AppException(ErrorCode.NOT_FOUND, 'Access group not found', 404);
    const ips = (r.ipAllowlist as string[]) ?? [];
    const denies = (r.ipDenylist as string[]) ?? [];
    const geo = (r.geoDenylist as string[]) ?? [];
    const users = (r.authUsers as { username: string; passwordEnc: string }[]) ?? [];
    return {
      id: r.id,
      name: r.name,
      ipCount: ips.length,
      denyCount: denies.length,
      geoCount: geo.length,
      userCount: users.length,
      proxyHostCount: r._count.proxyHostMemberships,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      ipAllowlist: ips,
      ipDenylist: denies,
      geoDenylist: geo,
      users: users.map((u) => ({
        username: u.username,
        hasPassword: !!u.passwordEnc,
      })),
    };
  }

  async create(clusterId: string, body: unknown) {
    await this.assertCluster(clusterId);
    const parsed = CreateAccessGroupSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Validation failed';
      throw new AppException(ErrorCode.VALIDATION_FAILED, msg, 400);
    }

    const ipLines = normalizeIpLines(parsed.data.ipAllowlist);
    const denyLines = normalizeIpLines(parsed.data.ipDenylist);
    const authUsers = this.encryptUsers(parsed.data.users);

    const exists = await this.prisma.accessGroup.findUnique({
      where: { clusterId_name: { clusterId, name: parsed.data.name } },
    });
    if (exists)
      throw new AppException(
        ErrorCode.CONFLICT,
        `Access group '${parsed.data.name}' already exists`,
        409,
      );

    const created = await this.prisma.accessGroup.create({
      data: {
        clusterId,
        name: parsed.data.name.trim(),
        ipAllowlist: ipLines,
        ipDenylist: denyLines,
        geoDenylist: parsed.data.geoDenylist,
        authUsers,
      },
    });

    await this.applySafe(clusterId);
    return created;
  }

  async update(clusterId: string, id: string, body: unknown) {
    await this.assertCluster(clusterId);
    const parsed = UpdateAccessGroupSchema.safeParse(body);
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message ?? 'Validation failed';
      throw new AppException(ErrorCode.VALIDATION_FAILED, msg, 400);
    }
    if (Object.keys(parsed.data).length === 0) {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Empty update', 400);
    }

    const existing = await this.prisma.accessGroup.findFirst({ where: { id, clusterId } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Access group not found', 404);

    if (parsed.data.name && parsed.data.name !== existing.name) {
      const taken = await this.prisma.accessGroup.findUnique({
        where: { clusterId_name: { clusterId, name: parsed.data.name.trim() } },
      });
      if (taken)
        throw new AppException(
          ErrorCode.CONFLICT,
          `Name '${parsed.data.name}' is already taken`,
          409,
        );
    }

    let nextIp = (existing.ipAllowlist as string[]) ?? [];
    if (parsed.data.ipAllowlist !== undefined) {
      nextIp = normalizeIpLines(parsed.data.ipAllowlist);
    }

    let nextDeny = (existing.ipDenylist as string[]) ?? [];
    if (parsed.data.ipDenylist !== undefined) {
      nextDeny = normalizeIpLines(parsed.data.ipDenylist);
    }

    let nextGeo = (existing.geoDenylist as string[]) ?? [];
    if (parsed.data.geoDenylist !== undefined) {
      nextGeo = parsed.data.geoDenylist;
    }

    let nextAuth: object[] = (existing.authUsers as object[]) ?? [];
    if (parsed.data.users !== undefined) {
      const prev = (existing.authUsers as { username: string; passwordEnc: string }[]) ?? [];
      const prevByUser = new Map(prev.map((u) => [u.username, u.passwordEnc]));
      nextAuth = [];
      for (const u of parsed.data.users) {
        if (u.password) {
          nextAuth.push({
            username: u.username,
            passwordEnc: this.crypto.encrypt(u.password).toString('base64'),
          });
        } else {
          const enc = prevByUser.get(u.username);
          if (!enc) {
            throw new AppException(
              ErrorCode.VALIDATION_FAILED,
              `Password required for new user "${u.username}"`,
              400,
            );
          }
          nextAuth.push({ username: u.username, passwordEnc: enc });
        }
      }
    }

    if (
      nextIp.length === 0 &&
      nextDeny.length === 0 &&
      nextGeo.length === 0 &&
      nextAuth.length === 0
    ) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'At least one IP/CIDR, country, or Basic Auth user is required',
        400,
      );
    }

    const updated = await this.prisma.accessGroup.update({
      where: { id },
      data: {
        ...(parsed.data.name !== undefined ? { name: parsed.data.name.trim() } : {}),
        ipAllowlist: nextIp,
        ipDenylist: nextDeny,
        geoDenylist: nextGeo,
        authUsers: nextAuth,
      },
    });

    await this.applySafe(clusterId);
    return updated;
  }

  async remove(clusterId: string, id: string) {
    await this.assertCluster(clusterId);
    const existing = await this.prisma.accessGroup.findFirst({ where: { id, clusterId } });
    if (!existing) throw new AppException(ErrorCode.NOT_FOUND, 'Access group not found', 404);

    await this.prisma.accessGroup.delete({ where: { id } });
    await this.applySafe(clusterId);
    return { ok: true as const };
  }

  private encryptUsers(users: z.infer<typeof UserCreateSchema>[]): object[] {
    return users.map((u) => ({
      username: u.username,
      passwordEnc: this.crypto.encrypt(u.password).toString('base64'),
    }));
  }

  private async assertCluster(clusterId: string): Promise<void> {
    const c = await this.prisma.cluster.findUnique({
      where: { id: clusterId },
      select: { id: true },
    });
    if (!c) throw new AppException(ErrorCode.CLUSTER_NOT_FOUND, 'Cluster not found', 404);
  }

  private async applySafe(clusterId: string): Promise<void> {
    try {
      await this.renderApply.apply(clusterId);
    } catch (err) {
      this.logger.error(
        `auto-apply failed for cluster=${clusterId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }
}
