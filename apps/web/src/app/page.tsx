export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4">
      <div className="text-center space-y-6 max-w-2xl">
        {/* Split-flap board header */}
        <div className="font-display text-6xl font-bold tracking-widest text-amber uppercase">
          RAILGRID
        </div>
        <p className="font-display text-2xl text-chalk/70 tracking-wide uppercase">
          Train Ticket Booking
        </p>
        <div className="w-full h-px bg-steel/30" />
        <p className="text-steel text-sm">
          Demo system · Not affiliated with IRCTC or Indian Railways ·{' '}
          <span className="text-amber">Test mode payments only</span>
        </p>

        {/* Status board placeholder */}
        <div className="bg-ink border border-steel/30 rounded p-6 font-mono text-sm text-left">
          <div className="text-steel mb-2">── DEPARTURE BOARD ──────────────────</div>
          <div className="flex justify-between text-chalk/50">
            <span>TRAIN</span>
            <span>DEPARTS</span>
            <span>STATUS</span>
          </div>
          <div className="mt-2 text-chalk/30 text-center py-4">
            Search to see trains...
          </div>
        </div>

        <a
          href="/auth/login"
          className="inline-block bg-amber text-ink font-display font-bold uppercase tracking-widest px-8 py-3 rounded text-sm hover:bg-amber/90 transition-colors"
        >
          Get Started
        </a>
      </div>
    </main>
  );
}
