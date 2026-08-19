import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { usePortalAuth } from '../../auth/usePortalAuth';
import { patientApi } from '../../lib/portal-auth';
import { ApiError } from '../../lib/http';
import { Badge, Card, EmptyState, Spinner } from '../../components/ui';
import { formatDate } from '../../lib/format';

interface PatientOrder {
  orderId: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  isUrgent: boolean;
  reportReady: boolean;
  patient: { patientUid: string; firstName: string; lastName: string };
}

/**
 * Stage 8: Patient portal — order list. Shows all orders for the
 * authenticated patient, with a clear "View Report" action once the
 * report is ready (disabled with a "not ready yet" note otherwise).
 * Calm visual register, no staff NavBar.
 */
export function PatientOrders() {
  const { portalUser, loading: authLoading, logout } = usePortalAuth();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<PatientOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await patientApi.get<PatientOrder[]>('/portal/patient/orders');
      setOrders(data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/portal/patient/login', { replace: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load orders');
    } finally {
      setLoading(false);
    }
  }, [navigate]);

  useEffect(() => {
    if (!authLoading && !portalUser) {
      navigate('/portal/patient/login', { replace: true });
    } else if (!authLoading && portalUser) {
      void load();
    }
  }, [authLoading, portalUser, load, navigate]);

  if (authLoading || loading) return <Spinner label="Loading your orders…" />;

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Portal header — no staff NavBar */}
      <header className="sticky top-0 z-40 border-b border-brand-900 bg-brand-800 shadow-sm">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-4">
          <span className="text-sm font-bold text-white">Patient Portal</span>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-brand-300">
              {portalUser?.id?.slice(0, 8).toUpperCase()}
            </span>
            <button
              onClick={async () => { await logout(); navigate('/portal/patient/login', { replace: true }); }}
              className="inline-flex h-8 items-center rounded-md border border-white/20 px-2.5 text-[12px] font-semibold text-slate-100 transition hover:bg-white/10"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <h1 className="mb-4 text-lg font-bold text-slate-800">My Orders</h1>

        {error && (
          <p className="mb-4 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        )}

        {orders.length === 0 ? (
          <Card>
            <EmptyState
              title="No orders found"
              hint="When you have lab tests done, your orders will appear here."
            />
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.orderId} className="overflow-hidden">
                <div className="flex items-center justify-between gap-4 p-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-brand-700">
                        {order.orderNumber}
                      </span>
                      {order.isUrgent && <Badge tone="rose">URGENT</Badge>}
                      <Badge tone={order.reportReady ? 'green' : 'slate'}>
                        {order.status.replace(/_/g, ' ')}
                      </Badge>
                    </div>
                    <div className="mt-1 text-[13px] text-slate-500">
                      {formatDate(order.createdAt)}
                      {' · '}
                      {order.patient.firstName} {order.patient.lastName}
                    </div>
                  </div>
                  <div className="shrink-0">
                    {order.reportReady ? (
                      <Link
                        to={`/portal/patient/orders/${order.orderId}/report`}
                        className="thulir-btn thulir-btn-primary text-[13px]"
                      >
                        View Report
                      </Link>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-[13px] font-medium text-slate-400"
                        title="Report will be available once all results are approved"
                      >
                        Not ready yet
                      </span>
                    )}
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
