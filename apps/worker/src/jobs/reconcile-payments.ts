/**
 * reconcile-payments — BullMQ repeatable job, every 2 minutes.
 *
 * Finds CREATED payments older than 3 minutes (dropped webhook scenario),
 * queries Razorpay for each order's status, and runs runConfirmTransaction
 * or marks FAILED as appropriate. In fixture mode (no RAZORPAY_KEY_ID),
 * logs and skips external call.
 */
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma, runConfirmTransaction } from '@railgrid/db';

export const RECONCILE_PAYMENTS_QUEUE = 'reconcile-payments';

interface StalePayment {
  id: string;
  booking_id: string;
  gateway_order_id: string;
  gateway_payment_id: string | null;
  amount_paise: number;
  created_at: Date;
}

async function fetchRazorpayOrderPayments(
  orderId: string,
  keyId: string,
  keySecret: string,
): Promise<{ id: string; amount: number; status: string } | null> {
  try {
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { items?: Array<{ id: string; amount: number; status: string }> };
    // Return most recent captured payment if any
    return data.items?.find((p) => p.status === 'captured') ?? null;
  } catch {
    return null;
  }
}

export const reconcilePaymentsProcessor =
  (keyId: string | undefined, keySecret: string | undefined, logger: Logger): Processor =>
  async (_job) => {
    const threeMinutesAgo = new Date(Date.now() - 3 * 60_000);
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60_000);

    const stale = await prisma.$queryRaw<StalePayment[]>`
      SELECT p.id, p.booking_id, p.gateway_order_id, p.gateway_payment_id, p.amount_paise, p.created_at
      FROM payments p
      WHERE p.status = 'CREATED'
        AND p.created_at < ${threeMinutesAgo}
      LIMIT 50`;

    let healed = 0;
    let failed = 0;

    for (const payment of stale) {
      try {
        if (!keyId || !keySecret) {
          // Fixture mode — log and skip external call
          logger.info(
            { paymentId: payment.id, orderId: payment.gateway_order_id },
            'reconcile-payments: fixture mode, skipping Razorpay check',
          );
          continue;
        }

        const captured = await fetchRazorpayOrderPayments(payment.gateway_order_id, keyId, keySecret);
        if (captured) {
          const result = await runConfirmTransaction(
            payment.booking_id,
            captured.id,
            payment.gateway_order_id,
            captured.amount,
          );
          logger.info({ paymentId: payment.id, result }, 'reconcile-payments: healed');
          healed++;
        } else {
          // Stale for > 15 min — alert
          if (payment.created_at < fifteenMinutesAgo) {
            logger.error(
              { paymentId: payment.id, orderId: payment.gateway_order_id, age: Date.now() - payment.created_at.getTime() },
              'reconcile-payments: payment unresolved > 15 min — ALERT',
            );
          }
        }
      } catch (err) {
        logger.error({ err, paymentId: payment.id }, 'reconcile-payments: error healing payment');
        failed++;
      }
    }

    return { processed: stale.length, healed, failed };
  };

export function createReconcileWorker(
  connection: Redis,
  keyId: string | undefined,
  keySecret: string | undefined,
  logger: Logger,
): Worker {
  return new Worker(RECONCILE_PAYMENTS_QUEUE, reconcilePaymentsProcessor(keyId, keySecret, logger), {
    connection,
    concurrency: 1,
  });
}
