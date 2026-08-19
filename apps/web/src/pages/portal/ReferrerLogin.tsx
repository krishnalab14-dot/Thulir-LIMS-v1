import { FormEvent, useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../auth/usePortalAuth';
import { referrerLogin } from '../../lib/portal-auth';
import { ApiError } from '../../lib/http';

/**
 * Stage 8: Referrer portal login — username + password (admin-issued
 * credentials). Same calm visual register as the patient login.
 */
export function ReferrerLogin() {
  const { portalUser, loading } = usePortalAuth();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

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
        await referrerLogin(username.trim(), password);
        navigate('/portal/referrer', { replace: true });
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
    [username, password, navigate],
  );

  if (!loading && portalUser) {
    return <Navigate to="/portal/referrer" replace />;
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-brand-700 shadow-sm">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#5eead4" strokeWidth="1.6" />
              <path d="M4.5 4.5h1.6v7H4.5zm2.7 0h1.6v4.8H7.2zm2.7 0h1.6v7H9.9z" fill="#5eead4" />
            </svg>
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-800">Referrer Portal</h1>
          <p className="mt-1 text-sm text-slate-500">View your referred patients' reports.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Username
            </span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Password
            </span>
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
          Credentials are provided by the lab administrator.
        </p>
      </div>
    </div>
  );
}
