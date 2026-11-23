'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Navbar } from '../../components/navbar';
import { STATIONS } from '../../lib/stations';

interface TrainResult {
  runId: string;
  trainNumber: string;
  trainName: string;
  departureTime: string;
  arrivalTime: string;
  duration: string;
  classes: Array<{
    code: string;
    availableSeats: number;
    waitlistCount: number;
    farePaise: number;
  }>;
}

// Demo trains generator for route search
function getMockTrainResults(from: string, to: string): TrainResult[] {
  return [
    {
      runId: '101',
      trainNumber: '12002',
      trainName: 'Bhopal Shatabdi',
      departureTime: '06:00',
      arrivalTime: '14:25',
      duration: '8h 25m',
      classes: [
        { code: 'CC', availableSeats: 42, waitlistCount: 0, farePaise: 89_000 },
        { code: '2A', availableSeats: 12, waitlistCount: 0, farePaise: 165_000 },
      ],
    },
    {
      runId: '102',
      trainNumber: '12919',
      trainName: 'Malwa Express',
      departureTime: '07:20',
      arrivalTime: '18:40',
      duration: '11h 20m',
      classes: [
        { code: 'SL', availableSeats: 74, waitlistCount: 0, farePaise: 42_000 },
        { code: '3A', availableSeats: 26, waitlistCount: 0, farePaise: 110_000 },
        { code: '2A', availableSeats: 4, waitlistCount: 0, farePaise: 175_000 },
      ],
    },
    {
      runId: '103',
      trainNumber: '12952',
      trainName: 'Mumbai Rajdhani',
      departureTime: '16:55',
      arrivalTime: '08:35',
      duration: '15h 40m',
      classes: [
        { code: '3A', availableSeats: 0, waitlistCount: 6, farePaise: 185_000 },
        { code: '2A', availableSeats: 18, waitlistCount: 0, farePaise: 260_000 },
      ],
    },
  ];
}

function TrainsList() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const fromCode = searchParams.get('from') ?? 'NDLS';
  const toCode = searchParams.get('to') ?? 'BPL';
  const date = searchParams.get('date') ?? 'Tomorrow';
  const selectedClass = searchParams.get('class') ?? 'ALL';

  const [trains] = useState<TrainResult[]>(() => getMockTrainResults(fromCode, toCode));

  const fromStation = STATIONS.find((s) => s.code === fromCode)?.name ?? fromCode;
  const toStation = STATIONS.find((s) => s.code === toCode)?.name ?? toCode;

  const handleSelectTrain = (runId: string, classCode: string) => {
    router.push(`/booking/${runId}?from=${fromCode}&to=${toCode}&class=${classCode}&date=${date}`);
  };

  return (
    <div className="space-y-6">
      {/* Route Header Banner */}
      <div className="bg-[#0C121E] border border-amber/30 rounded p-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="flex items-center space-x-3">
            <span className="font-mono text-2xl font-bold text-amber">{fromCode}</span>
            <span className="text-steel font-bold">➔</span>
            <span className="font-mono text-2xl font-bold text-amber">{toCode}</span>
          </div>
          <p className="text-xs text-steel mt-1">
            {fromStation} to {toStation} · Journey Date: <span className="text-chalk">{date}</span>
          </p>
        </div>

        <button
          onClick={() => router.push('/')}
          className="text-xs uppercase font-mono text-steel hover:text-amber border border-steel/30 px-3 py-1.5 rounded transition-colors"
        >
          Modify Search
        </button>
      </div>

      {/* Train Cards List */}
      <div className="space-y-4">
        {trains.map((train) => (
          <div
            key={train.trainNumber}
            className="bg-[#0C121E] border border-steel/20 rounded p-6 hover:border-steel/50 transition-colors shadow-lg"
          >
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-steel/20 pb-4 mb-4">
              <div>
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-xl font-bold text-chalk">
                    {train.trainNumber}
                  </span>
                  <span className="font-display text-lg text-amber uppercase font-semibold">
                    {train.trainName}
                  </span>
                </div>
                <p className="text-xs font-mono text-steel mt-0.5">
                  Departs Daily · Superfast Express
                </p>
              </div>

              {/* Schedule */}
              <div className="flex items-center space-x-6">
                <div>
                  <p className="font-mono text-lg font-bold text-chalk">{train.departureTime}</p>
                  <p className="text-[10px] font-mono text-steel">{fromCode}</p>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-mono text-steel">{train.duration}</span>
                  <div className="w-16 h-0.5 bg-steel/30 relative">
                    <span className="w-1.5 h-1.5 rounded-full bg-amber absolute right-0 -top-0.5" />
                  </div>
                </div>
                <div>
                  <p className="font-mono text-lg font-bold text-chalk">{train.arrivalTime}</p>
                  <p className="text-[10px] font-mono text-steel">{toCode}</p>
                </div>
              </div>
            </div>

            {/* Class Availability Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {train.classes.map((cls) => {
                const isAvailable = cls.availableSeats > 0;
                return (
                  <button
                    key={cls.code}
                    type="button"
                    onClick={() => handleSelectTrain(train.runId, cls.code)}
                    className="flex flex-col justify-between p-3 rounded bg-[#121A28] border border-steel/20 hover:border-amber transition-all text-left group"
                  >
                    <div className="flex items-center justify-between w-full">
                      <span className="font-mono font-bold text-sm text-chalk">{cls.code}</span>
                      <span className="font-mono text-xs font-semibold text-amber">
                        ₹{(cls.farePaise / 100).toLocaleString('en-IN')}
                      </span>
                    </div>

                    <div className="mt-3">
                      {isAvailable ? (
                        <p className="text-xs font-mono font-bold text-signal-green">
                          AVAILABLE {cls.availableSeats}
                        </p>
                      ) : (
                        <p className="text-xs font-mono font-bold text-amber">
                          WL {cls.waitlistCount}
                        </p>
                      )}
                      <p className="text-[10px] text-steel group-hover:text-amber transition-colors mt-0.5">
                        {isAvailable ? 'Click to Select Seats ➔' : 'Join Waitlist ➔'}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function TrainsPage() {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Suspense fallback={<div className="font-mono text-steel p-6">Loading trains…</div>}>
          <TrainsList />
        </Suspense>
      </main>
    </div>
  );
}
