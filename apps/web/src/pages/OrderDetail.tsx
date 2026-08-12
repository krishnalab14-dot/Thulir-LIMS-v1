import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Card, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, inr } from '../lib/format';

interface OrderDetailData {
  id: string;
  status: string;
  isUrgent: boolean;
  subtotal: string;
  discountPercent: string;
  totalAmount: string;
  createdAt: string;
  patient: { patientUid: string; firstName: string; lastName: string; mobile: string };
  orderTests: { id: string; testNameSnapshot: string; status: string }[];
  invoice?: { status: string; totalAmount: string } | null;
  samples: {
    id: string;
    barcodeValue: string;
    status: string;
    collectedAt?: string | null;
    createdAt: string;
    sampleType: { name: string; code: string | null };
    orderTests: { id: string; testNameSnapshot: string }[];
  }[];
}

const SAMPLE_TONES: Record<string, string> = {
  pending_collection: 'amber',
  collected: 'green',
  rejected: 'rose',
};

const ORDER_TONES: Record<string, string> = {
  billed: 'slate',
  collected: 'blue',
  entered: 'teal',
  partially_verified: 'amber',
  verified: 'teal',
  partially_approved: 'violet',
  approved: 'green',
};

export function OrderDetail() {
  const { id = '' } = useParams();
  const [order, setOrder] = useState<OrderDetailData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrder(await api.get<OrderDetailData>(`/orders/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load order');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="Loading order…" />;
  if (error) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!order) return null;

  return (
    <div className="space-y-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Order detail</p>
        <h1 className="flex items-center gap-2 text-lg font-bold text-slate-800">
          <span className="font-mono">{order.id.slice(0, 8).toUpperCase()}</span>
          {order.isUrgent && <Badge tone="rose">URGENT</Badge>}
          <Badge tone={ORDER_TONES[order.status] ?? 'slate'}>{order.status.replaceAll('_', ' ')}</Badge>
        </h1>
        <p className="text-[13px] text-slate-500">
          {order.patient.firstName} {order.patient.lastName} · {order.patient.patientUid} · created {formatDateTime(order.createdAt)}
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Ordered tests">
          <ul className="divide-y divide-slate-100">
            {order.orderTests.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-1.5 text-sm">
                <span className="text-slate-700">{t.testNameSnapshot}</span>
                <Badge tone={t.status === 'pending' ? 'slate' : 'teal'}>{t.status.replaceAll('_', ' ')}</Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Billing">
          <dl className="space-y-1.5 text-sm">
            <div className="flex justify-between">
              <dt className="text-slate-500">Subtotal</dt>
              <dd className="font-mono">{inr(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Discount</dt>
              <dd className="font-mono">{Number(order.discountPercent)}%</dd>
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-1.5">
              <dt className="font-medium text-slate-700">Total</dt>
              <dd className="font-mono font-bold text-brand-800">{inr(order.totalAmount)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-slate-500">Invoice</dt>
              <dd>
                <Badge tone={order.invoice?.status === 'paid' ? 'green' : order.invoice?.status === 'partial' ? 'amber' : 'slate'}>
                  {order.invoice?.status ?? '—'}
                </Badge>
              </dd>
            </div>
          </dl>
        </Card>
      </div>

      <Card title={`Samples (${order.samples.length})`} pad={false}>
        {order.samples.length === 0 ? (
          <p className="p-4 text-[13px] text-slate-500">No samples — the ordered tests have no required sample type.</p>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="thulir-th">Barcode</th>
                <th className="thulir-th">Tube</th>
                <th className="thulir-th">Tests</th>
                <th className="thulir-th">Status</th>
                <th className="thulir-th">Collected</th>
              </tr>
            </thead>
            <tbody>
              {order.samples.map((s) => (
                <tr key={s.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                  <td className="thulir-td">
                    <Link to={`/samples/${s.id}`} className="font-mono text-[12px] font-semibold text-brand-700 hover:underline">
                      {s.barcodeValue}
                    </Link>
                  </td>
                  <td className="thulir-td text-[13px]">{s.sampleType.name}</td>
                  <td className="thulir-td">
                    <span className="block max-w-[280px] truncate text-[12px] text-slate-600" title={s.orderTests.map((t) => t.testNameSnapshot).join(', ')}>
                      {s.orderTests.map((t) => t.testNameSnapshot).join(', ')}
                    </span>
                  </td>
                  <td className="thulir-td">
                    <Badge tone={SAMPLE_TONES[s.status] ?? 'slate'}>{s.status.replaceAll('_', ' ')}</Badge>
                  </td>
                  <td className="thulir-td text-[12px] text-slate-500">{s.collectedAt ? formatDateTime(s.collectedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
