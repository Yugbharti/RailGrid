import { createHash, randomInt, randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { ERROR_CODES, createBookingSchema, type CreateBookingInput } from '@railgrid/shared';
import { prisma, Prisma } from '@railgrid/db';
import { authenticate } from '../auth/guard.js';

const HOLD_SECONDS = 10 * 60;
const MAX_ADVANCE_DAYS = 60;
const ENDPOINT = 'POST:/v1/bookings';

class BookingFailure extends Error {
  constructor(readonly statusCode: number, readonly code: string, message: string) {
    super(message);
  }
}

function fail(status: number, code: string, message: string): never {
  throw new BookingFailure(status, code, message);
}

export function bookingRequestHash(input: CreateBookingInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex');
}

function pnr(): string {
  return String(randomInt(100_000_000, 1_000_000_000));
}

function prismaCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined;
}

async function createHold(
  input: CreateBookingInput,
  userId: string,
  requestId: string,
  idempotencyKey: string,
): Promise<{ statusCode: number; body: unknown; replay: boolean }> {
  const requestHash = bookingRequestHash(input);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.idempotencyKey.create({
        data: { userId, key: idempotencyKey, endpoint: ENDPOINT, requestHash },
      });

      const runId = BigInt(input.runId);
      const runRows = await tx.$queryRaw<Array<{
        id: bigint; train_number: string; journey_date: Date; status: string;
        is_superfast: boolean; departure_date: Date;
      }>>`SELECT r.id, r.train_number, r.journey_date, r.status,
          t.is_superfast,
          (r.journey_date + (s.departure::time + make_interval(days => s.day_offset)))::date AS departure_date
        FROM runs r JOIN trains t ON t.number = r.train_number
        JOIN train_stops s ON s.train_number = r.train_number AND s.stop_idx = ${input.fromIdx}
        WHERE r.id = ${runId} AND r.journey_date >= CURRENT_DATE
          AND r.journey_date <= CURRENT_DATE + ${MAX_ADVANCE_DAYS}::int
          AND r.status = 'SCHEDULED'`;
      const run = runRows[0];
      if (!run) fail(400, ERROR_CODES.INVALID_JOURNEY, 'The selected run is unavailable for booking.');

      const stops = await tx.$queryRaw<Array<{ stop_idx: number; distance_km: number }>>`
        SELECT stop_idx, distance_km FROM train_stops
        WHERE train_number = ${run.train_number} AND stop_idx IN (${input.fromIdx}, ${input.toIdx})
        ORDER BY stop_idx`;
      if (input.fromIdx >= input.toIdx || stops.length !== 2 || stops[0]!.stop_idx !== input.fromIdx || stops[1]!.stop_idx !== input.toIdx) {
        fail(400, ERROR_CODES.INVALID_JOURNEY, 'Choose two valid stops in travel order.');
      }

      const departure = await tx.$queryRaw<Array<{ departed: boolean }>>`
        SELECT ((r.journey_date + (s.departure::time + make_interval(days => s.day_offset))) <= now()) AS departed
        FROM runs r JOIN train_stops s ON s.train_number = r.train_number
        WHERE r.id = ${runId} AND s.stop_idx = ${input.fromIdx}`;
      if (departure[0]?.departed) fail(400, ERROR_CODES.TRAIN_DEPARTED, 'This train has already departed.');

      // Serialize same-user holds for this run, so two simultaneous requests cannot bypass the limit.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${userId}:${runId}`}, 0)) IS NULL AS locked`;
      const active = await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) AS count FROM bookings
        WHERE user_id = ${userId} AND run_id = ${runId} AND status IN ('SEATS_HELD','PAYMENT_PENDING')
          AND hold_expires_at > now()`;
      if (Number(active[0]?.count ?? 0) > 0) fail(409, ERROR_CODES.CONCURRENT_HOLD_LIMIT, 'You already have an active hold for this run.');

      await tx.$executeRaw`UPDATE seat_allocations SET status = 'EXPIRED', updated_at = now()
        WHERE run_id = ${runId} AND status = 'HELD' AND hold_expires_at <= now()`;
      await tx.$executeRaw`UPDATE bookings SET status = 'EXPIRED', updated_at = now()
        WHERE run_id = ${runId} AND status = 'SEATS_HELD' AND hold_expires_at <= now()`;

      const wanted = input.passengers.length;
      let selected: Array<{ id: bigint; coach: string; seat_no: number; berth_type: string }>;
      if (input.seatIds?.length) {
        if (input.seatIds.length !== wanted || new Set(input.seatIds).size !== wanted || input.seatIds.some((id) => !/^\d+$/.test(id))) {
          fail(400, ERROR_CODES.VALIDATION_ERROR, 'Provide one distinct seat id per passenger.');
        }
        const seatIds = input.seatIds.map(BigInt).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
        selected = await tx.$queryRaw<Array<{ id: bigint; coach: string; seat_no: number; berth_type: string }>>`
          SELECT s.id, s.coach, s.seat_no, s.berth_type FROM seats s
          WHERE s.train_number = ${run.train_number} AND s.class_code = ${input.classCode} AND s.id IN (${Prisma.join(seatIds)})
          ORDER BY s.id FOR UPDATE`;
        if (selected.length !== wanted) fail(409, ERROR_CODES.SEAT_TAKEN, 'One or more selected seats are unavailable.');
        const free = await tx.$queryRaw<Array<{ id: bigint }>>`
          SELECT s.id FROM seats s WHERE s.id IN (${Prisma.join(seatIds)}) AND NOT EXISTS (
            SELECT 1 FROM seat_allocations a WHERE a.run_id = ${runId} AND a.seat_id = s.id
              AND a.status IN ('HELD','CONFIRMED') AND int4range(a.from_idx,a.to_idx) && int4range(${input.fromIdx}::int,${input.toIdx}::int)
          )`;
        if (free.length !== wanted) fail(409, ERROR_CODES.SEAT_TAKEN, 'One or more selected seats are unavailable.');
      } else {
        selected = await tx.$queryRaw<Array<{ id: bigint; coach: string; seat_no: number; berth_type: string }>>`
          SELECT s.id, s.coach, s.seat_no, s.berth_type FROM seats s
          WHERE s.train_number = ${run.train_number} AND s.class_code = ${input.classCode}
            AND NOT EXISTS (SELECT 1 FROM seat_allocations a WHERE a.run_id = ${runId} AND a.seat_id = s.id
              AND a.status IN ('HELD','CONFIRMED') AND int4range(a.from_idx,a.to_idx) && int4range(${input.fromIdx}::int,${input.toIdx}::int))
          ORDER BY s.id LIMIT ${wanted} FOR UPDATE OF s SKIP LOCKED`;
        if (selected.length !== wanted) fail(409, ERROR_CODES.INSUFFICIENT_SEATS, 'There are not enough seats for this journey.');
      }

      const fares = await tx.fareRule.findUnique({ where: { classCode: input.classCode } });
      if (!fares) fail(400, ERROR_CODES.INVALID_JOURNEY, 'Fare is not configured for this class.');
      const distanceMeters = Math.round((stops[1]!.distance_km - stops[0]!.distance_km) * 1000);
      if (distanceMeters <= 0) fail(400, ERROR_CODES.INVALID_JOURNEY, 'The selected journey has no valid distance.');
      const perPassenger = fares.basePaise + Math.round(fares.perKmPaise * distanceMeters / 1000)
        + fares.reservationFeePaise + (run.is_superfast ? fares.superfastFeePaise : 0);
      const totalPaise = perPassenger * wanted;
      const bookingId = randomUUID();
      const bookingPnr = pnr();
      const expiry = await tx.$queryRaw<Array<{ expires_at: Date }>>`SELECT now() + make_interval(secs => ${HOLD_SECONDS}) AS expires_at`;
      const holdExpiresAt = expiry[0]!.expires_at;
      await tx.booking.create({ data: {
        id: bookingId, pnr: bookingPnr, userId, runId, fromIdx: input.fromIdx, toIdx: input.toIdx,
        classCode: input.classCode, status: 'SEATS_HELD', totalPaise, holdExpiresAt,
      } });
      const allocations = await Promise.all(selected.map((seat) => tx.seatAllocation.create({ data: {
        runId, seatId: seat.id, bookingId, fromIdx: input.fromIdx, toIdx: input.toIdx,
        status: 'HELD', holdExpiresAt,
      } })));
      await tx.bookingPassenger.createMany({ data: input.passengers.map((passenger, index) => ({
        bookingId, name: passenger.name, age: passenger.age, gender: passenger.gender,
        seatAllocationId: allocations[index]!.id,
      })) });
      const body = {
        booking: { id: bookingId, pnr: bookingPnr, runId: runId.toString(), fromIdx: input.fromIdx,
          toIdx: input.toIdx, classCode: input.classCode, status: 'SEATS_HELD', totalPaise,
          holdExpiresAt: holdExpiresAt.toISOString(),
          seats: selected.map((seat) => ({ id: seat.id.toString(), coach: seat.coach, seatNo: seat.seat_no, berthType: seat.berth_type })) },
      };
      await tx.outboxEvent.create({ data: { type: 'booking.held', aggregateId: bookingId, payload: body as Prisma.InputJsonObject } });
      await tx.auditLog.create({ data: { actor: userId, entity: 'booking', entityId: bookingId, toState: 'SEATS_HELD', reason: 'booking created', requestId } });
      await tx.idempotencyKey.update({ where: { userId_key: { userId, key: idempotencyKey } }, data: {
        status: 'COMPLETED', responseCode: 201, responseBody: body as Prisma.InputJsonObject,
      } });
      return { statusCode: 201, body, replay: false };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5_000, timeout: 15_000 });
  } catch (error) {
    if (error instanceof BookingFailure) throw error;
    if (prismaCode(error) === 'P2002') {
      const prior = await prisma.idempotencyKey.findUnique({ where: { userId_key: { userId, key: idempotencyKey } } });
      if (prior) {
        if (prior.endpoint !== ENDPOINT || prior.requestHash !== requestHash) fail(422, ERROR_CODES.IDEMPOTENCY_KEY_REUSED, 'This idempotency key was used for a different request.');
        if (prior.status !== 'COMPLETED' || !prior.responseBody) fail(409, ERROR_CODES.REQUEST_IN_PROGRESS, 'A request with this key is still being processed.');
        return { statusCode: prior.responseCode ?? 201, body: prior.responseBody, replay: true };
      }
    }
    if (prismaCode(error) === 'P2002' || (typeof error === 'object' && error && 'code' in error && error.code === '23P01')) {
      fail(409, ERROR_CODES.SEAT_TAKEN, 'The requested seat was just taken. Please choose another seat.');
    }
    throw error;
  }
}

export async function bookingRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateBookingInput }>(
    '/',
    { schema: { body: createBookingSchema }, preHandler: authenticate },
    async (request, reply) => {
      const key = request.headers['idempotency-key'];
      if (typeof key !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) {
        fail(400, ERROR_CODES.VALIDATION_ERROR, 'A UUID v4 Idempotency-Key header is required.');
      }
      const result = await createHold(request.body, request.authUser!.sub, request.id, key);
      return reply.code(result.statusCode).send(result.body);
    },
  );
}
