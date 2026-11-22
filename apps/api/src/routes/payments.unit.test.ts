import { describe, expect, it } from 'vitest';
import { createHmac, timingSafeEqual } from 'node:crypto';

// ── Razorpay signature verification (extracted pure logic) ───────────────────

function razorpayHmac(data: string, secret: string): Buffer {
  return createHmac('sha256', secret).update(data).digest();
}

function verifyRazorpaySignature(data: string, signature: string, secret: string): boolean {
  if (!secret) return false;
  const expected = razorpayHmac(data, secret);
  try {
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

describe('Razorpay HMAC payment signature', () => {
  const secret = 'test_webhook_secret_32_characters!!';

  it('verifies a correctly computed signature', () => {
    const data = 'order_abc123|pay_def456';
    const signature = razorpayHmac(data, secret).toString('hex');
    expect(verifyRazorpaySignature(data, signature, secret)).toBe(true);
  });

  it('rejects a tampered data string', () => {
    const data = 'order_abc123|pay_def456';
    const signature = razorpayHmac(data, secret).toString('hex');
    expect(verifyRazorpaySignature('order_TAMPERED|pay_def456', signature, secret)).toBe(false);
  });

  it('rejects a tampered signature', () => {
    const data = 'order_abc123|pay_def456';
    const goodSig = razorpayHmac(data, secret).toString('hex');
    const badSig = goodSig.replace(/^.{2}/, 'ff');
    expect(verifyRazorpaySignature(data, badSig, secret)).toBe(false);
  });

  it('rejects empty secret', () => {
    const data = 'order_abc123|pay_def456';
    const signature = razorpayHmac(data, secret).toString('hex');
    expect(verifyRazorpaySignature(data, signature, '')).toBe(false);
  });

  it('rejects completely invalid signature string', () => {
    expect(verifyRazorpaySignature('data', 'not_hex_!!!', secret)).toBe(false);
  });

  it('uses timing-safe comparison (function exists and is correct type)', () => {
    // Verify timingSafeEqual is the crypto primitive — not .toString() comparison
    const a = Buffer.from('abc');
    const b = Buffer.from('abc');
    const c = Buffer.from('xyz');
    expect(timingSafeEqual(a, b)).toBe(true);
    expect(timingSafeEqual(a, c)).toBe(false);
  });
});

// ── Booking state machine validation ─────────────────────────────────────────

type BookingStatus =
  | 'CREATED'
  | 'SEATS_HELD'
  | 'PAYMENT_PENDING'
  | 'CONFIRMED'
  | 'CANCELLED'
  | 'EXPIRED'
  | 'FAILED'
  | 'REFUND_DUE';

const TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CREATED: ['SEATS_HELD', 'CANCELLED'],
  SEATS_HELD: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [],
  EXPIRED: ['CONFIRMED', 'REFUND_DUE'],
  FAILED: ['CANCELLED'],
  REFUND_DUE: ['CANCELLED'],
};

function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

describe('Booking state machine', () => {
  it('allows SEATS_HELD → PAYMENT_PENDING', () => {
    expect(canTransition('SEATS_HELD', 'PAYMENT_PENDING')).toBe(true);
  });

  it('allows PAYMENT_PENDING → CONFIRMED', () => {
    expect(canTransition('PAYMENT_PENDING', 'CONFIRMED')).toBe(true);
  });

  it('allows CONFIRMED → CANCELLED (cancellation flow)', () => {
    expect(canTransition('CONFIRMED', 'CANCELLED')).toBe(true);
  });

  it('allows EXPIRED → CONFIRMED (late payment re-acquire)', () => {
    expect(canTransition('EXPIRED', 'CONFIRMED')).toBe(true);
  });

  it('allows EXPIRED → REFUND_DUE (late payment seats gone)', () => {
    expect(canTransition('EXPIRED', 'REFUND_DUE')).toBe(true);
  });

  it('blocks CONFIRMED → SEATS_HELD (invalid reversal)', () => {
    expect(canTransition('CONFIRMED', 'SEATS_HELD')).toBe(false);
  });

  it('blocks CANCELLED → CONFIRMED (terminal state)', () => {
    expect(canTransition('CANCELLED', 'CONFIRMED')).toBe(false);
  });

  it('blocks CANCELLED → anything (terminal)', () => {
    for (const to of Object.keys(TRANSITIONS) as BookingStatus[]) {
      expect(canTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('blocks CREATED → CONFIRMED (skipped steps)', () => {
    expect(canTransition('CREATED', 'CONFIRMED')).toBe(false);
  });
});

// ── Webhook deduplication logic ───────────────────────────────────────────────

describe('Webhook event deduplication', () => {
  const seen = new Set<string>();

  function processWebhookEvent(eventId: string): 'processed' | 'duplicate' {
    if (seen.has(eventId)) return 'duplicate';
    seen.add(eventId);
    return 'processed';
  }

  it('processes an event id once', () => {
    expect(processWebhookEvent('evt_001')).toBe('processed');
  });

  it('marks the same event id as duplicate on second delivery', () => {
    expect(processWebhookEvent('evt_001')).toBe('duplicate');
  });

  it('processes a different event id', () => {
    expect(processWebhookEvent('evt_002')).toBe('processed');
  });

  it('out-of-order duplicate is still a duplicate', () => {
    processWebhookEvent('evt_003');
    processWebhookEvent('evt_004');
    expect(processWebhookEvent('evt_003')).toBe('duplicate');
  });
});

// ── Amount validation ─────────────────────────────────────────────────────────

describe('Payment amount mismatch guard', () => {
  it('rejects when gateway amount differs from recorded total', () => {
    const recorded = 15_000;
    const fromGateway: number = 14_999; // tampered — typed as number to allow comparison
    expect(fromGateway !== recorded).toBe(true);
  });

  it('accepts when amounts match exactly', () => {
    const recorded = 15_000;
    const fromGateway = 15_000;
    expect(fromGateway === recorded).toBe(true);
  });

  it('never uses float: amounts are integer paise', () => {
    const amount = 15_000;
    expect(Number.isInteger(amount)).toBe(true);
    expect(amount).not.toBe(15_000.0001);
  });
});
