'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Navbar } from '../../../components/navbar';
import { JourneyRibbon, type StopInfo } from '../../../components/journey-ribbon';
import { CoachMap, type SeatItem } from '../../../components/coach-map';

interface PassengerForm {
  name: string;
  age: number;
  gender: 'M' | 'F' | 'O';
  berthPreference: string;
}

const DEMO_STOPS: StopInfo[] = [
  { stationCode: 'NDLS', stationName: 'New Delhi', arrivalTime: '-', departureTime: '06:00', distanceKm: 0, haltMinutes: 0 },
  { stationCode: 'AGC', stationName: 'Agra Cantt', arrivalTime: '07:50', departureTime: '07:55', distanceKm: 195, haltMinutes: 5 },
  { stationCode: 'GWL', stationName: 'Gwalior Jn', arrivalTime: '09:23', departureTime: '09:28', distanceKm: 313, haltMinutes: 5 },
  { stationCode: 'VGLJ', stationName: 'V Lakshmibai Jhansi', arrivalTime: '10:45', departureTime: '10:50', distanceKm: 410, haltMinutes: 5 },
  { stationCode: 'BPL', stationName: 'Bhopal Junction', arrivalTime: '14:25', departureTime: '-', distanceKm: 705, haltMinutes: 0 },
];

function BookingContent({ runId }: { runId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const fromCode = searchParams.get('from') ?? 'NDLS';
  const toCode = searchParams.get('to') ?? 'BPL';
  const classCode = searchParams.get('class') ?? 'CC';

  const [selectedSeats, setSelectedSeats] = useState<SeatItem[]>([]);
  const [passengers, setPassengers] = useState<PassengerForm[]>([
    { name: '', age: 28, gender: 'M', berthPreference: 'NO_PREFERENCE' },
  ]);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const addPassenger = () => {
    if (passengers.length >= 6) {
      alert('Maximum 6 passengers allowed per booking.');
      return;
    }
    setPassengers([...passengers, { name: '', age: 25, gender: 'M', berthPreference: 'NO_PREFERENCE' }]);
  };

  const removePassenger = (index: number) => {
    if (passengers.length === 1) return;
    setPassengers(passengers.filter((_, i) => i !== index));
  };

  const updatePassenger = (index: number, field: keyof PassengerForm, value: unknown) => {
    setPassengers(
      passengers.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const handleHoldAndProceed = async (e: React.FormEvent) => {
    e.preventDefault();
    for (const p of passengers) {
      if (!p.name.trim()) {
        alert('Please fill all passenger names.');
        return;
      }
    }

    setIsSubmitting(true);
    // Simulate booking hold creation (or direct API call if running)
    setTimeout(() => {
      const demoBookingId = `bkg_${Date.now()}`;
      router.push(
        `/payment/${demoBookingId}?from=${fromCode}&to=${toCode}&class=${classCode}&seats=${selectedSeats.map((s) => s.seatNo).join(',')}&pax=${passengers.length}`,
      );
    }, 400);
  };

  const totalPaise =
    selectedSeats.length > 0
      ? selectedSeats.reduce((acc, s) => acc + s.pricePaise, 0)
      : passengers.length * (classCode === 'SL' ? 42_000 : classCode === '3A' ? 110_000 : 165_000);

  return (
    <div className="space-y-8">
      {/* Train & Journey Ribbon */}
      <JourneyRibbon stops={DEMO_STOPS} fromCode={fromCode} toCode={toCode} />

      {/* Coach Map */}
      <CoachMap classCode={classCode} onSeatsChange={setSelectedSeats} maxSeats={6} />

      {/* Passenger Details Form */}
      <form onSubmit={handleHoldAndProceed} className="bg-[#0C121E] border border-steel/20 rounded p-6 space-y-6">
        <div className="flex items-center justify-between border-b border-steel/20 pb-4">
          <div>
            <h3 className="font-display text-xl uppercase tracking-wider text-chalk font-semibold">
              PASSENGER DETAILS
            </h3>
            <p className="text-xs text-steel">
              Enter names exactly as they appear on government photo ID.
            </p>
          </div>

          <button
            type="button"
            onClick={addPassenger}
            disabled={passengers.length >= 6}
            className="text-xs uppercase font-mono text-amber hover:text-amber/80 border border-amber/40 px-3 py-1.5 rounded transition-colors disabled:opacity-40"
          >
            + Add Passenger ({passengers.length}/6)
          </button>
        </div>

        <div className="space-y-4">
          {passengers.map((p, idx) => (
            <div
              key={idx}
              className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-center p-3 bg-[#121A28] rounded border border-steel/20"
            >
              <div className="sm:col-span-1 font-mono text-xs text-amber font-bold">
                #{idx + 1}
              </div>

              <div className="sm:col-span-5">
                <label className="block text-[10px] font-mono uppercase text-steel mb-1">
                  FULL NAME
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Ramesh Kumar"
                  value={p.name}
                  onChange={(e) => updatePassenger(idx, 'name', e.target.value)}
                  className="w-full bg-[#080D16] border border-steel/30 text-chalk rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-mono uppercase text-steel mb-1">
                  AGE
                </label>
                <input
                  type="number"
                  min="1"
                  max="120"
                  required
                  value={p.age}
                  onChange={(e) => updatePassenger(idx, 'age', parseInt(e.target.value) || 1)}
                  className="w-full bg-[#080D16] border border-steel/30 text-chalk rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block text-[10px] font-mono uppercase text-steel mb-1">
                  GENDER
                </label>
                <select
                  value={p.gender}
                  onChange={(e) => updatePassenger(idx, 'gender', e.target.value as 'M' | 'F' | 'O')}
                  className="w-full bg-[#080D16] border border-steel/30 text-chalk rounded px-3 py-2 text-xs font-mono focus:outline-none focus:border-amber"
                >
                  <option value="M">Male</option>
                  <option value="F">Female</option>
                  <option value="O">Other</option>
                </select>
              </div>

              <div className="sm:col-span-2 flex items-end justify-between">
                {passengers.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removePassenger(idx)}
                    className="text-xs text-signal-red hover:underline font-mono pb-2"
                  >
                    Remove
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Fare Summary & CTA */}
        <div className="pt-4 border-t border-steel/20 flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-mono text-steel">ESTIMATED TOTAL FARE</p>
            <p className="font-mono text-2xl font-bold text-amber">
              ₹{(totalPaise / 100).toLocaleString('en-IN')}
            </p>
            <p className="text-[10px] text-steel">Includes 10-minute atomic seat hold lock</p>
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="bg-amber hover:bg-amber/90 text-ink font-display font-bold uppercase tracking-widest px-8 py-3 rounded text-sm transition-all shadow-[0_0_15px_rgba(255,180,0,0.5)] disabled:opacity-50"
          >
            {isSubmitting ? 'HOLDING SEATS…' : 'HOLD SEATS & PROCEED ➔'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default function BookingPage({ params }: { params: { runId: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Suspense fallback={<div className="font-mono text-steel p-6">Loading booking details…</div>}>
          <BookingContent runId={params.runId} />
        </Suspense>
      </main>
    </div>
  );
}
