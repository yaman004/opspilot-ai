import { utimesSync, writeFileSync } from 'node:fs';
import { connectDb, disconnectDb } from './config/db';
import { env } from './config/env';
import { logger } from './config/logger';
import { createRedis } from './config/redis';
import { startSlaWorker } from './jobs/sla.queue';
import { initRealtime } from './services/realtime';

async function main() {
  if (!env.SLA_JOBS_ENABLED) {
    logger.warn('SLA_JOBS_ENABLED=false — worker has nothing to do, exiting');
    return;
  }
  await connectDb();
  const connection = createRedis('worker');
  // The worker has no socket server; it publishes through Redis so the API process can fan events out.
  initRealtime(createRedis('worker-emitter'));
  const sla = await startSlaWorker(connection);
  logger.info({ everySeconds: env.SLA_SCAN_INTERVAL_SECONDS, timeScale: env.SLA_TIME_SCALE }, 'SLA worker started');

  // Liveness marker for container health checks (the worker serves no HTTP). Refreshed only while its event loop runs.
  const heartbeatFile = process.env.WORKER_HEARTBEAT_FILE ?? '/tmp/opspilot-worker.alive';
  const beat = () => {
    try {
      const now = new Date();
      try {
        utimesSync(heartbeatFile, now, now);
      } catch {
        writeFileSync(heartbeatFile, String(process.pid));
      }
    } catch (err) {
      logger.warn({ err }, 'Could not write worker heartbeat');
    }
  };
  beat();
  setInterval(beat, 15_000).unref();

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Worker shutting down');
    const force = setTimeout(() => process.exit(1), 10_000);
    force.unref();
    await sla.close();
    await Promise.allSettled([connection.quit(), disconnectDb()]);
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start worker');
  process.exit(1);
});
