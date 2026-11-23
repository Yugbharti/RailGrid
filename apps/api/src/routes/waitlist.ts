/**
 * Phase 7 — Waitlist API Routes
 *
 * POST /v1/bookings/waitlist          — join waitlist when a run is sold out for a class
 * GET  /v1/bookings/waitlist/:runId   — get user's waitlist entry for a run/class
 * POST /v1/bookings/waitlist/:id/leave — leave the waitlist (cancel waitlist entry)
 *
 * Design:
 *   - Waitlist position is a per-(run, classCode) sequence: MAX(position_seq) + 1
 *   - Payment is NOT captured at waitlist join (simplified vs agent.md note)
 *     because we have no Razorpay test key — we capture when promoted
 *   - When a cancellation frees seats, the cancel transaction promotes the next
 *     WAITING entry atomically via SKIP LOCKED
 *   - If not promoted by cutoff (12h before departure), auto-expire via worker
 */
import { createHash, randomUUID, randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma, Prisma } from '@railgrid/db';
import { ERROR_CODES } from '@railgrid/shared';
import { authenticate } from '../auth/guard.js';

class WaitlistError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function fail(status: number, code: string, msg: string): never {
  throw new WaitlistError(status, code, msg);
}

/** Compute cancellation fee paise based on hours before departure */
export function computeCancellationFeePaise(
  totalPaise: number,
  hoursBeforeDeparture: number,
): number {
  // Tiered policy (agent.md § 6.4 / § 12):
  // > 48 h : 10% fee
  // 24-48 h: 25% fee
  // 12-24 h: 50% fee
  // < 12 h : no refund (100% fee)
  if (hoursBeforeDeparture >= 48) return Math.round(totalPaise * 0.1);
  if (hoursBeforeDeparture >= 24) return Math.round(totalPaise * 0.25);
  if (hoursBeforeDeparture >= 12) return Math.round(totalPaise * 0.5);
  return totalPaise; // no refund
}

