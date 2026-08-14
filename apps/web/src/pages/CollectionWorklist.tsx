import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Modal, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { waitLabel } from '../lib/format';

interface PendingSample {
  id: string;
  barcodeValue: string;
  status: string;
  createdAt: string;
  sampleType: { id: string; name: string; code: string | null };
  order: {
    id: string;
    isUrgent: boolean;
    createdAt: string;
    patient: { id: string; patientUid: string; firstName: string; lastName: string; mobile: string };
  };
}

const REJECTION_REASONS = [
  { value: 'hemolyzed', label: 'Hemolyzed' },
  { value: 'clotted', label: 'Clotted' },
  { value: 'insufficient_quantity', label: 'Insufficient quantity' },
  { value: 'mislabeled', label: 'Mislabeled' },
  { value: 'container_leaked', label: 'Container leaked' },
  { value: 'other', label: 'Other' },
];

export function CollectionWorklist() {
  const [samples, setSamples] = useState<PendingSample[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState('');

  // Scan-or-type barcode flow.
  const [scanValue, setScanValue] = useState('');
  const [scanTarget, setScanTarget] = useState<PendingSample | null>(null);
  const [scanError, setScanError] = useState('');
  const scanRef = useRef<HTMLInputElement>(null);

  // Reject dialog.
  const [rejectTarget, setRejectTarget] = useState<PendingSample | null>(null);
  const [rejectReason, setRejectReason] = useState('hemolyzed');
  const [rejectNote, setRejectNote] = useState('');
  const [rejectError, setRejectError] = useState('');

  // Banner after a rejection, so the new recollection label is never silently hidden.
  const [recollection, setRecollection] = useState<{ id: string; barcodeValue: string; orderId: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSamples(await api.get<PendingSample[]>('/samples/pending'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the worklist');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    scanRef.current?.focus();
  }, [load]);

  const resolveScan = useCallback(() => {
    const term = scanValue.trim().toUpperCase();
    setScanError('');
    if (!term) return;
    const match = samples.find((s) => s.barcodeValue.toUpperCase() === term);
    if (!match) {
      setScanError(`No pending sample matches "${term}". It may already be collected/rejected, or the barcode is unknown.`);
      return;
    }
    setScanTarget(match);
    setScanValue('');
  }, [scanValue, samples]);

  const collect = useCallback(
    async (id: string) => {
      setBusyId(id);
      setError('');
      setRecollection(null);
      try {
        await api.put(`/samples/${id}/collect`);
        await load();
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Collect failed');
      } finally {
        setBusyId('');
        setScanTarget(null);
      }
    },
    [load],
  );

  const submitReject = useCallback(async () => {
    if (!rejectTarget) return;
    setRejectError('');
    setBusyId(rejectTarget.id);
    try {
      const recol = await api.put<{ id: string; barcodeValue: string; orderId: string }>(`/samples/${rejectTarget.id}/reject`, {
        reason: rejectReason,
        note: rejectReason === 'other' ? rejectNote : undefined,
      });
      setRecollection(recol);
      setRejectTarget(null);
      setRejectNote('');
      setRejectReason('hemolyzed');
      await load();
    } catch (e) {
      setRejectError(e instanceof ApiError ? e.message : 'Reject failed');
    } finally {
      setBusyId('');
    }
  }, [rejectTarget, rejectReason, rejectNote, load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Sample Collection Worklist</h1>
          <p className="text-[13px] text-slate-500">
            Pending samples, oldest first. Scan a barcode or use the row actions — collecting and receiving are one action.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {recollection && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3">
          <div>
            <p className="text-sm font-semibold text-emerald-800">Sample rejected — new recollection created</p>
            <p className="font-mono text-[13px] text-emerald-900">
              {recollection.barcodeValue} <span className="text-emerald-600">· awaiting collection</span>
            </p>
          </div>
          <Link to={`/samples/${recollection.id}`} className="rounded-md border border-emerald-300 bg-white px-3 py-1.5 text-[13px] font-medium text-emerald-800 hover:bg-emerald-100">
            Print / view label
          </Link>
        </div>
      )}

      {/* Scan-or-type barcode input — barcode scanners act as a keyboard + Enter. */}
      <Card pad={false}>
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="flex gap-2">
            <input
              ref={scanRef}
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  resolveScan();
                }
              }}
              placeholder="Scan or type barcode, then press Enter…"
              className="thulir-input font-mono uppercase"
              autoComplete="off"
              spellCheck={false}
            />
            <Button variant="primary" onClick={resolveScan}>
              Resolve
            </Button>
          </div>
          {scanError && <p className="mt-2 text-[13px] text-rose-700">{scanError}</p>}
        </div>
      </Card>

      {scanTarget && (
        <Modal open onClose={() => setScanTarget(null)} title="Collect this sample?">
          <div className="space-y-1">
            <p className="font-mono text-lg font-bold tracking-wide text-brand-800">{scanTarget.barcodeValue}</p>
            <p className="text-sm text-slate-700">
              {scanTarget.order.patient.firstName} {scanTarget.order.patient.lastName} · {scanTarget.sampleType.name}
            </p>
            <p className="text-[12px] text-slate-500">
              Order {scanTarget.order.id.slice(0, 8).toUpperCase()} · awaiting collection
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setScanTarget(null)}>Cancel</Button>
            <Button variant="primary" onClick={() => void collect(scanTarget.id)} disabled={busyId === scanTarget.id}>
              Confirm collect
            </Button>
          </div>
        </Modal>
      )}

      {loading && <Spinner label="Loading worklist…" />}

      {!loading && !error && samples.length === 0 && (
        <EmptyState title="No samples awaiting collection" hint="New orders with required sample types appear here automatically." />
      )}

      {!loading && samples.length > 0 && (
        <Card pad={false}>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="thulir-th">Barcode</th>
                <th className="thulir-th">Patient</th>
                <th className="thulir-th">Sample Type</th>
                <th className="thulir-th">Order</th>
                <th className="thulir-th">Wait</th>
                <th className="thulir-th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {samples.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                  <td className="thulir-td">
                    <Link to={`/samples/${s.id}`} className="font-mono text-[12px] font-semibold text-brand-700 hover:underline">
                      {s.barcodeValue}
                    </Link>
                  </td>
                  <td className="thulir-td">
                    <span className="block text-[13px] font-medium text-slate-800">
                      {s.order.patient.firstName} {s.order.patient.lastName}
                    </span>
                    <span className="block font-mono text-[11px] text-slate-400">{s.order.patient.patientUid}</span>
                  </td>
                  <td className="thulir-td text-[13px]">{s.sampleType.name}</td>
                  <td className="thulir-td">
                    <span className="flex items-center gap-1.5">
                      <span className="font-mono text-[12px] text-slate-600">{s.order.id.slice(0, 8).toUpperCase()}</span>
                      {s.order.isUrgent && <Badge tone="rose">URGENT</Badge>}
                    </span>
                  </td>
                  <td className="thulir-td text-[12px] text-slate-500">{waitLabel(Date.now() - new Date(s.createdAt).getTime())}</td>
                  <td className="thulir-td">
                    <div className="flex justify-end gap-1.5">
                      <Button variant="primary" onClick={() => void collect(s.id)} disabled={busyId === s.id}>
                        Collect
                      </Button>
                      <Button variant="danger" onClick={() => setRejectTarget(s)} disabled={busyId === s.id}>
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {rejectTarget && (
        <Modal open onClose={() => setRejectTarget(null)} title={`Reject sample ${rejectTarget.barcodeValue}`}>
          <div className="space-y-3">
            <p className="text-[13px] text-slate-500">
              {rejectTarget.order.patient.firstName} {rejectTarget.order.patient.lastName} · {rejectTarget.sampleType.name}
            </p>
            <div>
              <span className="thulir-label">Rejection reason</span>
              <select className="thulir-input" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}>
                {REJECTION_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
            {rejectReason === 'other' && (
              <div>
                <span className="thulir-label">
                  Note <span className="text-rose-600">*</span>
                </span>
                <input
                  className="thulir-input"
                  value={rejectNote}
                  onChange={(e) => setRejectNote(e.target.value)}
                  placeholder="e.g. label torn at collection"
                  maxLength={500}
                />
              </div>
            )}
            {rejectError && <p className="text-[13px] text-rose-700">{rejectError}</p>}
            <p className="text-[12px] text-slate-400">
              A new recollection sample will be created automatically and the affected tests re-linked. Billing is never touched.
            </p>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button onClick={() => setRejectTarget(null)}>Cancel</Button>
            <Button variant="danger" onClick={() => void submitReject()} disabled={busyId === rejectTarget.id}>
              Reject & create recollection
            </Button>
          </div>
        </Modal>
      )}
    </div>
  );
}
