import { describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env';

const good = { JWT_ACCESS_SECRET: 'x'.repeat(40) };

describe('environment validation', () => {
  it('treats blank values (KEY=) as unset', () => {
    const e = parseEnv({ ...good, AI_BASE_URL: '', S3_ENDPOINT: '', AI_API_KEY: '', AI_MODEL: '' } as any);
    expect(e.AI_BASE_URL).toBeUndefined();
    expect(e.AI_PROVIDER).toBe('mock');
  });
  it('requires a strong JWT secret and rejects placeholders in production', () => {
    expect(() => parseEnv({ JWT_ACCESS_SECRET: 'short' } as any)).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => parseEnv({ NODE_ENV: 'production', JWT_ACCESS_SECRET: 'dev-only-change-me-'.padEnd(40, 'x') } as any)).toThrow(/placeholder/);
  });
  it('requires credentials for real AI providers and S3', () => {
    expect(() => parseEnv({ ...good, AI_PROVIDER: 'anthropic' } as any)).toThrow(/AI_API_KEY/);
    expect(parseEnv({ ...good, AI_PROVIDER: 'anthropic', AI_API_KEY: 'k' } as any).AI_PROVIDER).toBe('anthropic');
    expect(() => parseEnv({ ...good, STORAGE_DRIVER: 's3' } as any)).toThrow(/S3_BUCKET/);
  });
  it('defaults cookies to secure in production and forbids insecure SameSite=None', () => {
    expect(parseEnv({ ...good, NODE_ENV: 'production' } as any).cookieSecure).toBe(true);
    expect(parseEnv({ ...good } as any).cookieSecure).toBe(false);
    expect(() => parseEnv({ ...good, COOKIE_SAMESITE: 'none' } as any)).toThrow(/secure/);
  });
});
