import http from 'node:http';
import { createApp } from './app';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { createRedis } from './config/redis';
import { attachSockets } from './sockets';
import { initRealtime } from './services/realtime';

async function main() {
  await connectDb();

  const redis = createRedis('api');
  const pub = createRedis('socket-pub');
  const sub = pub.duplicate();
  initRealtime(createRedis('emitter'));

  const app = createApp({ redis });
  const server = http.createServer(app);
  const io = attachSockets(server, { pub, sub });

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV, ai: env.AI_PROVIDER, slaTimeScale: env.SLA_TIME_SCALE }, 'OpsPilot API listening');
    if (env.AI_PROVIDER === 'mock') logger.warn('AI_PROVIDER=mock: triage uses a keyword heuristic, NOT a real AI model');
    if (env.SLA_TIME_SCALE !== 1) logger.warn({ scale: env.SLA_TIME_SCALE }, 'SLA_TIME_SCALE != 1: SLA deadlines are compressed (development mode)');
  });

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    logger.info({ signal }, 'Shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    io.close();
    server.close();
    await Promise.allSettled([disconnectDb(), redis.quit(), pub.quit(), sub.quit()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start API');
  process.exit(1);
});
