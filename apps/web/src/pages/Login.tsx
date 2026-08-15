import { FormEvent, useCallback, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/useAuth';
import { ApiError } from '../lib/http';

/**
 * Stage 7 login — the only unauthenticated staff surface. Username + password
 * against POST /auth/login; the access token stays in memory, the refresh
 * token is persisted (see lib/auth.ts for the documented rationale). On
 * success the user is returned to the path they were trying to reach
 * (?returnTo=…), defaulting to Registration.
 */
export function Login() {
  const { user, loading, login } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const returnTo = params.get('returnTo') ?? '/register';

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!username.trim() || !password) {
        setError('Enter your username and password.');
        return;
      }
      setSubmitting(true);
      setError('');
      try {
        await login(username.trim(), password);
        navigate(returnTo, { replace: true });
      } catch (err) {
        setError(
          err instanceof ApiError
            ? err.message
            : 'Sign-in is temporarily unavailable. Please try again.',
        );
      } finally {
        setSubmitting(false);
      }
    },
    [username, password, login, navigate, returnTo],
  );

  if (!loading && user) {
    return <Navigate to={returnTo} replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-800 shadow-sm">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#5eead4" strokeWidth="1.6" />
              <path d="M4.5 4.5h1.6v7H4.5zm2.7 0h1.6v4.8H7.2zm2.7 0h1.6v7H9.9z" fill="#5eead4" />
            </svg>
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-800">Sign in to Thulir LIMS</h1>
          <p className="mt-1 text-sm text-slate-500">Use your lab staff username and password.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Username</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>

          {error && (
            <p className="mt-3 rounded-md bg-rose-50 px-3 py-2 text-[13px] font-medium text-rose-700">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting || loading}
            className="mt-5 inline-flex h-10 w-full items-center justify-center rounded-lg bg-brand-700 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Protected area — staff accounts only. Contact your lab administrator for access.
        </p>
      </div>
    </div>
  );
}
