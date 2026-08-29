import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { FlagNote } from '../components/ResultFlags';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { flagCellClasses } from '../lib/result-flag-view';
import { flagResult, normalOptionFor, ResultFlag } from '../lib/result-flags';

interface ResultRow {
  id: string;
  testNameSnapshot: string;
  status: string;
  resultType: 'numeric' | 'options' | 'text';
  unit: string | null;
  resultOptions: string[];
  abnormalOptions: string[];
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  resultValue: string | null;
  enteredBy: string | null;
  enteredAt: string | null;
}

interface SampleGroup {
  id: string;
  barcodeValue: string;
  sampleType: { id: string; name: string; code: string | null };
  orderTests: ResultRow[];
}

interface ResultsData {
  order: { id: string; status: string; isUrgent: boolean; createdAt: string };
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number };
  samples: SampleGroup[];
  summary: { total: number; entered: number };
}

interface CriticalAlertInfo {
  id: string;
  orderTestId: string;
  testNameSnapshot: string;
  value: string;
  createdAt: string;
}

interface SaveResponse {
  updated: Array<{ orderTestId: string; resultValue: string | null; status: string; enteredAt: string | null }>;
  skipped: Array<{ orderTestId: string; reason: string; message: string }>;
  orderStatus: string;
  criticalAlerts: CriticalAlertInfo[];
}

const GENDER_SHORT: Record<string, string> = { male: 'M', female: 'F', other: 'Other' };

