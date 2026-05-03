import { describe, expect, it } from 'vitest';
import { certCovers, sanMatches } from '../src/common/san-match';

describe('sanMatches', () => {
  it('matches exact domains case-insensitively', () => {
    expect(sanMatches('Example.com', 'example.com')).toBe(true);
  });

  it('matches one-level wildcards', () => {
    expect(sanMatches('*.example.com', 'app.example.com')).toBe(true);
  });

  it('does not match wildcards across multiple levels (RFC 6125)', () => {
    expect(sanMatches('*.example.com', 'a.b.example.com')).toBe(false);
  });

  it('treats two wildcards as equal only when identical', () => {
    expect(sanMatches('*.example.com', '*.example.com')).toBe(true);
    expect(sanMatches('*.example.com', '*.foo.com')).toBe(false);
  });

  it('rejects empty inputs', () => {
    expect(sanMatches('', 'example.com')).toBe(false);
    expect(sanMatches('*.example.com', '')).toBe(false);
  });
});

describe('certCovers', () => {
  it('matches via CN', () => {
    expect(certCovers({ commonName: 'example.com', sans: [] }, 'example.com')).toBe(true);
  });

  it('matches via any SAN', () => {
    expect(certCovers({ commonName: 'foo.com', sans: ['*.example.com'] }, 'web.example.com')).toBe(
      true,
    );
  });

  it('returns false when neither CN nor any SAN matches', () => {
    expect(certCovers({ commonName: 'foo.com', sans: ['bar.com', 'baz.com'] }, 'example.com')).toBe(
      false,
    );
  });
});
