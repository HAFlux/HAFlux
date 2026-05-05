/**
 * Минимальный ZIP-encoder без сжатия (метод 0 = store).
 * Используется в /certificates/export — несколько небольших PEM-файлов,
 * deflate тут ничего не выиграет, но добавил бы pako/native-deflate в deps.
 *
 * Совместим с большинством unzip-имплементаций (Linux unzip, macOS Archive,
 * Windows Explorer): локальные header'ы + central directory + EOCD.
 */

import { createHash } from 'node:crypto';

interface ZipEntry {
  name: string;
  data: Buffer;
  /** Mtime в epoch ms. Если не указано — Date.now(). */
  mtime?: number;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    const idx = (c ^ (buf[i] ?? 0)) & 0xff;
    c = (CRC_TABLE[idx] ?? 0) ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

/** Перевод epoch ms в DOS time/date (упаковано в 32 бита: time | (date << 16)). */
function dosTime(ts: number): { time: number; date: number } {
  const d = new Date(ts);
  const year = Math.max(1980, d.getFullYear());
  const time =
    ((d.getHours() & 0x1f) << 11) | ((d.getMinutes() & 0x3f) << 5) | (d.getSeconds() >> 1);
  const date = (((year - 1980) & 0x7f) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

export function buildZip(entries: ZipEntry[]): Buffer {
  const localChunks: Buffer[] = [];
  const centralChunks: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, 'utf8');
    const crc = crc32(e.data);
    const size = e.data.length;
    const { time, date } = dosTime(e.mtime ?? Date.now());

    // Local file header
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); // signature
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // general purpose bit flag — UTF-8 names
    local.writeUInt16LE(0, 8); // method = store
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); // compressed size
    local.writeUInt32LE(size, 22); // uncompressed size
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length
    localChunks.push(local, nameBuf, e.data);

    // Central directory entry
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(0x031e, 4); // version made by — Unix
    central.writeUInt16LE(20, 6); // version needed
    central.writeUInt16LE(0x0800, 8); // gpbf — UTF-8
    central.writeUInt16LE(0, 10); // method
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(date, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32); // comment length
    central.writeUInt16LE(0, 34); // disk start
    central.writeUInt16LE(0, 36); // internal attrs
    central.writeUInt32LE(0o100644 << 16, 38); // external attrs (regular file 0644)
    central.writeUInt32LE(offset, 42);
    centralChunks.push(central, nameBuf);

    offset += local.length + nameBuf.length + e.data.length;
  }

  const localBlock = Buffer.concat(localChunks);
  const centralBlock = Buffer.concat(centralChunks);

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // disk with central
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBlock.length, 12);
  eocd.writeUInt32LE(localBlock.length, 16); // central dir offset
  eocd.writeUInt16LE(0, 20); // comment length

  return Buffer.concat([localBlock, centralBlock, eocd]);
}

/**
 * Разбирает PEM-блоб (cert + chain + private key, как храним в БД) на
 * fullchain (всё, что не PRIVATE KEY) и privkey (только PRIVATE KEY).
 */
export function splitPem(pem: string): { fullchain: string; privkey: string } {
  const blocks = pem.match(/-----BEGIN [^-]+-----[\s\S]*?-----END [^-]+-----/g) ?? [];
  const certs: string[] = [];
  const keys: string[] = [];
  for (const b of blocks) {
    if (/PRIVATE KEY/.test(b)) keys.push(b);
    else certs.push(b);
  }
  return {
    fullchain: certs.join('\n') + (certs.length ? '\n' : ''),
    privkey: keys.join('\n') + (keys.length ? '\n' : ''),
  };
}

/** «Слаг» для имени файла/папки в архиве (без пробелов и слэшей). */
export function safeName(input: string): string {
  return input.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/^_+|_+$/g, '') || 'cert';
}

/** Стабильный fingerprint строки — для уникализации при коллизии safeName. */
export function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 8);
}
