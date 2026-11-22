/**
 * generate-ticket — BullMQ worker consuming the generate-ticket queue.
 *
 * Triggered by booking.confirmed outbox events.
 * Generates a signed QR token (PNR + bookingId + userId, 1-year expiry).
 * Stores ticket JSON in outbox_events.
 */
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { createHmac, randomBytes } from 'node:crypto';
import { prisma } from '@railgrid/db';

export const GENERATE_TICKET_QUEUE = 'generate-ticket';

interface TicketJobData {
  eventId: string;
  type: string;
  aggregateId: string; // bookingId
  payload: Record<string, unknown>;
}

/** Sign a simple JWT-like token without jsonwebtoken dependency */
function signToken(payload: Record<string, unknown>, secret: string): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = createHmac('sha256', secret)
    .update(`${header}.${body}`)
    .digest('base64url');
  return `${header}.${body}.${sig}`;
}

export const generateTicketProcessor =
  (jwtSecret: string, logger: Logger): Processor<TicketJobData> =>
  async (job) => {
    const { eventId, aggregateId: bookingId } = job.data;

    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        pnr: true,
        userId: true,
        status: true,
        totalPaise: true,
        classCode: true,
        fromIdx: true,
        toIdx: true,
        run: {
          select: {
            journeyDate: true,
            train: {
              select: {
                name: true,
                number: true,
                stops: {
                  select: { stopIdx: true, stationCode: true, station: { select: { name: true } } },
                },
              },
            },
          },
        },
        passengers: {
          select: { name: true, age: true, gender: true },
        },
        seatAllocations: {
          where: { status: 'CONFIRMED' },
          select: { seat: { select: { seatNo: true, coach: true } } },
        },
      },
    });

    if (!booking || booking.status !== 'CONFIRMED') {
      logger.warn({ bookingId, eventId }, 'generate-ticket: booking not found or not confirmed');
      return { skipped: true };
    }

    const fromStop = booking.run.train.stops.find((s) => s.stopIdx === booking.fromIdx);
    const toStop = booking.run.train.stops.find((s) => s.stopIdx === booking.toIdx);
    const fromStr = fromStop ? `${fromStop.station.name} (${fromStop.stationCode})` : `Stop #${booking.fromIdx}`;
    const toStr = toStop ? `${toStop.station.name} (${toStop.stationCode})` : `Stop #${booking.toIdx}`;
    const travelDate = booking.run.journeyDate.toISOString().split('T')[0];

    const expiresAt = Math.floor(Date.now() / 1000) + 365 * 24 * 3600; // 1 year
    const qrToken = signToken(
      {
        pnr: booking.pnr,
        bookingId: booking.id,
        userId: booking.userId,
        exp: expiresAt,
        jti: randomBytes(8).toString('hex'),
      },
      jwtSecret,
    );

    const ticketData = {
      pnr: booking.pnr,
      bookingId: booking.id,
      train: `${booking.run.train.name} (${booking.run.train.number})`,
      from: fromStr,
      to: toStr,
      journeyDate: travelDate,
      classCode: booking.classCode,
      passengers: booking.passengers,
      seats: booking.seatAllocations.map((a) => `${a.seat.coach}-${a.seat.seatNo}`),
      totalPaise: booking.totalPaise,
      qrToken,
      generatedAt: new Date().toISOString(),
    };

    // Store ticket in outbox for delivery
    await prisma.outboxEvent.create({
      data: {
        type: 'ticket.generated',
        aggregateId: bookingId,
        payload: ticketData as unknown as import('@railgrid/db').Prisma.InputJsonObject,
      },
    });

    logger.info({ bookingId, pnr: booking.pnr, eventId }, 'generate-ticket: ticket generated');
    return { pnr: booking.pnr, qrTokenLength: qrToken.length };
  };

export function createGenerateTicketWorker(
  connection: Redis,
  jwtSecret: string,
  logger: Logger,
): Worker {
  return new Worker(GENERATE_TICKET_QUEUE, generateTicketProcessor(jwtSecret, logger), {
    connection,
    concurrency: 3,
  });
}
