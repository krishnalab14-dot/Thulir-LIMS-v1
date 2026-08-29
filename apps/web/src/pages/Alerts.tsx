import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime } from '../lib/format';

interface AlertPatient {
  patientUid: string;
  firstName: string;
  lastName: string;
  gender: string;
}

interface AlertRow {
  id: string;
  value: string;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
  createdAt: string;
  orderTestId: string;
  testName: string;
  orderId: string;
  billNo: string | null;
  patient: AlertPatient;
}

/**
 * Alerts inbox (Stage 9): lists critical-value alerts with acknowledge
 * action. Unacknowledged ones are visually distinct using the existing
 * critical-rose token from Stage 3.
 */
export function Alerts() {
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [ackId, setAckId] = useState<string | null>(null);
  const [ackError, setAckError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const rows = await api.get<AlertRow[]>('/alerts');
      setAlerts(rows);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load alerts');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const handleAck = useCallback(async (id: string) => {
    setAckId(id);
    setAckError('');
    try {
      await api.put(`/alerts/${id}/acknowledge`);
      // Remove the acknowledged alert from the local list (optimistic update)
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, acknowledgedBy: 'you', acknowledgedAt: new Date().toISOString() } : a)));
    } catch (e) {
      setAckError(e instanceof ApiError ? e.message : 'Failed to acknowledge');
    } finally {
      setAckId(null);
    }
  }, []);

  const unacknowledged = alerts.filter((a) => !a.acknowledgedAt);
  const acknowledged = alerts.filter((a) => a.acknowledgedAt);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Critical Value Alerts</h1>
          <p className="text-xs text-slate-500">
            Alerts generated when a numeric result breaches critical thresholds.
          </p>
        </div>
        {unacknowledged.length > 0 && (
          <Badge tone="rose">{unacknowledged.length} pending</Badge>
        )}
      </header>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}
      {ackError && <div className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-700">{ackError}</div>}

      {loading ? (
        <Spinner label="Loading alerts…" />
      ) : alerts.length === 0 ? (
        <EmptyState title="No critical value alerts" hint="Alerts will appear here when a numeric result exceeds the defined critical thresholds." />
      ) : (
        <>
          {/* Unacknowledged section */}
          {unacknowledged.length > 0 && (
            <Card title={<span className="flex items-center gap-2"><span className="inline-block h-2.5 w-2.5 rounded-full bg-rose-500" />Pending Acknowledgment</span>}>
              <div className="divide-y divide-slate-100">
                {unacknowledged.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={handleAck}
                    acknowledging={ackId === alert.id}
                  />
                ))}
              </div>
            </Card>
          )}

          {/* Acknowledged section */}
          {acknowledged.length > 0 && (
            <Card title="Acknowledged">
              <div className="divide-y divide-slate-100">
                {acknowledged.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    onAcknowledge={handleAck}
                    acknowledging={ackId === alert.id}
                  />
                ))}
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function AlertRow({
  alert,
  onAcknowledge,
  acknowledging,
}: {
  alert: AlertRow;
  onAcknowledge: (id: string) => void;
  acknowledging: boolean;
}) {
  const isUnacknowledged = !alert.acknowledgedAt;

  return (
    <div
      className={`flex items-start justify-between gap-3 px-4 py-3 ${
        isUnacknowledged ? 'bg-rose-50/60' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isUnacknowledged && (
            <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-rose-500" />
          )}
          <span className="truncate text-sm font-medium text-slate-800">
            {alert.patient.firstName} {alert.patient.lastName}
          </span>
          <span className="text-xs text-slate-400">({alert.patient.patientUid})</span>
          {alert.billNo && <Badge tone="slate">{alert.billNo}</Badge>}
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          <span>
            <span className="font-medium text-slate-600">{alert.testName}</span>{' '}
            = <span className="font-mono font-bold text-rose-700">{alert.value}</span>
          </span>
          <span>{formatDateTime(alert.createdAt)}</span>
        </div>
        {alert.acknowledgedAt && (
          <div className="mt-1 text-xs text-slate-400">
            Acknowledged {formatDateTime(alert.acknowledgedAt)}
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        {alert.orderId && (
          <Link
            to={`/orders/${alert.orderId}/results`}
            className="rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
          >
            View Order
          </Link>
        )}
        {isUnacknowledged && (
          <button
            onClick={() => onAcknowledge(alert.id)}
            disabled={acknowledging}
            className="rounded bg-rose-600 px-3 py-1 text-xs font-semibold text-white transition hover:bg-rose-700 disabled:opacity-50"
          >
            {acknowledging ? 'Acknowledging…' : 'Acknowledge'}
          </button>
        )}
      </div>
    </div>
  );
}
