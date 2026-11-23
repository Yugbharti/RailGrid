'use client';

import { useState } from 'react';

export interface SeatItem {
  id: string;
  seatNo: number;
  coach: string;
  berthType: 'LB' | 'MB' | 'UB' | 'SL' | 'SU' | 'WINDOW' | 'AISLE';
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'SELECTED';
  pricePaise: number;
}

interface CoachMapProps {
  classCode: string;
  onSeatsChange: (selectedSeats: SeatItem[]) => void;
  maxSeats?: number;
}

// Generate demo coach layout with realistic berth distribution
function generateDemoSeats(classCode: string): SeatItem[] {
  const seats: SeatItem[] = [];
  const coach = classCode === 'SL' ? 'S1' : classCode === '3A' ? 'B1' : classCode === '2A' ? 'A1' : 'C1';
  const totalSeats = classCode === 'SL' ? 72 : classCode === '3A' ? 64 : classCode === '2A' ? 48 : 78;

  const berthCycle =
    classCode === 'CC'
      ? (['WINDOW', 'AISLE', 'AISLE', 'WINDOW'] as const)
      : classCode === '2A'
      ? (['LB', 'UB', 'LB', 'UB', 'SL', 'SU'] as const)
      : (['LB', 'MB', 'UB', 'LB', 'MB', 'UB', 'SL', 'SU'] as const);

  for (let i = 1; i <= totalSeats; i++) {
    const berthType = berthCycle[(i - 1) % berthCycle.length]!;
    // Demo statuses: a few booked and held
    const isBooked = i % 7 === 0 || i % 11 === 0;
    const isHeld = i % 17 === 0;
    const basePaise = classCode === 'SL' ? 45_000 : classCode === '3A' ? 120_000 : classCode === '2A' ? 180_000 : 85_000;

    seats.push({
      id: `${coach}-${i}`,
      seatNo: i,
      coach,
      berthType,
      status: isBooked ? 'BOOKED' : isHeld ? 'HELD' : 'AVAILABLE',
      pricePaise: basePaise,
    });
  }

  return seats;
}

export function CoachMap({ classCode, onSeatsChange, maxSeats = 6 }: CoachMapProps) {
  const [seats, setSeats] = useState<SeatItem[]>(() => generateDemoSeats(classCode));
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const handleSeatClick = (seat: SeatItem) => {
    if (seat.status === 'BOOKED' || seat.status === 'HELD') return;

    let newSelected: string[];
    if (selectedIds.includes(seat.id)) {
      newSelected = selectedIds.filter((id) => id !== seat.id);
    } else {
      if (selectedIds.length >= maxSeats) {
        alert(`You can select up to ${maxSeats} passengers/seats per booking.`);
        return;
      }
      newSelected = [...selectedIds, seat.id];
    }

    setSelectedIds(newSelected);
    const selectedSeatObjects = seats.filter((s) => newSelected.includes(s.id));
    onSeatsChange(selectedSeatObjects);
  };

  return (
    <div className="bg-[#0C121E] border border-steel/20 rounded p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h3 className="font-display text-xl uppercase tracking-wider text-amber font-semibold">
            SEGMENT-AWARE COACH MAP · {classCode}
          </h3>
          <p className="text-xs text-steel">
            Click seats to assign to passengers (max {maxSeats} seats).
          </p>
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 text-xs font-mono">
          <div className="flex items-center space-x-1.5">
            <span className="w-3.5 h-3.5 rounded-sm bg-[#162030] border border-steel/40" />
            <span className="text-chalk/80">Available</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3.5 h-3.5 rounded-sm bg-amber border border-amber" />
            <span className="text-amber">Selected</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3.5 h-3.5 rounded-sm bg-amber/40 border border-amber/60 animate-pulse" />
            <span className="text-amber/80">Held (10m)</span>
          </div>
          <div className="flex items-center space-x-1.5">
            <span className="w-3.5 h-3.5 rounded-sm bg-signal-red/20 border border-signal-red/40" />
            <span className="text-steel">Occupied</span>
          </div>
        </div>
      </div>

      {/* Coach Layout representation */}
      <div className="border border-steel/30 rounded p-4 bg-[#080D16] overflow-x-auto">
        <div className="min-w-[600px] grid grid-cols-8 gap-2">
          {seats.map((seat) => {
            const isSelected = selectedIds.includes(seat.id);
            const isAvailable = seat.status === 'AVAILABLE';
            const isHeld = seat.status === 'HELD';
            const isBooked = seat.status === 'BOOKED';

            return (
              <button
                key={seat.id}
                type="button"
                disabled={!isAvailable && !isSelected}
                onClick={() => handleSeatClick(seat)}
                className={`relative flex flex-col items-center justify-center p-2 rounded transition-all font-mono text-xs ${
                  isSelected
                    ? 'bg-amber text-ink font-bold shadow-[0_0_12px_rgba(255,180,0,0.8)] scale-105'
                    : isAvailable
                    ? 'bg-[#121A28] border border-steel/30 text-chalk hover:border-amber hover:bg-[#1A2538]'
                    : isHeld
                    ? 'bg-amber/20 border border-amber/40 text-amber/70 cursor-not-allowed animate-pulse'
                    : 'bg-[#1E1116] border border-signal-red/20 text-steel/40 cursor-not-allowed'
                }`}
              >
                <span className="text-sm font-bold">{seat.seatNo}</span>
                <span className="text-[10px] opacity-80">{seat.berthType}</span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedIds.length > 0 && (
        <div className="mt-4 p-3 bg-amber/10 border border-amber/30 rounded flex items-center justify-between text-xs">
          <span className="text-chalk font-mono">
            {selectedIds.length} seat(s) selected: {selectedIds.join(', ')}
          </span>
          <span className="text-amber font-mono font-bold text-sm">
            Total: ₹
            {(
              seats
                .filter((s) => selectedIds.includes(s.id))
                .reduce((acc, s) => acc + s.pricePaise, 0) / 100
            ).toLocaleString('en-IN')}
          </span>
        </div>
      )}
    </div>
  );
}
