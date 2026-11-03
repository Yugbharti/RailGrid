import { randomUUID } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { LiveStatus } from '@railgrid/shared';
import { liveStatusSchema } from '@railgrid/shared';
import { addTrainDataLatency, incrementTrainDataMetric, updateTrainDataMetrics } from './metrics.js';
import { ProviderError, type TrainDataProvider } from './provider.js';

const FRESH_FOR_MS = 60_000;
const CACHE_TTL_SECONDS = 24 * 60 * 60;
const LOCK_TTL_MS = 12_000;
const ROLLING_BUDGET_MS = 30 * 24 * 60 * 60 * 1_000;

type CachedStatus = { fetchedAt: number; value: LiveStatus };
type QuotaDecision = 'allowed' | 'cache-only' | 'minute-limit' | 'budget-exhausted';

export interface DataCache {
  get(key: string): Promise<CachedStatus | null>;
  set(key: string, value: CachedStatus, ttlSeconds: number): Promise<void>;
  lock(key: string, token: string): Promise<boolean>;
  unlock(key: string, token: string): Promise<void>;
  reserveQuota(monthlyLimit: number, minuteLimit: number, now: number): Promise<QuotaDecision>;
}

const RESERVE_QUOTA_LUA = `
local monthlyKey = KEYS[1]
local minuteKey = KEYS[2]
local now = tonumber(ARGV[1])
local monthLimit = tonumber(ARGV[2])
local minuteLimit = tonumber(ARGV[3])
local rollingMs = 2592000000
redis.call('ZREMRANGEBYSCORE', monthlyKey, 0, now - rollingMs)
redis.call('ZREMRANGEBYSCORE', minuteKey, 0, now - 60000)
local monthly = redis.call('ZCARD', monthlyKey)
local minute = redis.call('ZCARD', minuteKey)
if monthly >= monthLimit then return 'budget-exhausted' end
if monthly >= math.ceil(monthLimit * 0.8) then return 'cache-only' end
if minute >= minuteLimit then return 'minute-limit' end
local id = ARGV[4]
redis.call('ZADD', monthlyKey, now, id)
redis.call('ZADD', minuteKey, now, id)
redis.call('PEXPIRE', monthlyKey, rollingMs + 60000)
redis.call('PEXPIRE', minuteKey, 60000)
return 'allowed'
`;
const UNLOCK_LUA = `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`;

export class RedisDataCache implements DataCache {
  constructor(private readonly redis: Redis) {}

  async get(key: string): Promise<CachedStatus | null> {
    const result = await this.redis.get(key);
    if (!result) return null;
    try {
      const parsed = JSON.parse(result) as unknown;
      if (!parsed || typeof parsed !== 'object' || !('fetchedAt' in parsed) || !('value' in parsed)) return null;
      const entry = parsed as CachedStatus;
      return { fetchedAt: Number(entry.fetchedAt), value: liveStatusSchema.parse(entry.value) };
    } catch {
      await this.redis.del(key);
      return null;
    }
  }

  async set(key: string, value: CachedStatus, ttlSeconds: number): Promise<void> {
    await this.redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  }

  async lock(key: string, token: string): Promise<boolean> {
    return (await this.redis.set(key, token, 'PX', LOCK_TTL_MS, 'NX')) === 'OK';
  }

  async unlock(key: string, token: string): Promise<void> {
    await this.redis.eval(UNLOCK_LUA, 1, key, token);
  }

  async reserveQuota(monthlyLimit: number, minuteLimit: number, now: number): Promise<QuotaDecision> {
    return (await this.redis.eval(
      RESERVE_QUOTA_LUA,
      2,
      'railgrid:provider:railradar:budget:rolling-30d',
      'railgrid:provider:railradar:budget:minute',
      String(now),
      String(monthlyLimit),
      String(minuteLimit),
      randomUUID(),
    )) as QuotaDecision;
  }
}

export class MemoryDataCache implements DataCache {
  private readonly values = new Map<string, { value: CachedStatus; expiresAt: number }>();
  private readonly locks = new Map<string, { token: string; expiresAt: number }>();
  private readonly monthlyEvents: number[] = [];
  private readonly minuteEvents: number[] = [];

  async get(key: string): Promise<CachedStatus | null> {
    const entry = this.values.get(key);
    if (!entry || entry.expiresAt <= Date.now()) {
      this.values.delete(key);
      return null;
    }
    return entry.value;
  }

  async set(key: string, value: CachedStatus, ttlSeconds: number): Promise<void> {
    this.values.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  async lock(key: string, token: string): Promise<boolean> {
    const lock = this.locks.get(key);
    if (lock && lock.expiresAt > Date.now()) return false;
    this.locks.set(key, { token, expiresAt: Date.now() + LOCK_TTL_MS });
    return true;
  }

  async unlock(key: string, token: string): Promise<void> {
    if (this.locks.get(key)?.token === token) this.locks.delete(key);
  }

  async reserveQuota(monthlyLimit: number, minuteLimit: number, now: number): Promise<QuotaDecision> {
    while (this.monthlyEvents[0] !== undefined && this.monthlyEvents[0] <= now - ROLLING_BUDGET_MS) this.monthlyEvents.shift();
    while (this.minuteEvents[0] !== undefined && this.minuteEvents[0] <= now - 60_000) this.minuteEvents.shift();
    if (this.monthlyEvents.length >= monthlyLimit) return 'budget-exhausted';
    if (this.monthlyEvents.length >= Math.ceil(monthlyLimit * 0.8)) return 'cache-only';
    if (this.minuteEvents.length >= minuteLimit) return 'minute-limit';
    this.monthlyEvents.push(now);
    this.minuteEvents.push(now);
    return 'allowed';
  }
}

export class CircuitBreaker {
  private failures = 0;
  private openedAt = 0;
  private halfOpenInFlight = false;

