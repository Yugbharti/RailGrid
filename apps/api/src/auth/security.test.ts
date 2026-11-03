import { describe, expect, it } from 'vitest';
import {
  classifyRefreshState,
  decryptOutboxSecret,
  encryptOutboxSecret,
  hashOpaqueToken,
  signAccessToken,
  verifyAccessToken,
} from './tokens.js';
import { evaluateSlidingWindow } from '../plugins/rate-limit.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { loginFailureLockSeconds, shouldRequireTurnstile } from './lockout.js';

describe('password hashing', () => {
  it('uses salted Argon2id hashes and verifies only the matching password', async () => {
    const first = await hashPassword('correct horse battery staple');
    const second = await hashPassword('correct horse battery staple');

    expect(first.startsWith('$argon2id$')).toBe(true);
    expect(second).not.toBe(first);
    await expect(verifyPassword(first, 'correct horse battery staple')).resolves.toBe(true);
    await expect(verifyPassword(first, 'wrong password')).resolves.toBe(false);
  });
});

describe('access tokens and refresh token state', () => {
  it('signs a short-lived access token and rejects expiry or tampering', () => {
    const secret = 'a'.repeat(40);
    const token = signAccessToken({ sub: 'user-1', role: 'USER' }, secret, 1_000_000);

    expect(verifyAccessToken(token, secret, 1_000_100)).toMatchObject({
      sub: 'user-1',
      role: 'USER',
    });
    expect(verifyAccessToken(token, secret, 1_901_000)).toBeNull();
    expect(verifyAccessToken(`${token.slice(0, -1)}x`, secret, 1_000_100)).toBeNull();
    expect(verifyAccessToken(token, 'b'.repeat(40), 1_000_100)).toBeNull();
  });

  it('stores an opaque refresh-token digest rather than the token itself', () => {
    const raw = 'opaque-secret-token';
    const digest = hashOpaqueToken(raw, 'pepper'.repeat(8));
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(raw);
    expect(hashOpaqueToken(raw, 'pepper'.repeat(8))).toBe(digest);
    expect(hashOpaqueToken(raw, 'another'.repeat(8))).not.toBe(digest);
  });

  it('encrypts one-time tokens placed in the transactional email outbox', () => {
    const key = 'encryption-key'.repeat(3);
    const encrypted = encryptOutboxSecret('one-time-action-token', key);
    expect(encrypted).not.toContain('one-time-action-token');
    expect(decryptOutboxSecret(encrypted, key)).toBe('one-time-action-token');
    expect(() => decryptOutboxSecret(encrypted, 'different-encryption-key'.repeat(2))).toThrow();
  });

  it('distinguishes active, expired, revoked, and replayed refresh tokens', () => {
    const now = new Date('2026-11-03T00:00:00.000Z');
    expect(
      classifyRefreshState(
        { expiresAt: new Date(now.getTime() + 1000), revokedAt: null, replacedBy: null },
        now,
      ),
    ).toBe('VALID');
    expect(classifyRefreshState({ expiresAt: now, revokedAt: null, replacedBy: null }, now)).toBe(
      'INVALID',
    );
    expect(
      classifyRefreshState(
        { expiresAt: new Date(now.getTime() + 1000), revokedAt: now, replacedBy: null },
        now,
      ),
    ).toBe('INVALID');
    expect(
      classifyRefreshState({ expiresAt: now, revokedAt: now, replacedBy: 'replacement' }, now),
    ).toBe('REUSE');
  });
});

describe('sliding-window policy', () => {
  it('blocks at the limit and reports when the oldest event expires', () => {
    expect(evaluateSlidingWindow([100, 500, 900], 1000, 1000, 3)).toEqual({
      allowed: false,
      activeCount: 3,
      remaining: 0,
      retryAfterMs: 100,
    });
  });

  it('slides the window by removing events at or before the cutoff', () => {
    expect(evaluateSlidingWindow([999, 1000, 1500], 2000, 1000, 3)).toEqual({
      allowed: true,
      activeCount: 2,
      remaining: 1,
      retryAfterMs: 0,
    });
  });
});

describe('progressive login friction', () => {
  it('requires Turnstile after three failures and applies bounded exponential lockout', () => {
    expect(shouldRequireTurnstile(2)).toBe(false);
    expect(shouldRequireTurnstile(3)).toBe(true);
    expect(loginFailureLockSeconds(9)).toBe(0);
    expect(loginFailureLockSeconds(10)).toBe(900);
    expect(loginFailureLockSeconds(15)).toBe(1800);
    expect(loginFailureLockSeconds(100)).toBe(3600);
  });
});
