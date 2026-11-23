'use client';

export interface TicketPassenger {
  name: string;
  age: number;
  gender: string;
  seatNo?: string;
  berthType?: string;
  status: string; // 'CNF' | 'WL 1'
}

export interface TicketStubProps {
  pnr: string;
  trainNumber: string;
  trainName: string;
  fromStation: string;
  fromStationName: string;
  toStation: string;
  toStationName: string;
  journeyDate: string;
  departureTime: string;
  arrivalTime: string;
  classCode: string;
  quota?: string;
  passengers: TicketPassenger[];
  farePaise: number;
  qrToken?: string;
  bookingStatus: 'CONFIRMED' | 'WAITLISTED' | 'CANCELLED';
  onCancelTicket?: () => void;
}

export function TicketStub({
  pnr,
  trainNumber,
  trainName,
  fromStation,
  fromStationName,
  toStation,
  toStationName,
  journeyDate,
  departureTime,
  arrivalTime,
  classCode,
  quota = 'GENERAL',
  passengers,
  farePaise,
  bookingStatus,
  onCancelTicket,
}: TicketStubProps) {
  const isCancelled = bookingStatus === 'CANCELLED';

  return (
    <div className="max-w-3xl mx-auto bg-[#F6F4EF] text-[#0B0F19] border-2 border-[#1D4ED8] rounded shadow-2xl overflow-hidden font-ui">
      {/* Header Bar */}
      <div className="bg-[#1D4ED8] text-chalk px-6 py-4 flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-amber inline-block" />
            <h2 className="font-display text-2xl font-bold tracking-widest uppercase">
              ELECTRONIC RESERVATION SLIP (ERS)
            </h2>
          </div>
          <p className="text-xs text-chalk/80 font-mono">
            INDIAN RAILWAYS PASSENGER RESERVATION SYSTEM · RAILGRID ENGINE
          </p>
        </div>

        <div className="text-right">
          <p className="text-[10px] font-mono uppercase text-chalk/70">PNR NUMBER</p>
          <p className="font-mono text-2xl font-bold text-amber tracking-widest">{pnr}</p>
        </div>
      </div>

      {/* Main Ticket Body */}
      <div className="p-6 space-y-6">
        {/* Status Stamp if Cancelled */}
        {isCancelled && (
          <div className="border-2 border-signal-red text-signal-red font-display text-2xl font-bold text-center py-2 uppercase tracking-widest bg-signal-red/10 rounded">
            CANCELLED · REFUND PROCESSED
          </div>
        )}

        {/* Train & Journey Meta */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 bg-white/70 border border-steel/20 rounded">
          <div>
            <span className="text-[10px] uppercase font-mono text-steel">TRAIN NO & NAME</span>
            <p className="font-bold font-display text-base text-[#0B0F19]">
              {trainNumber} / {trainName}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-steel">CLASS & QUOTA</span>
            <p className="font-bold font-display text-base text-[#0B0F19]">
              {classCode} · {quota}
            </p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-steel">JOURNEY DATE</span>
            <p className="font-bold font-display text-base text-[#0B0F19]">{journeyDate}</p>
          </div>
          <div>
            <span className="text-[10px] uppercase font-mono text-steel">BOOKING STATUS</span>
            <p
              className={`font-bold font-mono text-sm ${
                bookingStatus === 'CONFIRMED'
                  ? 'text-signal-green'
                  : bookingStatus === 'CANCELLED'
                  ? 'text-signal-red'
                  : 'text-amber'
              }`}
            >
              {bookingStatus}
            </p>
          </div>
        </div>

        {/* Stations & Schedule */}
        <div className="flex items-center justify-between p-4 bg-white border border-steel/20 rounded">
          <div>
            <p className="font-mono text-xl font-bold text-[#1D4ED8]">{fromStation}</p>
            <p className="text-xs text-steel">{fromStationName}</p>
            <p className="text-sm font-mono font-semibold mt-1">Dep: {departureTime}</p>
          </div>

          <div className="flex-1 mx-6 flex flex-col items-center">
            <span className="text-[11px] font-mono text-steel mb-1">DIRECT ROUTE</span>
            <div className="w-full h-0.5 bg-[#1D4ED8] relative flex items-center justify-center">
              <span className="w-2 h-2 rounded-full bg-[#1D4ED8]" />
            </div>
          </div>

          <div className="text-right">
            <p className="font-mono text-xl font-bold text-[#1D4ED8]">{toStation}</p>
            <p className="text-xs text-steel">{toStationName}</p>
            <p className="text-sm font-mono font-semibold mt-1">Arr: {arrivalTime}</p>
          </div>
        </div>

        {/* Passenger List Table */}
        <div>
          <h4 className="font-display text-sm font-bold uppercase tracking-wider text-steel mb-2">
            PASSENGER DETAILS
          </h4>
          <div className="border border-steel/20 rounded overflow-hidden">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#E5E7EB] text-[#374151]">
                <tr>
                  <th className="p-2.5">#</th>
                  <th className="p-2.5">PASSENGER NAME</th>
                  <th className="p-2.5">AGE / GENDER</th>
                  <th className="p-2.5">SEAT / BERTH</th>
                  <th className="p-2.5 text-right">STATUS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-steel/20 bg-white">
                {passengers.map((p, idx) => (
                  <tr key={idx} className="hover:bg-gray-50">
                    <td className="p-2.5 text-steel">{idx + 1}</td>
                    <td className="p-2.5 font-bold">{p.name}</td>
                    <td className="p-2.5">
                      {p.age} YRS / {p.gender}
                    </td>
                    <td className="p-2.5 font-bold text-[#1D4ED8]">
                      {p.seatNo ? `${p.seatNo} (${p.berthType ?? 'BERTH'})` : 'WL'}
                    </td>
                    <td className="p-2.5 text-right font-bold text-signal-green">
                      {p.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Perforated Divider */}
        <div className="border-t-2 border-dashed border-steel/40 my-4 relative">
          <div className="absolute -left-8 -top-3 w-6 h-6 rounded-full bg-ink" />
          <div className="absolute -right-8 -top-3 w-6 h-6 rounded-full bg-ink" />
        </div>

        {/* Fare & Barcode Section */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center space-x-4">
            {/* Simulated 2D QR Code Matrix */}
            <div className="w-20 h-20 bg-black p-1.5 flex flex-col justify-between rounded">
              <div className="flex justify-between">
                <div className="w-5 h-5 bg-white border-2 border-black" />
                <div className="w-5 h-5 bg-white border-2 border-black" />
              </div>
              <div className="w-full h-1 bg-white" />
              <div className="flex justify-between">
                <div className="w-5 h-5 bg-white border-2 border-black" />
                <div className="w-3 h-3 bg-white" />
              </div>
            </div>
            <div className="text-xs font-mono text-steel">
              <p className="font-bold text-[#0B0F19]">SECURE QR PASS</p>
              <p>Cryptographically Signed</p>
              <p>Valid with Gov Photo ID</p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] font-mono uppercase text-steel">TOTAL FARE PAID</span>
            <p className="font-mono text-2xl font-bold text-[#1D4ED8]">
              ₹{(farePaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
            </p>
            <p className="text-[10px] text-steel font-mono">Inclusive of GST & IRCTC Convenience Fee</p>
          </div>
        </div>

        {/* Actions */}
        <div className="flex flex-wrap items-center justify-end gap-3 pt-4 border-t border-steel/20">
          <button
            onClick={() => window.print()}
            type="button"
            className="px-4 py-2 text-xs font-display font-bold uppercase tracking-widest bg-steel/20 hover:bg-steel/30 text-[#0B0F19] rounded transition-colors"
          >
            Print Ticket
          </button>

          {!isCancelled && onCancelTicket && (
            <button
              onClick={onCancelTicket}
              type="button"
              className="px-4 py-2 text-xs font-display font-bold uppercase tracking-widest border border-signal-red text-signal-red hover:bg-signal-red hover:text-white rounded transition-colors"
            >
              Cancel Booking
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