  constructor(
    private readonly failureThreshold = 5,
    private readonly openForMs = 30_000,
    private readonly now: () => number = Date.now,
  ) {}

  async execute<T>(work: () => Promise<T>): Promise<T> {
    const timestamp = this.now();
    if (this.openedAt && timestamp - this.openedAt < this.openForMs) {
      updateTrainDataMetrics({ circuitOpen: true });
      throw new ProviderError('Train data circuit is open');
    }
    if (this.openedAt && this.halfOpenInFlight) throw new ProviderError('Train data circuit probe is in progress');
    if (this.openedAt) this.halfOpenInFlight = true;
    try {
      const result = await work();
      this.failures = 0;
      this.openedAt = 0;
      updateTrainDataMetrics({ circuitOpen: false });
      return result;
    } catch (error) {
      this.failures += 1;
      if (this.failures >= this.failureThreshold) {
        this.openedAt = this.now();
        updateTrainDataMetrics({ circuitOpen: true });
      }
      throw error;
    } finally {
      this.halfOpenInFlight = false;
    }
  }
}

export class TrainDataUnavailable extends Error {
  constructor(message = 'Live train data is temporarily unavailable') {
    super(message);
    this.name = 'TrainDataUnavailable';
  }
}

export class TrainDataService {
  private readonly breaker = new CircuitBreaker();

  constructor(
    private readonly provider: TrainDataProvider,
    private readonly cache: DataCache,
    private readonly monthlyBudget: number,
    private readonly minuteLimit: number,
    private readonly logger: { warn: (data: unknown, message: string) => void },
  ) {}

  async getLiveStatus(trainNumber: string, date?: string): Promise<LiveStatus> {
    const key = `railgrid:train-data:${this.provider.name}:live:${trainNumber}:${date ?? 'active'}`;
    const lockKey = `${key}:refresh-lock`;
    let cached: CachedStatus | null = null;
    try {
      cached = await this.cache.get(key);
    } catch (error) {
      this.logger.warn({ err: error }, 'Train-data cache unavailable');
      if (this.provider.name !== 'fixture') throw new TrainDataUnavailable();
    }

    const now = Date.now();
    if (cached && now - cached.fetchedAt < FRESH_FOR_MS) {
      incrementTrainDataMetric('cacheHits');
      return { ...cached.value, stale: false };
    }
    if (cached) {
      const token = randomUUID();
      try {
        if (await this.cache.lock(lockKey, token)) {
          void this.refresh(key, lockKey, token, trainNumber, date).catch((error: unknown) =>
            this.logger.warn({ err: error }, 'Background live-status refresh failed'),
          );
        }
      } catch (error) {
        this.logger.warn({ err: error }, 'Could not acquire train-data refresh lock');
      }
      incrementTrainDataMetric('staleResponses');
      return { ...cached.value, stale: true };
    }

    const token = randomUUID();
    try {
      if (await this.cache.lock(lockKey, token)) {
        await this.refresh(key, lockKey, token, trainNumber, date);
        const refreshed = await this.cache.get(key);
        if (refreshed) return { ...refreshed.value, stale: false };
      }
    } catch (error) {
      this.logger.warn({ err: error }, 'Live-status fetch failed');
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      try {
        const refreshed = await this.cache.get(key);
        if (refreshed) return { ...refreshed.value, stale: Date.now() - refreshed.fetchedAt >= FRESH_FOR_MS };
      } catch {
        break;
      }
    }
    throw new TrainDataUnavailable();
  }

  private async refresh(
    cacheKey: string,
    lockKey: string,
    token: string,
    trainNumber: string,
    date?: string,
  ): Promise<void> {
    try {
      const value = await this.breaker.execute(() => this.fetchWithRetries(trainNumber, date));
      await this.cache.set(cacheKey, { fetchedAt: Date.now(), value }, CACHE_TTL_SECONDS);
    } finally {
      await this.cache.unlock(lockKey, token).catch((error: unknown) =>
        this.logger.warn({ err: error }, 'Could not release train-data refresh lock'),
      );
    }
  }

  private async fetchWithRetries(trainNumber: string, date?: string): Promise<LiveStatus> {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const quota = await this.cache.reserveQuota(this.monthlyBudget, this.minuteLimit, Date.now());
      if (quota !== 'allowed') {
        incrementTrainDataMetric('quotaBlocked');
        throw new ProviderError(`Train-data provider quota guard: ${quota}`);
      }
      const startedAt = Date.now();
      incrementTrainDataMetric('requests');
      try {
        const result = await this.provider.getLiveStatus(trainNumber, date);
        addTrainDataLatency(Date.now() - startedAt);
        return result;
      } catch (error) {
        addTrainDataLatency(Date.now() - startedAt);
        incrementTrainDataMetric('failures');
        lastError = error;
        if (!(error instanceof ProviderError) || (error.statusCode && error.statusCode < 500 && error.statusCode !== 429)) {
          break;
        }
        if (attempt < 2) {
          const delay = error instanceof ProviderError && error.retryAfterMs !== undefined
            ? Math.min(error.retryAfterMs, 2_000)
            : 150 * 2 ** attempt + Math.random() * 100;
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }
}
