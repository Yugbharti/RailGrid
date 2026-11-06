import { z } from 'zod';
import type { LiveStatus } from '@railgrid/shared';

const liveEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    trainNumber: z.string().min(1),
    status: z.string().optional(),
    delayMinutes: z.number().nullable().optional(),
    lastUpdatedAt: z.string().datetime({ offset: true }).optional(),
    currentLocation: z
      .object({
        stationCode: z.string().nullable().optional(),
        stationName: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
    nextHalt: z
      .object({
        stationCode: z.string().nullable().optional(),
        stationName: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  meta: z.object({ timestamp: z.string().datetime({ offset: true }) }).passthrough(),
});

export type ProviderLiveStatus = LiveStatus;

export interface TrainSchedule {
  trainNumber: string;
  trainName: string;
  trainType: string;
  source: { code: string; name: string };
  destination: { code: string; name: string };
  route: Array<{
    sequence: number;
    stationCode: string;
    stationName: string;
    isHalt: boolean;
    arrival: string | null;
    arrivalDay: number | null;
    departure: string | null;
    departureDay: number | null;
    distanceKm: number;
  }>;
}

export interface TrainSummary {
  trainNumber: string;
  trainName: string;
  trainType: string;
  runDays: string[];
  from: { code: string; name: string; departure: string | null; day: number; sequence: number };
  to: { code: string; name: string; arrival: string | null; day: number; sequence: number };
  distanceKm: number;
  durationMinutes: number;
}

export interface StationBoardEntry {
  trainNumber: string;
  trainName: string;
  trainType: string;
  source: string;
  destination: string;
  sequence: number;
  arrival: string | null;
  departure: string | null;
  day: number;
  platform: string | null;
  liveType: string;
  expectedArrivalTime: string | null;
  expectedDepartureTime: string | null;
  delayMinutes: number | null;
}

const stationSchema = z.object({ code: z.string(), name: z.string() });
const scheduleEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    train: z.object({
      number: z.string(),
      name: z.string(),
      type: z.string(),
      source: stationSchema,
      destination: stationSchema,
    }).passthrough(),
    route: z.array(z.object({
      sequence: z.number().int(),
      station: stationSchema,
      isHalt: z.boolean(),
      arrival: z.string().nullable().optional(),
      arrivalDay: z.number().int().nullable().optional(),
      departure: z.string().nullable().optional(),
      departureDay: z.number().int().nullable().optional(),
      distance: z.number(),
    }).passthrough()),
  }),
  meta: z.object({ timestamp: z.string().datetime({ offset: true }) }).passthrough(),
});
const betweenEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    trains: z.array(z.object({
      train: z.object({ number: z.string(), name: z.string(), type: z.string(), runDays: z.array(z.string()) }).passthrough(),
      from: z.object({ code: z.string(), name: z.string(), departure: z.string().nullable().optional(), day: z.number().int(), sequence: z.number().int() }).passthrough(),
      to: z.object({ code: z.string(), name: z.string(), arrival: z.string().nullable().optional(), day: z.number().int(), sequence: z.number().int() }).passthrough(),
      distance: z.number(),
      duration: z.number(),
    }).passthrough()),
  }).passthrough(),
  meta: z.object({ timestamp: z.string().datetime({ offset: true }) }).passthrough(),
});
const stationBoardEnvelopeSchema = z.object({
  success: z.literal(true),
  data: z.object({
    trains: z.array(z.object({
      train: z.object({ number: z.string(), name: z.string(), type: z.string(), source: z.string(), destination: z.string() }).passthrough(),
      stop: z.object({ sequence: z.number().int(), arrival: z.string().nullable(), departure: z.string().nullable(), day: z.number().int(), platform: z.string().nullable().optional() }).passthrough(),
      live: z.object({ type: z.string(), expectedArrivalTime: z.string().datetime({ offset: true }).nullable().optional(), expectedDepartureTime: z.string().datetime({ offset: true }).nullable().optional(), delayMinutes: z.number().nullable().optional() }).passthrough(),
    }).passthrough()),
  }).passthrough(),
  meta: z.object({ timestamp: z.string().datetime({ offset: true }) }).passthrough(),
});

export interface TrainDataProvider {
  readonly name: string;
  getTrain(trainNumber: string): Promise<TrainSchedule>;
  getLiveStatus(trainNumber: string, date?: string): Promise<ProviderLiveStatus>;
  getTrainsBetween(from: string, to: string, date?: string): Promise<TrainSummary[]>;
  getStationBoard(code: string): Promise<StationBoardEntry[]>;
}

