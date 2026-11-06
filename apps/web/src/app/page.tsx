import { LiveStatusBoard } from '../components/live-status-board';

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

        <LiveStatusBoard />

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
