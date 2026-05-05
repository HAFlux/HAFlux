import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Envelope encryption через AES-256-GCM ключом из ENCRYPTION_KEY.
 * Шифруем секреты (Cloudflare token, ACME account key, приватные ключи cert).
 *
 * Layout: [iv:12 | ciphertext:N | authTag:16]  → base64.
 */
@Injectable()
export class CryptoService implements OnModuleInit {
  private key!: Buffer;

  constructor(private readonly cfg: ConfigService) {}

  onModuleInit() {
    const raw = this.cfg.getOrThrow<string>('ENCRYPTION_KEY');
    // Принимаем base64 (32 байта) или произвольную длину — деривируем до 32.
    let key: Buffer;
    try {
      const decoded = Buffer.from(raw, 'base64');
      key = decoded.length === 32 ? decoded : createHash('sha256').update(raw).digest();
    } catch {
      key = createHash('sha256').update(raw).digest();
    }
    this.key = key;
  }

  encrypt(plaintext: string | Buffer): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const buf = Buffer.isBuffer(plaintext) ? plaintext : Buffer.from(plaintext, 'utf8');
    const enc = Buffer.concat([cipher.update(buf), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, enc, tag]);
  }

  decrypt(blob: Buffer): Buffer {
    const iv = blob.subarray(0, 12);
    const tag = blob.subarray(blob.length - 16);
    const enc = blob.subarray(12, blob.length - 16);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]);
  }

  decryptToString(blob: Buffer): string {
    return this.decrypt(blob).toString('utf8');
  }
}

/**
 * Конвертирует Buffer в Uint8Array<ArrayBuffer>. Prisma 7 ужесточил типизацию
 * Bytes-полей: они принимают только Uint8Array поверх обычного ArrayBuffer, а
 * `Buffer.from(...)` (после @types/node 22+) возвращает Buffer<ArrayBufferLike>,
 * что включает SharedArrayBuffer. Создаём явный ArrayBuffer и наливаем в него
 * байты — TS видит точный generic-параметр.
 */
export function toBytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const ab = new ArrayBuffer(buf.length);
  const out = new Uint8Array(ab);
  out.set(buf);
  return out;
}
