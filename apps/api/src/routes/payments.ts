/**
 * Phase 5 â€” Payments
 *
 * Implements:
 *   POST /v1/bookings/:id/pay          â†’ create Razorpay order, extend hold once
 *   POST /v1/payments/verify           â†’ optimistic HMAC verify (browser redirect path)
 *   POST /v1/webhooks/razorpay         â†’ source-of-truth webhook (raw body, signature)
 *   GET  /v1/bookings/:id              â†’ booking detail with seats, passengers, payment
 *   GET  /v1/bookings                  â†’ user's bookings list
 *   POST /v1/bookings/:id/cancel       â†’ cancel + release seats (waitlist promotion deferred to Phase 7)
 *
 * Security rules enforced:
 *   - Amount/status NEVER trusted from client â€” always from DB
 *   - Webhook verified on raw body before parsing
 *   - Duplicate webhook events ignored via payment_events.gateway_event_id UNIQUE
 *   - Late payment (booking EXPIRED) â†’ re-acquire seats or auto-refund via REFUND_DUE
 *   - All mutating endpoints require Idempotency-Key (UUID v4)
 */
import { createHash, createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma, runConfirmTransaction } from '@railgrid/db';
import { ERROR_CODES } from '@railgrid/shared';
import { authenticate } from '../auth/guard.js';

export { runConfirmTransaction };

// â”€â”€ Shared utilities â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

class PaymentError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(status: number, code: string, message: string): never {
  throw new PaymentError(status, code, message);
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

/** Verify Razorpay HMAC-SHA256 signature using timing-safe compare */
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

// â”€â”€ Idempotency helper (reusable for pay / cancel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function checkIdempotency(
  userId: string,
  key: string,
  endpoint: string,
  requestHash: string,
): Promise<{ replay: true; statusCode: number; body: unknown } | { replay: false }> {
  try {
    await prisma.idempotencyKey.create({
      data: { userId, key, endpoint, requestHash },
    });
    return { replay: false };
  } catch (error) {
    if (prismaCode(error) === 'P2002') {
      const prior = await prisma.idempotencyKey.findUnique({
        where: { userId_key: { userId, key } },
      });
      if (prior) {
        if (prior.endpoint !== endpoint || prior.requestHash !== requestHash)
          fail(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, 'This idempotency key was used for a different request.');
        if (prior.status !== 'COMPLETED' || !prior.responseBody)
          fail(409, ERROR_CODES.REQUEST_IN_PROGRESS, 'A request with this key is still being processed.');
        return { replay: true, statusCode: prior.responseCode ?? 200, body: prior.responseBody };
      }
    }
    throw error;
  }
}

async function completeIdempotency(
  userId: string,
  key: string,
  responseCode: number,
  responseBody: Prisma.InputJsonObject,
) {
  await prisma.idempotencyKey.update({
    where: { userId_key: { userId, key } },
    data: { status: 'COMPLETED', responseCode, responseBody },
  });
}

function requireIdempotencyKey(request: FastifyRequest): string {
  const key = request.headers['idempotency-key'];
  if (
    typeof key !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)
  ) {
    fail(400, ERROR_CODES.VALIDATION_ERROR, 'A UUID v4 Idempotency-Key header is required.');
  }
  return key;
}

// â”€â”€ Razorpay mock / abstraction â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// In test/fixture mode (no RAZORPAY_KEY_ID set) we return a deterministic mock order.

interface RazorpayOrder {
  id: string;
  amount: number;
  currency: string;
  receipt: string;
  status: string;
}

