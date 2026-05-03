import { describe, expect, it } from 'vitest';
import { LoginRequestSchema, LoginResponseSchema } from '../src/index';

describe('LoginRequestSchema', () => {
  it('accepts a valid email/password pair', () => {
    const parsed = LoginRequestSchema.parse({
      email: 'admin@haflux.local',
      password: 'correct horse battery staple',
    });
    expect(parsed.email).toBe('admin@haflux.local');
  });

  it('rejects passwords shorter than 8 chars', () => {
    const result = LoginRequestSchema.safeParse({
      email: 'admin@haflux.local',
      password: 'short',
    });
    expect(result.success).toBe(false);
  });

  it('rejects malformed totp', () => {
    const result = LoginRequestSchema.safeParse({
      email: 'admin@haflux.local',
      password: 'correct horse battery staple',
      totp: 'ABC',
    });
    expect(result.success).toBe(false);
  });
});

describe('LoginResponseSchema', () => {
  it('round-trips a well-formed response', () => {
    const payload = {
      accessToken: 'a',
      refreshToken: 'r',
      expiresIn: 3600,
      user: { id: 'u1', email: 'admin@haflux.local', displayName: null },
    };
    expect(LoginResponseSchema.parse(payload)).toEqual(payload);
  });
});
