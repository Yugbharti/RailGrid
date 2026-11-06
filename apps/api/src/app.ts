import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { ZodTypeProvider, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import type { Env } from '@railgrid/shared';
import { Redis } from 'ioredis';
import { healthRoutes } from './routes/health.js';
import { metricsRoutes } from './routes/metrics.js';
import { authRoutes } from './routes/auth.js';
import { trainDataRoutes } from './routes/train-data.js';
import { bookingRoutes } from './routes/bookings.js';
import { errorHandler } from './plugins/error-handler.js';
import { requestId } from './plugins/request-id.js';
import { rateLimit } from './plugins/rate-limit.js';
import type { AccessClaims } from './auth/tokens.js';
import { FixtureProvider } from './train-data/fixture-provider.js';
import { RailRadarProvider } from './train-data/provider.js';
import { MemoryDataCache, RedisDataCache, TrainDataService } from './train-data/service.js';

interface AppOptions {
  env: Env;
}

export async function buildApp({ env }: AppOptions) {
  const app = Fastify({
    trustProxy: false,
    bodyLimit: 1_048_576,
    logger: {
      level: env.LOG_LEVEL,
    },
    requestIdHeader: 'x-request-id',
    requestIdLogLabel: 'requestId',
  }).withTypeProvider<ZodTypeProvider>();

  const redis = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1_000,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (attempt) => (attempt <= 1 ? 100 : null),
  });
  let lastRedisErrorAt = 0;
  redis.on('error', (error) => {
    const now = Date.now();
    if (now - lastRedisErrorAt > 30_000) {
      app.log.warn({ err: error }, 'Redis connection error');
      lastRedisErrorAt = now;
    }
  });

  // Set up zod validators
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // Plugins
  await app.register(requestId);
  await app.register(errorHandler);

  await app.register(helmet, {
    contentSecurityPolicy: false, // configured at Cloudflare level
  });

  await app.register(cors, {
    origin: env.ALLOWED_ORIGINS.split(',').map((origin) => origin.trim()),
    credentials: true,
  });

  // Store env for use in routes
  app.decorate('env', env);
  app.decorate('redis', redis);
  const trainDataProvider =
    env.TRAIN_DATA_PROVIDER === 'railradar'
      ? new RailRadarProvider(env.RAILRADAR_API_KEY ?? '')
      : new FixtureProvider();
  const trainDataCache =
    env.TRAIN_DATA_PROVIDER === 'fixture' ? new MemoryDataCache() : new RedisDataCache(redis);
  const trainDataService = new TrainDataService(
    trainDataProvider,
    trainDataCache,
    env.RAILRADAR_MONTHLY_BUDGET,
    env.RAILRADAR_MINUTE_LIMIT,
    app.log,
  );
  app.decorateRequest('authUser', null);
  app.addHook('onClose', async () => {
    redis.disconnect();
    const { prisma } = await import('@railgrid/db');
    await prisma.$disconnect();
  });

  app.addHook(
    'preHandler',
    rateLimit([
      {
        name: 'global:ip',
        key: (request) => request.ip,
        limit: 120,
        windowMs: 60_000,
      },
    ]),
  );

  // Routes
  await app.register(healthRoutes, { prefix: '' });
  await app.register(metricsRoutes, { prefix: '' });
  await app.register(authRoutes, { prefix: '/v1/auth' });
  await app.register(bookingRoutes, { prefix: '/v1/bookings' });
  await app.register(async (router) => trainDataRoutes(router, trainDataService), { prefix: '/v1' });

  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    env: Env;
    redis: Redis;
  }
  interface FastifyRequest {
    authUser: AccessClaims | null;
  }
}
