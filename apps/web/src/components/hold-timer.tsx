'use client';

import { useEffect, useState } from 'react';

interface HoldTimerProps {
  expiresAt: string | Date;
  onExpire?: () => void;
}

export function HoldTimer({ expiresAt, onExpire }: HoldTimerProps) {
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() => {
    const end = new Date(expiresAt).getTime();
    return Math.max(0, Math.floor((end - Date.now()) / 1000));
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const end = new Date(expiresAt).getTime();
      const diff = Math.max(0, Math.floor((end - Date.now()) / 1000));
      setSecondsRemaining(diff);

      if (diff === 0) {
        clearInterval(interval);
        onExpire?.();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [expiresAt, onExpire]);

  const minutes = Math.floor(secondsRemaining / 60);
  const seconds = secondsRemaining % 60;
  const isUrgent = secondsRemaining < 120 && secondsRemaining > 0;
  const isExpired = secondsRemaining === 0;

  // 10 minutes (600s) full scale
  const percent = Math.min(100, Math.max(0, (secondsRemaining / 600) * 100));

  return (
    <div
      role="timer"
      aria-live="polite"
      className={`border rounded p-4 flex flex-col sm:flex-row items-center justify-between gap-3 ${
        isExpired
          ? 'bg-signal-red/10 border-signal-red/40 text-signal-red'
          : isUrgent
          ? 'bg-signal-red/10 border-signal-red animate-pulse text-signal-red'
          : 'bg-amber/10 border-amber/40 text-chalk'
      }`}
    >
      <div className="flex items-center space-x-3">
        <div
          className={`w-3 h-3 rounded-full ${
            isExpired ? 'bg-signal-red' : isUrgent ? 'bg-signal-red' : 'bg-amber'
          }`}
        />
        <div>
          <p className="text-xs uppercase font-mono tracking-wider text-steel">
            SEATS TEMPORARILY RESERVED
          </p>
          <p className="text-sm font-ui">
            {isExpired
              ? 'Reservation hold has expired. Please select seats again.'
              : isUrgent
              ? 'Urgent: Complete payment before your reservation releases!'
              : 'Complete payment before the timer reaches zero to confirm your booking.'}
          </p>
        </div>
      </div>

      <div className="flex items-center space-x-3">
        <div className="font-mono text-2xl font-bold tracking-widest text-chalk">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </div>
        <div className="w-16 h-2 bg-steel/30 rounded-full overflow-hidden">
          <div
            className={`h-full transition-all duration-1000 ${
              isUrgent ? 'bg-signal-red' : 'bg-amber'
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
    </div>
  );
}
