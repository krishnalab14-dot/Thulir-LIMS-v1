import { FormEvent, useCallback, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../auth/usePortalAuth';
import { patientLogin } from '../../lib/portal-auth';
import { ApiError } from '../../lib/http';

/**
 * Stage 8: Patient portal login — mobile + DOB (two-factor, low-friction).
 * Visually calm and trust-building, distinct from the staff Login page.
 * No staff NavBar (public surface). On success, navigates to the patient
 * portal order list.
 */
export function PatientLogin() {
  const { portalUser, loading } = usePortalAuth();
  const navigate = useNavigate();

  const [mobile, setMobile] = useState('');
  const [dob, setDob] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const submit = useCallback(
    async (e: FormEvent) => {
      e.preventDefault();
      if (!mobile.trim() || !dob) {
        setError('Enter your mobile number and date of birth.');
        return;
      }
      setSubmitting(true);
      setError('');
      try {
        await patientLogin(mobile.trim(), dob);
        navigate('/portal/patient', { replace: true });
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
    [mobile, dob, navigate],
  );

  if (!loading && portalUser) {
    return <Navigate to="/portal/patient" replace />;
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
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-800">Patient Portal</h1>
          <p className="mt-1 text-sm text-slate-500">View your lab reports and order status.</p>
        </div>

        <form onSubmit={submit} className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Mobile Number
            </span>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="e.g. 9876543210"
              autoFocus
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Date of Birth
            </span>
            <input
              type="date"
              value={dob}
              onChange={(e) => setDob(e.target.value)}
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
            {submitting ? 'Signing in…' : 'View My Reports'}
          </button>
        </form>

        <p className="mt-4 text-center text-xs text-slate-400">
          Enter the mobile number and date of birth used during registration.
        </p>
      </div>
    </div>
  );
}
