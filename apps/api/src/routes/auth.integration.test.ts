import '../load-env.js';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '@railgrid/shared';
import { prisma } from '@railgrid/db';
import { buildApp } from '../app.js';

const integration = process.env['RAILGRID_INTEGRATION_TESTS'] === '1' ? describe : describe.skip;
const createdEmails: string[] = [];
let app: FastifyInstance | undefined;

function cookieValue(header: string | string[] | undefined, name: string): string {
  const entries = Array.isArray(header) ? header : header ? [header] : [];
  const entry = entries.find((value) => value.startsWith(`${name}=`));
  if (!entry) throw new Error(`Missing ${name} cookie`);
  return decodeURIComponent(entry.slice(name.length + 1).split(';')[0]!);
}

function responseCookieHeader(header: string | string[] | undefined): string {
  const entries = Array.isArray(header) ? header : header ? [header] : [];
  return entries.map((entry) => entry.split(';')[0]).join('; ');
}

function ipFor(requestNumber: number): string {
  return `198.51.100.${requestNumber}`;
}

integration('auth routes with Neon persistence', () => {
  afterAll(async () => {
    for (const email of createdEmails) {
      const user = await prisma.user.findUnique({ where: { email } });
      if (!user) continue;
      await prisma.$transaction(async (tx) => {
        await tx.outboxEvent.deleteMany({ where: { aggregateId: user.id } });
        await tx.authToken.deleteMany({ where: { userId: user.id } });
        await tx.refreshToken.deleteMany({ where: { userId: user.id } });
        await tx.user.delete({ where: { id: user.id } });
      });
    }
    await app?.close();
  });

  it('registers, verifies, logs in, rotates refresh tokens, detects replay, and resets a password', async () => {
    process.env['NODE_ENV'] = 'test';
    const env = parseEnv(process.env);
    app = await buildApp({ env });
    const email = `auth-${randomUUID()}@railgrid.invalid`;
    createdEmails.push(email);
    const originalPassword = 'a-long-demo-password-123';
    const newPassword = 'a-different-long-password-456';

    let redisAvailable = true;
    try {
      if (app.redis.status === 'wait' || app.redis.status === 'end') await app.redis.connect();
      await app.redis.ping();
    } catch {
      redisAvailable = false;
    }
    if (!redisAvailable) {
      const fallbackRequests = await Promise.all(
        Array.from({ length: 4 }, (_, index) =>
          app!.inject({
            method: 'GET',
            url: '/v1/auth/csrf',
            remoteAddress: ipFor(20),
            headers: { 'x-forwarded-for': ipFor(30 + index) },
          }),
        ),
      );
      expect(fallbackRequests.map((response) => response.statusCode).sort()).toEqual([
        200, 200, 200, 429,
      ]);
      const limited = fallbackRequests.find((response) => response.statusCode === 429)!;
      expect(limited.headers['ratelimit-limit']).toBe('3');
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    }

    const registration = await app.inject({
      method: 'POST',
      url: '/v1/auth/register',
      remoteAddress: ipFor(1),
      payload: { email, name: 'Auth Integration', password: originalPassword },
    });
    expect(registration.statusCode).toBe(202);
    const verificationToken = registration.json<{ verificationToken: string }>().verificationToken;
    expect(verificationToken).toBeTruthy();

    const verification = await app.inject({
      method: 'POST',
      url: '/v1/auth/verify-email',
      remoteAddress: ipFor(2),
      payload: { token: verificationToken },
    });
    expect(verification.statusCode).toBe(200);

    const login = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: ipFor(3),
      payload: { email, password: originalPassword },
    });
    expect(login.statusCode).toBe(200);
    const accessToken = login.json<{ accessToken: string }>().accessToken;
    const unauthorizedProfile = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      remoteAddress: ipFor(3),
    });
    expect(unauthorizedProfile.statusCode).toBe(401);
    const profile = await app.inject({
      method: 'GET',
      url: '/v1/auth/me',
      remoteAddress: ipFor(3),
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(profile.statusCode).toBe(200);
    expect(profile.json().user.email).toBe(email);
    const refreshToken = cookieValue(login.headers['set-cookie'], 'rg_refresh');
    const csrfToken = login.json<{ csrfToken: string }>().csrfToken;

    const origin = env.ALLOWED_ORIGINS.split(',')[0]!.trim();
    const csrfRejected = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      remoteAddress: ipFor(4),
      headers: {
        origin: 'https://attacker.example',
        'x-csrf-token': csrfToken,
        cookie: `rg_refresh=${refreshToken}; rg_csrf=${csrfToken}`,
      },
    });
    expect(csrfRejected.statusCode).toBe(403);
    const refresh = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      remoteAddress: ipFor(4),
      headers: {
        origin,
        'x-csrf-token': csrfToken,
        cookie: `rg_refresh=${refreshToken}; rg_csrf=${csrfToken}`,
      },
    });
    expect(refresh.statusCode).toBe(200);
    const nextCsrfToken = refresh.json<{ csrfToken: string }>().csrfToken;

    const replay = await app.inject({
      method: 'POST',
      url: '/v1/auth/refresh',
      remoteAddress: ipFor(5),
      headers: {
        origin,
        'x-csrf-token': nextCsrfToken,
        cookie: `rg_refresh=${refreshToken}; rg_csrf=${nextCsrfToken}`,
      },
    });
    expect(replay.statusCode).toBe(401);
    expect(replay.json().error.code).toBe('TOKEN_REUSED');
    const forgot = await app.inject({
      method: 'POST',
      url: '/v1/auth/forgot-password',
      remoteAddress: ipFor(6),
      payload: { email },
    });
    expect(forgot.statusCode).toBe(202);
    const resetToken = forgot.json<{ resetToken: string }>().resetToken;
    expect(resetToken).toBeTruthy();

    const reset = await app.inject({
      method: 'POST',
      url: '/v1/auth/reset-password',
      remoteAddress: ipFor(7),
      payload: { token: resetToken, password: newPassword },
    });
    expect(reset.statusCode).toBe(200);

    const oldPasswordLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: ipFor(8),
      payload: { email, password: originalPassword },
    });
    expect(oldPasswordLogin.statusCode).toBe(401);

    const newPasswordLogin = await app.inject({
      method: 'POST',
      url: '/v1/auth/login',
      remoteAddress: ipFor(9),
      payload: { email, password: newPassword },
    });
    expect(newPasswordLogin.statusCode).toBe(200);
    expect(newPasswordLogin.json().user.email).toBe(email);
    expect(responseCookieHeader(newPasswordLogin.headers['set-cookie'])).toContain('rg_refresh=');
  }, 30_000);
});
