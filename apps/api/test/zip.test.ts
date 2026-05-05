import { describe, expect, it } from 'vitest';
import { buildZip, safeName, splitPem } from '../src/certificates/zip';

describe('buildZip', () => {
  it('produces a valid ZIP signature and end-of-central-directory marker', () => {
    const zip = buildZip([
      { name: 'a.txt', data: Buffer.from('hello'), mtime: Date.UTC(2026, 0, 1) },
      { name: 'b.txt', data: Buffer.from('world\n'), mtime: Date.UTC(2026, 0, 1) },
    ]);
    // Local file header signature
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    // EOCD must end the buffer
    const eocdSig = zip.readUInt32LE(zip.length - 22);
    expect(eocdSig).toBe(0x06054b50);
    // Two entries reported by EOCD
    expect(zip.readUInt16LE(zip.length - 22 + 8)).toBe(2);
    expect(zip.readUInt16LE(zip.length - 22 + 10)).toBe(2);
  });

  it('does not throw on external attrs encoding (regression: 0o100644 << 16 overflowed Int32)', () => {
    expect(() =>
      buildZip([{ name: 'x', data: Buffer.from('y'), mtime: Date.now() }]),
    ).not.toThrow();
  });
});

describe('splitPem', () => {
  it('separates certificates from private keys', () => {
    const pem = [
      '-----BEGIN CERTIFICATE-----',
      'AAAA',
      '-----END CERTIFICATE-----',
      '-----BEGIN PRIVATE KEY-----',
      'BBBB',
      '-----END PRIVATE KEY-----',
    ].join('\n');
    const { fullchain, privkey } = splitPem(pem);
    expect(fullchain).toContain('CERTIFICATE');
    expect(fullchain).not.toContain('PRIVATE KEY');
    expect(privkey).toContain('PRIVATE KEY');
    expect(privkey).not.toContain('CERTIFICATE');
  });
});

describe('safeName', () => {
  it('strips path-unfriendly characters and falls back to "cert" on empty', () => {
    expect(safeName('*.example.com')).toBe('.example.com');
    expect(safeName('  /// ')).toBe('cert');
    expect(safeName('OK_value-1.0')).toBe('OK_value-1.0');
  });
});