export function ResultEntry() {
  const { id = '' } = useParams();
  const [data, setData] = useState<ResultsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [savingCount, setSavingCount] = useState(0);

  // values[rowId] = what the input shows right now; savedValues[rowId] = the
  // last server-confirmed value (the CAS anchor sent as expectedValue on the
  // next save); flags[rowId] = the last BLURRED value's visual treatment.
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string | null>>({});
  const [flags, setFlags] = useState<Record<string, ResultFlag>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [focusedId, setFocusedId] = useState('');
  const [expandedText, setExpandedText] = useState<Record<string, boolean>>({});

  // Stage 9: critical alert modal — the first unacknowledged alert from the
  // last save. Non-dismissable: only the explicit "Acknowledge" button closes it.
  const [pendingAlert, setPendingAlert] = useState<CriticalAlertInfo | null>(null);
  const [acknowledging, setAcknowledging] = useState(false);
  const [ackError, setAckError] = useState('');

  const valuesRef = useRef(values);
  const savedRef = useRef(savedValues);
  const savingRef = useRef<Set<string>>(new Set());
  const resaveRef = useRef<Set<string>>(new Set());
  const inputRefs = useRef<(HTMLInputElement | HTMLTextAreaElement | null)[]>([]);
  const [rowOrder, setRowOrder] = useState<ResultRow[]>([]);

  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  useEffect(() => {
    savedRef.current = savedValues;
  }, [savedValues]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await api.get<ResultsData>(`/orders/${id}/results`);
      setData(res);
      const rows = res.samples.flatMap((s) => s.orderTests);
      setRowOrder(rows);
      const v: Record<string, string> = {};
      const sv: Record<string, string | null> = {};
      const fl: Record<string, ResultFlag> = {};
      for (const r of rows) {
        v[r.id] = r.resultValue ?? '';
        sv[r.id] = r.resultValue;
        fl[r.id] = flagResult(r, r.resultValue ?? '');
      }
      setValues(v);
      setSavedValues(sv);
      setFlags(fl);
      setFieldErrors({});
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const rowsById = useMemo(() => new Map(rowOrder.map((r) => [r.id, r])), [rowOrder]);
  const enteredCount = useMemo(() => rowOrder.filter((r) => (savedRef.current[r.id] ?? null) != null).length, [rowOrder]);

  /** Acknowledge a critical alert — called from the modal. */
  const handleAcknowledge = useCallback(async (alertId: string) => {
    setAcknowledging(true);
    setAckError('');
    try {
      await api.put(`/alerts/${alertId}/acknowledge`);
      setPendingAlert(null);
      setAckError('');
    } catch (e) {
      setAckError(e instanceof ApiError ? e.message : 'Failed to acknowledge alert');
    } finally {
      setAcknowledging(false);
    }
  }, []);

  /** Autosave one row through the validated, concurrency-safe endpoint. */
  const saveRow = useCallback(
    async (rowId: string) => {
      if (savingRef.current.has(rowId)) {
        resaveRef.current.add(rowId); // a newer blur arrived — save again after this one
        return;
      }
      const row = rowsById.get(rowId);
      if (!row) return;
      const value = valuesRef.current[rowId] ?? '';
      savingRef.current.add(rowId);
      setSavingCount((c) => c + 1);
      try {
        const res = await api.put<SaveResponse>(`/orders/${id}/results`, {
          entries: [
            {
              orderTestId: rowId,
              resultValue: value,
              // CAS anchor: null (pending) → omitted → entry path; otherwise
              // the last server-confirmed value, so a concurrent change
              // elsewhere is never silently overwritten.
              ...(savedRef.current[rowId] != null ? { expectedValue: savedRef.current[rowId] } : {}),
            },
          ],
        });
        if (res.skipped.length > 0) {
          setNotice(`${res.skipped[0].message} Reloading…`);
          await load();
          return;
        }
        const upd = res.updated[0];
        if (upd) {
          setSavedValues((prev) => ({ ...prev, [rowId]: upd.resultValue }));
          setFlags((prev) => ({ ...prev, [rowId]: flagResult(row, upd.resultValue ?? '') }));
          setFieldErrors((prev) => ({ ...prev, [rowId]: '' }));
        }
        setData((d) => (d ? { ...d, order: { ...d.order, status: res.orderStatus } } : d));

        // Stage 9: show critical alert modal if any alerts were created
        if (res.criticalAlerts.length > 0 && !pendingAlert) {
          setPendingAlert(res.criticalAlerts[0]);
        }
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Save failed');
      } finally {
        savingRef.current.delete(rowId);
        setSavingCount((c) => c - 1);
        if (resaveRef.current.has(rowId)) {
          resaveRef.current.delete(rowId);
          void saveRow(rowId);
        }
      }
    },
    [id, load, rowsById, pendingAlert],
  );

  const handleBlur = useCallback(
    (row: ResultRow) => {
      const raw = valuesRef.current[row.id] ?? '';
      const value = raw.trim();
      setFocusedId('');
      // Client-side guards mirror the server's (the server remains the source
      // of truth — these just avoid sending obviously bad values).
      if (row.resultType === 'options' && value !== '' && !row.resultOptions.includes(value)) {
        setValues((v) => ({ ...v, [row.id]: savedRef.current[row.id] ?? '' }));
        setFieldErrors((e) => ({ ...e, [row.id]: `Not one of: ${row.resultOptions.join(', ')}` }));
        return;
      }
      if (row.resultType === 'numeric' && value !== '' && !Number.isFinite(Number(value))) {
        setValues((v) => ({ ...v, [row.id]: savedRef.current[row.id] ?? '' }));
        setFieldErrors((e) => ({ ...e, [row.id]: 'Enter a valid number' }));
        return;
      }
      setFieldErrors((e) => ({ ...e, [row.id]: '' }));
      setFlags((f) => ({ ...f, [row.id]: flagResult(row, value) }));
      if (value !== (savedRef.current[row.id] ?? '')) {
        void saveRow(row.id);
      }
    },
    [saveRow],
  );

  const focusAt = useCallback((idx: number) => {
    const el = inputRefs.current[idx];
    if (el) {
      el.focus();
    }
  }, []);

  const commitAndAdvance = useCallback(
    (row: ResultRow, idx: number) => {
      setFlags((f) => ({ ...f, [row.id]: flagResult(row, valuesRef.current[row.id] ?? '') }));
      const value = valuesRef.current[row.id] ?? '';
      if (value !== (savedRef.current[row.id] ?? '')) {
        void saveRow(row.id);
      }
      focusAt(idx + 1);
    },
    [focusAt, saveRow],
  );

  /** "Mark All Normal" — fills unentered OPTIONS fields with the first
   *  non-abnormal option, in one batch. Numeric/text are never auto-filled
   *  (no value is guessed) — the tooltip says exactly that. */
  const markAllNormal = useCallback(async () => {
    setError('');
    setNotice('');
    const entries: Array<{ orderTestId: string; resultValue: string; expectedValue?: string }> = [];
    for (const row of rowOrder) {
      if (row.resultType !== 'options') continue;
      if ((valuesRef.current[row.id] ?? '') !== '') continue; // only unentered
      const normal = normalOptionFor(row);
      if (normal == null) continue; // no non-abnormal option → leave unentered
      entries.push({
        orderTestId: row.id,
        resultValue: normal,
        ...(savedRef.current[row.id] != null ? { expectedValue: savedRef.current[row.id] as string } : {}),
      });
      setValues((v) => ({ ...v, [row.id]: normal }));
      setFlags((f) => ({ ...f, [row.id]: flagResult(row, normal) }));
    }
    if (entries.length === 0) return;
    setSavingCount((c) => c + 1);
    try {
      const res = await api.put<SaveResponse>(`/orders/${id}/results`, { entries });
      for (const upd of res.updated) {
        setSavedValues((prev) => ({ ...prev, [upd.orderTestId]: upd.resultValue }));
      }
      if (res.skipped.length > 0) {
        setNotice(`${res.skipped[0].message} Reloading…`);
        await load();
        return;
      }
      setData((d) => (d ? { ...d, order: { ...d.order, status: res.orderStatus } } : d));

      // Stage 9: show critical alert modal if any alerts were created
      if (res.criticalAlerts.length > 0 && !pendingAlert) {
        setPendingAlert(res.criticalAlerts[0]);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Mark All Normal failed');
    } finally {
      setSavingCount((c) => c - 1);
    }
  }, [id, load, rowOrder, pendingAlert]);

  if (loading) return <Spinner label="Loading results…" />;
  if (error) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!data) return null;

  const total = rowOrder.length;
  const { patient, order } = data;

  return (
    <div className="space-y-0">
      {/* Sticky profile header + column headers — stays visible while scrolling a long panel. */}
      <div className="sticky top-12 z-30 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Link to={`/orders/${order.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 hover:underline">
              Order {order.id.slice(0, 8).toUpperCase()}
            </Link>
            <span className="text-slate-300">/</span>
            <span className="text-[13px] font-semibold text-slate-800">
              {patient.firstName} {patient.lastName}
            </span>
            <Badge tone="slate">{patient.patientUid}</Badge>
            <span className="text-[12px] text-slate-500">
              {GENDER_SHORT[patient.gender] ?? '—'} · {patient.ageYears} y
            </span>
            {order.isUrgent && <Badge tone="rose">URGENT</Badge>}
            <Badge tone={order.status === 'billed' ? 'slate' : 'teal'}>{order.status.replaceAll('_', ' ')}</Badge>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[12px] font-medium text-slate-600" title="Only options-type fields with a defined normal option are filled — numeric and text results are never guessed.">
              {enteredCount}/{total} entered
              <span className="ml-1 inline-block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200 align-middle">
                <span className="block h-full rounded-full bg-brand-600" style={{ width: `${total === 0 ? 0 : Math.round((enteredCount / total) * 100)}%` }} />
              </span>
            </span>
            <button
              onClick={() => void markAllNormal()}
              disabled={savingCount > 0}
              title="Fills unentered options-type results with the normal option. Numeric and text results are never auto-filled — no value is guessed."
              className="inline-flex h-8 items-center rounded-md border border-brand-200 bg-white px-3 text-[12px] font-semibold text-brand-800 transition hover:bg-brand-50 disabled:opacity-50"
            >
              Mark All Normal
            </button>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-slate-200 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
          <span>Test Name</span>
          <span>Result</span>
          <span>Unit</span>
          <span>Reference Range</span>
          <span className="pr-1 text-right">Status</span>
        </div>
      </div>

      {notice && <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{notice}</p>}
      {savingCount > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-[12px] text-slate-400">
          <svg className="h-3 w-3 animate-spin text-brand-600" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-20" />
            <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          saving…
        </p>
      )}

      <div className="mt-4 space-y-4">
        {data.samples.length === 0 && (
          <EmptyState title="No samples are ready for result entry" hint="Only collected samples appear here. Collect the order's samples first." />
        )}

        {data.samples.map((sample) => (
          <Card
            key={sample.id}
            title={
              <span className="flex items-center gap-2">
                <Link to={`/samples/${sample.id}`} className="font-mono text-[12px] font-semibold text-brand-700 hover:underline">
                  {sample.barcodeValue}
                </Link>
                <span className="text-slate-400">·</span>
                <span className="text-[12px] font-medium text-slate-500">{sample.sampleType.name}</span>
              </span>
            }
            pad={false}
          >
            <ul className="divide-y divide-slate-100">
              {sample.orderTests.map((row) => {
                const idx = rowOrder.findIndex((r) => r.id === row.id);
                const flag = flags[row.id];
                const isText = row.resultType === 'text';
                const isOptions = row.resultType === 'options';
                return (
                  <li key={row.id} className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-4 py-2">
                    <div>
                      <span className="block text-[13px] font-medium text-slate-800">{row.testNameSnapshot}</span>
                      {isOptions && (
                        <span className="block text-[11px] text-slate-400">
                          {row.resultOptions.join(' / ')}
                          {row.abnormalOptions.length > 0 && <span className="ml-1 text-amber-600">(abnormal: {row.abnormalOptions.join(', ')})</span>}
                        </span>
                      )}
                    </div>

                    <div>
                      {isOptions ? (
                        <OptionsInput
                          row={row}
                          value={values[row.id] ?? ''}
                          focused={focusedId === row.id}
                          inputRef={(el) => {
                            inputRefs.current[idx] = el;
                          }}
                          onChange={(v) => {
                            setValues((prev) => ({ ...prev, [row.id]: v }));
                            setFieldErrors((e) => ({ ...e, [row.id]: '' }));
                          }}
                          onFocus={() => setFocusedId(row.id)}
                          onBlur={() => handleBlur(row)}
                          onCommit={() => commitAndAdvance(row, idx)}
                          onEscape={() => {
                            setValues((prev) => ({ ...prev, [row.id]: '' }));
                          }}
                        />
                      ) : isText ? (
                        expandedText[row.id] ? (
                          <textarea
                            ref={(el) => {
                              inputRefs.current[idx] = el;
                            }}
                            value={values[row.id] ?? ''}
                            rows={3}
                            onChange={(e) => {
                              setValues((prev) => ({ ...prev, [row.id]: e.target.value }));
                              setFieldErrors((e) => ({ ...e, [row.id]: '' }));
                            }}
                            onFocus={() => {
                              setFocusedId(row.id);
                              setExpandedText((prev) => ({ ...prev, [row.id]: true }));
                            }}
                            onBlur={() => handleBlur(row)}
                            onKeyDown={(e) => {
                              if (e.key === 'Escape') {
                                e.preventDefault();
                                setValues((prev) => ({ ...prev, [row.id]: '' }));
                              }
                            }}
                            className={`${flagCellClasses(flag, focusedId === row.id)} resize-y font-sans`}
                            placeholder="Type result…"
                          />
                        ) : (
                          <input
                            ref={(el) => {
                              inputRefs.current[idx] = el;
                            }}
                            value={values[row.id] ?? ''}
                            onChange={(e) => {
                              setValues((prev) => ({ ...prev, [row.id]: e.target.value }));
                            }}
                            onFocus={() => {
                              setFocusedId(row.id);
                              setExpandedText((prev) => ({ ...prev, [row.id]: true }));
                            }}
                            onBlur={() => handleBlur(row)}
                            className={flagCellClasses(flag, focusedId === row.id)}
                            placeholder="Type result…"
                          />
                        )
                      ) : (
                        <input
                          ref={(el) => {
                            inputRefs.current[idx] = el;
                          }}
                          type="text"
                          inputMode="decimal"
                          value={values[row.id] ?? ''}
                          onChange={(e) => {
                            setValues((prev) => ({ ...prev, [row.id]: e.target.value }));
                            setFieldErrors((e) => ({ ...e, [row.id]: '' }));
                          }}
                          onFocus={() => setFocusedId(row.id)}
                          onBlur={() => handleBlur(row)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              commitAndAdvance(row, idx);
                            } else if (e.key === 'ArrowDown') {
                              e.preventDefault();
                              focusAt(idx + 1);
                            } else if (e.key === 'ArrowUp') {
                              e.preventDefault();
                              focusAt(idx - 1);
                            } else if (e.key === 'Escape') {
                              setValues((prev) => ({ ...prev, [row.id]: '' }));
                            }
                          }}
                          className={flagCellClasses(flag, focusedId === row.id)}
                          placeholder={row.refLow != null ? `${row.refLow}–${row.refHigh}` : 'Enter value…'}
                        />
                      )}
                      <FlagNote flag={flag} />
                      {fieldErrors[row.id] && <p className="mt-1 text-[11px] text-rose-600">{fieldErrors[row.id]}</p>}
                    </div>

                    <div className="min-w-[70px] text-[12px] text-slate-500">{row.unit ?? '—'}</div>

                    <div className="min-w-[90px] text-[12px] text-slate-500">
                      {row.resultType === 'numeric' && row.refLow != null && row.refHigh != null && (
                        <span className="font-mono">
                          {row.refLow}–{row.refHigh}
                          {row.criticalLow != null && row.criticalHigh != null && (
                            <span className="block text-[10px] text-rose-500">
                              crit {row.criticalLow}–{row.criticalHigh}
                            </span>
                          )}
                        </span>
                      )}
                      {row.resultType !== 'numeric' && <span className="text-slate-300">—</span>}
                    </div>

                    <div className="flex items-center justify-end gap-1.5">
                      <Badge tone={row.status === 'pending' ? 'slate' : row.status === 'entered' ? 'teal' : 'amber'}>
                        {row.status.replaceAll('_', ' ')}
                      </Badge>
                      {row.enteredAt && <span className="text-[10px] text-slate-400">{formatDateTime(row.enteredAt)}</span>}
                    </div>
                  </li>
                );
              })}
            </ul>
          </Card>
        ))}
      </div>

      {/* Stage 9: Critical Alert Modal — non-dismissable, only closes on Acknowledge */}
      <CriticalAlertModal
        alert={pendingAlert}
        acknowledging={acknowledging}
        error={ackError}
        onAcknowledge={handleAcknowledge}
      />
    </div>
  );
}