export class ProviderError extends Error {
  constructor(
    message: string,
    readonly statusCode?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

export class RailRadarProvider implements TrainDataProvider {
  readonly name = 'railradar';

  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async getTrain(trainNumber: string): Promise<TrainSchedule> {
    const payload = await this.requestJson(`/trains/${encodeURIComponent(trainNumber)}?haltsOnly=true`);
    const parsed = scheduleEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderError('RailRadar schedule response did not match the documented shape');
    const { train, route } = parsed.data.data;
    return {
      trainNumber: train.number,
      trainName: train.name,
      trainType: train.type,
      source: train.source,
      destination: train.destination,
      route: route.map((stop) => ({
        sequence: stop.sequence,
        stationCode: stop.station.code,
        stationName: stop.station.name,
        isHalt: stop.isHalt,
        arrival: stop.arrival ?? null,
        arrivalDay: stop.arrivalDay ?? null,
        departure: stop.departure ?? null,
        departureDay: stop.departureDay ?? null,
        distanceKm: stop.distance,
      })),
    };
  }

  async getLiveStatus(trainNumber: string, date?: string): Promise<ProviderLiveStatus> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const payload = await this.requestJson(`/trains/${encodeURIComponent(trainNumber)}/live${query}`);
    const parsed = liveEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderError('RailRadar response did not match the documented live-status shape');

    const { data, meta } = parsed.data;
    return {
      trainNumber: data.trainNumber,
      delayMinutes: data.delayMinutes ?? null,
      currentStation: data.currentLocation?.stationName ?? data.currentLocation?.stationCode ?? null,
      nextStation: data.nextHalt?.stationName ?? data.nextHalt?.stationCode ?? null,
      updatedAt: new Date(data.lastUpdatedAt ?? meta.timestamp).toISOString(),
      stale: false,
    };
  }

  async getTrainsBetween(from: string, to: string, date?: string): Promise<TrainSummary[]> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    const payload = await this.requestJson(
      `/trains/between/${encodeURIComponent(from)}/${encodeURIComponent(to)}${query}`,
    );
    const parsed = betweenEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderError('RailRadar trains-between response did not match the documented shape');
    return parsed.data.data.trains.map(({ train, from: origin, to: destination, distance, duration }) => ({
      trainNumber: train.number,
      trainName: train.name,
      trainType: train.type,
      runDays: train.runDays,
      from: { code: origin.code, name: origin.name, departure: origin.departure ?? null, day: origin.day, sequence: origin.sequence },
      to: { code: destination.code, name: destination.name, arrival: destination.arrival ?? null, day: destination.day, sequence: destination.sequence },
      distanceKm: distance,
      durationMinutes: duration,
    }));
  }

  async getStationBoard(code: string): Promise<StationBoardEntry[]> {
    const payload = await this.requestJson(`/stations/${encodeURIComponent(code)}/live?hours=4`);
    const parsed = stationBoardEnvelopeSchema.safeParse(payload);
    if (!parsed.success) throw new ProviderError('RailRadar station-board response did not match the documented shape');
    return parsed.data.data.trains.map(({ train, stop, live }) => ({
      trainNumber: train.number,
      trainName: train.name,
      trainType: train.type,
      source: train.source,
      destination: train.destination,
      sequence: stop.sequence,
      arrival: stop.arrival,
      departure: stop.departure,
      day: stop.day,
      platform: stop.platform ?? null,
      liveType: live.type,
      expectedArrivalTime: live.expectedArrivalTime ?? null,
      expectedDepartureTime: live.expectedDepartureTime ?? null,
      delayMinutes: live.delayMinutes ?? null,
    }));
  }

  private async requestJson(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await this.fetchImpl(`https://api.railradar.in/v1${path}`, {
        headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
        signal: AbortSignal.timeout(3_000),
      });
    } catch (error) {
      throw new ProviderError(error instanceof Error ? error.message : 'Provider network error');
    }

    if (!response.ok) {
      const retryAfter = response.headers.get('retry-after');
      const retryAfterMs = retryAfter
        ? Math.max(0, Number.isFinite(Number(retryAfter)) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - Date.now())
        : undefined;
      throw new ProviderError(`RailRadar returned HTTP ${response.status}`, response.status, retryAfterMs);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new ProviderError('RailRadar returned invalid JSON');
    }
    return payload;
  }
}
