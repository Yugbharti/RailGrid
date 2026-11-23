'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { STATIONS } from '../lib/stations';

export function SearchForm() {
  const router = useRouter();
  const [fromStation, setFromStation] = useState('NDLS');
  const [toStation, setToStation] = useState('BPL');
  const [journeyDate, setJourneyDate] = useState(() => {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    return today.toISOString().split('T')[0]!;
  });
  const [travelClass, setTravelClass] = useState('ALL');

  const handleSwap = () => {
    const temp = fromStation;
    setFromStation(toStation);
    setToStation(temp);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (fromStation === toStation) {
      alert('Source and destination stations cannot be the same.');
      return;
    }
    const params = new URLSearchParams({
      from: fromStation,
      to: toStation,
      date: journeyDate,
      class: travelClass,
    });
    router.push(`/trains?${params.toString()}`);
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-[#0C121E] border border-amber/30 rounded p-4 sm:p-6 shadow-2xl space-y-4"
    >
      <div className="flex items-center justify-between border-b border-steel/20 pb-3">
        <h2 className="font-display text-xl uppercase tracking-wider text-chalk font-semibold">
          SEARCH TRAINS & BOOK
        </h2>
        <span className="text-xs font-mono text-amber">LIVE SEAT AVAILABILITY</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-center">
        {/* From Station */}
        <div className="md:col-span-4">
          <label className="block text-[10px] font-mono uppercase text-steel mb-1">
            FROM STATION
          </label>
          <select
            value={fromStation}
            onChange={(e) => setFromStation(e.target.value)}
            className="w-full bg-[#121A28] border border-steel/30 text-chalk rounded px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-amber"
          >
            {STATIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name} ({s.city})
              </option>
            ))}
          </select>
        </div>

        {/* Swap Button */}
        <div className="md:col-span-1 flex justify-center pt-4 md:pt-0">
          <button
            type="button"
            onClick={handleSwap}
            className="w-9 h-9 rounded-full bg-steel/20 hover:bg-amber hover:text-ink text-chalk flex items-center justify-center font-bold text-base transition-colors"
            title="Swap source and destination"
          >
            ⇄
          </button>
        </div>

        {/* To Station */}
        <div className="md:col-span-4">
          <label className="block text-[10px] font-mono uppercase text-steel mb-1">
            TO STATION
          </label>
          <select
            value={toStation}
            onChange={(e) => setToStation(e.target.value)}
            className="w-full bg-[#121A28] border border-steel/30 text-chalk rounded px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-amber"
          >
            {STATIONS.map((s) => (
              <option key={s.code} value={s.code}>
                {s.code} · {s.name} ({s.city})
              </option>
            ))}
          </select>
        </div>

        {/* Journey Date */}
        <div className="md:col-span-3">
          <label className="block text-[10px] font-mono uppercase text-steel mb-1">
            JOURNEY DATE
          </label>
          <input
            type="date"
            value={journeyDate}
            min={new Date().toISOString().split('T')[0]}
            onChange={(e) => setJourneyDate(e.target.value)}
            className="w-full bg-[#121A28] border border-steel/30 text-chalk rounded px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-amber"
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
        <div className="flex items-center space-x-2">
          <label className="text-[10px] font-mono uppercase text-steel">CLASS:</label>
          <div className="flex space-x-1.5 font-mono text-xs">
            {['ALL', 'SL', '3A', '2A', 'CC'].map((cls) => (
              <button
                key={cls}
                type="button"
                onClick={() => setTravelClass(cls)}
                className={`px-2.5 py-1 rounded transition-colors ${
                  travelClass === cls
                    ? 'bg-amber text-ink font-bold'
                    : 'bg-steel/20 text-chalk/70 hover:text-chalk'
                }`}
              >
                {cls}
              </button>
            ))}
          </div>
        </div>

        <button
          type="submit"
          className="bg-amber hover:bg-amber/90 text-ink font-display font-bold uppercase tracking-widest px-8 py-2.5 rounded text-sm transition-all shadow-[0_0_15px_rgba(255,180,0,0.4)]"
        >
          FIND TRAINS ➔
        </button>
      </div>
    </form>
  );
}
