import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  APP_URL: z.string().url().default('http://localhost:5173'),
  /** Comma-separated list of allowed browser origins (explicit CORS allow-list). */
  CLIENT_ORIGINS: z.string().default('http://localhost:5173'),
  TRUST_PROXY: z.coerce.number().int().min(0).default(0),

  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/opspilot'),
  /** Set false only for MongoDB-compatible servers lacking TTL indexes (e.g. FerretDB). */
  MONGO_TTL_INDEXES: bool.default('true'),
  REDIS_URL: z.string().min(1).default('redis://127.0.0.1:6379'),

  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().min(30).default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().min(1).default(14),
  COOKIE_SECURE: bool.optional(),
  COOKIE_SAMESITE: z.enum(['lax', 'strict', 'none']).default('lax'),
  COOKIE_DOMAIN: z.string().optional(),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(12),

  RATE_LIMIT_ENABLED: bool.default('true'),
  AUTH_RATE_LIMIT_PER_15MIN: z.coerce.number().int().min(1).default(30),
  API_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(10).default(600),
  AI_RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(1).default(10),

  AI_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  AI_API_KEY: z.string().optional(),
  AI_MODEL: z.string().optional(),
  AI_BASE_URL: z.string().url().optional(),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).default(20000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),

  /** 1 = real time. 60 = one SLA "minute" lasts one second (development/testing only). */
  SLA_TIME_SCALE: z.coerce.number().positive().default(1),
  SLA_SCAN_INTERVAL_SECONDS: z.coerce.number().int().min(1).default(30),
  SLA_JOBS_ENABLED: bool.default('true'),

  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  UPLOAD_DIR: z.string().default('./uploads'),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().default('us-east-1'),
  S3_ENDPOINT: z.string().url().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_FORCE_PATH_STYLE: bool.default('false'),

  SMTP_URL: z.string().optional(),
  MAIL_FROM: z.string().default('OpsPilot AI <no-reply@opspilot.local>'),
});

export type Env = z.infer<typeof schema> & { cookieSecure: boolean; isProd: boolean; isTest: boolean };

export function parseEnv(source: NodeJS.ProcessEnv): Env {
  // `KEY=` in a .env file means "unset", not an empty string.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = schema.safeParse(cleaned);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${lines}\nSee .env.example`);
  }
  const e = parsed.data;
  const isProd = e.NODE_ENV === 'production';
  if (isProd && /change-?me|dev-only/i.test(e.JWT_ACCESS_SECRET)) {
    throw new Error('JWT_ACCESS_SECRET still contains a development placeholder. Generate a real secret for production.');
  }
  if (e.AI_PROVIDER !== 'mock' && !e.AI_API_KEY) {
    throw new Error(`AI_PROVIDER=${e.AI_PROVIDER} requires AI_API_KEY (or set AI_PROVIDER=mock).`);
  }
  if (e.STORAGE_DRIVER === 's3' && (!e.S3_BUCKET || !e.S3_ACCESS_KEY_ID || !e.S3_SECRET_ACCESS_KEY)) {
    throw new Error('STORAGE_DRIVER=s3 requires S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.');
  }
  if (e.COOKIE_SAMESITE === 'none' && !(e.COOKIE_SECURE ?? isProd)) {
    throw new Error('COOKIE_SAMESITE=none requires secure cookies (COOKIE_SECURE=true).');
  }
  return { ...e, isProd, isTest: e.NODE_ENV === 'test', cookieSecure: e.COOKIE_SECURE ?? isProd };
}

export const env: Env = parseEnv(process.env);