/**
 * Non-dismissable modal for critical value alerts. Cannot be closed by
 * pressing Escape or clicking outside — only by clicking "Acknowledge".
 * This matches how genuinely critical lab values should be handled (can't
 * be casually scrolled past).
 */
function CriticalAlertModal({
  alert,
  acknowledging,
  error,
  onAcknowledge,
}: {
  alert: CriticalAlertInfo | null;
  acknowledging: boolean;
  error: string;
  onAcknowledge: (id: string) => void;
}) {
  if (!alert) return null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/60 p-4">
      <div className="w-full max-w-sm rounded-lg border-2 border-rose-300 bg-white shadow-2xl">
        <header className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-3">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-rose-600">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
          </span>
          <h3 className="text-sm font-bold text-rose-800">Critical Value Alert</h3>
        </header>
        <div className="px-4 py-4">
          <p className="text-[13px] text-slate-700">
            <span className="font-semibold">{alert.testNameSnapshot}</span> has a critical value of{' '}
            <span className="font-mono font-bold text-rose-700">{alert.value}</span>.
          </p>
          <p className="mt-2 text-[12px] text-slate-500">
            This value is outside the defined critical threshold range. Please verify the result and acknowledge this alert.
          </p>
          {error && (
            <p className="mt-2 rounded-md bg-rose-50 px-2 py-1.5 text-[12px] text-rose-700">{error}</p>
          )}
        </div>
        <footer className="flex justify-end gap-2 border-t border-slate-100 px-4 py-3">
          <button
            onClick={() => onAcknowledge(alert.id)}
            disabled={acknowledging}
            className="rounded-md bg-rose-600 px-4 py-2 text-[13px] font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        </footer>
      </div>
    </div>
  );
}

