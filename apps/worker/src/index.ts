/**
 * RailGrid Worker — Phase 6 & 7
 *
 * Registers BullMQ workers and schedulers:
 *   - expire-holds       (every 30s)
 *   - reconcile-payments (every 2min)
 *   - outbox-publisher   (every 1s)
 *   - send-email         (consumer)
 *   - generate-ticket    (consumer)
 *
 * Graceful shutdown: drains all workers on SIGTERM/SIGINT.
 */
import './load-env.js';
import pino from 'pino';
import { Queue, Worker } from 'bullmq';
import { parseEnv } from '@railgrid/shared';
import { createQueueRedis, createCacheRedis } from './queue.js';
import {
  EXPIRE_HOLDS_QUEUE,
  expireHoldsProcessor,
} from './jobs/expire-holds.js';
import { RECONCILE_PAYMENTS_QUEUE, reconcilePaymentsProcessor } from './jobs/reconcile-payments.js';
import {
  OUTBOX_PUBLISHER_QUEUE,
  outboxPublisherProcessor,
  SEND_EMAIL_QUEUE,
  GENERATE_TICKET_QUEUE,
} from './jobs/outbox-publisher.js';
import { sendEmailProcessor } from './jobs/send-email.js';
import { generateTicketProcessor } from './jobs/generate-ticket.js';
import { PROCESS_REFUND_QUEUE, processRefundProcessor } from './jobs/process-refund.js';

const env = parseEnv(process.env);

const logger = pino({ level: env.LOG_LEVEL });

logger.info('RailGrid Worker starting (Phase 6)...');

// — Redis connections
const queueRedis = createQueueRedis();
const cacheRedis = createCacheRedis();

// — Queues (for adding repeatable jobs)
const expireHoldsQueue = new Queue(EXPIRE_HOLDS_QUEUE, { connection: createQueueRedis() });
const reconcileQueue = new Queue(RECONCILE_PAYMENTS_QUEUE, { connection: createQueueRedis() });
const outboxQueue = new Queue(OUTBOX_PUBLISHER_QUEUE, { connection: createQueueRedis() });
const sendEmailQueue = new Queue(SEND_EMAIL_QUEUE, { connection: createQueueRedis() });
const generateTicketQueue = new Queue(GENERATE_TICKET_QUEUE, { connection: createQueueRedis() });

// — Register repeatable jobs
await expireHoldsQueue.add(
  'sweep',
  {},
  { repeat: { every: 30_000 }, jobId: 'expire-holds-sweep' },
);
await reconcileQueue.add(
  'run',
  {},
  { repeat: { every: 120_000 }, jobId: 'reconcile-payments-run' },
);
await outboxQueue.add(
  'poll',
  {},
  { repeat: { every: 1_000 }, jobId: 'outbox-publisher-poll' },
);

// — Workers
const expireHoldsWorker = new Worker(
  EXPIRE_HOLDS_QUEUE,
  async (job) => {
    const result = await expireHoldsProcessor(job);
    if (typeof result === 'object' && result !== null && 'expiredAllocations' in result && (result as { expiredAllocations: number }).expiredAllocations > 0) {
      logger.info(result, 'expire-holds: expired');
    }
    return result;
  },
  { connection: createQueueRedis(), concurrency: 1 },
);

const reconcileWorker = new Worker(
  RECONCILE_PAYMENTS_QUEUE,
  reconcilePaymentsProcessor(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, logger),
  { connection: createQueueRedis(), concurrency: 1 },
);

const outboxWorker = new Worker(
  OUTBOX_PUBLISHER_QUEUE,
  outboxPublisherProcessor(sendEmailQueue, generateTicketQueue, logger),
  { connection: createQueueRedis(), concurrency: 1 },
);

const sendEmailWorker = new Worker(
  SEND_EMAIL_QUEUE,
  sendEmailProcessor(env.RESEND_API_KEY, env.RESEND_FROM, logger),
  { connection: createQueueRedis(), concurrency: 5 },
);

const generateTicketWorker = new Worker(
  GENERATE_TICKET_QUEUE,
  generateTicketProcessor(env.JWT_ACCESS_SECRET, logger),
  { connection: createQueueRedis(), concurrency: 3 },
);

const processRefundWorker = new Worker(
  PROCESS_REFUND_QUEUE,
  processRefundProcessor(env.RAZORPAY_KEY_ID, env.RAZORPAY_KEY_SECRET, logger),
  { connection: createQueueRedis(), concurrency: 3 },
);

const allWorkers: Worker[] = [
  expireHoldsWorker,
  reconcileWorker,
  outboxWorker,
  sendEmailWorker,
  generateTicketWorker,
  processRefundWorker,
];
const allQueues: Queue[] = [
  expireHoldsQueue,
  reconcileQueue,
  outboxQueue,
  sendEmailQueue,
  generateTicketQueue,
];

// — Log worker events
for (const worker of allWorkers) {
  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, queue: worker.name, err }, 'Worker job failed');
  });
  worker.on('error', (err) => {
    logger.error({ queue: worker.name, err }, 'Worker connection error');
  });
}

// — Graceful shutdown
const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, draining workers...`);
  await Promise.all(allWorkers.map((w) => w.close()));
  await Promise.all(allQueues.map((q) => q.close()));
  queueRedis.disconnect();
  cacheRedis.disconnect();
  logger.info('Worker shutdown complete');
  process.exit(0);
};

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

logger.info(
  {
    workers: allWorkers.map((w) => w.name),
    repeatableJobs: ['expire-holds/30s', 'reconcile-payments/2min', 'outbox-publisher/1s'],
  },
  'Worker ready — all jobs registered',
);
