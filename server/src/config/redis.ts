import { Redis } from 'ioredis';
import { env } from './env';
import { logger } from './logger';

/** BullMQ requires maxRetriesPerRequest = null on its connections. */
export function createRedis(name = 'redis'): Redis {
  const client = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: true, lazyConnect: false });
  client.on('error', (err) => logger.error({ err: err.message, name }, 'Redis error'));
  return client;
}
