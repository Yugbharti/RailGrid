'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Navbar } from '../../../components/navbar';
import { TicketStub } from '../../../components/ticket-stub';

function TicketContent({ pnr }: { pnr: string }) {
  const searchParams = useSearchParams();
  const fromCode = searchParams.get('from') ?? 'NDLS';
  const toCode = searchParams.get('to') ?? 'BPL';
  const classCode = searchParams.get('class') ?? 'CC';
  const fare = parseInt(searchParams.get('fare') ?? '98450');

  const [bookingStatus, setBookingStatus] = useState<'CONFIRMED' | 'CANCELLED'>('CONFIRMED');
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelDetails, setCancelDetails] = useState<{ refundPaise: number; feePaise: number } | null>(null);

  const handleCancelClick = () => {
    // Show cancellation modal with IRCTC tiered refund policy preview:
    // > 48h = 10% fee
    const fee = Math.round(fare * 0.1);
    const refund = fare - fee;
    setCancelDetails({ feePaise: fee, refundPaise: refund });
    setShowCancelModal(true);
  };

  const confirmCancellation = () => {
    setBookingStatus('CANCELLED');
    setShowCancelModal(false);
  };

  return (
    <div className="space-y-6">
      <TicketStub
        pnr={pnr}
        trainNumber="12002"
        trainName="Bhopal Shatabdi"
        fromStation={fromCode}
        fromStationName={fromCode === 'NDLS' ? 'New Delhi' : fromCode}
        toStation={toCode}
        toStationName={toCode === 'BPL' ? 'Bhopal Junction' : toCode}
        journeyDate={new Date(Date.now() + 86400000).toLocaleDateString('en-IN', {
          day: '2-digit',
          month: 'short',
          year: 'numeric',
        })}
        departureTime="06:00"
        arrivalTime="14:25"
        classCode={classCode}
        passengers={[
          {
            name: 'Ramesh Kumar',
            age: 28,
            gender: 'M',
            seatNo: 'C1-14',
            berthType: 'WINDOW',
            status: bookingStatus === 'CONFIRMED' ? 'CNF' : 'CANCELLED',
          },
        ]}
        farePaise={fare}
        bookingStatus={bookingStatus}
        onCancelTicket={handleCancelClick}
      />

      {/* Cancellation Confirmation Modal */}
      {showCancelModal && cancelDetails && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-[#0C121E] border border-signal-red/50 rounded max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="flex items-center space-x-2 text-signal-red">
              <span className="text-xl">⚠️</span>
              <h3 className="font-display text-xl uppercase tracking-wider font-bold">
                CONFIRM CANCELLATION
              </h3>
            </div>

            <p className="text-xs text-steel">
              Under IRCTC and RailGrid tiered cancellation rules, fees are calculated based on time remaining before departure:
            </p>

            <div className="bg-[#121A28] p-3 rounded font-mono text-xs space-y-1.5 border border-steel/20">
              <div className="flex justify-between text-steel">
                <span>Original Fare Paid</span>
                <span>₹{(fare / 100).toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between text-signal-red">
                <span>Cancellation Fee (&gt;48h: 10%)</span>
                <span>- ₹{(cancelDetails.feePaise / 100).toLocaleString('en-IN')}</span>
              </div>
              <div className="pt-2 border-t border-steel/20 flex justify-between font-bold text-signal-green text-sm">
                <span>Refund Amount Payable</span>
                <span>₹{(cancelDetails.refundPaise / 100).toLocaleString('en-IN')}</span>
              </div>
            </div>

            <p className="text-[10px] text-amber font-mono">
              ★ The vacated seat will be atomically offered to the next passenger on the waitlist.
            </p>

            <div className="flex items-center justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCancelModal(false)}
                className="px-4 py-2 text-xs font-mono text-steel hover:text-chalk"
              >
                Go Back
              </button>
              <button
                type="button"
                onClick={confirmCancellation}
                className="px-5 py-2 text-xs font-display font-bold uppercase tracking-wider bg-signal-red text-white hover:bg-signal-red/90 rounded transition-colors"
              >
                Confirm & Refund
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function TicketPage({ params }: { params: { pnr: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Suspense fallback={<div className="font-mono text-steel p-6">Loading ticket…</div>}>
          <TicketContent pnr={params.pnr} />
        </Suspense>
      </main>
    </div>
  );
}
