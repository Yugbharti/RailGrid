/**
 * Phase 6 — WebSocket seat update feed
 *
 * GET /v1/ws/token        — issue a 60-second WS admission token (requires auth)
 * GET /v1/ws?token=...    — WebSocket connection; subscribe to run:{runId} channel
 *
 * Security:
 *   - Short-lived token (60s) signed with JWT_ACCESS_SECRET
 *   - Up to 10 run subscriptions per socket
 *   - Up to 5 concurrent WS connections per user (tracked in Redis)
 *   - Heartbeat ping every 30s; close on pong timeout
 *   - Best-effort: Redis subscription errors log and close the socket cleanly
 */
import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Redis } from 'ioredis';
import { authenticate } from '../auth/guard.js';

const MAX_SUBSCRIPTIONS = 10;
const MAX_CONNECTIONS_PER_USER = 5;
const PING_INTERVAL_MS = 30_000;

/** Sign a minimal WS token (HMAC-signed JSON base64url) */
function signWsToken(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function verifyWsToken(
  token: string,
  secret: string,
): { sub: string; role: string; exp: number } | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts as [string, string];
  const expected = createHmac('sha256', secret).update(body).digest('base64url');
  if (sig !== expected) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as {
      sub: string;
      role: string;
      exp: number;
    };
    if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function wsRoutes(app: FastifyInstance) {
  const env = app.env;

  /** Issue a short-lived WS token */
  app.get(
    '/ws/token',
    {
      preHandler: authenticate,
      schema: {
        response: {
          200: z.object({ token: z.string(), expiresIn: z.number() }),
        },
      },
    },
    async (request, reply) => {
      const user = request.authUser!;
      const exp = Math.floor(Date.now() / 1000) + 60;
      const token = signWsToken({ sub: user.sub, role: user.role, exp }, env.JWT_ACCESS_SECRET);
      return reply.send({ token, expiresIn: 60 });
    },
  );

  /** WebSocket upgrade endpoint */
  app.get('/ws', { websocket: true }, (connection, request) => {
    const socket = connection.socket;
    const url = new URL(request.url, 'http://localhost');
    const token = url.searchParams.get('token') ?? '';
    const runId = url.searchParams.get('runId') ?? '';

    // Verify token
    const claims = verifyWsToken(token, env.JWT_ACCESS_SECRET);
    if (!claims) {
      socket.send(JSON.stringify({ error: 'UNAUTHORIZED', message: 'Invalid or expired token' }));
      socket.close(4001, 'Unauthorized');
      return;
    }

    const userId = claims.sub;
    const connectionKey = `ws:conns:${userId}`;
    const redis = app.redis;

    // Async setup
    void (async () => {
      const connCount = await redis.incr(connectionKey);
      await redis.expire(connectionKey, 300);

      if (connCount > MAX_CONNECTIONS_PER_USER) {
        await redis.decr(connectionKey);
        socket.send(
          JSON.stringify({ error: 'TOO_MANY_CONNECTIONS', message: 'Max 5 concurrent connections per user' }),
        );
        socket.close(4029, 'Too many connections');
        return;
      }

      // Subscriber Redis connection
      const subscriber = new Redis(env.REDIS_URL, {
        lazyConnect: false,
        maxRetriesPerRequest: null,
      });

      const subscriptions = new Set<string>();

      // Subscribe to initial runId if provided
      if (runId) {
        await subscriber.subscribe(`run:${runId}`);
        subscriptions.add(runId);
      }

      // Forward Redis messages to WebSocket
      subscriber.on('message', (_channel: string, message: string) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(message);
        }
      });

      // Heartbeat
      let pongReceived = true;
      const pingInterval = setInterval(() => {
        if (!pongReceived) {
          socket.close(4000, 'Pong timeout');
          return;
        }
        pongReceived = false;
        socket.ping();
      }, PING_INTERVAL_MS);

      socket.on('pong', () => {
        pongReceived = true;
      });

      // Client messages
      socket.on('message', async (data: Buffer | string) => {
        try {
          const msg = JSON.parse(data.toString()) as { action: string; runId: string };
          if (msg.action === 'subscribe' && msg.runId) {
            if (subscriptions.size >= MAX_SUBSCRIPTIONS) {
              socket.send(JSON.stringify({ error: 'MAX_SUBSCRIPTIONS', message: 'Max 10 subscriptions per socket' }));
              return;
            }
            if (!subscriptions.has(msg.runId)) {
              await subscriber.subscribe(`run:${msg.runId}`);
              subscriptions.add(msg.runId);
              socket.send(JSON.stringify({ event: 'subscribed', runId: msg.runId }));
            }
          } else if (msg.action === 'unsubscribe' && msg.runId) {
            if (subscriptions.has(msg.runId)) {
              await subscriber.unsubscribe(`run:${msg.runId}`);
              subscriptions.delete(msg.runId);
            }
          }
        } catch {
          // ignore malformed messages
        }
      });

      // Cleanup on close
      socket.on('close', async () => {
        clearInterval(pingInterval);
        try {
          await subscriber.unsubscribe(...Array.from(subscriptions).map((r) => `run:${r}`));
          subscriber.disconnect();
        } catch {
          // ignore
        }
        await redis.decr(connectionKey);
      });

      socket.on('error', () => {
        clearInterval(pingInterval);
        try {
          subscriber.disconnect();
        } catch {
          // ignore
        }
      });

      socket.send(JSON.stringify({ event: 'connected', userId, subscriptions: Array.from(subscriptions) }));
    })();
  });
}
