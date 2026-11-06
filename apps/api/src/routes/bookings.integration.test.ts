import '../load-env.js';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { parseEnv } from '@railgrid/shared';
import { prisma } from '@railgrid/db';
import { buildApp } from '../app.js';
import { signAccessToken } from '../auth/tokens.js';

const integration = process.env['RAILGRID_INTEGRATION_TESTS'] === '1' ? describe : describe.skip;
let app: FastifyInstance | undefined;
const userIds: string[] = [];

integration('booking holds with Neon', () => {
  afterAll(async () => {
    for (const userId of userIds) {
      const bookings = await prisma.booking.findMany({ where: { userId }, select: { id: true } });
      const ids = bookings.map(({ id }) => id);
      await prisma.$transaction(async (tx) => {
        await tx.bookingPassenger.deleteMany({ where: { bookingId: { in: ids } } });
        await tx.seatAllocation.deleteMany({ where: { bookingId: { in: ids } } });
        await tx.payment.deleteMany({ where: { bookingId: { in: ids } } });
        await tx.waitlistEntry.deleteMany({ where: { bookingId: { in: ids } } });
        await tx.outboxEvent.deleteMany({ where: { aggregateId: { in: ids } } });
        await tx.auditLog.deleteMany({ where: { entity: 'booking', entityId: { in: ids } } });
        await tx.booking.deleteMany({ where: { id: { in: ids } } });
        await tx.idempotencyKey.deleteMany({ where: { userId } });
        await tx.user.delete({ where: { id: userId } });
      });
    }
    await app?.close();
  });

  it('holds a seat once, replays the response, and rejects a competing user', async () => {
    process.env['NODE_ENV'] = 'test';
    const env = parseEnv(process.env);
    app = await buildApp({ env });
    const candidates = await prisma.$queryRaw<Array<{ run_id: bigint; from_idx: number; to_idx: number; seat_id: bigint; class_code: string }>>`
      SELECT r.id AS run_id, a.stop_idx AS from_idx, b.stop_idx AS to_idx,
        s.id AS seat_id, s.class_code
      FROM runs r JOIN train_stops a ON a.train_number = r.train_number
      JOIN train_stops b ON b.train_number = r.train_number AND b.stop_idx = a.stop_idx + 1
      JOIN seats s ON s.train_number = r.train_number
      WHERE r.journey_date >= CURRENT_DATE AND r.journey_date <= CURRENT_DATE + 60 AND r.status = 'SCHEDULED'
        AND a.departure IS NOT NULL AND (r.journey_date + (a.departure::time + make_interval(days => a.day_offset))) > now()
      ORDER BY r.journey_date, r.id, s.id LIMIT 1`;
    expect(candidates.length).toBe(1);
    const candidate = candidates[0]!;
    const users = await Promise.all([0, 1].map((index) => prisma.user.create({ data: {
      email: `booking-${randomUUID()}@railgrid.invalid`, name: `Booking Test ${index}`, passwordHash: 'integration-test-only', emailVerifiedAt: new Date(),
    } })));
    userIds.push(...users.map(({ id }) => id));
    const tokens = users.map((user) => signAccessToken({ sub: user.id, role: 'USER' }, env.JWT_ACCESS_SECRET));
    const key = randomUUID();
    const payload = {
      runId: candidate.run_id.toString(), fromIdx: candidate.from_idx, toIdx: candidate.to_idx,
      classCode: candidate.class_code as 'SL' | '3A' | '2A' | 'CC', passengers: [{ name: 'Test Passenger', age: 30, gender: 'O' as const }],
      seatIds: [candidate.seat_id.toString()],
    };
    const first = await app.inject({ method: 'POST', url: '/v1/bookings', headers: { authorization: `Bearer ${tokens[0]}`, 'idempotency-key': key }, payload });
    expect(first.statusCode, JSON.stringify(first.json())).toBe(201);
    const replay = await app.inject({ method: 'POST', url: '/v1/bookings', headers: { authorization: `Bearer ${tokens[0]}`, 'idempotency-key': key }, payload });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(first.json());
    const competitor = await app.inject({ method: 'POST', url: '/v1/bookings', headers: { authorization: `Bearer ${tokens[1]}`, 'idempotency-key': randomUUID() }, payload });
    expect(competitor.statusCode).toBe(409);
    expect(competitor.json<{ error: { code: string } }>().error.code).toBe('SEAT_TAKEN');
  }, 30_000);
});
