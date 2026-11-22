/**
 * send-email — BullMQ worker consuming the send-email queue.
 *
 * Idempotent: keyed by eventId via BullMQ jobId (set by outbox-publisher).
 * Fixture mode (no RESEND_API_KEY): logs email content only.
 * Production mode: POSTs to Resend API.
 */
import { Worker, type Processor } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { prisma } from '@railgrid/db';

export const SEND_EMAIL_QUEUE = 'send-email';

interface EmailJobData {
  eventId: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

async function buildEmailContent(type: string, aggregateId: string, payload: Record<string, unknown>): Promise<EmailMessage | null> {
  switch (type) {
    case 'booking.confirmed': {
      const booking = await prisma.booking.findUnique({
        where: { id: aggregateId },
        select: {
          pnr: true,
          totalPaise: true,
          fromIdx: true,
          toIdx: true,
          user: { select: { email: true, name: true } },
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
        },
      });
      if (!booking) return null;

      const fromStop = booking.run.train.stops.find((s) => s.stopIdx === booking.fromIdx);
      const toStop = booking.run.train.stops.find((s) => s.stopIdx === booking.toIdx);
      const fromName = fromStop ? `${fromStop.station.name} (${fromStop.stationCode})` : `Stop #${booking.fromIdx}`;
      const toName = toStop ? `${toStop.station.name} (${toStop.stationCode})` : `Stop #${booking.toIdx}`;
      const travelDate = booking.run.journeyDate.toISOString().split('T')[0];

      return {
        to: booking.user.email,
        subject: `RailGrid — Booking Confirmed: PNR ${booking.pnr}`,
        html: `
          <h1>Your booking is confirmed!</h1>
          <p>Hi ${booking.user.name ?? 'traveller'},</p>
          <p><strong>PNR:</strong> ${booking.pnr}</p>
          <p><strong>Train:</strong> ${booking.run.train.name} (${booking.run.train.number})</p>
          <p><strong>From:</strong> ${fromName}</p>
          <p><strong>To:</strong> ${toName}</p>
          <p><strong>Date:</strong> ${travelDate}</p>
          <p><strong>Amount paid:</strong> ₹${(booking.totalPaise / 100).toFixed(2)}</p>
          <p>Thank you for choosing RailGrid!</p>
        `,
      };
    }
    case 'booking.cancelled': {
      const booking = await prisma.booking.findUnique({
        where: { id: aggregateId },
        select: {
          pnr: true,
          user: { select: { email: true, name: true } },
        },
      });
      if (!booking) return null;
      return {
        to: booking.user.email,
        subject: `RailGrid — Booking Cancelled: PNR ${booking.pnr}`,
        html: `<p>Hi ${booking.user.name ?? 'traveller'}, your booking (PNR: ${booking.pnr}) has been cancelled. Refund will be processed within 5–7 working days.</p>`,
      };
    }
    case 'auth.email_verification': {
      const token = payload['token'] as string | undefined;
      const email = payload['email'] as string | undefined;
      if (!email || !token) return null;
      return {
        to: email,
        subject: 'RailGrid — Verify your email address',
        html: `<p>Click <a href="${process.env['APP_URL'] ?? 'http://localhost:3000'}/verify-email?token=${token}">here</a> to verify your email.</p>`,
      };
    }
    case 'auth.password_reset': {
      const token = payload['token'] as string | undefined;
      const email = payload['email'] as string | undefined;
      if (!email || !token) return null;
      return {
        to: email,
        subject: 'RailGrid — Reset your password',
        html: `<p>Click <a href="${process.env['APP_URL'] ?? 'http://localhost:3000'}/reset-password?token=${token}">here</a> to reset your password. This link expires in 15 minutes.</p>`,
      };
    }
    default:
      return null;
  }
}

async function sendViaResend(
  apiKey: string,
  from: string,
  message: EmailMessage,
  logger: Logger,
): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body }, 'send-email: Resend API error');
    throw new Error(`Resend API error ${res.status}: ${body}`);
  }
}

export const sendEmailProcessor =
  (resendApiKey: string | undefined, fromAddress: string, logger: Logger): Processor<EmailJobData> =>
  async (job) => {
    const { eventId, type, aggregateId, payload } = job.data;

    const message = await buildEmailContent(type, aggregateId, payload);
    if (!message) {
      logger.debug({ eventId, type }, 'send-email: no email template for event type');
      return { skipped: true };
    }

    if (!resendApiKey) {
      // Fixture mode — log and skip
      logger.info(
        { eventId, type, to: message.to, subject: message.subject },
        'send-email: fixture mode — email not sent (log only)',
      );
      return { fixture: true, to: message.to };
    }

    await sendViaResend(resendApiKey, fromAddress, message, logger);
    logger.info({ eventId, type, to: message.to }, 'send-email: sent via Resend');
    return { sent: true, to: message.to };
  };

export function createSendEmailWorker(
  connection: Redis,
  resendApiKey: string | undefined,
  fromAddress: string,
  logger: Logger,
): Worker {
  return new Worker(SEND_EMAIL_QUEUE, sendEmailProcessor(resendApiKey, fromAddress, logger), {
    connection,
    concurrency: 5,
  });
}
