/**
 * process-refund — BullMQ worker job
 *
 * Processes REFUND_PENDING refund records by calling the Razorpay refund API.
 * Idempotent via gateway_refund_id UNIQUE constraint.
 * On failure: retries with exponential backoff (via BullMQ attempts).
 * In fixture mode (no RAZORPAY_KEY_ID): marks REFUNDED immediately.
 */
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma } from '@railgrid/db';

export const PROCESS_REFUND_QUEUE = 'process-refund';

interface RefundRow {
  id: bigint;
  payment_id: string;
  amount_paise: number;
  gateway_refund_id: string | null;
  gateway_order_id: string;
  gateway_payment_id: string | null;
  booking_id: string;
}

async function issueRazorpayRefund(
  paymentId: string,
  amountPaise: number,
  keyId: string,
  keySecret: string,
): Promise<{ id: string } | null> {
  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: amountPaise }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Razorpay refund API error ${res.status}: ${body}`);
    }
    return (await res.json()) as { id: string };
  } catch (err) {
    throw err;
  }
}

export const processRefundProcessor =
  (keyId: string | undefined, keySecret: string | undefined, logger: Logger): Processor<{ refundId: string }> =>
  async (job) => {
    const refundId = BigInt(job.data.refundId);

    const rows = await prisma.$queryRaw<RefundRow[]>`
      SELECT r.id, r.payment_id, r.amount_paise, r.gateway_refund_id,
             p.gateway_order_id, p.gateway_payment_id, p.booking_id
      FROM refunds r
      JOIN payments p ON p.id = r.payment_id
      WHERE r.id = ${refundId} AND r.status = 'REFUND_PENDING'`;

    if (!rows.length) {
      logger.info({ refundId: String(refundId) }, 'process-refund: refund already processed or not found');
      return { skipped: true };
    }

    const refund = rows[0]!;

    // Fixture mode — immediately mark as REFUNDED without calling Razorpay
    if (!keyId || !keySecret || !refund.gateway_payment_id) {
      logger.info(
        { refundId: String(refundId), amountPaise: refund.amount_paise },
        'process-refund: fixture mode — marking REFUNDED without gateway call',
      );
      await prisma.$transaction([
        prisma.refund.update({
          where: { id: refundId },
          data: { status: 'REFUNDED', gatewayRefundId: `mock_refund_${String(refundId)}`, updatedAt: new Date() },
        }),
        prisma.payment.update({
          where: { id: refund.payment_id },
          data: { status: 'REFUNDED', updatedAt: new Date() },
        }),
        prisma.auditLog.create({
          data: {
            actor: 'system',
            entity: 'refund',
            entityId: refund.booking_id,
            fromState: 'REFUND_PENDING',
            toState: 'REFUNDED',
            reason: 'fixture_mode_auto_refund',
          },
        }),
      ]);
      return { refunded: true, fixture: true };
    }

    // Live mode — call Razorpay
    const result = await issueRazorpayRefund(refund.gateway_payment_id, refund.amount_paise, keyId, keySecret);
    if (!result) throw new Error('Razorpay refund returned null response');

    // Persist — uniqueness on gateway_refund_id prevents double refund
    await prisma.$transaction([
      prisma.refund.update({
        where: { id: refundId },
        data: { status: 'REFUNDED', gatewayRefundId: result.id, updatedAt: new Date() },
      }),
      prisma.payment.update({
        where: { id: refund.payment_id },
        data: { status: 'REFUNDED', updatedAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actor: 'system',
          entity: 'refund',
          entityId: refund.booking_id,
          fromState: 'REFUND_PENDING',
          toState: 'REFUNDED',
          reason: 'razorpay_refund_issued',
        },
      }),
    ]);

    logger.info({ refundId: String(refundId), gatewayRefundId: result.id }, 'process-refund: success');
    return { refunded: true, gatewayRefundId: result.id };
  };

export function createProcessRefundWorker(
  connection: Redis,
  keyId: string | undefined,
  keySecret: string | undefined,
  logger: Logger,
): Worker {
  return new Worker(PROCESS_REFUND_QUEUE, processRefundProcessor(keyId, keySecret, logger), {
    connection,
    concurrency: 3,
  });
}
