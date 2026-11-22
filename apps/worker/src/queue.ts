/**
 * IORedis connections for BullMQ worker.
 * Uses QUEUE_REDIS_URL (noeviction policy) — separate from cache Redis.
 */
import { Redis } from 'ioredis';
import { parseEnv } from '@railgrid/shared';

const env = parseEnv(process.env);

/** Queue Redis — noeviction, BullMQ jobs */
export function createQueueRedis(): Redis {
  return new Redis(env.QUEUE_REDIS_URL, {
    maxRetriesPerRequest: null, // required by BullMQ
    enableReadyCheck: false,
  });
}

/** Cache Redis — LRU, pub/sub for seat updates */
export function createCacheRedis(): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