/** Options typeahead — Down Arrow + Enter selects from the snapshotted
 *  options, no free typing outside them (client guard; server rejects too). */
function OptionsInput({
  row,
  value,
  focused,
  inputRef,
  onChange,
  onFocus,
  onBlur,
  onCommit,
  onEscape,
}: {
  row: ResultRow;
  value: string;
  focused: boolean;
  inputRef: (el: HTMLInputElement | null) => void;
  onChange: (v: string) => void;
  onFocus: () => void;
  onBlur: () => void;
  onCommit: () => void;
  onEscape: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const filtered = useMemo(() => {
    const term = value.trim().toLowerCase();
    if (!term) return row.resultOptions;
    return row.resultOptions.filter((o) => o.toLowerCase().includes(term));
  }, [value, row.resultOptions]);

  return (
    <div className="relative">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => {
          onFocus();
          setOpen(true);
        }}
        onBlur={() => {
          // Close after a tick so a click on the list still lands.
          setTimeout(() => setOpen(false), 120);
          onBlur();
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              setHighlight(0);
            } else {
              setHighlight((h) => Math.min(h + 1, filtered.length - 1));
            }
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            if (open) setHighlight((h) => Math.max(h - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (open && filtered.length > 0) {
              const choice = filtered[Math.min(highlight, filtered.length - 1)];
              onChange(choice);
              setOpen(false);
              onCommit();
            } else if (row.resultOptions.includes(value.trim())) {
              setOpen(false);
              onCommit();
            }
          } else if (e.key === 'Escape') {
            e.preventDefault();
            setOpen(false);
            onEscape();
          }
        }}
        className={flagCellClasses(undefined, focused)}
        placeholder="Select…"
        autoComplete="off"
        spellCheck={false}
        aria-expanded={open}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute left-0 top-full z-40 mt-1 max-h-48 w-full overflow-y-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {filtered.map((option, i) => (
            <li key={option}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault(); // keep the input's focus
                  onChange(option);
                  setOpen(false);
                  onCommit();
                }}
                onMouseEnter={() => setHighlight(i)}
                className={`block w-full px-2.5 py-1 text-left text-[13px] ${
                  i === highlight ? 'bg-brand-50 text-brand-800' : 'text-slate-700'
                } ${row.abnormalOptions.includes(option) ? 'font-semibold text-amber-700' : ''}`}
              >
                {option}
                {row.abnormalOptions.includes(option) && <span className="ml-1 text-[10px] text-amber-600">(abnormal)</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
