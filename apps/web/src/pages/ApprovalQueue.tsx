import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { FlagNote } from '../components/ResultFlags';
import { Badge, Card, EmptyState, Modal, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, waitLabel } from '../lib/format';
import { pseudoQrCells } from '../lib/pseudo-qr';
import { flagCellClasses } from '../lib/result-flag-view';
import { flagResult, ResultFlag } from '../lib/result-flags';

interface QueueRow {
  orderId: string;
  orderStatus: string;
  isUrgent: boolean;
  createdAt: string;
  verifiedCount: number;
  verifiedAt: string | null;
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
  approvedBy: string | null;
  approvedAt: string | null;
  approvalSignatureStamp: string | null;
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
  summary: { total: number; verified: number; approved: number };
  preview: { labName: string; labAddress: string | null; signatureRef: string; verificationCode: string };
}

interface ApproveResponse {
  approved: Array<{ orderTestId: string; testNameSnapshot: string; status: string; approvedAt: string; approvalSignatureStamp: string }>;
  skipped: Array<{ orderTestId: string; reason: string; message: string }>;
  orderStatus: string;
}

const GENDER_SHORT: Record<string, string> = { male: 'M', female: 'F', other: 'Other' };
const STATUS_TONE: Record<string, string> = { pending: 'slate', entered: 'teal', verified: 'amber', approved: 'green' };

/** The live A4 preview QR placeholder — deterministic grid from the seed. */
function PseudoQr({ seed, className }: { seed: string; className?: string }) {
  const cells = useMemo(() => pseudoQrCells(seed), [seed]);
  return (
    <div
      className={`grid ${className ?? ''}`}
      style={{ gridTemplateColumns: 'repeat(21, 1fr)' }}
      aria-hidden
    >
      {cells.map((on, i) => (
        <span key={i} className={on ? 'bg-slate-900' : 'bg-white'} />
      ))}
    </div>
  );
}

/** Scaled-down rendering of the printed report — letterhead, patient/order
 *  header, results table, signature block and QR placeholder. Reflects the
 *  CURRENT approval state: approved rows are locked in (value shown + ✓),
 *  verified rows show the value pending approval, pending rows show a dash. */
