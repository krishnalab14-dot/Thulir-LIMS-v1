import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlagNote } from '../components/ResultFlags';
import { Badge, Card, EmptyState, Modal, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, waitLabel } from '../lib/format';
import { flagCellClasses } from '../lib/result-flag-view';
import { flagResult, ResultFlag } from '../lib/result-flags';

interface QueueRow {
  orderId: string;
  orderStatus: string;
  isUrgent: boolean;
  createdAt: string;
  enteredCount: number;
  enteredAt: string | null;
  waitMs: number;
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number };
}

interface ReviewRow {
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
  verifiedBy: string | null;
  verifiedAt: string | null;
  verifyRejectedNote: string | null;
}

interface ReviewSample {
  id: string;
  barcodeValue: string;
  status: string;
  sampleType: { id: string; name: string; code: string | null };
  orderTests: ReviewRow[];
}

interface ReviewData {
  order: { id: string; status: string; isUrgent: boolean; createdAt: string };
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number };
  samples: ReviewSample[];
  summary: { total: number; entered: number; verified: number };
}

interface VerifyResponse {
  verified: Array<{ orderTestId: string; testNameSnapshot: string; status: string; verifiedAt: string }>;
  skipped: Array<{ orderTestId: string; reason: string; message: string }>;
  orderStatus: string;
}

const GENDER_SHORT: Record<string, string> = { male: 'M', female: 'F', other: 'Other' };
const STATUS_TONE: Record<string, string> = { pending: 'slate', entered: 'teal', verified: 'green' };

