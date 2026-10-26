import { Queue, Worker, type ConnectionOptions } from 'bullmq';
import { env } from '../config/env';
import { logger } from '../config/logger';
import { scanSlas } from '../services/sla';

export const SLA_QUEUE = 'sla';
const SCHEDULER_ID = 'sla-scan';

/**
 * Registers the repeatable scan (idempotent: same scheduler id => one schedule no matter how many
 * workers start) and returns a worker that processes it. A failed scan is retried with backoff;
 * scanning itself is idempotent (see services/sla.ts) so retries and overlapping runs cannot double-alert.
 */
export async function startSlaWorker(connection: ConnectionOptions) {
  const queue = new Queue(SLA_QUEUE, { connection });
  await queue.upsertJobScheduler(
    SCHEDULER_ID,
    { every: env.SLA_SCAN_INTERVAL_SECONDS * 1000 },
    {
      name: 'scan',
      data: {},
      opts: { attempts: 3, backoff: { type: 'exponential', delay: 2000 }, removeOnComplete: 50, removeOnFail: 200 },
    },
  );

  const worker = new Worker(
    SLA_QUEUE,
    async () => {
      const result = await scanSlas();
      if (result.alertsRaised) logger.info(result, 'SLA scan raised alerts');
      else logger.debug(result, 'SLA scan complete');
      return result;
    },
    { connection, concurrency: 1 },
  );
  worker.on('failed', (job, err) => logger.error({ err, jobId: job?.id, attempts: job?.attemptsMade }, 'SLA job failed'));
  worker.on('error', (err) => logger.error({ err }, 'SLA worker error'));

  return {
    queue,
    worker,
    async close() {
      await worker.close();
      await queue.close();
    },
  };
}
