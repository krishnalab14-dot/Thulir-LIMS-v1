import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, inr } from '../lib/format';

interface OrderRow {
  id: string;
  status: string;
  isUrgent: boolean;
  subtotal: string;
  discountPercent: string;
  totalAmount: string;
  createdAt: string;
  patient: { patientUid: string; firstName: string; lastName: string; mobile: string };
  orderTests: { testNameSnapshot: string; status: string }[];
  invoice?: { status: string };
}

const ORDER_TONES: Record<string, string> = {
  billed: 'slate',
  collected: 'blue',
  entered: 'teal',
  partially_verified: 'amber',
  verified: 'teal',
  partially_approved: 'violet',
  approved: 'green',
};

export function Orders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setOrders(await api.get<OrderRow[]>('/orders'));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load orders');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Orders</h1>
          <p className="text-[13px] text-slate-500">Stage 1 read-only list — status rollups derive from per-test statuses.</p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
      </div>

      {loading && <Spinner label="Loading orders…" />}
      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      {!loading && !error && orders.length === 0 && <EmptyState title="No orders yet" hint="Register a patient and submit an order from Patient Registration." />}

      {!loading && orders.length > 0 && (
        <Card pad={false}>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="thulir-th">Order</th>
                <th className="thulir-th">Patient</th>
                <th className="thulir-th">Items</th>
                <th className="thulir-th text-right">Total</th>
                <th className="thulir-th">Order Status</th>
                <th className="thulir-th">Invoice</th>
                <th className="thulir-th">Created</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => navigate(`/orders/${o.id}`)}
                  className="cursor-pointer border-t border-slate-100 transition hover:bg-brand-50"
                  title="View order detail"
                >
                  <td className="thulir-td">
                    <span className="flex items-center gap-1.5 font-mono text-[12px] font-semibold text-brand-700">
                      {o.id.slice(0, 8).toUpperCase()}
                      {o.isUrgent && <Badge tone="rose">URGENT</Badge>}
                    </span>
                  </td>
                  <td className="thulir-td">
                    <span className="block text-[13px] font-medium text-slate-800">
                      {o.patient.firstName} {o.patient.lastName}
                    </span>
                    <span className="block font-mono text-[11px] text-slate-400">{o.patient.patientUid}</span>
                  </td>
                  <td className="thulir-td">
                    <span className="block max-w-[220px] truncate text-[12px] text-slate-600" title={o.orderTests.map((t) => t.testNameSnapshot).join(', ')}>
                      {o.orderTests.map((t) => t.testNameSnapshot).join(', ')}
                    </span>
                    <span className="text-[11px] text-slate-400">{o.orderTests.length} test{o.orderTests.length === 1 ? '' : 's'}</span>
                  </td>
                  <td className="thulir-td text-right font-mono text-[13px] font-semibold text-slate-800">{inr(o.totalAmount)}</td>
                  <td className="thulir-td">
                    <Badge tone={ORDER_TONES[o.status] ?? 'slate'}>{o.status.replaceAll('_', ' ')}</Badge>
                  </td>
                  <td className="thulir-td">
                    <Badge tone={o.invoice?.status === 'paid' ? 'green' : o.invoice?.status === 'partial' ? 'amber' : 'slate'}>
                      {o.invoice?.status ?? '—'}
                    </Badge>
                  </td>
                  <td className="thulir-td text-[12px] text-slate-500">{formatDateTime(o.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
