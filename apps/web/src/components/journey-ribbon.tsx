'use client';

export interface StopInfo {
  stationCode: string;
  stationName: string;
  arrivalTime: string;
  departureTime: string;
  distanceKm: number;
  haltMinutes: number;
  platform?: string;
  isPassed?: boolean;
  isCurrent?: boolean;
}

interface JourneyRibbonProps {
  stops: StopInfo[];
  fromCode: string;
  toCode: string;
}

export function JourneyRibbon({ stops, fromCode, toCode }: JourneyRibbonProps) {
  const fromIndex = stops.findIndex((s) => s.stationCode === fromCode);
  const toIndex = stops.findIndex((s) => s.stationCode === toCode);

  return (
    <div className="bg-[#0C121E] border border-steel/20 rounded p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg uppercase tracking-wider text-amber font-semibold">
          JOURNEY RIBBON · ROUTE & HALTS
        </h3>
        <span className="font-mono text-xs text-steel">
          {stops.length} STATIONS · {stops[stops.length - 1]?.distanceKm ?? 0} KM TOTAL
        </span>
      </div>

      {/* Horizontal ribbon on desktop, vertical on mobile */}
      <div className="relative overflow-x-auto pb-4">
        <div className="min-w-[650px] flex items-center justify-between relative py-6">
          {/* Track Line background */}
          <div className="absolute top-1/2 left-4 right-4 h-1 bg-[#1A2638] -translate-y-1/2 z-0" />

          {/* Active segments highlighted */}
          {fromIndex !== -1 && toIndex !== -1 && (
            <div
              className="absolute top-1/2 h-1 bg-amber -translate-y-1/2 z-0 transition-all"
              style={{
                left: `${(fromIndex / (stops.length - 1)) * 100}%`,
                width: `${((toIndex - fromIndex) / (stops.length - 1)) * 100}%`,
              }}
            />
          )}

          {/* Stops Nodes */}
          {stops.map((stop, index) => {
            const isUserFrom = stop.stationCode === fromCode;
            const isUserTo = stop.stationCode === toCode;
            const isBetween = index >= fromIndex && index <= toIndex;

            return (
              <div
                key={stop.stationCode}
                className="relative z-10 flex flex-col items-center group cursor-pointer"
              >
                {/* Time above */}
                <span className="font-mono text-[10px] text-steel/80 mb-1 group-hover:text-chalk transition-colors">
                  {stop.arrivalTime !== '-' ? stop.arrivalTime : stop.departureTime}
                </span>

                {/* Node Circle */}
                <div
                  className={`w-4 h-4 rounded-full border-2 transition-transform group-hover:scale-125 ${
                    isUserFrom || isUserTo
                      ? 'bg-amber border-chalk scale-110 shadow-[0_0_10px_rgba(255,180,0,0.8)]'
                      : isBetween
                      ? 'bg-[#182333] border-amber'
                      : 'bg-[#0E1522] border-steel/40'
                  }`}
                />

                {/* Station Code below */}
                <div className="mt-2 text-center">
                  <p
                    className={`font-mono text-xs font-bold ${
                      isUserFrom || isUserTo ? 'text-amber' : 'text-chalk/90'
                    }`}
                  >
                    {stop.stationCode}
                  </p>
                  <p className="text-[10px] text-steel truncate max-w-[80px]">
                    {stop.stationName}
                  </p>
                  <p className="text-[9px] font-mono text-steel/60">
                    {stop.distanceKm} km
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
