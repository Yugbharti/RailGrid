import { createHash, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import {
  ERROR_CODES,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  type ForgotPasswordInput,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@railgrid/shared';
import { prisma, type Prisma } from '@railgrid/db';
import { rateLimit, type RateLimitPolicy } from '../plugins/rate-limit.js';
import { authenticate } from '../auth/guard.js';
import {
  clearSessionCookies,
  readCookie,
  setCsrfCookie,
  setSessionCookies,
  verifyCsrf,
} from '../auth/cookies.js';
import { getDummyPasswordHash, hashPassword, verifyPassword } from '../auth/passwords.js';
import { loginFailureLockSeconds, shouldRequireTurnstile } from '../auth/lockout.js';
import {
  classifyRefreshState,
  createOpaqueToken,
  encryptOutboxSecret,
  hashOpaqueToken,
  signAccessToken,
} from '../auth/tokens.js';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 14 * 24 * 60 * 60;
const EMAIL_VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 30 * 60 * 1000;
const actionTokenSchema = z.object({ token: z.string().min(20).max(256) });

class AuthFailure extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AuthFailure';
  }
}

function fail(statusCode: number, code: string, message: string): never {
  throw new AuthFailure(statusCode, code, message);
}

function hasPrismaCode(error: unknown, code: string): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function bodyEmail(request: FastifyRequest): string | null {
  if (!request.body || typeof request.body !== 'object' || !('email' in request.body)) return null;
  const email = (request.body as { email?: unknown }).email;
  return typeof email === 'string' ? email.trim().toLowerCase() : null;
}

const ipPolicy = (name: string, limit: number, windowMs: number): RateLimitPolicy => ({
  name,
  key: (request) => request.ip,
  limit,
  windowMs,
});

const emailPolicy = (name: string, limit: number, windowMs: number): RateLimitPolicy => ({
  name,
  key: (request) => bodyEmail(request),
  limit,
  windowMs,
});

function csrfGuard(app: FastifyInstance) {
  return async (request: FastifyRequest) => {
    if (!verifyCsrf(app, request)) {
      fail(
        403,
        ERROR_CODES.FORBIDDEN,
        'The request could not be verified. Refresh the page and try again.',
      );
    }
  };
}

async function persistActionToken(
  tx: Prisma.TransactionClient,
  app: FastifyInstance,
  userId: string,
  email: string,
  purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
): Promise<string> {
  const rawToken = createOpaqueToken();
  const expiresAt = new Date(
    Date.now() +
      (purpose === 'EMAIL_VERIFICATION' ? EMAIL_VERIFICATION_TTL_MS : PASSWORD_RESET_TTL_MS),
  );
  await tx.authToken.create({
    data: {
      userId,
      tokenHash: hashOpaqueToken(rawToken, app.env.REFRESH_TOKEN_PEPPER),
      purpose,
      expiresAt,
    },
  });
  await tx.outboxEvent.create({
    data: {
      type: purpose === 'EMAIL_VERIFICATION' ? 'auth.email_verification' : 'auth.password_reset',
      aggregateId: userId,
      payload: {
        email,
        encryptedToken: encryptOutboxSecret(rawToken, app.env.OUTBOX_ENCRYPTION_KEY),
        expiresAt: expiresAt.toISOString(),
      } as Prisma.InputJsonObject,
    },
  });
  return rawToken;
}

function issueAccessToken(app: FastifyInstance, user: { id: string; role: string }) {
  return signAccessToken({ sub: user.id, role: user.role }, app.env.JWT_ACCESS_SECRET);
}

function responseUser(user: { id: string; email: string; name: string; role: string }) {
  return { id: user.id, email: user.email, name: user.name, role: user.role };
}

const memoryLoginFailures = new Map<
  string,
  { failures: number; since: number; lockedUntil: number }
>();
const MAX_LOCAL_LOGIN_IDENTIFIERS = 10_000;
let loginRedisUnavailableUntil = 0;
let lastLoginRedisWarningAt = 0;
const loginAbuseScript = `
local failures = tonumber(redis.call('GET', KEYS[1]) or '0')
local lockTtl = redis.call('TTL', KEYS[2])
if lockTtl < 0 then lockTtl = 0 end
return {failures, lockTtl}
`;
const recordFailureScript = `
local failures = redis.call('INCR', KEYS[1])
if failures == 1 then redis.call('EXPIRE', KEYS[1], 3600) end
if failures < 10 then return {failures, 0} end
local level = math.floor((failures - 10) / 5)
local lockSeconds = math.min(3600, 900 * (2 ^ level))
redis.call('SET', KEYS[2], '1', 'EX', lockSeconds)
return {failures, lockSeconds}
`;
const clearFailureScript = `return redis.call('DEL', KEYS[1], KEYS[2])`;

