import { PrismaClient } from '@prisma/client';
import { trains } from './fixtures.js';

const db = new PrismaClient();

async function main() {
  const days = Number(process.env.BOOKING_WINDOW_DAYS ?? 60);
  if (!Number.isInteger(days) || days < 1 || days > 365) {
    throw new Error('BOOKING_WINDOW_DAYS must be an integer from 1 to 365');
  }
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const rows = trains.flatMap(({ number }) =>
    Array.from({ length: days }, (_, day) => {
      const journeyDate = new Date(today);
      journeyDate.setUTCDate(today.getUTCDate() + day);
      return { trainNumber: number, journeyDate };
    }),
  );
  for (let offset = 0; offset < rows.length; offset += 1000) {
    await db.run.createMany({ data: rows.slice(offset, offset + 1000), skipDuplicates: true });
  }
  console.info(`Ensured ${rows.length} run slots for ${trains.length} demo trains.`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
