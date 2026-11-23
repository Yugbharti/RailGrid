'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Navbar } from '../../components/navbar';

interface BookingRecord {
  pnr: string;
  trainNo: string;
  trainName: string;
  from: string;
  to: string;
  date: string;
  status: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  farePaise: number;
  classCode: string;
}

const DEMO_BOOKINGS: BookingRecord[] = [
  {
    pnr: '2458192031',
    trainNo: '12002',
    trainName: 'Bhopal Shatabdi',
    from: 'NDLS',
    to: 'BPL',
    date: '2026-11-28',
    status: 'CONFIRMED',
    farePaise: 89000,
    classCode: 'CC',
  },
  {
    pnr: '2451029482',
    trainNo: '12919',
    trainName: 'Malwa Express',
    from: 'NDLS',
    to: 'JAT',
    date: '2026-11-15',
    status: 'CONFIRMED',
    farePaise: 42000,
    classCode: 'SL',
  },
  {
    pnr: '2457891244',
    trainNo: '12952',
    trainName: 'Mumbai Rajdhani',
    from: 'NDLS',
    to: 'CSTM',
    date: '2026-10-02',
    status: 'CANCELLED',
    farePaise: 185000,
    classCode: '3A',
  },
];

export default function MyBookingsPage() {
  const [activeTab, setActiveTab] = useState<'ALL' | 'ACTIVE' | 'CANCELLED'>('ALL');

  const filtered = DEMO_BOOKINGS.filter((b) => {
    if (activeTab === 'ACTIVE') return b.status === 'CONFIRMED';
    if (activeTab === 'CANCELLED') return b.status === 'CANCELLED';
    return true;
  });

  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-steel/20 pb-4">
          <div>
            <h1 className="font-display text-3xl font-bold uppercase tracking-wider text-chalk">
              MY RESERVATIONS
            </h1>
            <p className="text-xs text-steel font-mono">
              View confirmed e-tickets, manage cancellations, and track waitlist standings.
            </p>
          </div>

          <div className="flex space-x-2 font-mono text-xs">
            {(['ALL', 'ACTIVE', 'CANCELLED'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  activeTab === tab
                    ? 'bg-amber text-ink font-bold'
                    : 'bg-steel/20 text-steel hover:text-chalk'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          {filtered.map((b) => (
            <div
              key={b.pnr}
              className="bg-[#0C121E] border border-steel/20 rounded p-6 hover:border-steel/40 transition-colors flex flex-wrap items-center justify-between gap-4"
            >
              <div className="space-y-1">
                <div className="flex items-center space-x-3">
                  <span className="font-mono text-base font-bold text-amber tracking-wider">
                    PNR: {b.pnr}
                  </span>
                  <span
                    className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      b.status === 'CONFIRMED'
                        ? 'bg-signal-green/20 text-signal-green'
                        : 'bg-signal-red/20 text-signal-red'
                    }`}
                  >
                    {b.status}
                  </span>
                </div>
                <p className="font-display text-lg text-chalk font-semibold">
                  {b.trainNo} · {b.trainName}
                </p>
                <p className="text-xs font-mono text-steel">
                  {b.from} ➔ {b.to} · {b.classCode} · {b.date}
                </p>
              </div>

              <div className="flex items-center space-x-4">
                <div className="text-right">
                  <p className="text-[10px] font-mono uppercase text-steel">TOTAL FARE</p>
                  <p className="font-mono text-lg font-bold text-chalk">
                    ₹{(b.farePaise / 100).toLocaleString('en-IN')}
                  </p>
                </div>

                <Link
                  href={`/ticket/${b.pnr}?from=${b.from}&to=${b.to}&class=${b.classCode}&fare=${b.farePaise}`}
                  className="px-4 py-2 text-xs font-display font-bold uppercase tracking-wider bg-steel/20 hover:bg-amber hover:text-ink text-chalk rounded transition-colors"
                >
                  View Ticket ➔
                </Link>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