function loginFailureKeys(email: string): [string, string] {
  const emailDigest = createHash('sha256').update(email).digest('hex');
  return [`railgrid:auth-failure:${emailDigest}`, `railgrid:auth-lock:${emailDigest}`];
}

function pruneLocalLoginFailures(now: number): void {
  for (const [key, state] of memoryLoginFailures) {
    if (now - state.since > 60 * 60 * 1000 && state.lockedUntil <= now) {
      memoryLoginFailures.delete(key);
    }
  }
}

async function loginAbuseState(
  app: FastifyInstance,
  email: string,
): Promise<{ failures: number; lockSeconds: number }> {
  const [failureKey, lockKey] = loginFailureKeys(email);
  try {
    if (Date.now() < loginRedisUnavailableUntil)
      throw new Error('Redis login limiter is in fallback cooldown');
    if (app.redis.status === 'wait' || app.redis.status === 'end') await app.redis.connect();
    const [failures, lockSeconds] = (await app.redis.eval(
      loginAbuseScript,
      2,
      failureKey,
      lockKey,
    )) as [number, number];
    return { failures: Number(failures), lockSeconds: Number(lockSeconds) };
  } catch (error) {
    const now = Date.now();
    loginRedisUnavailableUntil = now + 1_000;
    if (now - lastLoginRedisWarningAt > 30_000) {
      app.log.warn({ err: error }, 'Using local login lockout fallback while Redis is unavailable');
      lastLoginRedisWarningAt = now;
    }
    let previous = memoryLoginFailures.get(failureKey);
    if (!previous) {
      pruneLocalLoginFailures(now);
      if (memoryLoginFailures.size >= MAX_LOCAL_LOGIN_IDENTIFIERS) {
        return { failures: 10, lockSeconds: 60 * 60 };
      }
      previous = memoryLoginFailures.get(failureKey);
    }
    if (!previous || now - previous.since > 60 * 60 * 1000) {
      memoryLoginFailures.set(failureKey, { failures: 0, since: now, lockedUntil: 0 });
      return { failures: 0, lockSeconds: 0 };
    }
    return {
      failures: previous.failures,
      lockSeconds: Math.max(0, Math.ceil((previous.lockedUntil - now) / 1000)),
    };
  }
}

async function recordLoginFailure(
  app: FastifyInstance,
  email: string,
): Promise<{ failures: number; lockSeconds: number }> {
  const [failureKey, lockKey] = loginFailureKeys(email);
  try {
    if (Date.now() < loginRedisUnavailableUntil)
      throw new Error('Redis login limiter is in fallback cooldown');
    if (app.redis.status === 'wait' || app.redis.status === 'end') await app.redis.connect();
    const [failures, lockSeconds] = (await app.redis.eval(
      recordFailureScript,
      2,
      failureKey,
      lockKey,
    )) as [number, number];
    return { failures: Number(failures), lockSeconds: Number(lockSeconds) };
  } catch (error) {
    const now = Date.now();
    loginRedisUnavailableUntil = now + 1_000;
    if (now - lastLoginRedisWarningAt > 30_000) {
      app.log.warn({ err: error }, 'Using local login lockout fallback while Redis is unavailable');
      lastLoginRedisWarningAt = now;
    }
    let previous = memoryLoginFailures.get(failureKey);
    if (!previous) {
      pruneLocalLoginFailures(now);
      if (memoryLoginFailures.size >= MAX_LOCAL_LOGIN_IDENTIFIERS) {
        return { failures: 10, lockSeconds: 60 * 60 };
      }
      previous = memoryLoginFailures.get(failureKey);
    }
    const failures = previous && now - previous.since <= 60 * 60 * 1000 ? previous.failures + 1 : 1;
    const lockSeconds = loginFailureLockSeconds(failures);
    memoryLoginFailures.set(failureKey, {
      failures,
      since: previous?.since ?? now,
      lockedUntil: lockSeconds > 0 ? now + lockSeconds * 1000 : 0,
    });
    return { failures, lockSeconds };
  }
}

