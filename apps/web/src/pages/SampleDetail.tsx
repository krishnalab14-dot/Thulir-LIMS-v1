import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface SampleDetailData {
  id: string;
  barcodeValue: string;
  status: string;
  collectedBy?: string | null;
  collectedAt?: string | null;
  rejectedReason?: string | null;
  rejectedReasonNote?: string | null;
  rejectedBy?: string | null;
  rejectedAt?: string | null;
  createdAt: string;
  sampleType: { id: string; name: string; code: string | null };
  order: {
    id: string;
    isUrgent: boolean;
    createdAt: string;
    patient: { id: string; patientUid: string; firstName: string; lastName: string; mobile: string };
  };
  orderTests: { id: string; testNameSnapshot: string; status: string }[];
  chain: { id: string; barcodeValue: string; status: string; createdAt: string }[];
}

interface LabelData {
  barcodeValue: string;
  patientName: string;
  patientUid: string;
  sampleTypeName: string;
  orderId: string;
  labName: string;
}

const STATUS_TONES: Record<string, string> = {
  pending_collection: 'amber',
  collected: 'green',
  rejected: 'rose',
};

function statusLabel(status: string): string {
  return status.replaceAll('_', ' ');
}

export function SampleDetail() {
  const { id = '' } = useParams();
  const [sample, setSample] = useState<SampleDetailData | null>(null);
  const [label, setLabel] = useState<LabelData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSample(await api.get<SampleDetailData>(`/samples/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load sample');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const printLabel = useCallback(async () => {
    try {
      const data = await api.get<LabelData>(`/samples/${id}/label`);
      setLabel(data);
      // Render the label into the print area, then print after a tick so the DOM is in place.
      setTimeout(() => window.print(), 50);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load the label');
    }
  }, [id]);

  if (loading) return <Spinner label="Loading sample…" />;
  if (error) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!sample) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Sample detail</p>
          <h1 className="flex items-center gap-2 font-mono text-xl font-bold tracking-wide text-slate-900">
            {sample.barcodeValue}
            <Badge tone={STATUS_TONES[sample.status] ?? 'slate'}>{statusLabel(sample.status)}</Badge>
          </h1>
          <p className="mt-0.5 text-[13px] text-slate-500">
            {sample.order.patient.firstName} {sample.order.patient.lastName} · {sample.sampleType.name} · created{' '}
            {formatDateTime(sample.createdAt)}
          </p>
        </div>
        <Button variant="primary" onClick={() => void printLabel()}>
          🖨 Print Label
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Lifecycle">
          <div className="space-y-1.5 text-sm">
            <p className="flex justify-between">
              <span className="text-slate-500">Status</span>
              <Badge tone={STATUS_TONES[sample.status] ?? 'slate'}>{statusLabel(sample.status)}</Badge>
            </p>
            {sample.status === 'collected' && (
              <>
                <p className="flex justify-between">
                  <span className="text-slate-500">Collected by</span>
                  <span className="font-mono text-[13px]">{sample.collectedBy ?? '—'}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Collected at</span>
                  <span>{formatDateTime(sample.collectedAt)}</span>
                </p>
              </>
            )}
            {sample.status === 'rejected' && (
              <>
                <p className="flex justify-between">
                  <span className="text-slate-500">Reason</span>
                  <span className="font-medium text-rose-700">{statusLabel(sample.rejectedReason ?? 'unknown')}</span>
                </p>
                {sample.rejectedReasonNote && (
                  <p className="flex justify-between">
                    <span className="text-slate-500">Note</span>
                    <span className="text-right text-[13px]">{sample.rejectedReasonNote}</span>
                  </p>
                )}
                <p className="flex justify-between">
                  <span className="text-slate-500">Rejected by</span>
                  <span className="font-mono text-[13px]">{sample.rejectedBy ?? '—'}</span>
                </p>
                <p className="flex justify-between">
                  <span className="text-slate-500">Rejected at</span>
                  <span>{formatDateTime(sample.rejectedAt)}</span>
                </p>
              </>
            )}
            <p className="flex justify-between">
              <span className="text-slate-500">Order</span>
              <Link to={`/orders/${sample.order.id}`} className="font-mono text-[13px] text-brand-700 hover:underline">
                {sample.order.id.slice(0, 8).toUpperCase()}
                {sample.order.isUrgent && <Badge tone="rose">URGENT</Badge>}
              </Link>
            </p>
          </div>
        </Card>

        <Card title="Ordered tests">
          <ul className="divide-y divide-slate-100">
            {sample.orderTests.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-700">{t.testNameSnapshot}</span>
                <Badge tone={t.status === 'pending' ? 'slate' : 'teal'}>{statusLabel(t.status)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {sample.chain.length > 1 && (
        <Card title={`Recollection chain (${sample.chain.length} samples)`}>
          <ol className="space-y-2">
            {sample.chain.map((c, idx) => (
              <li key={c.id} className="flex items-center gap-2 text-sm">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[11px] font-bold text-slate-500">
                  {idx + 1}
                </span>
                <Link to={`/samples/${c.id}`} className={`font-mono text-[13px] hover:underline ${c.id === sample.id ? 'font-bold text-brand-800' : 'text-slate-600'}`}>
                  {c.barcodeValue}
                </Link>
                <Badge tone={STATUS_TONES[c.status] ?? 'slate'}>{statusLabel(c.status)}</Badge>
                {idx < sample.chain.length - 1 && <span className="text-slate-300">→</span>}
              </li>
            ))}
          </ol>
        </Card>
      )}

      {/* Printable label — rendered only during window.print() (see .print-area in index.css). */}
      {label && (
        <div className="print-area thulir-card p-5">
          <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700">{label.labName}</p>
          <p className="mt-3 font-mono text-2xl font-bold tracking-widest text-slate-900">{label.barcodeValue}</p>
          <p className="mt-2 text-sm text-slate-800">{label.patientName}</p>
          <p className="font-mono text-[12px] text-slate-500">{label.patientUid}</p>
          <p className="mt-2 text-sm text-slate-700">{label.sampleTypeName}</p>
          <p className="text-[12px] text-slate-500">Order {label.orderId.slice(0, 8).toUpperCase()}</p>
        </div>
      )}
    </div>
  );
}
