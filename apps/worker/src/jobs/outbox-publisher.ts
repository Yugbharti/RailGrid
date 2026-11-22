/**
 * outbox-publisher — BullMQ repeatable job, every 1 second.
 *
 * Polls outbox_events for unpublished rows using SELECT ... FOR UPDATE SKIP LOCKED,
 * enqueues each into the appropriate downstream BullMQ queue, then marks published_at.
 * Idempotent: if enqueue succeeds but update fails, the job will be re-attempted
 * without side-effects (downstream workers are keyed by eventId).
 */
import { Worker, Queue, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma } from '@railgrid/db';

export const OUTBOX_PUBLISHER_QUEUE = 'outbox-publisher';
export const SEND_EMAIL_QUEUE = 'send-email';
export const GENERATE_TICKET_QUEUE = 'generate-ticket';

interface OutboxRow {
  id: string;
  type: string;
  aggregate_id: string;
  payload: unknown;
}

/** Map outbox event type → downstream queue name */
function resolveQueue(eventType: string): string | null {
  if (
    [
      'booking.confirmed',
      'booking.cancelled',
      'booking.held',
      'booking.refund_due',
      'auth.email_verification',
      'auth.password_reset',
      'auth.lockout',
    ].includes(eventType)
  ) {
    return SEND_EMAIL_QUEUE;
  }
  if (eventType === 'booking.confirmed') {
    return GENERATE_TICKET_QUEUE;
  }
  return null;
}

export const outboxPublisherProcessor =
  (sendEmailQueue: Queue, generateTicketQueue: Queue, logger: Logger): Processor =>
  async (_job) => {
    const rows = await prisma.$queryRaw<OutboxRow[]>`
      SELECT id, type, aggregate_id, payload
      FROM outbox_events
      WHERE published_at IS NULL
      ORDER BY id
      LIMIT 100
      FOR UPDATE SKIP LOCKED`;

    if (rows.length === 0) return { published: 0 };

    let published = 0;
    const publishedIds: string[] = [];

    for (const row of rows) {
      try {
        // Enqueue to appropriate downstream queue
        const jobData = { eventId: row.id, type: row.type, aggregateId: row.aggregate_id, payload: row.payload };

        if (row.type === 'booking.confirmed') {
          // Both email and ticket
          await sendEmailQueue.add(row.type, jobData, {
            jobId: `email:${row.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          });
          await generateTicketQueue.add(row.type, jobData, {
            jobId: `ticket:${row.id}`,
            attempts: 3,
            backoff: { type: 'exponential', delay: 2000 },
          });
        } else {
          const queueName = resolveQueue(row.type);
          if (queueName === SEND_EMAIL_QUEUE) {
            await sendEmailQueue.add(row.type, jobData, {
              jobId: `email:${row.id}`,
              attempts: 3,
              backoff: { type: 'exponential', delay: 2000 },
            });
          } else {
            logger.debug({ eventType: row.type }, 'outbox-publisher: no queue mapped');
          }
        }

        publishedIds.push(row.id);
        published++;
      } catch (err) {
        logger.error({ err, eventId: row.id }, 'outbox-publisher: failed to enqueue event');
      }
    }

    // Mark published in a single update
    if (publishedIds.length > 0) {
      await prisma.$executeRaw`
        UPDATE outbox_events SET published_at = now()
        WHERE id = ANY(${publishedIds}::uuid[])`;
    }

    return { published };
  };

export function createOutboxPublisherWorker(
  connection: Redis,
  logger: Logger,
): { worker: Worker; sendEmailQueue: Queue; generateTicketQueue: Queue } {
  const sendEmailQueue = new Queue(SEND_EMAIL_QUEUE, { connection });
  const generateTicketQueue = new Queue(GENERATE_TICKET_QUEUE, { connection });

  const worker = new Worker(
    OUTBOX_PUBLISHER_QUEUE,
    outboxPublisherProcessor(sendEmailQueue, generateTicketQueue, logger),
    { connection, concurrency: 1 },
  );

  return { worker, sendEmailQueue, generateTicketQueue };
}
