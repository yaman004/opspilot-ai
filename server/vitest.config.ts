import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Each file uses its own database; run files serially to keep a single small DB server happy.
    fileParallelism: false,
    env: {
      NODE_ENV: 'test',
      JWT_ACCESS_SECRET: 'test-secret-test-secret-test-secret-123456',
      MONGODB_URI: process.env.TEST_MONGODB_URI ?? 'mongodb://127.0.0.1:27017/opspilot_test',
      MONGO_TTL_INDEXES: process.env.TEST_MONGO_TTL ?? 'false',
      BCRYPT_ROUNDS: '4',
      RATE_LIMIT_ENABLED: 'false',
      AI_PROVIDER: 'mock',
      AI_TIMEOUT_MS: '2000',
      AI_MAX_RETRIES: '1',
      UPLOAD_DIR: './.data/test-uploads',
      CLIENT_ORIGINS: 'http://localhost:5173',
      SLA_TIME_SCALE: '1',
    },
  },
});
