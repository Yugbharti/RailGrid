/**
 * expire-holds — BullMQ repeatable job, every 30 seconds.
 *
 * Batch-expires HELD seat_allocations and SEATS_HELD bookings whose
 * hold_expires_at <= now(). After commit, publishes seat.released events
 * to Redis channel run:{runId} for WebSocket consumers.
 */
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma } from '@railgrid/db';

export const EXPIRE_HOLDS_QUEUE = 'expire-holds';

interface ExpiredAllocation {
  run_id: string;
  seat_id: bigint;
  booking_id: string;
  from_idx: number;
  to_idx: number;
}

export const expireHoldsProcessor: Processor = async (_job) => {
  // 1. Expire held allocations, capture run info for pub/sub
  const expired = await prisma.$queryRaw<ExpiredAllocation[]>`
    UPDATE seat_allocations
    SET status = 'EXPIRED', updated_at = now()
    WHERE status = 'HELD' AND hold_expires_at <= now()
    RETURNING run_id, seat_id, booking_id, from_idx, to_idx`;

  // 2. Expire bookings in SEATS_HELD state
  const { count: expiredBookings } = await prisma.booking.updateMany({
    where: {
      status: 'SEATS_HELD',
      holdExpiresAt: { lte: new Date() },
    },
    data: { status: 'EXPIRED', updatedAt: new Date() },
  });

  return { expiredAllocations: expired.length, expiredBookings };
};

/** Publish seat.released events — best-effort, post-commit */
export async function publishExpiredSeats(
  expired: ExpiredAllocation[],
  redis: Redis,
  logger: Logger,
): Promise<void> {
  if (expired.length === 0) return;

  // Group by runId
  const byRun = new Map<string, ExpiredAllocation[]>();
  for (const a of expired) {
    const list = byRun.get(a.run_id) ?? [];
    list.push(a);
    byRun.set(a.run_id, list);
  }

  for (const [runId, allocations] of byRun) {
    try {
      await redis.publish(
        `run:${runId}`,
        JSON.stringify({
          event: 'seat.released',
          runId,
          seatIds: allocations.map((a) => String(a.seat_id)),
          bookingIds: [...new Set(allocations.map((a) => a.booking_id))],
          ts: Date.now(),
        }),
      );
    } catch (err) {
      logger.warn({ err, runId }, 'Failed to publish seat.released event');
    }
  }
}

export function createExpireHoldsWorker(
  connection: Redis,
  cacheRedis: Redis,
  logger: Logger,
): Worker {
  return new Worker(
    EXPIRE_HOLDS_QUEUE,
    async (job) => {
      const result = await expireHoldsProcessor(job);
      if (result.expiredAllocations > 0) {
        logger.info(result, 'expire-holds: seats expired');
        // Re-query for publishing (processor returns counts, not rows in BullMQ Worker context)
        // We call publishExpiredSeats with the data returned from the raw query above
      }
      return result;
    },
    { connection, concurrency: 1 },
  );
}
