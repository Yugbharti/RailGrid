export default function LoginPage() {
  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <div className="font-display text-4xl font-bold text-amber uppercase tracking-widest">
            RailGrid
          </div>
          <p className="text-steel text-sm mt-1">Sign in to your account</p>
        </div>

        <div className="bg-ink/50 border border-steel/30 rounded p-6 space-y-4">
          <div className="space-y-2">
            <label className="text-chalk/70 text-sm font-ui">Email</label>
            <input
              type="email"
              placeholder="you@example.com"
              className="w-full bg-ink border border-steel/40 rounded px-3 py-2 text-chalk placeholder-steel/50 text-sm focus:outline-none focus:border-amber/60"
            />
          </div>
          <div className="space-y-2">
            <label className="text-chalk/70 text-sm font-ui">Password</label>
            <input
              type="password"
              placeholder="••••••••"
              className="w-full bg-ink border border-steel/40 rounded px-3 py-2 text-chalk placeholder-steel/50 text-sm focus:outline-none focus:border-amber/60"
            />
          </div>
          <button className="w-full bg-amber text-ink font-display font-bold uppercase tracking-widest py-2 rounded text-sm hover:bg-amber/90 transition-colors">
            Sign In
          </button>
        </div>

        <div className="text-center space-y-2">
          <a href="/auth/forgot-password" className="text-steel text-sm hover:text-chalk transition-colors">
            Forgot password?
          </a>
          <div className="text-steel text-sm">
            No account?{' '}
            <a href="/auth/register" className="text-amber hover:text-amber/80 transition-colors">
              Register
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
