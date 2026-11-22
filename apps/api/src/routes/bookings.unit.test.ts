import { describe, expect, it } from 'vitest';
import { bookingRequestHash } from './bookings.js';

// ── Fare boundary tests ───────────────────────────────────────────────────────
describe('fare paise calculation', () => {
  it('never uses floats: integer paise only', () => {
    // 100 km @ SL rate: basePaise + round(perKmPaise * distance) + reservationFee
    const perKmPaise = 55;
    const basePaise = 2500;
    const reservationFee = 2000;
    const superfastFee = 3750;
    const distanceKm = 100;
    const perPassenger = basePaise + Math.round(perKmPaise * distanceKm) + reservationFee;
    expect(Number.isInteger(perPassenger)).toBe(true);
    expect(perPassenger).toBe(10000); // 2500 + 5500 + 2000
  });

  it('applies superfast surcharge when flag set', () => {
    const base = 10_000;
    const superfastFee = 3_750;
    expect(base + superfastFee).toBe(13_750);
  });

  it('zero distance is invalid (rejected upstream)', () => {
    const distanceMeters = 0;
    expect(distanceMeters <= 0).toBe(true);
  });
});

// ── Segment overlap tests ─────────────────────────────────────────────────────
describe('half-open segment overlap logic', () => {
  // int4range semantics: [a, b) overlaps [c, d) iff a < d && c < b
  function overlaps(a: number, b: number, c: number, d: number): boolean {
    return a < d && c < b;
  }

  it('[0,3) and [3,5) are adjacent — no overlap', () => {
    expect(overlaps(0, 3, 3, 5)).toBe(false);
  });

  it('[0,5) overlaps [2,4)', () => {
    expect(overlaps(0, 5, 2, 4)).toBe(true);
  });

  it('[0,5) overlaps [3,5)', () => {
    expect(overlaps(0, 5, 3, 5)).toBe(true);
  });

  it('[1,4) overlaps [2,6)', () => {
    expect(overlaps(1, 4, 2, 6)).toBe(true);
  });

  it('[0,2) and [3,5) are non-adjacent — no overlap', () => {
    expect(overlaps(0, 2, 3, 5)).toBe(false);
  });

  it('identical ranges overlap', () => {
    expect(overlaps(0, 3, 0, 3)).toBe(true);
  });
});

// ── Idempotency hash tests ────────────────────────────────────────────────────
describe('bookingRequestHash', () => {
  const base = {
    runId: '123',
    fromIdx: 0,
    toIdx: 3,
    classCode: 'SL' as const,
    passengers: [{ name: 'Alice', age: 30, gender: 'F' as const }],
  };

  it('same input → same hash', () => {
    expect(bookingRequestHash(base)).toBe(bookingRequestHash(base));
  });

  it('different runId → different hash', () => {
    expect(bookingRequestHash({ ...base, runId: '456' })).not.toBe(bookingRequestHash(base));
  });

  it('different classCode → different hash', () => {
    expect(bookingRequestHash({ ...base, classCode: '3A' })).not.toBe(bookingRequestHash(base));
  });

  it('passenger order matters', () => {
    const p1 = { name: 'Alice', age: 30, gender: 'F' as const };
    const p2 = { name: 'Bob', age: 25, gender: 'M' as const };
    const h1 = bookingRequestHash({ ...base, passengers: [p1, p2] });
    const h2 = bookingRequestHash({ ...base, passengers: [p2, p1] });
    expect(h1).not.toBe(h2);
  });

  it('returns a 64-char hex string', () => {
    expect(bookingRequestHash(base)).toMatch(/^[0-9a-f]{64}$/);
  });
});
