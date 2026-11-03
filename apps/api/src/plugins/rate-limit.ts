import { createHash, randomUUID } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { Redis } from 'ioredis';
import { ERROR_CODES } from '@railgrid/shared';

export interface SlidingWindowResult {
  allowed: boolean;
  activeCount: number;
  remaining: number;
  retryAfterMs: number;
}

export function evaluateSlidingWindow(
  timestamps: number[],
  now: number,
  windowMs: number,
  limit: number,
): SlidingWindowResult {
  const active = timestamps.filter((timestamp) => timestamp > now - windowMs).sort((a, b) => a - b);
  if (active.length >= limit) {
    return {
      allowed: false,
      activeCount: active.length,
      remaining: 0,
      retryAfterMs: Math.max(1, active[0]! + windowMs - now),
    };
  }
  return {
    allowed: true,
    activeCount: active.length + 1,
    remaining: limit - active.length - 1,
    retryAfterMs: 0,
  };
}

const slidingWindowScript = `
local clock = redis.call('TIME')
local now = tonumber(clock[1]) * 1000 + math.floor(tonumber(clock[2]) / 1000)
local window = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
local count = redis.call('ZCARD', KEYS[1])
if count >= limit then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local retry_ms = tonumber(oldest[2]) + window - now
  return {0, count, retry_ms}
end
redis.call('ZADD', KEYS[1], now, ARGV[3])
redis.call('PEXPIRE', KEYS[1], window)
return {1, count + 1, 0}
`;

export interface RateLimitPolicy {
  name: string;
  key: (request: FastifyRequest) => string | null;
  limit: number;
  windowMs: number;
}

interface EvaluatedPolicy extends SlidingWindowResult {
  limit: number;
  windowMs: number;
}

const fallbackWindows = new Map<string, number[]>();
const MAX_FALLBACK_KEYS = 10_000;
let lastRedisWarningAt = 0;
let redisUnavailableUntil = 0;

function identifier(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function fallbackDecision(key: string, policy: RateLimitPolicy, now: number): SlidingWindowResult {
  if (!fallbackWindows.has(key) && fallbackWindows.size >= MAX_FALLBACK_KEYS) {
    for (const [candidate, events] of fallbackWindows) {
      if (events.every((timestamp) => timestamp <= now - 60 * 60 * 1000)) {
        fallbackWindows.delete(candidate);
      }
    }
    if (fallbackWindows.size >= MAX_FALLBACK_KEYS) {
      return {
        allowed: false,
        activeCount: Math.max(1, Math.min(3, policy.limit)),
        remaining: 0,
        retryAfterMs: policy.windowMs,
      };
    }
  }
  const timestamps = (fallbackWindows.get(key) ?? []).filter(
    (timestamp) => timestamp > now - policy.windowMs,
  );
  const stricterLimit = Math.max(1, Math.min(3, policy.limit));
  const result = evaluateSlidingWindow(timestamps, now, policy.windowMs, stricterLimit);
  if (result.allowed) timestamps.push(now);
  fallbackWindows.set(key, timestamps);
  return result;
}

async function redisDecision(
  redis: Redis,
  key: string,
  policy: RateLimitPolicy,
): Promise<SlidingWindowResult> {
  if (Date.now() < redisUnavailableUntil)
    throw new Error('Redis rate limiter is in fallback cooldown');
  if (redis.status === 'wait' || redis.status === 'end') await redis.connect();
  const [allowed, activeCount, retryAfterMs] = (await redis.eval(
    slidingWindowScript,
    1,
    key,
    policy.windowMs,
    policy.limit,
    randomUUID(),
  )) as [number, number, number];
  return {
    allowed: Number(allowed) === 1,
    activeCount: Number(activeCount),
    remaining: Math.max(0, policy.limit - Number(activeCount)),
    retryAfterMs: Number(retryAfterMs),
  };
}

async function evaluatePolicy(
  redis: Redis,
  policy: RateLimitPolicy,
  request: FastifyRequest,
): Promise<EvaluatedPolicy | null> {
  const rawKey = policy.key(request);
  if (!rawKey) return null;
  const key = `railgrid:rl:${policy.name}:${identifier(rawKey)}`;
  try {
    const result = await redisDecision(redis, key, policy);
    return { ...result, limit: policy.limit, windowMs: policy.windowMs };
  } catch (error) {
    const now = Date.now();
    redisUnavailableUntil = now + 1_000;
    if (now - lastRedisWarningAt > 30_000) {
      request.log.warn(
        { err: error },
        'Redis rate limiter unavailable; using stricter in-process limit',
      );
      lastRedisWarningAt = now;
    }
    const result = fallbackDecision(key, policy, now);
    return { ...result, limit: Math.max(1, Math.min(3, policy.limit)), windowMs: policy.windowMs };
  }
}

function sendLimited(reply: FastifyReply, policy: EvaluatedPolicy): void {
  const retryAfterSeconds = Math.max(1, Math.ceil(policy.retryAfterMs / 1000));
  reply
    .header('retry-after', String(retryAfterSeconds))
    .header('ratelimit-limit', String(policy.limit))
    .header('ratelimit-remaining', '0')
    .header('ratelimit-reset', String(retryAfterSeconds))
    .code(429)
    .send({
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message: 'Too many requests. Please try again later.',
        requestId: reply.request.id,
      },
    });
}

export function rateLimit(policies: RateLimitPolicy[]): preHandlerHookHandler {
  return async (request, reply) => {
    const evaluated: EvaluatedPolicy[] = [];
    for (const policy of policies) {
      const result = await evaluatePolicy(request.server.redis, policy, request);
      if (result) evaluated.push(result);
      if (result && !result.allowed) {
        sendLimited(reply, result);
        return;
      }
    }

    if (evaluated.length > 0) {
      const restrictive = evaluated.reduce((current, candidate) =>
        candidate.remaining / candidate.limit < current.remaining / current.limit
          ? candidate
          : current,
      );
      reply
        .header('ratelimit-limit', String(restrictive.limit))
        .header('ratelimit-remaining', String(restrictive.remaining))
        .header('ratelimit-reset', String(Math.ceil(restrictive.windowMs / 1000)));
    }
  };
}
