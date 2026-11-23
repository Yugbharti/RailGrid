'use client';

import { useEffect, useState } from 'react';

interface FlapProps {
  char: string;
}

function FlapChar({ char }: FlapProps) {
  const [displayChar, setDisplayChar] = useState(char);
  const [isFlipping, setIsFlipping] = useState(false);

  useEffect(() => {
    if (char !== displayChar) {
      setIsFlipping(true);
      const timer = setTimeout(() => {
        setDisplayChar(char);
        setIsFlipping(false);
      }, 150);
      return () => {
        clearTimeout(timer);
      };
    }
    return undefined;
  }, [char, displayChar]);

  return (
    <div className="relative inline-flex flex-col items-center justify-center w-7 h-10 bg-[#121824] border border-[#222F3E] text-amber font-mono font-bold text-lg select-none rounded-[2px] shadow-inner overflow-hidden">
      {/* Top half */}
      <span className={`transition-transform duration-150 ${isFlipping ? 'scale-y-0 opacity-40' : 'scale-y-100'}`}>
        {displayChar}
      </span>
      {/* Center line separator */}
      <div className="absolute top-1/2 left-0 right-0 h-[1px] bg-black/60 z-10" />
    </div>
  );
}

function FlapWord({ word, length = 12 }: { word: string; length?: number }) {
  const padded = word.toUpperCase().padEnd(length, ' ').slice(0, length);
  return (
    <div className="inline-flex space-x-[2px]">
      {padded.split('').map((c, i) => (
        <FlapChar key={i} char={c} />
      ))}
    </div>
  );
}

export interface DepartureItem {
  trainNo: string;
  trainName: string;
  from: string;
  to: string;
  time: string;
  platform: string;
  status: 'ON TIME' | 'DELAYED' | 'BOARDING' | 'CANCELLED';
  delayMin?: number;
}

const DEFAULT_DEPARTURES: DepartureItem[] = [
  { trainNo: '12002', trainName: 'BHOPAL SHTBDI', from: 'NDLS', to: 'BPL', time: '06:00', platform: 'PF 1', status: 'ON TIME' },
  { trainNo: '12919', trainName: 'MALWA EXPRESS', from: 'NDLS', to: 'JAT', time: '07:20', platform: 'PF 4', status: 'DELAYED', delayMin: 15 },
  { trainNo: '12301', trainName: 'HWH RAJDHANI', from: 'NDLS', to: 'HWH', time: '16:55', platform: 'PF 2', status: 'BOARDING' },
  { trainNo: '12952', trainName: 'MUMBAI RAJDHANI', from: 'NDLS', to: 'CSTM', time: '17:00', platform: 'PF 3', status: 'ON TIME' },
  { trainNo: '12626', trainName: 'KERALA EXPRESS', from: 'NDLS', to: 'TVC', time: '20:10', platform: 'PF 5', status: 'ON TIME' },
];

export function SplitFlapBoard() {
  const [departures, setDepartures] = useState(DEFAULT_DEPARTURES);

  // Periodically flip status to show dynamic mechanical animation
  useEffect(() => {
    const interval = setInterval(() => {
      setDepartures((prev) =>
        prev.map((d, i) => {
          if (i === 1) {
            const nextStatus = d.status === 'DELAYED' ? 'BOARDING' : 'DELAYED';
            return { ...d, status: nextStatus };
          }
          return d;
        }),
      );
    }, 12_000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="bg-[#080D16] border border-amber/30 rounded p-4 sm:p-6 shadow-2xl overflow-x-auto">
      <div className="flex items-center justify-between border-b border-amber/20 pb-3 mb-4">
        <div className="flex items-center space-x-3">
          <div className="w-2.5 h-2.5 rounded-full bg-signal-green animate-ping" />
          <h2 className="font-display text-xl sm:text-2xl font-bold uppercase tracking-widest text-amber">
            LIVE DEPARTURES BOARD
          </h2>
        </div>
        <div className="text-xs font-mono text-chalk/60 uppercase">
          NEW DELHI · NDLS
        </div>
      </div>

      <div className="min-w-[700px]">
        {/* Table Header */}
        <div className="grid grid-cols-12 text-xs font-mono text-steel uppercase mb-2 px-1">
          <div className="col-span-2">TRAIN NO</div>
          <div className="col-span-4">NAME</div>
          <div className="col-span-2">ROUTE</div>
          <div className="col-span-1">TIME</div>
          <div className="col-span-1 text-center">PLATFORM</div>
          <div className="col-span-2 text-right">STATUS</div>
        </div>

        {/* Departure Rows */}
        <div className="space-y-2">
          {departures.map((item) => (
            <div
              key={item.trainNo}
              className="grid grid-cols-12 items-center bg-[#0C121E] hover:bg-[#111A2B] px-2 py-1.5 rounded transition-colors border border-[#1A2434]"
            >
              <div className="col-span-2">
                <FlapWord word={item.trainNo} length={5} />
              </div>
              <div className="col-span-4">
                <FlapWord word={item.trainName} length={14} />
              </div>
              <div className="col-span-2 text-xs font-mono text-chalk/90">
                {item.from} → {item.to}
              </div>
              <div className="col-span-1 font-mono text-sm text-amber font-semibold">
                {item.time}
              </div>
              <div className="col-span-1 font-mono text-xs text-center text-chalk/80">
                {item.platform}
              </div>
              <div className="col-span-2 text-right">
                <span
                  className={`inline-block font-mono text-xs font-bold px-2 py-0.5 rounded ${
                    item.status === 'ON TIME'
                      ? 'bg-signal-green/20 text-signal-green border border-signal-green/40'
                      : item.status === 'DELAYED'
                      ? 'bg-amber/20 text-amber border border-amber/40'
                      : item.status === 'BOARDING'
                      ? 'bg-rail-blue/30 text-chalk border border-rail-blue'
                      : 'bg-signal-red/20 text-signal-red'
                  }`}
                >
                  {item.status} {item.delayMin ? `+${item.delayMin}M` : ''}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
