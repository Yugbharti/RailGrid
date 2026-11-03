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

export interface TrainDataProvider {
  readonly name: string;
  getLiveStatus(trainNumber: string, date?: string): Promise<ProviderLiveStatus>;
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

  async getLiveStatus(trainNumber: string, date?: string): Promise<ProviderLiveStatus> {
    const query = date ? `?date=${encodeURIComponent(date)}` : '';
    let response: Response;
    try {
      response = await this.fetchImpl(
        `https://api.railradar.in/v1/trains/${encodeURIComponent(trainNumber)}/live${query}`,
        {
          headers: { authorization: `Bearer ${this.apiKey}`, accept: 'application/json' },
          signal: AbortSignal.timeout(3_000),
        },
      );
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
}