export async function waitlistRoutes(app: FastifyInstance) {
  /**
   * POST /v1/bookings/waitlist
   * Join waitlist for a sold-out run/class combination.
   * Body: { runId, classCode, fromIdx, toIdx, passengers }
   */
  app.post<{
    Body: {
      runId: string;
      classCode: string;
      fromIdx: number;
      toIdx: number;
      passengers: Array<{ name: string; age: number; gender: string }>;
    };
  }>(
    '/waitlist',
    {
      preHandler: authenticate,
      schema: {
        body: z.object({
          runId: z.string(),
          classCode: z.string(),
          fromIdx: z.number().int().min(0),
          toIdx: z.number().int().min(1),
          passengers: z.array(
            z.object({
              name: z.string().min(2).max(60),
              age: z.number().int().min(1).max(120),
              gender: z.enum(['M', 'F', 'O']),
            }),
          ).min(1).max(6),
        }),
        response: {
          201: z.object({
            waitlistId: z.string(),
            runId: z.string(),
            classCode: z.string(),
            positionSeq: z.number(),
            status: z.string(),
            message: z.string(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.sub;
      const { runId, classCode, fromIdx, toIdx, passengers } = request.body;
      const runIdBig = BigInt(runId);

      const result = await prisma.$transaction(async (tx) => {
        // Verify the run exists and is not departed
        const run = await tx.run.findUnique({ where: { id: runIdBig }, select: { id: true, trainNumber: true, journeyDate: true } });
        if (!run) fail(404, ERROR_CODES.NOT_FOUND, 'Train run not found.');

        // Check user does not already have a confirmed/held booking for this run
        const existing = await tx.booking.findFirst({
          where: { userId, runId: runIdBig, status: { in: ['SEATS_HELD', 'PAYMENT_PENDING', 'CONFIRMED'] } },
        });
        if (existing) fail(409, 'ALREADY_BOOKED', 'You already have an active booking for this run.');

        // Check user is not already on the waitlist
        const existingWaitlist = await tx.waitlistEntry.findFirst({
          where: { bookingId: { in: await tx.booking.findMany({ where: { userId, runId: runIdBig }, select: { id: true } }).then((bs) => bs.map((b) => b.id)) }, status: 'WAITING' },
        });
        if (existingWaitlist) fail(409, 'ALREADY_WAITLISTED', 'You are already on the waitlist for this run.');

        // Compute next position
        const maxPos = await tx.$queryRaw<Array<{ max_pos: bigint | null }>>`
          SELECT MAX(position_seq) AS max_pos FROM waitlist_entries
          WHERE run_id = ${runIdBig} AND class_code = ${classCode} AND status = 'WAITING'`;
        const nextPos = (maxPos[0]?.max_pos ?? 0n) + 1n;

        // Create a placeholder booking in WAITLISTED status
        const bookingId = randomUUID();
        const pnr = 'WL' + String(randomInt(10_000_000, 100_000_000));
        await tx.booking.create({
          data: {
            id: bookingId,
            pnr,
            userId,
            runId: runIdBig,
            fromIdx,
            toIdx,
            classCode,
            status: 'WAITLISTED',
            totalPaise: 0, // TBD at promotion time
          },
        });

        // Create passengers
        await tx.bookingPassenger.createMany({
          data: passengers.map((p) => ({
            bookingId,
            name: p.name,
            age: p.age,
            gender: p.gender,
          })),
        });

        // Create waitlist entry
        const entry = await tx.waitlistEntry.create({
          data: {
            runId: runIdBig,
            classCode,
            bookingId,
            positionSeq: nextPos,
            status: 'WAITING',
          },
        });

        await tx.outboxEvent.create({
          data: {
            type: 'booking.waitlisted',
            aggregateId: bookingId,
            payload: { bookingId, runId, classCode, positionSeq: Number(nextPos) } as Prisma.InputJsonObject,
          },
        });

        await tx.auditLog.create({
          data: {
            actor: userId,
            entity: 'booking',
            entityId: bookingId,
            toState: 'WAITLISTED',
            reason: 'waitlist_join',
          },
        });

        return { waitlistId: String(entry.id), positionSeq: Number(nextPos), bookingId };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      return reply.code(201).send({
        waitlistId: result.waitlistId,
        runId,
        classCode,
        positionSeq: result.positionSeq,
        status: 'WAITING',
        message: `You are #${result.positionSeq} on the waitlist. We'll notify you if a seat becomes available.`,
      });
    },
  );

  /**
   * GET /v1/bookings/waitlist/status?runId=&classCode=
   * Check user's current position in the waitlist.
   */
  app.get<{ Querystring: { runId: string; classCode: string } }>(
    '/waitlist/status',
    {
      preHandler: authenticate,
      schema: {
        querystring: z.object({ runId: z.string(), classCode: z.string() }),
        response: {
          200: z.object({
            inQueue: z.boolean(),
            positionSeq: z.number().nullable(),
            status: z.string().nullable(),
            queueLength: z.number(),
            runId: z.string(),
            classCode: z.string(),
            bookingId: z.string().nullable(),
          }),
        },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.sub;
      const { runId, classCode } = request.query;
      const runIdBig = BigInt(runId);

      // Find user's booking for this run
      const booking = await prisma.booking.findFirst({
        where: { userId, runId: runIdBig, status: { in: ['WAITLISTED'] } },
        select: { id: true },
      });

      const queueLength = await prisma.waitlistEntry.count({
        where: { runId: runIdBig, classCode, status: 'WAITING' },
      });

      if (!booking) {
        return reply.send({ inQueue: false, positionSeq: null, status: null, queueLength, runId, classCode, bookingId: null });
      }

      const entry = await prisma.waitlistEntry.findFirst({
        where: { bookingId: booking.id, status: 'WAITING' },
        select: { positionSeq: true, status: true },
      });

      return reply.send({
        inQueue: entry !== null,
        positionSeq: entry ? Number(entry.positionSeq) : null,
        status: entry?.status ?? null,
        queueLength,
        runId,
        classCode,
        bookingId: booking.id,
      });
    },
  );

  /**
   * DELETE /v1/bookings/waitlist/:id
   * Leave the waitlist (cancel WAITLISTED booking).
   */
  app.delete<{ Params: { id: string } }>(
    '/waitlist/:id',
    {
      preHandler: authenticate,
      schema: {
        response: { 200: z.object({ left: z.boolean(), bookingId: z.string() }) },
      },
    },
    async (request, reply) => {
      const userId = request.authUser!.sub;
      const { id } = request.params;

      await prisma.$transaction(async (tx) => {
        const entry = await tx.waitlistEntry.findUnique({ where: { id: BigInt(id) }, select: { id: true, bookingId: true, status: true } });
        if (!entry) fail(404, ERROR_CODES.NOT_FOUND, 'Waitlist entry not found.');
        if (entry.status !== 'WAITING') fail(409, 'NOT_WAITING', 'This waitlist entry is not in WAITING status.');

        // Verify ownership
        const booking = await tx.booking.findUnique({ where: { id: entry.bookingId }, select: { userId: true } });
        if (!booking || booking.userId !== userId) fail(403, ERROR_CODES.FORBIDDEN, 'Access denied.');

        await tx.waitlistEntry.update({ where: { id: BigInt(id) }, data: { status: 'CANCELLED', updatedAt: new Date() } });
        await tx.booking.update({ where: { id: entry.bookingId }, data: { status: 'CANCELLED', updatedAt: new Date() } });
        await tx.bookingPassenger.updateMany({ where: { bookingId: entry.bookingId }, data: { status: 'CANCELLED', updatedAt: new Date() } });
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });

      return reply.send({ left: true, bookingId: id });
    },
  );
}
