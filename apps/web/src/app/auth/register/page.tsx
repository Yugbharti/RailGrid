'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { setAuthToken } from '../../../lib/api';

export default function RegisterPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }

    setLoading(true);

    try {
      const apiUrl = (process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000').replace(/\/$/, '');
      const res = await fetch(`${apiUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error?.message ?? 'Registration failed.');
      }

      const data = await res.json();
      if (data.accessToken) {
        setAuthToken(data.accessToken);
      }
      router.push('/');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen flex items-center justify-center px-4 bg-ink text-chalk">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <Link href="/" className="inline-block">
            <div className="font-display text-4xl font-bold text-amber uppercase tracking-widest">
              RAIL<span className="text-chalk">GRID</span>
            </div>
          </Link>
          <p className="text-steel text-sm mt-1">Create passenger account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-[#0C121E] border border-steel/30 rounded p-6 space-y-4 shadow-xl"
        >
          {error && (
            <div className="p-3 bg-signal-red/10 border border-signal-red/30 rounded text-signal-red text-xs font-mono">
              {error}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-chalk/80 text-xs font-mono uppercase">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="passenger@railgrid.in"
              className="w-full bg-[#121A28] border border-steel/40 rounded px-3 py-2 text-chalk placeholder-steel/50 text-sm focus:outline-none focus:border-amber font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-chalk/80 text-xs font-mono uppercase">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full bg-[#121A28] border border-steel/40 rounded px-3 py-2 text-chalk placeholder-steel/50 text-sm focus:outline-none focus:border-amber font-mono"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-chalk/80 text-xs font-mono uppercase">Confirm Password</label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full bg-[#121A28] border border-steel/40 rounded px-3 py-2 text-chalk placeholder-steel/50 text-sm focus:outline-none focus:border-amber font-mono"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber text-ink font-display font-bold uppercase tracking-widest py-2.5 rounded text-sm hover:bg-amber/90 transition-colors disabled:opacity-50"
          >
            {loading ? 'CREATING ACCOUNT…' : 'CREATE ACCOUNT ➔'}
          </button>
        </form>

        <div className="text-center space-y-2">
          <div className="text-steel text-xs font-ui">
            Already registered?{' '}
            <Link href="/auth/login" className="text-amber hover:underline">
              Sign in
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