async function clearLoginFailures(app: FastifyInstance, email: string): Promise<void> {
  const keys = loginFailureKeys(email);
  memoryLoginFailures.delete(keys[0]);
  try {
    if (Date.now() < loginRedisUnavailableUntil)
      throw new Error('Redis login limiter is in fallback cooldown');
    if (app.redis.status === 'wait' || app.redis.status === 'end') await app.redis.connect();
    await app.redis.eval(clearFailureScript, 2, ...keys);
  } catch (error) {
    const now = Date.now();
    loginRedisUnavailableUntil = now + 1_000;
    if (now - lastLoginRedisWarningAt > 30_000) {
      app.log.warn({ err: error }, 'Could not clear Redis login failure state');
      lastLoginRedisWarningAt = now;
    }
  }
}

async function verifyTurnstile(
  app: FastifyInstance,
  token: string | undefined,
  ip: string,
): Promise<boolean> {
  if (!token) return false;
  try {
    const response = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        secret: app.env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: ip,
      }),
      signal: AbortSignal.timeout(2_500),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: unknown };
    return result.success === true;
  } catch {
    return false;
  }
}

function actionTokenRatePolicy(name: string): RateLimitPolicy {
  return {
    name,
    key: (request) => readCookie(request, 'rg_refresh'),
    limit: 30,
    windowMs: 60_000,
  };
}

