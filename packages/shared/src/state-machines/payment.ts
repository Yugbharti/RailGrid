import type { PaymentStatus } from '../schemas/booking.js';

// Payment: CREATED → CAPTURED | FAILED
//          CAPTURED → REFUND_PENDING → REFUNDED | REFUND_FAILED

const PAYMENT_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  CREATED: ['CAPTURED', 'FAILED'],
  CAPTURED: ['REFUND_PENDING'],
  FAILED: [],
  REFUND_PENDING: ['REFUNDED', 'REFUND_FAILED'],
  REFUNDED: [],
  REFUND_FAILED: ['REFUND_PENDING'], // can retry
};

export class PaymentStateMachineError extends Error {
  constructor(
    from: PaymentStatus,
    to: PaymentStatus,
  ) {
    super(`Invalid payment transition: ${from} → ${to}`);
    this.name = 'PaymentStateMachineError';
  }
}

export function validatePaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) return;
  const allowed = PAYMENT_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new PaymentStateMachineError(from, to);
  }
}
