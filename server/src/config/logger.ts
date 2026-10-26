import { createRequire } from 'node:module';
import { pino } from 'pino';
import { env } from './env';

/** pino-pretty is a dev-only dependency; production images don't ship it, so fall back to JSON logs. */
function hasPretty(): boolean {
  try {
    createRequire(import.meta.url).resolve('pino-pretty');
    return true;
  } catch {
    return false;
  }
}

export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      '*.password',
      '*.newPassword',
      '*.currentPassword',
      '*.token',
      '*.accessToken',
      '*.apiKey',
    ],
    censor: '[redacted]',
  },
  ...(env.isProd || env.isTest || !hasPretty()
    ? {}
    : { transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:HH:MM:ss' } } }),
});
