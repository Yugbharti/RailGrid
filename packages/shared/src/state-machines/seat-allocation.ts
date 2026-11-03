import type { SeatAllocationStatus } from '../schemas/booking.js';

// Seat alloc: HELD → CONFIRMED | RELEASED | EXPIRED

const SEAT_ALLOCATION_TRANSITIONS: Record<SeatAllocationStatus, SeatAllocationStatus[]> = {
  HELD: ['CONFIRMED', 'RELEASED', 'EXPIRED'],
  CONFIRMED: ['RELEASED'], // on cancellation
  RELEASED: [],
  EXPIRED: [],
};

export class SeatAllocationStateMachineError extends Error {
  constructor(
    from: SeatAllocationStatus,
    to: SeatAllocationStatus,
  ) {
    super(`Invalid seat allocation transition: ${from} → ${to}`);
    this.name = 'SeatAllocationStateMachineError';
  }
}

export function validateSeatAllocationTransition(
  from: SeatAllocationStatus,
  to: SeatAllocationStatus,
): void {
  if (from === to) return;
  const allowed = SEAT_ALLOCATION_TRANSITIONS[from];
  if (!allowed || !allowed.includes(to)) {
    throw new SeatAllocationStateMachineError(from, to);
  }
}
