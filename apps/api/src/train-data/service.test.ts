import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { FixtureProvider } from './fixture-provider.js';
import { RailRadarProvider } from './provider.js';
import { CircuitBreaker, MemoryDataCache, TrainDataService, type DataCache } from './service.js';

const logger = { warn: vi.fn() };

describe('RailRadar provider', () => {
  it('normalizes the documented schedule and trains-between shapes', async () => {
    const calls: string[] = [];
    const scheduleFixture = readFileSync(new URL('./fixtures/railradar-schedule-12919.response.json', import.meta.url), 'utf8');
    const betweenFixture = readFileSync(new URL('./fixtures/railradar-between-ujn-indb.response.json', import.meta.url), 'utf8');
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      calls.push(url);
      return new Response(url.includes('/between/') ? betweenFixture : scheduleFixture, { status: 200 });
    }) as unknown as typeof fetch;
    const provider = new RailRadarProvider('test-key', fetchImpl);
    const schedule = await provider.getTrain('12919');
    const between = await provider.getTrainsBetween('UJN', 'INDB', '2026-11-07');
    expect(schedule.route[0]).toMatchObject({ stationCode: 'DADN', departure: '11:50', distanceKm: 0 });
    expect(between[0]).toMatchObject({ trainNumber: '19304', distanceKm: 79.4, durationMinutes: 100 });
    expect(calls).toEqual([
      'https://api.railradar.in/v1/trains/12919?haltsOnly=true',
      'https://api.railradar.in/v1/trains/between/UJN/INDB?date=2026-11-07',
    ]);
  });

  it('normalizes the documented station-board shape', async () => {
    const fixture = readFileSync(new URL('./fixtures/railradar-station-live-indb.response.json', import.meta.url), 'utf8');
    const provider = new RailRadarProvider('test-key', async () => new Response(fixture, { status: 200 }));
    await expect(provider.getStationBoard('INDB')).resolves.toMatchObject([
      { trainNumber: '12920', platform: '4', liveType: 'at-station', delayMinutes: 0 },
    ]);
  });

  it('validates the documented envelope and normalizes live status', async () => {
    const fixture = readFileSync(new URL('./fixtures/railradar-live-12919.response.json', import.meta.url), 'utf8');
    const fetchImpl = vi.fn(async () =>
      new Response(fixture, { status: 200 }),
    );
    const provider = new RailRadarProvider('test-key', fetchImpl);
    const status = await provider.getLiveStatus('12919', '2026-11-02');
    expect(status).toEqual({
      trainNumber: '12919',
      delayMinutes: 4,
      currentStation: 'Ujjain Jn',
      nextStation: 'Maksi Jn',
      updatedAt: '2026-11-02T08:31:51.000Z',
      stale: false,
    });
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://api.railradar.in/v1/trains/12919/live?date=2026-11-02',
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer test-key' }) }),
    );
  });

  it('rejects response drift instead of forwarding unvalidated upstream JSON', async () => {
    const provider = new RailRadarProvider(
      'test-key',
      async () => new Response(JSON.stringify({ success: true, data: {}, meta: {} }), { status: 200 }),
    );
    await expect(provider.getLiveStatus('12919')).rejects.toThrow('documented live-status shape');
  });

  it('preserves 429 Retry-After for bounded retries', async () => {
    const provider = new RailRadarProvider(
      'test-key',
      async () => new Response('{}', { status: 429, headers: { 'retry-after': '2' } }),
    );
    await expect(provider.getLiveStatus('12919')).rejects.toMatchObject({
      statusCode: 429,
      retryAfterMs: 2_000,
    });
  });
});

describe('train data cache and resilience', () => {
  it('enforces minute limits and switches to cache-only at 80% of the rolling budget', async () => {
    const cache = new MemoryDataCache();
    expect(await cache.reserveQuota(100, 2, 1_000)).toBe('allowed');
    expect(await cache.reserveQuota(100, 2, 1_001)).toBe('allowed');
    expect(await cache.reserveQuota(100, 2, 1_002)).toBe('minute-limit');
    const budgetCache = new MemoryDataCache();
    expect(await budgetCache.reserveQuota(5, 10, 1_000)).toBe('allowed');
    expect(await budgetCache.reserveQuota(5, 10, 1_001)).toBe('allowed');
    expect(await budgetCache.reserveQuota(5, 10, 1_002)).toBe('allowed');
    expect(await budgetCache.reserveQuota(5, 10, 1_003)).toBe('allowed');
    expect(await budgetCache.reserveQuota(5, 10, 1_004)).toBe('cache-only');
  });

  it('serves a cached value without making a second provider request', async () => {
    const cache = new MemoryDataCache();
    const provider = new FixtureProvider();
    const getLiveStatus = vi.spyOn(provider, 'getLiveStatus');
    const service = new TrainDataService(provider, cache, 100, 10, logger);
    const first = await service.getLiveStatus('12919');
    const second = await service.getLiveStatus('12919');
    expect(first.stale).toBe(false);
    expect(second.stale).toBe(false);
    expect(getLiveStatus).toHaveBeenCalledTimes(1);
  });

  it('serves stale last-known-good data when refresh is blocked by the quota guard', async () => {
    const cache = new MemoryDataCache();
    const staleValue = {
      trainNumber: '12919',
      delayMinutes: 4,
      currentStation: 'Ujjain Jn',
      nextStation: 'Maksi Jn',
      updatedAt: new Date(Date.now() - 120_000).toISOString(),
      stale: false,
    };
    const key = 'railgrid:train-data:railradar:live:12919:active';
    await cache.set(key, { fetchedAt: Date.now() - 120_000, value: staleValue }, 86_400);
    const quotaCache: DataCache = {
      get: (cacheKey) => cache.get(cacheKey),
      set: (cacheKey, value, ttl) => cache.set(cacheKey, value, ttl),
      lock: (lockKey, token) => cache.lock(lockKey, token),
      unlock: (lockKey, token) => cache.unlock(lockKey, token),
      reserveQuota: async () => 'cache-only',
    };
    const provider = {
      name: 'railradar',
      getTrain: vi.fn(),
      getLiveStatus: vi.fn(),
      getTrainsBetween: vi.fn(),
      getStationBoard: vi.fn(),
    };
    const service = new TrainDataService(provider, quotaCache, 100, 10, logger);
    const status = await service.getLiveStatus('12919');
    expect(status.stale).toBe(true);
  });

  it('opens the circuit after repeated provider failures and allows a later probe', async () => {
    let now = 10_000;
    const breaker = new CircuitBreaker(2, 1_000, () => now);
    const failure = async () => {
      throw new Error('provider down');
    };
    await expect(breaker.execute(failure)).rejects.toThrow('provider down');
    await expect(breaker.execute(failure)).rejects.toThrow('provider down');
    await expect(breaker.execute(async () => 'too soon')).rejects.toThrow('circuit is open');
    now += 1_001;
    await expect(breaker.execute(async () => 'recovered')).resolves.toBe('recovered');
  });
});
