/**
 * Phase 6 — Waiting Room
 *
 * POST /v1/waiting-room/join         — join queue for a flash-window run
 * GET  /v1/waiting-room/status       — get position in queue
 * DELETE /v1/waiting-room/leave      — leave the queue
 *
 * Implementation: Redis sorted set  ZADD wr:{runId} <timestamp> <userId>
 */
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authenticate } from '../auth/guard.js';

const WR_WINDOW_SECONDS = 300; // 5-minute TTL for waiting room entry

export async function waitingRoomRoutes(app: FastifyInstance) {
  /** Join waiting room */
  app.post<{ Body: { runId: string } }>(
    '/waiting-room/join',
    {
      preHandler: authenticate,
      schema: {
        body: z.object({ runId: z.string().uuid() }),
        response: {
          200: z.object({ position: z.number(), queueLength: z.number(), runId: z.string() }),
          409: z.object({ error: z.string(), message: z.string() }),
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser!;
      const { runId } = request.body;
      const redis = app.redis;
      const key = `wr:${runId}`;
      const score = Date.now();

      // Add to sorted set (score = timestamp = FIFO order)
      const added = await redis.zadd(key, 'NX', score, user.sub);
      await redis.expire(key, WR_WINDOW_SECONDS);

      const position = (await redis.zrank(key, user.sub)) ?? 0;
      const queueLength = await redis.zcard(key);

      return reply.send({ position: position + 1, queueLength, runId });
    },
  );

  /** Check waiting room status */
  app.get<{ Querystring: { runId: string } }>(
    '/waiting-room/status',
    {
      preHandler: authenticate,
      schema: {
        querystring: z.object({ runId: z.string().uuid() }),
        response: {
          200: z.object({
            inQueue: z.boolean(),
            position: z.number().nullable(),
            queueLength: z.number(),
            runId: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser!;
      const { runId } = request.query;
      const redis = app.redis;
      const key = `wr:${runId}`;

      const rank = await redis.zrank(key, user.sub);
      const queueLength = await redis.zcard(key);

      return reply.send({
        inQueue: rank !== null,
        position: rank !== null ? rank + 1 : null,
        queueLength,
        runId,
      });
    },
  );

  /** Leave waiting room */
  app.delete<{ Body: { runId: string } }>(
    '/waiting-room/leave',
    {
      preHandler: authenticate,
      schema: {
        body: z.object({ runId: z.string().uuid() }),
        response: { 200: z.object({ left: z.boolean() }) },
      },
    },
    async (request, reply) => {
      const user = request.authUser!;
      const { runId } = request.body;
      const redis = app.redis;
      const removed = await redis.zrem(`wr:${runId}`, user.sub);

      return reply.send({ left: removed > 0 });
    },
  );
}