export async function authRoutes(app: FastifyInstance) {
  app.get('/csrf', async (_request, reply) => {
    const csrfToken = createOpaqueToken();
    setCsrfCookie(app, reply, csrfToken);
    return reply.header('cache-control', 'no-store').send({ csrfToken });
  });

  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.authUser!.sub } });
    if (!user) fail(401, ERROR_CODES.UNAUTHORIZED, 'Sign in to continue.');
    return reply.send({ user: responseUser(user) });
  });

  app.post<{ Body: RegisterInput }>(
    '/register',
    {
      schema: { body: registerSchema },
      preHandler: rateLimit([ipPolicy('auth:register:ip', 3, 60 * 60 * 1000)]),
    },
    async (request, reply) => {
      const input = request.body;
      const passwordHash = await hashPassword(input.password);
      let verificationToken: string | undefined;
      try {
        await prisma.$transaction(async (tx) => {
          const user = await tx.user.create({
            data: { email: input.email, name: input.name, passwordHash },
          });
          verificationToken = await persistActionToken(
            tx,
            app,
            user.id,
            user.email,
            'EMAIL_VERIFICATION',
          );
        });
      } catch (error) {
        if (!hasPrismaCode(error, 'P2002')) throw error;
      }
      const body: { message: string; verificationToken?: string } = {
        message: 'If registration can be completed, verification instructions will be sent.',
      };
      if (app.env.NODE_ENV !== 'production' && verificationToken)
        body.verificationToken = verificationToken;
      return reply.code(202).send(body);
    },
  );

  app.post<{ Body: LoginInput }>(
    '/login',
    {
      schema: { body: loginSchema },
      preHandler: rateLimit([
        {
          name: 'auth:login:email-ip',
          key: (request) => {
            const email = bodyEmail(request);
            return email ? `${request.ip}:${email}` : request.ip;
          },
          limit: 5,
          windowMs: 15 * 60 * 1000,
        },
        ipPolicy('auth:login:ip', 20, 15 * 60 * 1000),
      ]),
    },
    async (request, reply) => {
      const input = request.body;
      const abuse = await loginAbuseState(app, input.email);
      if (abuse.lockSeconds > 0) {
        reply.header('retry-after', String(abuse.lockSeconds));
        fail(429, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.');
      }
      if (
        shouldRequireTurnstile(abuse.failures) &&
        !(await verifyTurnstile(app, input.turnstileToken, request.ip))
      ) {
        fail(400, ERROR_CODES.TURNSTILE_REQUIRED, 'Additional verification is required.');
      }

      const user = await prisma.user.findUnique({ where: { email: input.email } });
      const hashToVerify = user?.passwordHash ?? (await getDummyPasswordHash());
      const passwordMatches = await verifyPassword(hashToVerify, input.password);
      if (!user || !passwordMatches) {
        const result = await recordLoginFailure(app, input.email);
        if (result.lockSeconds > 0) {
          if (user) {
            try {
              await prisma.outboxEvent.create({
                data: {
                  type: 'auth.login_locked',
                  aggregateId: user.id,
                  payload: {
                    email: user.email,
                    lockoutSeconds: result.lockSeconds,
                    lockedAt: new Date().toISOString(),
                  },
                },
              });
            } catch (error) {
              request.log.warn({ err: error }, 'Could not enqueue the login lockout notice');
            }
          }
          reply.header('retry-after', String(result.lockSeconds));
          fail(429, ERROR_CODES.RATE_LIMITED, 'Too many requests. Please try again later.');
        }
        fail(401, ERROR_CODES.INVALID_CREDENTIALS, 'Invalid email or password.');
      }
      if (!user.emailVerifiedAt) {
        fail(403, ERROR_CODES.EMAIL_NOT_VERIFIED, 'Verify your email before signing in.');
      }

      await clearLoginFailures(app, input.email);
      const refreshToken = createOpaqueToken();
      const familyId = randomUUID();
      await prisma.refreshToken.create({
        data: {
          userId: user.id,
          familyId,
          tokenHash: hashOpaqueToken(refreshToken, app.env.REFRESH_TOKEN_PEPPER),
          expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
          ip: request.ip,
          userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
        },
      });
      const csrfToken = createOpaqueToken();
      setSessionCookies(app, reply, refreshToken, csrfToken, REFRESH_TOKEN_TTL_SECONDS);
      return reply.send({
        accessToken: issueAccessToken(app, user),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        csrfToken,
        user: responseUser(user),
      });
    },
  );

  app.post(
    '/refresh',
    {
      preHandler: [
        csrfGuard(app),
        rateLimit([
          ipPolicy('auth:refresh:ip', 30, 60_000),
          actionTokenRatePolicy('auth:refresh:token'),
        ]),
      ],
    },
    async (request, reply) => {
      const rawRefreshToken = readCookie(request, 'rg_refresh');
      if (!rawRefreshToken) {
        clearSessionCookies(app, reply);
        fail(401, ERROR_CODES.UNAUTHORIZED, 'Sign in to continue.');
      }
      const tokenHash = hashOpaqueToken(rawRefreshToken, app.env.REFRESH_TOKEN_PEPPER);
      const result = await prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM refresh_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;
        const token = await tx.refreshToken.findUnique({
          where: { tokenHash },
          include: { user: true },
        });
        if (!token) return { kind: 'INVALID' as const };
        const state = classifyRefreshState(token, new Date());
        if (state === 'REUSE') {
          await tx.refreshToken.updateMany({
            where: { familyId: token.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
          return { kind: 'REUSE' as const };
        }
        if (state !== 'VALID') return { kind: 'INVALID' as const };

        const nextRawToken = createOpaqueToken();
        const next = await tx.refreshToken.create({
          data: {
            userId: token.userId,
            familyId: token.familyId,
            tokenHash: hashOpaqueToken(nextRawToken, app.env.REFRESH_TOKEN_PEPPER),
            expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
            ip: request.ip,
            userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
          },
        });
        await tx.refreshToken.update({
          where: { id: token.id },
          data: { revokedAt: new Date(), replacedBy: next.id },
        });
        return { kind: 'VALID' as const, token: nextRawToken, user: token.user };
      });

      if (result.kind !== 'VALID') {
        clearSessionCookies(app, reply);
        fail(
          401,
          result.kind === 'REUSE' ? ERROR_CODES.TOKEN_REUSED : ERROR_CODES.UNAUTHORIZED,
          'Sign in to continue.',
        );
      }

      const csrfToken = createOpaqueToken();
      setSessionCookies(app, reply, result.token, csrfToken, REFRESH_TOKEN_TTL_SECONDS);
      return reply.send({
        accessToken: issueAccessToken(app, result.user),
        expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        csrfToken,
        user: responseUser(result.user),
      });
    },
  );

  app.post(
    '/logout',
    {
      preHandler: [
        csrfGuard(app),
        rateLimit([
          ipPolicy('auth:logout:ip', 30, 60_000),
          actionTokenRatePolicy('auth:logout:token'),
        ]),
      ],
    },
    async (request, reply) => {
      const rawRefreshToken = readCookie(request, 'rg_refresh');
      if (rawRefreshToken) {
        const tokenHash = hashOpaqueToken(rawRefreshToken, app.env.REFRESH_TOKEN_PEPPER);
        const session = await prisma.refreshToken.findUnique({ where: { tokenHash } });
        if (session) {
          await prisma.refreshToken.updateMany({
            where: { familyId: session.familyId, revokedAt: null },
            data: { revokedAt: new Date() },
          });
        }
      }
      clearSessionCookies(app, reply);
      return reply.code(204).send();
    },
  );

  app.post<{ Body: { token: string } }>(
    '/verify-email',
    {
      schema: { body: actionTokenSchema },
      preHandler: rateLimit([ipPolicy('auth:verify-email:ip', 10, 60 * 60 * 1000)]),
    },
    async (request, reply) => {
      const tokenHash = hashOpaqueToken(request.body.token, app.env.REFRESH_TOKEN_PEPPER);
      const now = new Date();
      const verified = await prisma.$transaction(async (tx) => {
        const action = await tx.authToken.findUnique({ where: { tokenHash } });
        if (
          !action ||
          action.purpose !== 'EMAIL_VERIFICATION' ||
          action.expiresAt <= now ||
          action.consumedAt
        ) {
          return false;
        }
        const consumed = await tx.authToken.updateMany({
          where: { id: action.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) return false;
        await tx.user.update({ where: { id: action.userId }, data: { emailVerifiedAt: now } });
        return true;
      });
      if (!verified)
        fail(400, ERROR_CODES.TOKEN_EXPIRED, 'This verification link is invalid or has expired.');
      return reply.send({ message: 'Email verified. You can now sign in.' });
    },
  );

  app.post<{ Body: ForgotPasswordInput }>(
    '/forgot-password',
    {
      schema: { body: forgotPasswordSchema },
      preHandler: rateLimit([
        ipPolicy('auth:forgot-password:ip', 3, 60 * 60 * 1000),
        emailPolicy('auth:forgot-password:email', 3, 60 * 60 * 1000),
      ]),
    },
    async (request, reply) => {
      const user = await prisma.user.findUnique({ where: { email: request.body.email } });
      let resetToken: string | undefined;
      if (user) {
        resetToken = await prisma.$transaction((tx) =>
          persistActionToken(tx, app, user.id, user.email, 'PASSWORD_RESET'),
        );
      }
      const body: { message: string; resetToken?: string } = {
        message: 'If the account can be recovered, password reset instructions will be sent.',
      };
      if (app.env.NODE_ENV !== 'production' && resetToken) body.resetToken = resetToken;
      return reply.code(202).send(body);
    },
  );

  app.post<{ Body: ResetPasswordInput }>(
    '/reset-password',
    {
      schema: { body: resetPasswordSchema },
      preHandler: rateLimit([ipPolicy('auth:reset-password:ip', 5, 60 * 60 * 1000)]),
    },
    async (request, reply) => {
      const passwordHash = await hashPassword(request.body.password);
      const tokenHash = hashOpaqueToken(request.body.token, app.env.REFRESH_TOKEN_PEPPER);
      const now = new Date();
      const reset = await prisma.$transaction(async (tx) => {
        const action = await tx.authToken.findUnique({ where: { tokenHash } });
        if (
          !action ||
          action.purpose !== 'PASSWORD_RESET' ||
          action.expiresAt <= now ||
          action.consumedAt
        ) {
          return false;
        }
        const consumed = await tx.authToken.updateMany({
          where: { id: action.id, consumedAt: null, expiresAt: { gt: now } },
          data: { consumedAt: now },
        });
        if (consumed.count !== 1) return false;
        const updatedUser = await tx.user.update({
          where: { id: action.userId },
          data: { passwordHash },
          select: { email: true },
        });
        await tx.authToken.updateMany({
          where: { userId: action.userId, purpose: 'PASSWORD_RESET', consumedAt: null },
          data: { consumedAt: now },
        });
        await tx.refreshToken.updateMany({
          where: { userId: action.userId, revokedAt: null },
          data: { revokedAt: now },
        });
        return updatedUser.email;
      });
      if (!reset)
        fail(400, ERROR_CODES.TOKEN_EXPIRED, 'This reset link is invalid or has expired.');
      await clearLoginFailures(app, reset);
      return reply.send({ message: 'Password reset. Sign in with your new password.' });
    },
  );
}
