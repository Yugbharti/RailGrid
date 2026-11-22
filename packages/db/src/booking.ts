/**
 * Shared booking confirmation transaction logic.
 * Used by: payments/verify path, Razorpay webhook, and reconciler worker.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './client.js';

export type ConfirmResult = 'CONFIRMED' | 'ALREADY_CONFIRMED' | 'REFUND_DUE' | 'FAILED';

/** Confirm a captured payment — atomic, idempotent, shared by verify/webhook/reconciler */
export async function runConfirmTransaction(
  bookingId: string,
  gatewayPaymentId: string,
  gatewayOrderId: string,
  capturedAmountPaise: number,
): Promise<ConfirmResult> {
  return prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findFirst({
        where: { id: bookingId },
        select: {
          id: true,
          status: true,
          totalPaise: true,
          runId: true,
          fromIdx: true,
          toIdx: true,
          classCode: true,
        },
      });
      if (!booking) return 'FAILED';

      if (booking.status === 'CONFIRMED') return 'ALREADY_CONFIRMED';

      // Amount check: never trust the gateway — verify our own total
      if (capturedAmountPaise !== booking.totalPaise) {
        await tx.payment.updateMany({
          where: { bookingId, gatewayOrderId },
          data: {
            status: 'FAILED',
            failureReason: `Amount mismatch: got ${capturedAmountPaise}, expected ${booking.totalPaise}`,
            updatedAt: new Date(),
          },
        });
        await tx.auditLog.create({
          data: {
            actor: 'system',
            entity: 'payment',
            entityId: bookingId,
            fromState: 'CREATED',
            toState: 'FAILED',
            reason: 'amount_mismatch',
          },
        });
        return 'FAILED';
      }

      if (booking.status === 'SEATS_HELD' || booking.status === 'PAYMENT_PENDING') {
        await tx.$executeRaw`
          UPDATE seat_allocations SET status = 'CONFIRMED', hold_expires_at = NULL, updated_at = now()
          WHERE booking_id = ${bookingId}::uuid AND status IN ('HELD','CONFIRMED')`;
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'CONFIRMED', holdExpiresAt: null, updatedAt: new Date() },
        });
        await tx.payment.updateMany({
          where: { bookingId, gatewayOrderId },
          data: { status: 'CAPTURED', gatewayPaymentId, updatedAt: new Date() },
        });
        await tx.outboxEvent.create({
          data: {
            type: 'booking.confirmed',
            aggregateId: bookingId,
            payload: { bookingId, gatewayPaymentId } as Prisma.InputJsonObject,
          },
        });
        await tx.auditLog.create({
          data: {
            actor: 'system',
            entity: 'booking',
            entityId: bookingId,
            fromState: booking.status,
            toState: 'CONFIRMED',
            reason: 'payment_captured',
          },
        });
        return 'CONFIRMED';
      }

      if (booking.status === 'EXPIRED') {
        const runId = booking.runId;
        const existing = await tx.$queryRaw<Array<{ seat_id: bigint }>>`
          SELECT seat_id FROM seat_allocations WHERE booking_id = ${bookingId}::uuid`;
        const seatIds = existing
          .map((r) => r.seat_id)
          .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

        if (seatIds.length > 0) {
          const free = await tx.$queryRaw<Array<{ id: bigint }>>`
            SELECT s.id FROM seats s WHERE s.id = ANY(${seatIds}::bigint[])
            AND NOT EXISTS (
              SELECT 1 FROM seat_allocations a
              WHERE a.run_id = ${runId} AND a.seat_id = s.id
                AND a.status IN ('HELD','CONFIRMED')
                AND int4range(a.from_idx, a.to_idx) && int4range(${booking.fromIdx}::int, ${booking.toIdx}::int)
            )
            ORDER BY s.id FOR UPDATE SKIP LOCKED`;

          if (free.length === seatIds.length) {
            await tx.$executeRaw`
              INSERT INTO seat_allocations (run_id, seat_id, booking_id, from_idx, to_idx, status, hold_expires_at, created_at, updated_at)
              SELECT ${runId}, s.id, ${bookingId}::uuid, ${booking.fromIdx}, ${booking.toIdx}, 'CONFIRMED', NULL, now(), now()
              FROM seats s WHERE s.id = ANY(${seatIds}::bigint[])
              ON CONFLICT DO NOTHING`;
            await tx.booking.update({
              where: { id: bookingId },
              data: { status: 'CONFIRMED', holdExpiresAt: null, updatedAt: new Date() },
            });
            await tx.payment.updateMany({
              where: { bookingId, gatewayOrderId },
              data: { status: 'CAPTURED', gatewayPaymentId, updatedAt: new Date() },
            });
            await tx.outboxEvent.create({
              data: {
                type: 'booking.confirmed',
                aggregateId: bookingId,
                payload: {
                  bookingId,
                  gatewayPaymentId,
                  latePayment: true,
                } as Prisma.InputJsonObject,
              },
            });
            await tx.auditLog.create({
              data: {
                actor: 'system',
                entity: 'booking',
                entityId: bookingId,
                fromState: 'EXPIRED',
                toState: 'CONFIRMED',
                reason: 'late_payment_re_acquired',
              },
            });
            return 'CONFIRMED';
          }
        }

        // Seats gone — mark REFUND_DUE
        await tx.payment.updateMany({
          where: { bookingId, gatewayOrderId },
          data: { status: 'CAPTURED', gatewayPaymentId, updatedAt: new Date() },
        });
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'REFUND_DUE', updatedAt: new Date() },
        });
        await tx.outboxEvent.create({
          data: {
            type: 'booking.refund_due',
            aggregateId: bookingId,
            payload: {
              bookingId,
              reason: 'late_payment_seats_gone',
            } as Prisma.InputJsonObject,
          },
        });
        await tx.auditLog.create({
          data: {
            actor: 'system',
            entity: 'booking',
            entityId: bookingId,
            fromState: 'EXPIRED',
            toState: 'REFUND_DUE',
            reason: 'late_payment_no_seats',
          },
        });
        return 'REFUND_DUE';
      }

      return 'FAILED';
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
  );
}