export function VerifyQueue() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [review, setReview] = useState<ReviewData | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Reject-back dialog: one verified row at a time, reason required.
  const [rejectTarget, setRejectTarget] = useState<{ rowId: string; testName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setError('');
    try {
      const rows = await api.get<QueueRow[]>('/verify-queue');
      setQueue(rows);
      setSelectedId((prev) => prev && rows.some((r) => r.orderId === prev) ? prev : (rows[0]?.orderId ?? null));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the verification queue');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  // Request-sequence guard: after a mutation the queue may auto-advance the
  // selection while the old order's review is still in flight — only the
  // latest request may apply its result.
  const reviewReqRef = useRef(0);
  const loadReview = useCallback(async (orderId: string) => {
    const req = ++reviewReqRef.current;
    setLoadingReview(true);
    setError('');
    try {
      const data = await api.get<ReviewData>(`/orders/${orderId}/review`);
      if (req !== reviewReqRef.current) return; // superseded by a newer selection
      setReview(data);
    } catch (e) {
      if (req !== reviewReqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the review sheet');
      setReview(null);
    } finally {
      if (req === reviewReqRef.current) setLoadingReview(false);
    }
  }, []);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (selectedId) {
      void loadReview(selectedId);
    } else {
      setReview(null);
    }
  }, [selectedId, loadReview]);

  const rows = useMemo(() => review?.samples.flatMap((s) => s.orderTests) ?? [], [review]);
  const enteredRows = useMemo(() => rows.filter((r) => r.status === 'entered'), [rows]);

  const afterMutate = useCallback(async (orderId: string) => {
    // Queue first: if the order finished verifying it drops off and the
    // selection auto-advances (the effect then loads the new order's review,
    // superseding this one via the seq guard). If it stays selected, this
    // explicit reload refreshes the verified/rejected state in place.
    await loadQueue();
    await loadReview(orderId);
  }, [loadQueue, loadReview]);

  const verifyRows = useCallback(
    async (orderId: string, orderTestIds: string[]) => {
      if (orderTestIds.length === 0) return;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const res = await api.put<VerifyResponse>(`/orders/${orderId}/verify`, { orderTestIds });
        if (res.skipped.length > 0) {
          setNotice(res.skipped.map((s) => s.message).join(' '));
        }
        if (res.verified.length > 0) {
          setNotice((prev) => `${prev ? `${prev} ` : ''}Verified ${res.verified.length} result${res.verified.length === 1 ? '' : 's'}.`.trim());
        }
        await afterMutate(orderId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Verify failed');
      } finally {
        setBusy(false);
      }
    },
    [afterMutate],
  );

  const submitReject = useCallback(async () => {
    if (!rejectTarget || !review) return;
    const reason = rejectReason.trim();
    if (!reason) {
      setRejectError('A reason is required to send this result back to entry.');
      return;
    }
    setRejectError('');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.put(`/orders/${review.order.id}/reject-back-to-entry`, { orderTestId: rejectTarget.rowId, reason });
      setNotice(`Sent "${rejectTarget.testName}" back to Result Entry — reason recorded.`);
      setRejectTarget(null);
      setRejectReason('');
      await afterMutate(review.order.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }, [rejectTarget, review, rejectReason, afterMutate]);

  if (loadingQueue) return <Spinner label="Loading verification queue…" />;
  if (error && queue.length === 0 && !review) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Verification</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Second pair of eyes — review entered results before the pathologist approves them.
          </p>
        </div>
        <Badge tone="slate">{queue.length} order{queue.length === 1 ? '' : 's'} waiting</Badge>
      </div>

      {error && queue.length > 0 && <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      {notice && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{notice}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Left pane — the queue (oldest-entered-first). */}
        <Card title={`Queue (${queue.length})`} pad={false} className="lg:sticky lg:top-16">
          {queue.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nothing waiting for verification" hint="Orders with entered results appear here, oldest first." />
            </div>
          ) : (
            <ul className="max-h-[calc(100vh-16rem)] divide-y divide-slate-100 overflow-y-auto">
              {queue.map((row) => (
                <li key={row.orderId}>
                  <button
                    onClick={() => setSelectedId(row.orderId)}
                    className={`block w-full px-4 py-2.5 text-left transition ${
                      selectedId === row.orderId ? 'bg-brand-50' : 'hover:bg-slate-50'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-semibold text-slate-800">
                        {row.patient.firstName} {row.patient.lastName}
                      </span>
                      {row.isUrgent && <Badge tone="rose">URGENT</Badge>}
                    </div>
                    <div className="mt-0.5 flex items-center justify-between gap-2 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1.5">
                        <span className="font-mono text-brand-700">{row.patient.patientUid}</span>
                        <span>
                          {GENDER_SHORT[row.patient.gender] ?? '—'} · {row.patient.ageYears} y
                        </span>
                      </span>
                      <span className="font-mono">{row.orderId.slice(0, 8).toUpperCase()}</span>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-slate-400">
                        {row.enteredCount} awaiting · wait {waitLabel(row.waitMs)}
                      </span>
                      <Badge tone="amber">{row.orderStatus.replaceAll('_', ' ')}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right pane — the review workspace (full result sheet). */}
        <div className="min-w-0">
          {!selectedId ? (
            <EmptyState title="Select an order from the queue" hint="The full result sheet opens here for review." />
          ) : loadingReview ? (
            <Spinner label="Loading review sheet…" />
          ) : !review ? (
            <EmptyState title="Order not found" hint="It may have been removed from your organization." />
          ) : (
            <div className="space-y-0">
              {/* Sticky profile header. */}
              <div className="sticky top-12 z-30 -mx-4 border-b border-slate-200 bg-slate-50/95 px-4 py-2.5 backdrop-blur sm:-mx-6 sm:px-6">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Link to={`/orders/${review.order.id}`} className="text-[11px] font-semibold uppercase tracking-wide text-brand-700 hover:underline">
                      Order {review.order.id.slice(0, 8).toUpperCase()}
                    </Link>
                    <span className="text-slate-300">/</span>
                    <span className="text-[13px] font-semibold text-slate-800">
                      {review.patient.firstName} {review.patient.lastName}
                    </span>
                    <Badge tone="slate">{review.patient.patientUid}</Badge>
                    <span className="text-[12px] text-slate-500">
                      {GENDER_SHORT[review.patient.gender] ?? '—'} · {review.patient.ageYears} y
                    </span>
                    {review.order.isUrgent && <Badge tone="rose">URGENT</Badge>}
                    <Badge tone={review.order.status === 'billed' ? 'slate' : 'teal'}>{review.order.status.replaceAll('_', ' ')}</Badge>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-medium text-slate-600">
                      {enteredRows.length} awaiting verification
                    </span>
                    <button
                      onClick={() => void verifyRows(review.order.id, enteredRows.map((r) => r.id))}
                      disabled={busy || enteredRows.length === 0}
                      className="inline-flex h-8 items-center rounded-md bg-brand-700 px-3 text-[12px] font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
                    >
                      Verify All Visible ({enteredRows.length})
                    </button>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-t border-slate-200 pt-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <span>Test Name</span>
                  <span>Result</span>
                  <span>Unit</span>
                  <span>Reference Range</span>
                  <span className="pr-1 text-right">Status / Action</span>
                </div>
              </div>

              <div className="mt-4 space-y-4">
                {review.samples.map((sample) => (
                  <Card
                    key={sample.id}
                    title={
                      <span className="flex items-center gap-2">
                        <Link to={`/samples/${sample.id}`} className="font-mono text-[12px] font-semibold text-brand-700 hover:underline">
                          {sample.barcodeValue}
                        </Link>
                        <span className="text-slate-400">·</span>
                        <span className="text-[12px] font-medium text-slate-500">{sample.sampleType.name}</span>
                        {sample.status !== 'collected' && <Badge tone="slate">{sample.status.replaceAll('_', ' ')}</Badge>}
                      </span>
                    }
                    pad={false}
                  >
                    <ul className="divide-y divide-slate-100">
                      {sample.orderTests.map((row) => {
                        const flag: ResultFlag | undefined = flagResult(row, row.resultValue ?? '');
                        const isVerified = row.status === 'verified';
                        const isEntered = row.status === 'entered';
                        return (
                          <li
                            key={row.id}
                            className={`grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-4 py-2 ${
                              isVerified ? 'opacity-80' : ''
                            }`}
                          >
                            <div>
                              <span className={`block text-[13px] font-medium ${isVerified ? 'text-slate-500' : 'text-slate-800'}`}>
                                {row.testNameSnapshot}
                                {isVerified && <span className="ml-1.5 text-emerald-600">✓ verified</span>}
                              </span>
                              {row.verifyRejectedNote && (
                                <span className="mt-0.5 block rounded bg-rose-50 px-1.5 py-0.5 text-[11px] text-rose-700">
                                  Sent back: {row.verifyRejectedNote}
                                </span>
                              )}
                              {row.resultType === 'options' && (
                                <span className="block text-[11px] text-slate-400">{row.resultOptions.join(' / ')}</span>
                              )}
                            </div>

                            <div>
                              <div className={`${flagCellClasses(flag, false)} cursor-default bg-opacity-60`}>
                                {row.resultValue ?? '—'}
                              </div>
                              <FlagNote flag={flag} />
                            </div>

                            <div className="min-w-[70px] text-[12px] text-slate-500">{row.unit ?? '—'}</div>

                            <div className="min-w-[90px] text-[12px] text-slate-500">
                              {row.resultType === 'numeric' && row.refLow != null && row.refHigh != null ? (
                                <span className="font-mono">
                                  {row.refLow}–{row.refHigh}
                                  {row.criticalLow != null && row.criticalHigh != null && (
                                    <span className="block text-[10px] text-rose-500">
                                      crit {row.criticalLow}–{row.criticalHigh}
                                    </span>
                                  )}
                                </span>
                              ) : (
                                <span className="text-slate-300">—</span>
                              )}
                            </div>

                            <div className="flex items-center justify-end gap-1.5">
                              <Badge tone={STATUS_TONE[row.status] ?? 'slate'}>{row.status.replaceAll('_', ' ')}</Badge>
                              {isEntered && (
                                <button
                                  onClick={() => void verifyRows(review.order.id, [row.id])}
                                  disabled={busy}
                                  className="inline-flex h-7 items-center rounded-md bg-brand-700 px-2.5 text-[12px] font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
                                >
                                  Verify
                                </button>
                              )}
                              {isVerified && (
                                <button
                                  onClick={() => setRejectTarget({ rowId: row.id, testName: row.testNameSnapshot })}
                                  disabled={busy}
                                  className="inline-flex h-7 items-center rounded-md border border-rose-200 bg-white px-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                                >
                                  Reject
                                </button>
                              )}
                              {row.verifiedAt && <span className="text-[10px] text-slate-400">{formatDateTime(row.verifiedAt)}</span>}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={rejectTarget !== null}
        title="Send result back to entry"
        onClose={() => {
          setRejectTarget(null);
          setRejectReason('');
          setRejectError('');
        }}
        footer={
          <>
            <button
              onClick={() => {
                setRejectTarget(null);
                setRejectReason('');
                setRejectError('');
              }}
              className="thulir-btn thulir-btn-secondary"
            >
              Cancel
            </button>
            <button
              onClick={() => void submitReject()}
              disabled={busy}
              className="thulir-btn thulir-btn-primary disabled:opacity-50"
            >
              Send back to entry
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-slate-600">
            <span className="font-semibold text-slate-800">{rejectTarget?.testName}</span> returns to Result Entry as an
            editable result. Its current value is kept — the technician corrects it through the normal save path.
          </p>
          <label className="block">
            <span className="thulir-label">
              Reason <span className="ml-0.5 text-rose-600">*</span>
            </span>
            <textarea
              value={rejectReason}
              onChange={(e) => {
                setRejectReason(e.target.value);
                setRejectError('');
              }}
              rows={2}
              autoFocus
              placeholder='e.g. Typing error in Sugar value'
              className="thulir-input resize-y"
            />
          </label>
          {rejectError && <p className="text-[12px] text-rose-600">{rejectError}</p>}
        </div>
      </Modal>
    </div>
  );
}
