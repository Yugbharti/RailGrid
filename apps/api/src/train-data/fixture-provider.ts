import type { ProviderLiveStatus, TrainDataProvider } from './provider.js';

/** Fixture mirrors the published RailRadar example; it is not a live response. */
export class FixtureProvider implements TrainDataProvider {
  readonly name = 'fixture';

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
}
