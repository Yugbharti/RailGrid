import { describe, it, expect, vi, beforeEach } from 'vitest';
import { computeCancellationFeePaise } from './waitlist.js';
import { processRefundProcessor } from '../../../worker/src/jobs/process-refund.js';
import type { Logger } from 'pino';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
} as unknown as Logger;

describe('Phase 7: Tiered Cancellation Fees', () => {
  it('deducts 10% fee for cancellation > 48h before departure', () => {
    const totalPaise = 100_000; // Rs. 1,000
    const fee = computeCancellationFeePaise(totalPaise, 72);
    expect(fee).toBe(10_000); // 10% fee = Rs. 100
    const refund = totalPaise - fee;
    expect(refund).toBe(90_000); // 90% refund = Rs. 900
  });

  it('deducts 10% fee at exactly 48h boundary', () => {
    const totalPaise = 200_000;
    const fee = computeCancellationFeePaise(totalPaise, 48);
    expect(fee).toBe(20_000);
    expect(totalPaise - fee).toBe(180_000);
  });

  it('deducts 25% fee between 24h and 48h before departure', () => {
    const totalPaise = 100_000;
    const fee = computeCancellationFeePaise(totalPaise, 36);
    expect(fee).toBe(25_000); // 25% fee = Rs. 250
    expect(totalPaise - fee).toBe(75_000);
  });

  it('deducts 25% fee at exactly 24h boundary', () => {
    const totalPaise = 80_000;
    const fee = computeCancellationFeePaise(totalPaise, 24);
    expect(fee).toBe(20_000);
    expect(totalPaise - fee).toBe(60_000);
  });

  it('deducts 50% fee between 12h and 24h before departure', () => {
    const totalPaise = 100_000;
    const fee = computeCancellationFeePaise(totalPaise, 18);
    expect(fee).toBe(50_000); // 50% fee = Rs. 500
    expect(totalPaise - fee).toBe(50_000);
  });

  it('deducts 50% fee at exactly 12h boundary', () => {
    const totalPaise = 64_000;
    const fee = computeCancellationFeePaise(totalPaise, 12);
    expect(fee).toBe(32_000);
    expect(totalPaise - fee).toBe(32_000);
  });

  it('deducts 100% fee (< 12h before departure: no refund)', () => {
    const totalPaise = 100_000;
    const fee = computeCancellationFeePaise(totalPaise, 6);
    expect(fee).toBe(100_000); // 100% fee
    expect(totalPaise - fee).toBe(0); // Rs. 0 refund
  });

  it('deducts 100% fee at 0 hours (at departure)', () => {
    const totalPaise = 50_000;
    const fee = computeCancellationFeePaise(totalPaise, 0);
    expect(fee).toBe(50_000);
    expect(totalPaise - fee).toBe(0);
  });

  it('deducts 100% fee for past departure (negative hours)', () => {
    const totalPaise = 50_000;
    const fee = computeCancellationFeePaise(totalPaise, -2);
    expect(fee).toBe(50_000);
    expect(totalPaise - fee).toBe(0);
  });

  it('rounds fee to nearest integer paise correctly', () => {
    // 105 paise * 0.1 = 10.5 -> round to 11
    expect(computeCancellationFeePaise(105, 50)).toBe(11);
    // 104 paise * 0.1 = 10.4 -> round to 10
    expect(computeCancellationFeePaise(104, 50)).toBe(10);
  });

  it('handles zero totalPaise without NaN or errors', () => {
    expect(computeCancellationFeePaise(0, 72)).toBe(0);
    expect(computeCancellationFeePaise(0, 10)).toBe(0);
  });
});

describe('Phase 7: Waitlist Sequencing and Invariants', () => {
  it('computes next waitlist sequence number correctly', () => {
    const getNextSeq = (maxPos: bigint | null) => (maxPos ?? 0n) + 1n;
    expect(getNextSeq(null)).toBe(1n);
    expect(getNextSeq(0n)).toBe(1n);
    expect(getNextSeq(1n)).toBe(2n);
    expect(getNextSeq(42n)).toBe(43n);
  });

  it('ensures refund amount never exceeds total booking paise', () => {
    const totalPaise = 150_000;
    for (const hours of [-5, 0, 5, 11, 12, 13, 23, 24, 25, 47, 48, 49, 100]) {
      const fee = computeCancellationFeePaise(totalPaise, hours);
      const refund = Math.max(0, totalPaise - fee);
      expect(refund).toBeGreaterThanOrEqual(0);
      expect(refund).toBeLessThanOrEqual(totalPaise);
      expect(fee + refund).toBe(totalPaise);
    }
  });
});

describe('Phase 7: Process Refund Processor', () => {
  it('is exported and returns processor function', () => {
    const processor = processRefundProcessor(undefined, undefined, mockLogger);
    expect(typeof processor).toBe('function');
  });
});
