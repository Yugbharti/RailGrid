'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { getAuthToken, removeAuthToken } from '../lib/api';

export function Navbar() {
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    setHasToken(!!getAuthToken());
  }, []);

  const handleLogout = () => {
    removeAuthToken();
    setHasToken(false);
    window.location.href = '/';
  };

  return (
    <header className="sticky top-0 z-50 bg-ink/90 backdrop-blur border-b border-steel/20 px-4 py-3">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        <div className="flex items-center space-x-6">
          <Link href="/" className="flex items-center space-x-2 group">
            <span className="w-3 h-3 rounded-full bg-amber inline-block group-hover:scale-125 transition-transform" />
            <span className="font-display text-2xl font-bold tracking-widest text-chalk uppercase">
              RAIL<span className="text-amber">GRID</span>
            </span>
          </Link>

          <nav className="hidden md:flex items-center space-x-5 text-sm font-ui tracking-wide">
            <Link
              href="/"
              className="text-chalk/80 hover:text-amber transition-colors"
            >
              Book Tickets
            </Link>
            <Link
              href="/#departures"
              className="text-chalk/80 hover:text-amber transition-colors"
            >
              Live Departures
            </Link>
            <Link
              href="/my-bookings"
              className="text-chalk/80 hover:text-amber transition-colors"
            >
              My Bookings
            </Link>
          </nav>
        </div>

        <div className="flex items-center space-x-4">
          <span className="hidden sm:inline-flex items-center text-xs text-amber font-mono bg-amber/10 border border-amber/30 px-2.5 py-1 rounded">
            IRCTC TESTBED
          </span>

          {hasToken ? (
            <button
              onClick={handleLogout}
              className="text-xs uppercase font-display tracking-widest text-chalk/70 hover:text-signal-red px-3 py-1.5 border border-steel/30 rounded transition-colors"
            >
              Log Out
            </button>
          ) : (
            <Link
              href="/auth/login"
              className="text-xs uppercase font-display font-semibold tracking-widest bg-amber text-ink hover:bg-amber/90 px-4 py-1.5 rounded transition-colors"
            >
              Sign In
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