async function createRazorpayOrder(
  amountPaise: number,
  receipt: string,
  keyId: string,
  keySecret: string,
): Promise<RazorpayOrder> {
  if (!keyId || !keySecret) {
    // Test/fixture mode: return a deterministic mock order
    return {
      id: `order_mock_${createHash('sha256').update(receipt).digest('hex').slice(0, 14)}`,
      amount: amountPaise,
      currency: 'INR',
      receipt,
      status: 'created',
    };
  }
  const credentials = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const response = await fetch('https://api.razorpay.com/v1/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Basic ${credentials}` },
    body: JSON.stringify({ amount: amountPaise, currency: 'INR', receipt }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    const text = await response.text();
    fail(502, ERROR_CODES.SERVICE_UNAVAILABLE, `Payment gateway error: ${text.slice(0, 200)}`);
  }
  return response.json() as Promise<RazorpayOrder>;
}

// â”€â”€ Route registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export async function paymentRoutes(app: FastifyInstance) {
  const env = app.env;
  const PAYMENT_EXTENSION_SECONDS = env.PAYMENT_EXTENSION_SECONDS ?? 300;

  // â”€â”€ GET /v1/bookings â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get('/bookings', { preHandler: authenticate }, async (request, reply) => {
    const userId = request.authUser!.sub;
    const bookings = await prisma.booking.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true, pnr: true, runId: true, fromIdx: true, toIdx: true,
        classCode: true, status: true, totalPaise: true, holdExpiresAt: true, createdAt: true,
        run: { select: { trainNumber: true, journeyDate: true } },
        passengers: { select: { name: true, age: true, gender: true, status: true } },
      },
    });
    return reply.send({ bookings: bookings.map((b) => ({ ...b, runId: b.runId.toString() })) });
  });

  // â”€â”€ GET /v1/bookings/:id â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  app.get<{ Params: { id: string } }>(
    '/bookings/:id',
    { preHandler: authenticate },
    async (request, reply) => {
      const { id } = request.params;
      const userId = request.authUser!.sub;
      const booking = await prisma.booking.findFirst({
        where: { id },
        select: {
          id: true, pnr: true, runId: true, fromIdx: true, toIdx: true,
          classCode: true, status: true, totalPaise: true, holdExpiresAt: true, createdAt: true, updatedAt: true,
          run: { select: { trainNumber: true, journeyDate: true, train: { select: { name: true, type: true } } } },
          passengers: { select: { id: true, name: true, age: true, gender: true, status: true, seatAllocationId: true } },
          seatAllocations: { select: { id: true, seatId: true, fromIdx: true, toIdx: true, status: true, holdExpiresAt: true, seat: { select: { coach: true, seatNo: true, berthType: true } } } },
          payments: { select: { id: true, status: true, amountPaise: true, gatewayOrderId: true, createdAt: true } },
          userId: true,
        },
      });
      if (!booking) fail(404, ERROR_CODES.NOT_FOUND, 'Booking not found.');
      if (booking.userId !== userId) fail(403, ERROR_CODES.FORBIDDEN, 'You do not have access to this booking.');
      return reply.send({
        booking: {
          ...booking,
          runId: booking.runId.toString(),
          passengers: booking.passengers,
          seatAllocations: booking.seatAllocations.map((a) => ({
            ...a,
            id: a.id.toString(),
            seatId: a.seatId.toString(),
          })),
        },
      });
    },
  );

  // â”€â”€ POST /v1/bookings/:id/pay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const paySchema = z.object({});
  app.post<{ Params: { id: string }; Body: z.infer<typeof paySchema> }>(
    '/bookings/:id/pay',
    { preHandler: authenticate },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const userId = request.authUser!.sub;
      const { id: bookingId } = request.params;
      const endpoint = `POST:/v1/bookings/${bookingId}/pay`;
      const requestHash = createHash('sha256').update(`${bookingId}:${userId}`).digest('hex');

      const idem = await checkIdempotency(userId, idempotencyKey, endpoint, requestHash);
      if (idem.replay) return reply.code(idem.statusCode).send(idem.body);

      // Lock booking row & validate it belongs to this user and is holdable
      const booking = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: string; total_paise: number; hold_expires_at: Date | null; user_id: string; run_id: bigint; pnr: string }>
        >`SELECT id, status, total_paise, hold_expires_at, user_id, run_id, pnr FROM bookings WHERE id = ${bookingId} FOR UPDATE`;
        const b = rows[0];
        if (!b) fail(404, ERROR_CODES.NOT_FOUND, 'Booking not found.');
        if (b.user_id !== userId) fail(403, ERROR_CODES.FORBIDDEN, 'You do not have access to this booking.');
        if (b.status !== 'SEATS_HELD' && b.status !== 'PAYMENT_PENDING')
          fail(409, ERROR_CODES.BOOKING_EXPIRED, `Cannot initiate payment for a booking in status ${b.status}.`);
        if (b.hold_expires_at && b.hold_expires_at.getTime() <= Date.now())
          fail(409, ERROR_CODES.BOOKING_EXPIRED, 'This hold has expired. Please start a new booking.');

        // Extend hold once (max of current expiry and now + extension)
        await tx.$executeRaw`
          UPDATE bookings SET status = 'PAYMENT_PENDING',
            hold_expires_at = GREATEST(hold_expires_at, now() + make_interval(secs => ${PAYMENT_EXTENSION_SECONDS})),
            updated_at = now()
          WHERE id = ${bookingId}`;
        await tx.$executeRaw`
          UPDATE seat_allocations SET
            hold_expires_at = GREATEST(hold_expires_at, now() + make_interval(secs => ${PAYMENT_EXTENSION_SECONDS})),
            updated_at = now()
          WHERE booking_id = ${bookingId} AND status = 'HELD'`;

        return b;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      // Check for existing payment record (idempotent pay)
      const existingPayment = await prisma.payment.findFirst({
        where: { bookingId, status: { in: ['CREATED', 'CAPTURED'] } },
        select: { gatewayOrderId: true, amountPaise: true, status: true },
      });

      let orderId: string;
      if (existingPayment) {
        orderId = existingPayment.gatewayOrderId;
      } else {
        const order = await createRazorpayOrder(
          booking.total_paise,
          bookingId,
          env.RAZORPAY_KEY_ID ?? '',
          env.RAZORPAY_KEY_SECRET ?? '',
        );
        orderId = order.id;
        await prisma.payment.create({
          data: {
            id: randomUUID(),
            bookingId,
            gateway: 'razorpay',
            gatewayOrderId: orderId,
            amountPaise: booking.total_paise,
            currency: 'INR',
            status: 'CREATED',
          },
        });
        await prisma.auditLog.create({
          data: { actor: userId, entity: 'payment', entityId: bookingId, fromState: 'NONE', toState: 'CREATED', reason: 'payment_initiated' },
        });
      }

      const body = {
        orderId,
        keyId: env.RAZORPAY_KEY_ID ?? 'rzp_test_PLACEHOLDER',
        amountPaise: booking.total_paise,
        currency: 'INR',
        bookingId,
        pnr: booking.pnr,
      };
      await completeIdempotency(userId, idempotencyKey, 200, body as Prisma.InputJsonObject);
      return reply.send(body);
    },
  );

  // â”€â”€ POST /v1/payments/verify â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Optimistic UX path: browser sends signature after Razorpay checkout succeeds.
  const verifySchema = z.object({
    razorpay_payment_id: z.string().min(1),
    razorpay_order_id: z.string().min(1),
    razorpay_signature: z.string().min(1),
  });

  app.post<{ Body: z.infer<typeof verifySchema> }>(
    '/payments/verify',
    { schema: { body: verifySchema }, preHandler: authenticate },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const userId = request.authUser!.sub;
      const { razorpay_payment_id, razorpay_order_id, razorpay_signature } = request.body;
      const endpoint = 'POST:/v1/payments/verify';
      const requestHash = createHash('sha256')
        .update(`${razorpay_order_id}:${razorpay_payment_id}`)
        .digest('hex');

      const idem = await checkIdempotency(userId, idempotencyKey, endpoint, requestHash);
      if (idem.replay) return reply.code(idem.statusCode).send(idem.body);

      // Verify HMAC
      const data = `${razorpay_order_id}|${razorpay_payment_id}`;
      if (env.RAZORPAY_KEY_SECRET) {
        const valid = verifyRazorpaySignature(data, razorpay_signature, env.RAZORPAY_KEY_SECRET);
        if (!valid) fail(400, ERROR_CODES.INVALID_SIGNATURE, 'Payment signature verification failed.');
      }

      // Look up payment & verify ownership
      const payment = await prisma.payment.findFirst({
        where: { gatewayOrderId: razorpay_order_id },
        select: { id: true, bookingId: true, amountPaise: true, booking: { select: { userId: true } } },
      });
      if (!payment) fail(404, ERROR_CODES.PAYMENT_NOT_FOUND, 'Payment record not found.');
      if (payment.booking.userId !== userId) fail(403, ERROR_CODES.FORBIDDEN, 'Access denied.');

      const result = await runConfirmTransaction(
        payment.bookingId,
        razorpay_payment_id,
        razorpay_order_id,
        payment.amountPaise, // use our recorded amount, never the client amount
      );

      const body = { status: result, bookingId: payment.bookingId };
      await completeIdempotency(userId, idempotencyKey, 200, body as Prisma.InputJsonObject);
      return reply.send(body);
    },
  );

  // â”€â”€ POST /v1/webhooks/razorpay â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  // Source of truth. Raw body required for signature. Dedupes via payment_events UNIQUE.
  app.post(
    '/webhooks/razorpay',
    {
      config: { rawBody: true }, // fastify stores raw buffer in request.rawBody
      // Webhook endpoint bypasses user auth but requires signature
    },
    async (request, reply) => {
      // Always return 200 quickly; failures are logged and can be retried by Razorpay
      try {
        const signature = request.headers['x-razorpay-signature'];
        if (typeof signature !== 'string') {
          request.log.warn('Razorpay webhook: missing signature header');
          return reply.code(200).send({ ok: false, reason: 'missing_signature' });
        }

        const rawBody =
          (request as unknown as { rawBody?: Buffer }).rawBody?.toString('utf8') ??
          JSON.stringify(request.body);

        if (env.RAZORPAY_WEBHOOK_SECRET) {
          const valid = verifyRazorpaySignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET);
          if (!valid) {
            request.log.warn('Razorpay webhook: invalid signature');
            return reply.code(200).send({ ok: false, reason: 'invalid_signature' });
          }
        }

        const payload = JSON.parse(rawBody) as {
          event?: string;
          payload?: {
            payment?: { entity?: { id?: string; order_id?: string; amount?: number; status?: string } };
          };
        };

        const eventType = payload.event ?? 'unknown';
        const eventId = request.headers['x-razorpay-event-id'] as string | undefined ?? `${eventType}:${Date.now()}:${randomUUID()}`;
        const paymentEntity = payload.payload?.payment?.entity;

        // Dedupe: insert into payment_events; on conflict (duplicate event) â†’ skip
        const inserted = await prisma.$queryRaw<Array<{ id: bigint }>>`
          INSERT INTO payment_events (gateway_event_id, type, payload, processed_at)
          VALUES (${eventId}, ${eventType}, ${JSON.stringify(payload)}::jsonb, now())
          ON CONFLICT (gateway_event_id) DO NOTHING
          RETURNING id`;

        if (!inserted.length) {
          request.log.info({ eventId, eventType }, 'Razorpay webhook: duplicate event ignored');
          return reply.code(200).send({ ok: true, dedupe: true });
        }

        if (eventType === 'payment.captured' && paymentEntity?.id && paymentEntity.order_id) {
          const payment = await prisma.payment.findFirst({
            where: { gatewayOrderId: paymentEntity.order_id },
            select: { bookingId: true, amountPaise: true },
          });
          if (payment) {
            const capturedAmount = paymentEntity.amount ?? payment.amountPaise;
            const result = await runConfirmTransaction(
              payment.bookingId,
              paymentEntity.id,
              paymentEntity.order_id,
              capturedAmount,
            );
            request.log.info({ eventId, eventType, result, bookingId: payment.bookingId }, 'Webhook processed');
          }
        } else if (eventType === 'payment.failed' && paymentEntity?.order_id) {
          await prisma.payment.updateMany({
            where: { gatewayOrderId: paymentEntity.order_id, status: 'CREATED' },
            data: { status: 'FAILED', failureReason: 'payment.failed webhook', updatedAt: new Date() },
          });
          // Update booking status to FAILED if still in PAYMENT_PENDING
          const payment = await prisma.payment.findFirst({ where: { gatewayOrderId: paymentEntity.order_id }, select: { bookingId: true } });
          if (payment) {
            await prisma.booking.updateMany({
              where: { id: payment.bookingId, status: { in: ['SEATS_HELD', 'PAYMENT_PENDING'] } },
              data: { status: 'FAILED', updatedAt: new Date() },
            });
          }
        }

        return reply.code(200).send({ ok: true });
      } catch (error) {
        request.log.error({ err: error }, 'Razorpay webhook processing error');
        return reply.code(200).send({ ok: false, reason: 'processing_error' });
      }
    },
  );


  // ── POST /v1/bookings/:id/cancel ─────────────────────────────────────────
  // Phase 7: Tiered cancellation fee + atomic waitlist promotion
  app.post<{ Params: { id: string } }>(
    '/bookings/:id/cancel',
    { preHandler: authenticate },
    async (request, reply) => {
      const idempotencyKey = requireIdempotencyKey(request);
      const userId = request.authUser!.sub;
      const { id: bookingId } = request.params;
      const endpoint = `POST:/v1/bookings/${bookingId}/cancel`;
      const requestHash = createHash('sha256').update(`cancel:${bookingId}:${userId}`).digest('hex');

      const idem = await checkIdempotency(userId, idempotencyKey, endpoint, requestHash);
      if (idem.replay) return reply.code(idem.statusCode).send(idem.body);

      const result = await prisma.$transaction(async (tx) => {
        // Lock the booking row
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: string; total_paise: number; user_id: string; run_id: bigint; class_code: string; from_idx: number; to_idx: number }>
        >`SELECT id, status, total_paise, user_id, run_id, class_code, from_idx, to_idx
          FROM bookings WHERE id = ${bookingId}::uuid FOR UPDATE`;
        const b = rows[0];
        if (!b) fail(404, ERROR_CODES.NOT_FOUND, 'Booking not found.');
        if (b.user_id !== userId) fail(403, ERROR_CODES.FORBIDDEN, 'Access denied.');

        const cancellableStatuses = ['SEATS_HELD', 'PAYMENT_PENDING', 'CONFIRMED'];
        if (!cancellableStatuses.includes(b.status)) {
          if (b.status === 'CANCELLED') {
            // Already cancelled — idempotent no-op
            return { status: 'CANCELLED', refundPaise: 0, refundId: null, cancelFee: 0, alreadyCancelled: true };
          }
          fail(409, ERROR_CODES.BOOKING_EXPIRED, `Cannot cancel a booking in status ${b.status}.`);
        }

        // ── Departure check + hours until departure ──────────────────────────
        const depInfo = await tx.$queryRaw<Array<{ departed: boolean; hours_until: number }>>`
          SELECT
            ((r.journey_date + (s.departure::time + make_interval(days => s.day_offset))) <= now()) AS departed,
            GREATEST(0,
              EXTRACT(EPOCH FROM (
                (r.journey_date + (s.departure::time + make_interval(days => s.day_offset))) - now()
              )) / 3600.0
            )::float AS hours_until
          FROM bookings bk
          JOIN runs r ON r.id = bk.run_id
          JOIN train_stops s ON s.train_number = r.train_number AND s.stop_idx = bk.from_idx
          WHERE bk.id = ${bookingId}::uuid`;

        if (depInfo[0]?.departed)
          fail(409, ERROR_CODES.TRAIN_DEPARTED, 'Cancellation is not allowed after departure.');

        const hoursUntil: number = depInfo[0]?.hours_until ?? 999;

        // ── Release seat allocations ─────────────────────────────────────────
        const releasedSeats = await tx.$queryRaw<Array<{ seat_id: bigint }>>`
          UPDATE seat_allocations
          SET status = 'RELEASED', updated_at = now()
          WHERE booking_id = ${bookingId}::uuid AND status IN ('HELD','CONFIRMED')
          RETURNING seat_id`;

        // ── Cancel booking ───────────────────────────────────────────────────
        await tx.booking.update({
          where: { id: bookingId },
          data: { status: 'CANCELLED', updatedAt: new Date() },
        });

        // ── Tiered cancellation fee (agent.md § 6.4 / § 12) ─────────────────
        // > 48h: 10% fee | 24–48h: 25% | 12–24h: 50% | < 12h: 100% (no refund)
        const capturedPayment = await tx.payment.findFirst({
          where: { bookingId, status: 'CAPTURED' },
          select: { id: true, amountPaise: true },
        });

        let refundPaise = 0;
        let cancelFee = 0;
        let refundDbId: bigint | null = null;

        if (capturedPayment) {
          if (hoursUntil >= 48)      cancelFee = Math.round(capturedPayment.amountPaise * 0.10);
          else if (hoursUntil >= 24) cancelFee = Math.round(capturedPayment.amountPaise * 0.25);
          else if (hoursUntil >= 12) cancelFee = Math.round(capturedPayment.amountPaise * 0.50);
          else                       cancelFee = capturedPayment.amountPaise; // no refund

          refundPaise = capturedPayment.amountPaise - cancelFee;

          if (refundPaise > 0) {
            const refundRow = await tx.refund.create({
              data: {
                paymentId: capturedPayment.id,
                amountPaise: refundPaise,
                status: 'REFUND_PENDING',
                reason: `user_cancellation_${Math.round(hoursUntil)}h_before_departure`,
              },
            });
            refundDbId = refundRow.id;
            await tx.payment.update({
              where: { id: capturedPayment.id },
              data: { status: 'REFUND_PENDING', updatedAt: new Date() },
            });
          }
        }

        // ── Atomic waitlist promotion ────────────────────────────────────────
        // After releasing seats, check if any waitlist candidate can be promoted.
        const seatIds = releasedSeats.map((s) => s.seat_id);
        if (seatIds.length > 0) {
          // Lock the next WAITING waitlist entry FIFO by positionSeq, SKIP LOCKED for concurrency
          const nextWaiting = await tx.$queryRaw<Array<{ id: bigint; booking_id: string }>>`
            SELECT we.id, we.booking_id
            FROM waitlist_entries we
            WHERE we.run_id = ${b.run_id}
              AND we.class_code = ${b.class_code}
              AND we.status = 'WAITING'
            ORDER BY we.position_seq ASC
            LIMIT 1
            FOR UPDATE SKIP LOCKED`;

          if (nextWaiting.length > 0) {
            const candidate = nextWaiting[0]!;

            // Allocate freed seats to promoted booking
            await tx.$executeRaw`
              INSERT INTO seat_allocations
                (run_id, seat_id, booking_id, from_idx, to_idx, status, hold_expires_at, created_at, updated_at)
              SELECT ${b.run_id}, s.id, ${candidate.booking_id}::uuid,
                     ${b.from_idx}, ${b.to_idx}, 'CONFIRMED', NULL, now(), now()
              FROM seats s WHERE s.id = ANY(${seatIds}::bigint[])
              ON CONFLICT DO NOTHING`;

            // Compute fare for promoted booking using fare_rules
            const promoBooking = await tx.booking.findUnique({
              where: { id: candidate.booking_id },
              select: {
                fromIdx: true,
                toIdx: true,
                classCode: true,
                run: { select: { trainNumber: true, train: { select: { isSuperfast: true } } } },
                passengers: { select: { id: true } },
              },
            });

            if (promoBooking) {
              const fareRule = await tx.fareRule.findUnique({ where: { classCode: promoBooking.classCode } });
              const stops = await tx.trainStop.findMany({
                where: {
                  trainNumber: promoBooking.run.trainNumber,
                  stopIdx: { in: [promoBooking.fromIdx, Math.max(promoBooking.fromIdx, promoBooking.toIdx - 1)] },
                },
                select: { stopIdx: true, distanceKm: true },
              });
              const fromStop = stops.find((s) => s.stopIdx === promoBooking.fromIdx);
              const toStop   = stops.find((s) => s.stopIdx === promoBooking.toIdx - 1) ?? stops.find((s) => s.stopIdx !== promoBooking.fromIdx);
              const distKm   = Math.abs((toStop?.distanceKm ?? 0) - (fromStop?.distanceKm ?? 0));
              const perKm    = fareRule?.perKmPaise ?? 50;
              const base     = fareRule?.basePaise ?? 500;
              const resFee   = fareRule?.reservationFeePaise ?? 50;
              const sfFee    = promoBooking.run.train.isSuperfast ? (fareRule?.superfastFeePaise ?? 75) : 0;
              const count    = promoBooking.passengers.length || seatIds.length;
              const totalPaise = Math.round((base + distKm * perKm + resFee + sfFee) * count);

              await tx.booking.update({
                where: { id: candidate.booking_id },
                data: { status: 'CONFIRMED', totalPaise, updatedAt: new Date() },
              });
            }

            // Promote waitlist entry
            await tx.waitlistEntry.update({
              where: { id: candidate.id },
              data: { status: 'PROMOTED', updatedAt: new Date() },
            });

            await tx.outboxEvent.create({
              data: {
                type: 'booking.promoted_from_waitlist',
                aggregateId: candidate.booking_id,
                payload: { bookingId: candidate.booking_id, promotedFrom: bookingId } as Prisma.InputJsonObject,
              },
            });
            await tx.auditLog.create({
              data: {
                actor: 'system',
                entity: 'booking',
                entityId: candidate.booking_id,
                fromState: 'WAITLISTED',
                toState: 'CONFIRMED',
                reason: 'waitlist_promotion',
              },
            });
          }
        }

        // ── Outbox + audit for cancellation ─────────────────────────────────
        await tx.outboxEvent.create({
          data: {
            type: 'booking.cancelled',
            aggregateId: bookingId,
            payload: {
              bookingId,
              refundPaise,
              cancelFee,
              refundId: refundDbId ? String(refundDbId) : null,
            } as Prisma.InputJsonObject,
          },
        });
        await tx.auditLog.create({
          data: {
            actor: userId,
            entity: 'booking',
            entityId: bookingId,
            fromState: b.status,
            toState: 'CANCELLED',
            reason: 'user_cancellation',
          },
        });

        return {
          status: 'CANCELLED',
          refundPaise,
          cancelFee,
          refundId: refundDbId ? String(refundDbId) : null,
          alreadyCancelled: false,
        };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      // Enqueue refund processing job (best-effort)
      if (result.refundId && !result.alreadyCancelled) {
        try {
          const { Queue } = await import('bullmq');
          const queueRedisUrl = env.QUEUE_REDIS_URL;
          const urlObj = new URL(queueRedisUrl.startsWith('redis://') ? queueRedisUrl : `redis://${queueRedisUrl}`);
          const refundQueue = new Queue('process-refund', {
            connection: { host: urlObj.hostname, port: parseInt(urlObj.port || '6380') },
          });
          await refundQueue.add('refund', { refundId: result.refundId }, {
            jobId: `refund:${result.refundId}`,
            attempts: 5,
            backoff: { type: 'exponential', delay: 5_000 },
          });
          await refundQueue.close();
        } catch {
          request.log.warn({ refundId: result.refundId }, 'Failed to enqueue refund job; reconciler will retry');
        }
      }

      const body = { bookingId, ...result };
      await completeIdempotency(userId, idempotencyKey, 200, body as Prisma.InputJsonObject);
      return reply.send(body);
    },
  );
}
