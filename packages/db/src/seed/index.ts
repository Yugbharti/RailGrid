import { PrismaClient } from '@prisma/client';
import { fareRules, fixtureStops, stations, trains } from './fixtures.js';

const db = new PrismaClient();

const seatLayouts = [
  {
    classCode: 'SL',
    coach: 'S1',
    count: 72,
    berths: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
  },
  {
    classCode: '3A',
    coach: 'B1',
    count: 64,
    berths: ['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'],
  },
  { classCode: '2A', coach: 'A1', count: 46, berths: ['LB', 'UB', 'LB', 'UB', 'SL', 'SU'] },
  { classCode: 'CC', coach: 'C1', count: 78, berths: ['WINDOW', 'AISLE', 'AISLE', 'WINDOW'] },
] as const;

export async function seedRuns(days = Number(process.env.BOOKING_WINDOW_DAYS ?? 60)) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const runs = trains.flatMap(({ number }) =>
    Array.from({ length: days }, (_, day) => {
      const journeyDate = new Date(today);
      journeyDate.setUTCDate(today.getUTCDate() + day);
      return { trainNumber: number, journeyDate };
    }),
  );
  for (let offset = 0; offset < runs.length; offset += 1000) {
    await db.run.createMany({ data: runs.slice(offset, offset + 1000), skipDuplicates: true });
  }
  return runs.length;
}

async function main() {
  await db.station.createMany({
    data: stations.map(([code, name, city, lat, lng]) => ({ code, name, city, lat, lng })),
    skipDuplicates: true,
  });
  await db.fareRule.createMany({ data: [...fareRules], skipDuplicates: true });

  for (const train of trains) {
    await db.train.upsert({
      where: { number: train.number },
      create: {
        number: train.number,
        name: train.name,
        type: train.type,
        isSuperfast: train.superfast,
      },
      update: { name: train.name, type: train.type, isSuperfast: train.superfast },
    });
    for (const stop of fixtureStops(train)) {
      await db.trainStop.upsert({
        where: { trainNumber_stopIdx: { trainNumber: train.number, stopIdx: stop.stopIdx } },
        create: stop,
        update: stop,
      });
    }

    const seats = seatLayouts.flatMap(({ classCode, coach, count, berths }) =>
      Array.from({ length: count }, (_, index) => ({
        trainNumber: train.number,
        classCode,
        coach,
        seatNo: index + 1,
        berthType: berths[index % berths.length]!,
      })),
    );
    await db.seat.createMany({ data: seats, skipDuplicates: true });
  }

  const runsAddedOrFound = await seedRuns();
  console.info(
    `Seeded ${stations.length} stations, ${trains.length} trains, ${trains.length * 260} seats, and ${runsAddedOrFound} run slots.`,
  );
  console.info(
    'Timetable and seat layouts are simplified demo fixtures, not authoritative schedules.',
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => db.$disconnect());
