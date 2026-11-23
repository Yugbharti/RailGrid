import { Navbar } from '../components/navbar';
import { SearchForm } from '../components/search-form';
import { SplitFlapBoard } from '../components/split-flap-board';
import { LiveStatusBoard } from '../components/live-status-board';

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col bg-ink text-chalk">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-8 space-y-12">
        {/* Hero Section */}
        <div className="space-y-4 text-center max-w-3xl mx-auto pt-4">
          <div className="inline-flex items-center space-x-2 bg-amber/10 border border-amber/30 px-3 py-1 rounded-full text-xs font-mono text-amber">
            <span>HIGH-CONCURRENCY TICKETING ENGINE</span>
          </div>
          <h1 className="font-display text-4xl sm:text-6xl font-extrabold uppercase tracking-widest text-chalk">
            REVOLUTIONIZING <span className="text-amber">RAILWAY RESERVATIONS</span>
          </h1>
          <p className="text-steel text-sm sm:text-base font-ui max-w-2xl mx-auto">
            Zero double-bookings via PostgreSQL GiST segment exclusion locks, 10-minute atomic hold windows, live split-flap telemetry, and instant waitlist promotions.
          </p>
        </div>

        {/* Search Box */}
        <div className="max-w-4xl mx-auto">
          <SearchForm />
        </div>

        {/* Split-Flap Live Departure Board */}
        <section id="departures" className="space-y-4">
          <SplitFlapBoard />
        </section>

        {/* Live Running Telemetry */}
        <section className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <LiveStatusBoard />

          <div className="bg-[#0C121E] border border-steel/20 rounded p-6 flex flex-col justify-between">
            <div>
              <div className="flex items-center space-x-2 text-amber font-mono text-xs uppercase mb-3">
                <span className="w-2 h-2 rounded-full bg-amber" />
                <span>ARCHITECTURAL GUARANTEES</span>
              </div>
              <h3 className="font-display text-2xl uppercase tracking-wide text-chalk font-bold mb-3">
                BUILT FOR THE INDIAN RAILWAY SCALE
              </h3>
              <ul className="space-y-2 text-xs sm:text-sm text-steel font-ui">
                <li className="flex items-start space-x-2">
                  <span className="text-amber">✓</span>
                  <span><strong>GiST Segment Exclusion:</strong> Impossible for two passengers to book overlapping segments on the same berth.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-amber">✓</span>
                  <span><strong>SKIP LOCKED Hold Expiry:</strong> 30-second automated sweeps reclaim abandoned seats without table lock contention.</span>
                </li>
                <li className="flex items-start space-x-2">
                  <span className="text-amber">✓</span>
                  <span><strong>Tiered Refund Policy:</strong> Automatic fee computation per IRCTC rules with atomic waitlist promotion.</span>
                </li>
              </ul>
            </div>

            <div className="mt-6 pt-4 border-t border-steel/20 flex items-center justify-between text-xs font-mono text-steel">
              <span>STATUS: PRODUCTION-READY TESTBED</span>
              <span className="text-signal-green">NEON POSTGRESQL · REDIS 7</span>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-steel/20 py-8 bg-[#080D16] text-center text-xs text-steel font-ui">
        <p>© 2026 RailGrid Architecture · Developed for High-Concurrency Ticketing Research.</p>
        <p className="mt-1 text-steel/60">Demo system · Not affiliated with IRCTC or Indian Railways.</p>
      </footer>
    </div>
  );
}