function A4Preview({ review }: { review: ReviewData }) {
  const rows = review.samples.flatMap((s) => s.orderTests);
  const approvedRows = rows.filter((r) => r.status === 'approved');
  const allApproved = review.summary.total > 0 && approvedRows.length === review.summary.total;
  const firstStamp = approvedRows.find((r) => r.approvalSignatureStamp)?.approvalSignatureStamp ?? null;

  return (
    <div className="mx-auto w-full max-w-[460px] rounded-lg bg-slate-100 p-3 shadow-inner">
      <div className="aspect-[1/1.414] overflow-hidden rounded-sm bg-white shadow-xl ring-1 ring-slate-300">
        <div className="flex h-full flex-col px-5 py-4 text-slate-800">
          {/* Letterhead */}
          <div className="border-b-2 border-slate-800 pb-2 text-center">
            <div className="text-lg font-bold leading-tight tracking-tight">{review.preview.labName}</div>
            <div className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.25em] text-slate-500">Pathology Laboratory</div>
          </div>

          {/* Patient / order header */}
          <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-[10px] leading-tight">
            <div>
              Patient: <span className="font-semibold">{review.patient.firstName} {review.patient.lastName}</span>
            </div>
            <div>
              UID: <span className="font-mono font-semibold">{review.patient.patientUid}</span>
            </div>
            <div>
              Age / Sex: <span className="font-semibold">{review.patient.ageYears} y · {GENDER_SHORT[review.patient.gender] ?? '—'}</span>
            </div>
            <div>
              Order: <span className="font-mono font-semibold">{review.order.id.slice(0, 8).toUpperCase()}</span>
            </div>
          </div>

          {/* Results table */}
          <table className="mt-2.5 w-full border-collapse text-[10px]">
            <thead>
              <tr className="border-y border-slate-400 text-left text-[9px] uppercase tracking-wide text-slate-500">
                <th className="py-1 pr-2 font-semibold">Test</th>
                <th className="py-1 pr-2 font-semibold">Result</th>
                <th className="py-1 pr-2 font-semibold">Unit</th>
                <th className="py-1 font-semibold">Ref Range</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const approved = r.status === 'approved';
                return (
                  <tr key={r.id} className="border-b border-slate-200">
                    <td className="py-1 pr-2">
                      <span className="font-medium">{r.testNameSnapshot}</span>
                      {approved && <span className="ml-1 text-emerald-700">✓</span>}
                    </td>
                    <td className="py-1 pr-2 font-mono font-semibold">
                      {approved ? (r.resultValue ?? '—') : <span className="text-slate-400">{r.status === 'verified' ? '…' : '—'}</span>}
                    </td>
                    <td className="py-1 pr-2 text-slate-600">{r.unit ?? '—'}</td>
                    <td className="py-1 font-mono text-slate-600">
                      {r.resultType === 'numeric' && r.refLow != null && r.refHigh != null ? `${r.refLow}–${r.refHigh}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Footer: signature block + QR */}
          <div className="mt-auto pt-3">
            <div className="flex items-end justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="border-t border-slate-400 pt-1.5">
                  <div className="text-[11px] font-semibold">Dr. Pathologist</div>
                  <div className="mt-0.5 truncate text-[8px] text-slate-500">
                    {firstStamp ? `Signature on file · stamp ${firstStamp}` : 'Awaiting approval signature'}
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-right">
                <PseudoQr seed={review.preview.verificationCode} className="h-14 w-14" />
                <div className="mt-1 font-mono text-[7px] font-semibold tracking-tight text-slate-600">
                  {review.preview.verificationCode}
                </div>
              </div>
            </div>

            {allApproved ? (
              <div className="mt-2.5 rounded-sm bg-emerald-700 py-1 text-center text-[10px] font-bold uppercase tracking-wider text-white">
                ✓ Ready for Report
              </div>
            ) : (
              <div className="mt-2.5 rounded-sm bg-slate-100 py-1 text-center text-[9px] font-medium text-slate-500">
                {approvedRows.length}/{review.summary.total} approved — results lock into the report as rows are approved
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ApprovalQueue() {
  const [queue, setQueue] = useState<QueueRow[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const [review, setReview] = useState<ReviewData | null>(null);
  const [loadingReview, setLoadingReview] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  // Reject-back-to-verify dialog: one verified/approved row at a time, reason required.
  const [rejectTarget, setRejectTarget] = useState<{ rowId: string; testName: string } | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectError, setRejectError] = useState('');

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setError('');
    try {
      const rows = await api.get<QueueRow[]>('/approval-queue');
      setQueue(rows);
      setSelectedId((prev) => (prev && rows.some((r) => r.orderId === prev) ? prev : (rows[0]?.orderId ?? null)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the approval queue');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  // Request-sequence guard — same pattern as Verify: after a mutation the
  // queue may auto-advance the selection while the old review is in flight.
  const reviewReqRef = useRef(0);
  const loadReview = useCallback(async (orderId: string) => {
    const req = ++reviewReqRef.current;
    setLoadingReview(true);
    setError('');
    try {
      const data = await api.get<ReviewData>(`/orders/${orderId}/approve-review`);
      if (req !== reviewReqRef.current) return;
      setReview(data);
    } catch (e) {
      if (req !== reviewReqRef.current) return;
      setError(e instanceof ApiError ? e.message : 'Could not load the approval sheet');
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
  const verifiedRows = useMemo(() => rows.filter((r) => r.status === 'verified'), [rows]);
  const allApproved = useMemo(() => !!review && review.summary.total > 0 && review.summary.approved === review.summary.total, [review]);

  const afterMutate = useCallback(
    async (orderId: string) => {
      await loadQueue();
      await loadReview(orderId);
    },
    [loadQueue, loadReview],
  );

  const approveRows = useCallback(
    async (orderId: string, orderTestIds: string[]) => {
      if (orderTestIds.length === 0) return;
      setBusy(true);
      setError('');
      setNotice('');
      try {
        const res = await api.put<ApproveResponse>(`/orders/${orderId}/approve`, { orderTestIds });
        if (res.skipped.length > 0) {
          setNotice(res.skipped.map((s) => s.message).join(' '));
        }
        if (res.approved.length > 0) {
          setNotice((prev) =>
            `${prev ? `${prev} ` : ''}Approved & signed ${res.approved.length} result${res.approved.length === 1 ? '' : 's'}.`.trim(),
          );
        }
        await afterMutate(orderId);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Approve failed');
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
      setRejectError('A reason is required to send this result back to verify.');
      return;
    }
    setRejectError('');
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await api.put(`/orders/${review.order.id}/reject-back-to-verify`, { orderTestId: rejectTarget.rowId, reason });
      setNotice(`Sent "${rejectTarget.testName}" back to Verification — reason recorded.`);
      setRejectTarget(null);
      setRejectReason('');
      await afterMutate(review.order.id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Reject failed');
    } finally {
      setBusy(false);
    }
  }, [rejectTarget, review, rejectReason, afterMutate]);

  if (loadingQueue) return <Spinner label="Loading approval queue…" />;
  if (error && queue.length === 0 && !review) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;

  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Approval</h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            Pathologist sign-off — the last gate before a report is final. What you approve here is what the patient receives.
          </p>
        </div>
        <Badge tone="slate">{queue.length} order{queue.length === 1 ? '' : 's'} waiting</Badge>
      </div>

      {error && queue.length > 0 && <p className="mb-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
      {notice && <p className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{notice}</p>}

      <div className="grid items-start gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
        {/* Left pane — the queue (oldest-verified-first). */}
        <Card title={`Queue (${queue.length})`} pad={false} className="lg:sticky lg:top-16">
          {queue.length === 0 ? (
            <div className="p-4">
              <EmptyState title="Nothing waiting for approval" hint="Orders with verified results appear here, oldest first." />
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
                        {row.verifiedCount} awaiting · wait {waitLabel(row.waitMs)}
                      </span>
                      <Badge tone="amber">{row.orderStatus.replaceAll('_', ' ')}</Badge>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        {/* Right pane — the review workspace: result sheet + live A4 preview. */}
        <div className="min-w-0">
          {!selectedId ? (
            <EmptyState title="Select an order from the queue" hint="The full result sheet and live report preview open here." />
          ) : loadingReview ? (
            <Spinner label="Loading approval sheet…" />
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
                    <Badge tone="teal">{review.order.status.replaceAll('_', ' ')}</Badge>
                    {allApproved && <Badge tone="green">Ready for Report</Badge>}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="text-[12px] font-medium text-slate-600">
                      {verifiedRows.length} awaiting approval
                    </span>
                    <button
                      onClick={() => void approveRows(review.order.id, verifiedRows.map((r) => r.id))}
                      disabled={busy || verifiedRows.length === 0}
                      className="inline-flex h-8 items-center rounded-md bg-brand-700 px-3 text-[12px] font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
                    >
                      Approve All Visible ({verifiedRows.length})
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

              <div className="mt-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]">
                {/* Left half — the result sheet (reuses the shared flagging). */}
                <div className="space-y-4">
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
                          const isApproved = row.status === 'approved';
                          const isVerified = row.status === 'verified';
                          return (
                            <li
                              key={row.id}
                              className={`grid grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_auto_auto] items-center gap-3 px-4 py-2 ${
                                isApproved ? 'opacity-80' : ''
                              }`}
                            >
                              <div>
                                <span className={`block text-[13px] font-medium ${isApproved ? 'text-slate-500' : 'text-slate-800'}`}>
                                  {row.testNameSnapshot}
                                  {isApproved && <span className="ml-1.5 text-emerald-600">✓ approved</span>}
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
                                {isVerified && (
                                  <button
                                    onClick={() => void approveRows(review.order.id, [row.id])}
                                    disabled={busy}
                                    className="inline-flex h-7 items-center rounded-md bg-brand-700 px-2.5 text-[12px] font-semibold text-white transition hover:bg-brand-800 disabled:opacity-50"
                                  >
                                    Approve &amp; Sign
                                  </button>
                                )}
                                {(isVerified || isApproved) && (
                                  <button
                                    onClick={() => setRejectTarget({ rowId: row.id, testName: row.testNameSnapshot })}
                                    disabled={busy}
                                    className="inline-flex h-7 items-center rounded-md border border-rose-200 bg-white px-2.5 text-[12px] font-semibold text-rose-700 transition hover:bg-rose-50 disabled:opacity-50"
                                  >
                                    Reject
                                  </button>
                                )}
                                {row.approvedAt && (
                                  <span className="max-w-[110px] truncate text-[10px] text-slate-400">
                                    {formatDateTime(row.approvedAt)}
                                  </span>
                                )}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    </Card>
                  ))}
                </div>

                {/* Right half — the LIVE A4 preview (scaled). */}
                <div className="xl:sticky xl:top-16">
                  <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">Live report preview</p>
                  <A4Preview review={review} />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <Modal
        open={rejectTarget !== null}
        title="Send result back to verify"
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
              Send back to verify
            </button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-slate-600">
            <span className="font-semibold text-slate-800">{rejectTarget?.testName}</span> returns to Result Entry as an
            editable result — it must pass Verification and Approval again after correction. Its current value is kept; all
            verify/approval stamps are cleared.
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
              placeholder="e.g. Value inconsistent with clinical picture"
              className="thulir-input resize-y"
            />
          </label>
          {rejectError && <p className="text-[12px] text-rose-600">{rejectError}</p>}
        </div>
      </Modal>
    </div>
  );
}
