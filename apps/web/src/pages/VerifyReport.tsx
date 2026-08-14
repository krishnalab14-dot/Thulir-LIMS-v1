import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../lib/api';

interface VerifyResult {
  valid: boolean;
  orderNumber?: string;
  labName?: string;
  reportDate?: string;
}

/**
 * Public report verification — the patient-facing page behind the QR code on
 * a printed report. Deliberately calm and minimal: two inputs (order number +
 * date of birth), one confirmation, and the SAME "not found" message for
 * wrong-DOB and nonexistent orders alike (matching the API's non-leaking
 * behavior). This is a public page: no NavBar (hidden in App.tsx).
 */
export function VerifyReport() {
  const [params] = useSearchParams();
  const [orderNumber, setOrderNumber] = useState(params.get('orderNumber') ?? '');
  const [dob, setDob] = useState('');
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [error, setError] = useState('');

  const submit = useCallback(async () => {
    const code = orderNumber.trim();
    if (!code || !dob) {
      setError('Please enter both the order number and the patient date of birth.');
      setResult(null);
      return;
    }
    setError('');
    setChecking(true);
    setResult(null);
    try {
      const res = await api.get<VerifyResult>(
        `/public/verify-report?orderNumber=${encodeURIComponent(code)}&dob=${encodeURIComponent(dob)}`,
      );
      setResult(res);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Verification service is temporarily unavailable. Please try again.');
    } finally {
      setChecking(false);
    }
  }, [orderNumber, dob]);

  return (
    <div className="flex min-h-[calc(100vh-0px)] items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md">
        {/* Public mark — calm, not the staff tool. */}
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-teal-700">
            <svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden>
              <rect x="1.5" y="1.5" width="13" height="13" rx="2" stroke="#5eead4" strokeWidth="1.6" />
              <path d="M4.5 4.5h1.6v7H4.5zm2.7 0h1.6v4.8H7.2zm2.7 0h1.6v7H9.9z" fill="#5eead4" />
            </svg>
          </div>
          <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-800">Verify a report</h1>
          <p className="mt-1 text-sm text-slate-500">
            Confirm that a Thulir report is genuine. Enter the order number printed on the report and the patient's date
            of birth.
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order number</span>
            <input
              value={orderNumber}
              onChange={(e) => {
                setOrderNumber(e.target.value);
                setResult(null);
                setError('');
              }}
              placeholder="e.g. THU-VR-XXXXXXXX-XXXX"
              className="thulir-input font-mono"
              autoFocus
            />
          </label>
          <label className="mt-4 block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-slate-500">
              Patient date of birth
            </span>
            <input
              type="date"
              value={dob}
              onChange={(e) => {
                setDob(e.target.value);
                setResult(null);
                setError('');
              }}
              className="thulir-input"
            />
          </label>

          {error && <p className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}

          {result && result.valid && (
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
                    <path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-emerald-900">
                    Valid report from {result.labName}
                  </p>
                  <p className="mt-0.5 text-[13px] text-emerald-800">
                    This report was issued on {result.reportDate} and has not been altered.
                  </p>
                </div>
              </div>
            </div>
          )}

          {result && !result.valid && (
            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center">
              <p className="text-sm font-semibold text-slate-700">Not found</p>
              <p className="mt-0.5 text-[13px] text-slate-500">
                No matching report. Please check the order number and the date of birth, then try again.
              </p>
            </div>
          )}

          <button
            onClick={() => void submit()}
            disabled={checking}
            className="mt-5 w-full rounded-md bg-teal-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-teal-800 disabled:opacity-50"
          >
            {checking ? 'Checking…' : 'Verify report'}
          </button>
        </div>

        <p className="mt-6 text-center text-[11px] text-slate-400">
          This page only confirms a report's authenticity — it does not display results. If you have questions about your
          report, please contact the laboratory that issued it.
        </p>
      </div>
    </div>
  );
}
