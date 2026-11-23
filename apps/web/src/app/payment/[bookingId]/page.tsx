'use client';

import { Suspense, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { Navbar } from '../../../components/navbar';
import { HoldTimer } from '../../../components/hold-timer';

function PaymentContent({ bookingId }: { bookingId: string }) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const fromCode = searchParams.get('from') ?? 'NDLS';
  const toCode = searchParams.get('to') ?? 'BPL';
  const classCode = searchParams.get('class') ?? 'CC';
  const paxCount = parseInt(searchParams.get('pax') ?? '1');

  // Hold expires in 10 minutes from now
  const [expiresAt] = useState(() => new Date(Date.now() + 10 * 60_000));
  const [isProcessing, setIsProcessing] = useState(false);

  const baseFarePaise = classCode === 'SL' ? 42_000 : classCode === '3A' ? 110_000 : 165_000;
  const totalBase = baseFarePaise * paxCount;
  const reservationFee = 4_000 * paxCount;
  const gst = Math.round(totalBase * 0.05);
  const grandTotalPaise = totalBase + reservationFee + gst;

  const handlePayNow = async () => {
    setIsProcessing(true);
    // Simulate instant test payment verification
    setTimeout(() => {
      const pnr = '245' + String(Math.floor(1_000_000 + Math.random() * 9_000_000));
      router.push(`/ticket/${pnr}?from=${fromCode}&to=${toCode}&class=${classCode}&fare=${grandTotalPaise}&pax=${paxCount}`);
    }, 800);
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Hold Timer Banner */}
      <HoldTimer
        expiresAt={expiresAt}
        onExpire={() => {
          alert('Seat reservation hold has expired. Please reselect your journey.');
          router.push('/');
        }}
      />

      {/* Order Summary Card */}
      <div className="bg-[#0C121E] border border-steel/20 rounded p-6 shadow-xl space-y-6">
        <div className="flex items-center justify-between border-b border-steel/20 pb-4">
          <div>
            <h2 className="font-display text-2xl uppercase tracking-wider text-chalk font-bold">
              PAYMENT CHECKOUT
            </h2>
            <p className="text-xs font-mono text-steel mt-0.5">
              ORDER #{bookingId.toUpperCase().slice(0, 14)}
            </p>
          </div>
          <span className="font-mono text-xs text-amber bg-amber/10 border border-amber/30 px-2.5 py-1 rounded">
            TEST MODE GATEWAY
          </span>
        </div>

        {/* Journey details */}
        <div className="p-4 bg-[#121A28] rounded border border-steel/20 flex items-center justify-between font-mono text-xs">
          <div>
            <p className="text-steel uppercase text-[10px]">ROUTE & CLASS</p>
            <p className="text-sm font-bold text-chalk mt-0.5">
              {fromCode} ➔ {toCode} ({classCode})
            </p>
          </div>
          <div className="text-right">
            <p className="text-steel uppercase text-[10px]">PASSENGERS</p>
            <p className="text-sm font-bold text-chalk mt-0.5">{paxCount} Adult(s)</p>
          </div>
        </div>

        {/* Fare Breakdown */}
        <div className="space-y-2 font-mono text-xs">
          <div className="flex justify-between text-steel">
            <span>Base Fare ({paxCount} Passenger(s))</span>
            <span>₹{(totalBase / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-steel">
            <span>Reservation & Superfast Charge</span>
            <span>₹{(reservationFee / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="flex justify-between text-steel">
            <span>Goods & Services Tax (GST 5%)</span>
            <span>₹{(gst / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
          <div className="pt-3 border-t border-steel/20 flex justify-between text-base font-bold text-amber">
            <span>TOTAL AMOUNT PAYABLE</span>
            <span>₹{(grandTotalPaise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>

        {/* Payment Gate CTA */}
        <div className="pt-4 border-t border-steel/20 space-y-3">
          <button
            onClick={handlePayNow}
            disabled={isProcessing}
            className="w-full bg-signal-green hover:bg-signal-green/90 text-ink font-display font-bold uppercase tracking-widest py-3.5 rounded text-base transition-all shadow-[0_0_15px_rgba(47,191,113,0.4)] disabled:opacity-50"
          >
            {isProcessing ? 'AUTHORIZING PAYMENT…' : `PAY ₹${(grandTotalPaise / 100).toLocaleString('en-IN')} (TEST GATEWAY)`}
          </button>

          <p className="text-center text-[10px] text-steel font-mono">
            Simulated Razorpay HMAC signature exchange with transactional outbox event.
          </p>
        </div>
      </div>
    </div>
  );
}

export default function PaymentPage({ params }: { params: { bookingId: string } }) {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8">
        <Suspense fallback={<div className="font-mono text-steel p-6">Loading checkout…</div>}>
          <PaymentContent bookingId={params.bookingId} />
        </Suspense>
      </main>
    </div>
  );
}
