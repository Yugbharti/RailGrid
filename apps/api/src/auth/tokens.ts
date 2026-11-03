import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
const TOKEN_ISSUER = 'railgrid';

export interface AccessClaims {
  sub: string;
  role: string;
  iss: typeof TOKEN_ISSUER;
  iat: number;
  exp: number;
}

interface RefreshState {
  expiresAt: Date;
  revokedAt: Date | null;
  replacedBy: string | null;
}

function hmac(value: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(value).digest();
}

export function signAccessToken(
  claims: Pick<AccessClaims, 'sub' | 'role'>,
  secret: string,
  nowMs = Date.now(),
): string {
  if (secret.length < 32) throw new Error('JWT access secret must be at least 32 characters');
  const issuedAt = Math.floor(nowMs / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      ...claims,
      iss: TOKEN_ISSUER,
      iat: issuedAt,
      exp: issuedAt + ACCESS_TOKEN_TTL_SECONDS,
    } satisfies AccessClaims),
  ).toString('base64url');
  const signingInput = `${header}.${payload}`;
  return `${signingInput}.${hmac(signingInput, secret).toString('base64url')}`;
}

export function verifyAccessToken(
  token: string,
  secret: string,
  nowMs = Date.now(),
): AccessClaims | null {
  if (secret.length < 32) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerPart, payloadPart, signaturePart] = parts;
  if (!headerPart || !payloadPart || !signaturePart) return null;

  try {
    const header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8')) as {
      alg?: unknown;
      typ?: unknown;
    };
    if (header.alg !== 'HS256' || header.typ !== 'JWT') return null;
    const expected = hmac(`${headerPart}.${payloadPart}`, secret);
    const actual = Buffer.from(signaturePart, 'base64url');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;

    const payload = JSON.parse(
      Buffer.from(payloadPart, 'base64url').toString('utf8'),
    ) as Partial<AccessClaims>;
    const nowSeconds = Math.floor(nowMs / 1000);
    if (
      typeof payload.sub !== 'string' ||
      typeof payload.role !== 'string' ||
      payload.iss !== TOKEN_ISSUER ||
      typeof payload.iat !== 'number' ||
      typeof payload.exp !== 'number' ||
      payload.exp <= nowSeconds ||
      payload.iat > nowSeconds + 60
    ) {
      return null;
    }
    return payload as AccessClaims;
  } catch {
    return null;
  }
}

export function hashOpaqueToken(token: string, pepper: string): string {
  if (pepper.length < 32) throw new Error('Refresh token pepper must be at least 32 characters');
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function createOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function outboxKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error('Outbox encryption key must be at least 32 characters');
  return createHmac('sha256', secret).update('railgrid:outbox-token:v1').digest();
}

export function encryptOutboxSecret(value: string, secret: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', outboxKey(secret), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [nonce, cipher.getAuthTag(), ciphertext]
    .map((part) => part.toString('base64url'))
    .join('.');
}

export function decryptOutboxSecret(value: string, secret: string): string {
  const parts = value.split('.');
  if (parts.length !== 3) throw new Error('Invalid encrypted outbox secret');
  const [noncePart, tagPart, ciphertextPart] = parts;
  if (!noncePart || !tagPart || !ciphertextPart) throw new Error('Invalid encrypted outbox secret');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    outboxKey(secret),
    Buffer.from(noncePart, 'base64url'),
  );
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

export function classifyRefreshState(
  state: RefreshState,
  now = new Date(),
): 'VALID' | 'INVALID' | 'REUSE' {
  if (state.replacedBy !== null) return 'REUSE';
  if (state.revokedAt !== null || state.expiresAt.getTime() <= now.getTime()) return 'INVALID';
  return 'VALID';
}
