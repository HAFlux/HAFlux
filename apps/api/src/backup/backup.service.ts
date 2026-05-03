import { Injectable, Logger } from '@nestjs/common';
import { AppException, ErrorCode } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';

const TABLES = [
  'organization',
  'role',
  'user',
  'membership',
  'oidcLink',
  'sshKey',
  'cluster',
  'node',
  'configVersion',
  'certificate',
  'acmeAccount',
  'dnsProvider',
  'acmeOrder',
  'haproxyGlobal',
  'haproxyDefaults',
  'frontend',
  'backend',
  'listen',
  'serverEntry',
  'bind',
  'aclRule',
  'httpRule',
  'tcpRule',
  'peersSection',
  'resolver',
  'userlist',
  'httpErrorsSection',
  'ring',
  'cache',
  'mapFile',
  'aclListFile',
  'errorFile',
  'luaScript',
  'spoeAgent',
  'accessGroup',
  'proxyHost',
  'proxyHostAccessGroup',
] as const;

const BYTES_COLUMNS: Record<string, string[]> = {
  certificate: ['encryptedPemBlob'],
  acmeAccount: ['encryptedKey'],
  dnsProvider: ['encryptedCredentials'],
  sshKey: ['encryptedPrivKey'],
};

type Table = (typeof TABLES)[number];

interface BackupPayload {
  version: number;
  createdAt: string;
  data: Partial<Record<Table, Record<string, unknown>[]>>;
}

@Injectable()
export class BackupService {
  private readonly logger = new Logger(BackupService.name);

  constructor(private readonly prisma: PrismaService) {}

  async exportAll(): Promise<BackupPayload> {
    const data: Partial<Record<Table, Record<string, unknown>[]>> = {};
    const client = this.prisma as unknown as Record<
      string,
      { findMany: () => Promise<Record<string, unknown>[]> } | undefined
    >;
    for (const t of TABLES) {
      const model = client[t];
      if (!model) throw new AppException(ErrorCode.INTERNAL, `Prisma model missing: ${t}`, 500);
      const rows = await model.findMany();
      const cols = BYTES_COLUMNS[t] ?? [];
      data[t] =
        cols.length === 0
          ? rows
          : rows.map((row) => {
              const out = { ...row };
              for (const c of cols) {
                const v = out[c];
                if (v != null) {
                  out[c] = { __bytes: Buffer.from(v as Buffer | Uint8Array).toString('base64') };
                }
              }
              return out;
            });
    }
    return {
      version: 1,
      createdAt: new Date().toISOString(),
      data,
    };
  }

  async importAll(payload: BackupPayload): Promise<{ restored: Record<string, number> }> {
    if (!payload || payload.version !== 1 || typeof payload.data !== 'object') {
      throw new AppException(ErrorCode.VALIDATION_FAILED, 'Invalid backup payload', 400);
    }
    const restored: Record<string, number> = {};

    await this.prisma.$transaction(
      async (tx) => {
        type Model = {
          deleteMany: (args?: unknown) => Promise<unknown>;
          create: (args: { data: Record<string, unknown> }) => Promise<unknown>;
        };
        const client = tx as unknown as Record<string, Model | undefined>;
        const get = (name: string): Model => {
          const m = client[name];
          if (!m) throw new AppException(ErrorCode.INTERNAL, `Prisma model missing: ${name}`, 500);
          return m;
        };
        // Audit events first (FK to user without cascade), затем reverse-order.
        await get('auditEvent').deleteMany();
        for (const t of [...TABLES].reverse()) {
          await get(t).deleteMany();
        }
        for (const t of TABLES) {
          const rows = payload.data[t] ?? [];
          const cols = BYTES_COLUMNS[t] ?? [];
          for (const raw of rows) {
            const row = { ...raw };
            for (const c of cols) {
              const v = row[c] as { __bytes?: string } | null | undefined;
              if (v && typeof v === 'object' && typeof v.__bytes === 'string') {
                row[c] = Buffer.from(v.__bytes, 'base64');
              }
            }
            await get(t).create({ data: row });
          }
          restored[t] = rows.length;
        }
      },
      { timeout: 120_000, maxWait: 30_000 },
    );

    this.logger.log(
      `Restore complete: ${Object.entries(restored)
        .map(([k, v]) => `${k}=${v}`)
        .join(' ')}`,
    );
    return { restored };
  }
}
