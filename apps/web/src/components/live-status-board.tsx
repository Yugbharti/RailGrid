'use client';

import { useQuery } from '@tanstack/react-query';
import { liveStatusSchema, type LiveStatus } from '@railgrid/shared';

const apiUrl = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');

async function getLiveStatus(): Promise<LiveStatus> {
  const response = await fetch(`${apiUrl}/v1/trains/12919/live`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Live status is unavailable');
  return liveStatusSchema.parse(await response.json());
}

export function LiveStatusBoard() {
  const status = useQuery({
    queryKey: ['train-live-status', '12919'],
    queryFn: getLiveStatus,
    refetchInterval: 60_000,
  });

  return (
    <section aria-labelledby="live-status-heading" className="bg-ink border border-steel/30 rounded p-6 text-left">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 id="live-status-heading" className="font-mono text-steel text-sm">
          ── LIVE RUNNING STATUS ──────────────────
        </h2>
        <span className="font-mono text-xs text-chalk/50">12919 · MALWA SF EXPRESS</span>
      </div>

      {status.isPending ? (
        <p role="status" className="text-chalk/60 text-sm">Checking the latest train status…</p>
      ) : status.isError ? (
        <p role="status" className="text-chalk/60 text-sm">
          Live status is temporarily unavailable. Start the API to see updates.
        </p>
      ) : (
        <div aria-live="polite" className="grid gap-4 sm:grid-cols-3">
          <div>
            <p className="font-mono text-xs uppercase text-steel">Current station</p>
            <p className="mt-1 text-chalk">{status.data.currentStation ?? 'Not reported'}</p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase text-steel">Next station</p>
            <p className="mt-1 text-chalk">{status.data.nextStation ?? 'Not reported'}</p>
          </div>
          <div>
            <p className="font-mono text-xs uppercase text-steel">Delay</p>
            <p className="mt-1 text-chalk">
              {status.data.delayMinutes === null ? 'Not reported' : `${status.data.delayMinutes} min`}
              {status.data.stale && <span className="ml-2 text-amber">Last known update</span>}
            </p>
          </div>
          <p className="sm:col-span-3 font-mono text-xs text-chalk/45">
            Updated {new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', timeStyle: 'short' }).format(new Date(status.data.updatedAt))} IST
          </p>
        </div>
      )}

      <p className="mt-5 border-t border-steel/20 pt-3 text-xs text-chalk/45">
        Live data via RailRadar · Demo only
      </p>
    </section>
  );
}
