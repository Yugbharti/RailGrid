import { z } from 'zod';

export const classCodeSchema = z.enum(['SL', '3A', '2A', 'CC']);
export type ClassCode = z.infer<typeof classCodeSchema>;

export const berthTypeSchema = z.enum(['LB', 'MB', 'UB', 'SL', 'SU', 'WINDOW', 'AISLE']);
export type BerthType = z.infer<typeof berthTypeSchema>;

export const bookingStatusSchema = z.enum([
  'CREATED',
  'SEATS_HELD',
  'PAYMENT_PENDING',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
  'FAILED',
  'REFUND_DUE',
]);
export type BookingStatus = z.infer<typeof bookingStatusSchema>;

export const paymentStatusSchema = z.enum([
  'CREATED',
  'CAPTURED',
  'FAILED',
  'REFUND_PENDING',
  'REFUNDED',
  'REFUND_FAILED',
]);
export type PaymentStatus = z.infer<typeof paymentStatusSchema>;

export const seatAllocationStatusSchema = z.enum(['HELD', 'CONFIRMED', 'RELEASED', 'EXPIRED']);
export type SeatAllocationStatus = z.infer<typeof seatAllocationStatusSchema>;

export const passengerSchema = z.object({
  name: z.string().min(1).max(100),
  age: z.number().int().min(1).max(150),
  gender: z.enum(['M', 'F', 'O']),
});
export type Passenger = z.infer<typeof passengerSchema>;

export const createBookingSchema = z.object({
  runId: z.string(),
  fromIdx: z.number().int().min(0),
  toIdx: z.number().int().min(1),
  classCode: classCodeSchema,
  passengers: z.array(passengerSchema).min(1).max(6),
  seatIds: z.array(z.string()).optional(), // specific seat picks
});
export type CreateBookingInput = z.infer<typeof createBookingSchema>;
