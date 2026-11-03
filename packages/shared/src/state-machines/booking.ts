import type { BookingStatus } from '../schemas/booking.js';

// Booking state machine transitions
// CREATED → SEATS_HELD → PAYMENT_PENDING → CONFIRMED
//                │              │              └→ CANCELLED → (refund flow)
//                ├→ EXPIRED     ├→ FAILED
//                └→ CANCELLED   └→ EXPIRED → (late payment → CONFIRMED or REFUND_DUE)

const BOOKING_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  CREATED: ['SEATS_HELD', 'CANCELLED'],
  SEATS_HELD: ['PAYMENT_PENDING', 'EXPIRED', 'CANCELLED'],
  PAYMENT_PENDING: ['CONFIRMED', 'FAILED', 'EXPIRED', 'CANCELLED'],
  CONFIRMED: ['CANCELLED'],
  CANCELLED: [], // terminal
  EXPIRED: ['CONFIRMED', 'REFUND_DUE'], // late payment path
  FAILED: ['CANCELLED'],
  REFUND_DUE: ['CANCELLED'],
};

export class BookingStateMachineError extends Error {
  constructor(
    from: BookingStatus,
    to: BookingStatus,
  ) {
    super(`Invalid booking transition: ${from} → ${to}`);
    this.name = 'BookingStateMachineError';
  }
}

export function validateBookingTransition(from: BookingStatus, to: BookingStatus): void {
  if (from === to) return; // idempotent: already in target state
  const allowed = BOOKING_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new BookingStateMachineError(from, to);
  }
}

export function isTerminalBookingStatus(status: BookingStatus): boolean {
  return BOOKING_TRANSITIONS[status].length === 0;
}
