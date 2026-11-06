import type {
  ProviderLiveStatus,
  StationBoardEntry,
  TrainDataProvider,
  TrainSchedule,
  TrainSummary,
} from './provider.js';

/** Fixture mirrors the published RailRadar example; it is not a live response. */
export class FixtureProvider implements TrainDataProvider {
  readonly name = 'fixture';

  async getTrain(trainNumber: string): Promise<TrainSchedule> {
    return {
      trainNumber,
      trainName: 'Malwa SF Express (documentation fixture)',
      trainType: 'Superfast Express',
      source: { code: 'DADN', name: 'Dr. Ambedkar Nagar' },
      destination: { code: 'SVDK', name: 'Shri Mata Vaishno Devi Katra' },
      route: [
        { sequence: 1, stationCode: 'DADN', stationName: 'Dr. Ambedkar Nagar', isHalt: true, arrival: null, arrivalDay: null, departure: '11:50', departureDay: 1, distanceKm: 0 },
        { sequence: 7, stationCode: 'INDB', stationName: 'Indore Jn', isHalt: true, arrival: '12:05', arrivalDay: 1, departure: '12:15', departureDay: 1, distanceKm: 21.1 },
      ],
    };
  }

  async getLiveStatus(trainNumber: string): Promise<ProviderLiveStatus> {
    return {
      trainNumber,
      delayMinutes: 4,
      currentStation: 'Ujjain Jn',
      nextStation: 'Maksi Jn',
      updatedAt: new Date().toISOString(),
      stale: false,
    };
  }

  async getTrainsBetween(from: string, to: string): Promise<TrainSummary[]> {
    return [{
      trainNumber: '19304',
      trainName: 'Bhopal - Indore Express',
      trainType: 'Mail/Express',
      runDays: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'],
      from: { code: from.toUpperCase(), name: 'Ujjain Jn', departure: '03:05', day: 2, sequence: 25 },
      to: { code: to.toUpperCase(), name: 'Indore Jn', arrival: '04:45', day: 2, sequence: 37 },
      distanceKm: 79.4,
      durationMinutes: 100,
    }];
  }

  async getStationBoard(code: string): Promise<StationBoardEntry[]> {
    return [{
      trainNumber: '12920',
      trainName: 'Malwa SF Express',
      trainType: 'Superfast Express',
      source: 'SVDK',
      destination: 'DADN',
      sequence: 234,
      arrival: '13:35',
      departure: '13:45',
      day: 2,
      platform: '4',
      liveType: 'at-station',
      expectedArrivalTime: '2026-11-02T08:05:00.000Z',
      expectedDepartureTime: '2026-11-02T08:15:00.000Z',
      delayMinutes: 0,
    }].map((entry) => ({ ...entry, source: entry.source || code.toUpperCase() }));
  }
}
