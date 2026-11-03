import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';

export const REFRESH_COOKIE = 'rg_refresh';
export const CSRF_COOKIE = 'rg_csrf';
const COOKIE_PATH = '/v1/auth';

export function readCookie(request: FastifyRequest, name: string): string | null {
  const header = request.headers.cookie;
  if (!header) return null;
  for (const entry of header.split(';')) {
    const separator = entry.indexOf('=');
    if (separator < 0 || entry.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function cookieDomain(app: FastifyInstance): string {
  const domain = app.env.COOKIE_DOMAIN.trim();
  if (app.env.NODE_ENV !== 'production' || !domain || domain === 'localhost') return '';
  return `; Domain=${domain}`;
}

function cookieBase(app: FastifyInstance): string {
  const secure = app.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `Path=${COOKIE_PATH}; SameSite=Lax${secure}${cookieDomain(app)}`;
}

export function setSessionCookies(
  app: FastifyInstance,
  reply: FastifyReply,
  refreshToken: string,
  csrfToken: string,
  maxAgeSeconds: number,
): void {
  const base = cookieBase(app);
  reply.header('set-cookie', [
    `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}; ${base}; HttpOnly; Max-Age=${maxAgeSeconds}`,
    `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${base}; Max-Age=${maxAgeSeconds}`,
  ]);
}

export function setCsrfCookie(app: FastifyInstance, reply: FastifyReply, csrfToken: string): void {
  reply.header(
    'set-cookie',
    `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; ${cookieBase(app)}; Max-Age=3600`,
  );
}

export function clearSessionCookies(app: FastifyInstance, reply: FastifyReply): void {
  const base = cookieBase(app);
  reply.header('set-cookie', [
    `${REFRESH_COOKIE}=; ${base}; HttpOnly; Max-Age=0`,
    `${CSRF_COOKIE}=; ${base}; Max-Age=0`,
  ]);
}

export function verifyCsrf(app: FastifyInstance, request: FastifyRequest): boolean {
  const origin = request.headers.origin;
  const allowedOrigins = app.env.ALLOWED_ORIGINS.split(',').map((value) => value.trim());
  const cookieToken = readCookie(request, CSRF_COOKIE);
  const headerToken = request.headers['x-csrf-token'];
  if (
    !origin ||
    !allowedOrigins.includes(origin) ||
    !cookieToken ||
    !headerToken ||
    Array.isArray(headerToken)
  )
    return false;
  const expected = Buffer.from(cookieToken);
  const actual = Buffer.from(headerToken);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
