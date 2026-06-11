import { createPublicKey, generateKeyPairSync } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { CryptoService, toBytes } from '../certificates/crypto.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Единственный SSH-ключ панели для доступа к удалённым нодам.
 * Приватная часть хранится в БД зашифрованной (envelope через CryptoService),
 * публичную оператор кладёт в ~/.ssh/authorized_keys на нодах.
 */
@Injectable()
export class SshKeysService {
  private readonly logger = new Logger(SshKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  /** Публичная часть ключа (генерирует ключ при первом обращении). */
  async getOrCreate(): Promise<{ publicKey: string; comment: string; createdAt: Date }> {
    const existing = await this.prisma.sshKey.findFirst();
    if (existing) {
      return {
        publicKey: existing.publicKey,
        comment: existing.comment,
        createdAt: existing.createdAt,
      };
    }

    // RSA 3072 в PEM (PKCS#1) — формат, который ssh2 понимает без конвертации.
    const { publicKey, privateKey } = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
    });

    const comment = 'haflux';
    const openssh = `${toOpenSshRsa(publicKey)} ${comment}`;
    const created = await this.prisma.sshKey.create({
      data: {
        comment,
        publicKey: openssh,
        encryptedPrivKey: toBytes(this.crypto.encrypt(privateKey)),
      },
    });
    this.logger.log('Generated panel SSH key (rsa-3072)');
    return { publicKey: created.publicKey, comment: created.comment, createdAt: created.createdAt };
  }

  /** Расшифрованный приватный ключ (PEM) для ssh2. */
  async privateKeyPem(): Promise<string> {
    await this.getOrCreate();
    const key = await this.prisma.sshKey.findFirst();
    if (!key) throw new Error('SSH key not configured');
    return this.crypto.decryptToString(Buffer.from(key.encryptedPrivKey));
  }
}

/** SPKI PEM → строка "ssh-rsa AAAA..." (authorized_keys формат). */
function toOpenSshRsa(spkiPem: string): string {
  const jwk = createPublicKey(spkiPem).export({ format: 'jwk' }) as { n: string; e: string };
  const e = Buffer.from(jwk.e, 'base64url');
  let n = Buffer.from(jwk.n, 'base64url');
  // ssh wire format: mpint — если старший бит установлен, добавляется ведущий 0x00
  if (n[0] !== undefined && n[0] & 0x80) n = Buffer.concat([Buffer.from([0]), n]);
  const type = Buffer.from('ssh-rsa');
  const parts = [type, e, n];
  const wire = Buffer.concat(
    parts.flatMap((p) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(p.length);
      return [len, p];
    }),
  );
  return `ssh-rsa ${wire.toString('base64')}`;
}
