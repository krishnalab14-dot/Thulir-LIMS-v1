import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Modal, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDateTime, inr, round2 } from '../lib/format';

/**
 * Consolidated Bill view (frontend for the already-built bill-groups API).
 *
 * GET  /api/bill-groups/:id          → group + orders + combined totals
 * POST /api/bill-groups/:id/payments → distribute one payment across orders
 *
 * Response shapes verified against apps/api/src/bill-groups/bill-groups.service.ts:
 *  - combined* totals are plain numbers; per-order invoice money fields are
 *    Prisma Decimals (JSON strings) except the computed `paid`/`outstanding`
 *    which the service returns as numbers nested inside `invoice`.
 *  - an order without an invoice has no `invoice` object at all.
 */

const PAYMENT_MODES = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'upi', label: 'UPI' },
  { mode: 'card', label: 'Card' },
  { mode: 'bank_transfer', label: 'Bank Transfer' },
  { mode: 'insurance', label: 'Insurance' },
] as const;

interface BillGroupOrder {
  id: string;
  status: string;
  subtotal: string;
  discountPercent: string;
  totalAmount: string;
  createdAt: string;
  patient: { patientUid: string; firstName: string; lastName: string; mobile: string };
  orderTests: { id: string; testNameSnapshot: string; snapshottedPrice: string }[];
  invoice?: {
    id: string;
    status: string;
    subtotal: string;
    discountPercent: string;
    totalAmount: string;
    /** Computed server-side (numbers, not Decimals). */
    paid: number;
    outstanding: number;
  } | null;
}

interface BillGroupData {
  id: string;
  createdAt: string;
  orders: BillGroupOrder[];
  combinedSubtotal: number;
  combinedTotal: number;
  combinedPaid: number;
  combinedOutstanding: number;
}

interface PaymentDistribution {
  groupId: string;
  totalPaid: number;
  distribution: { orderId: string; invoiceId: string; distributed: number; newStatus: string }[];
}

export function ConsolidatedBill() {
  const { id = '' } = useParams();
  const [group, setGroup] = useState<BillGroupData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // --- Record Payment modal state (same pattern as OrderBillingStep) ---
  const [payOpen, setPayOpen] = useState(false);
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({ cash: '', upi: '', card: '', bank_transfer: '', insurance: '' });
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState('');
  const [lastDistribution, setLastDistribution] = useState<PaymentDistribution | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setGroup(await api.get<BillGroupData>(`/bill-groups/${id}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load consolidated bill');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalEntered = round2(PAYMENT_MODES.reduce((acc, m) => acc + (Number(paymentAmounts[m.mode]) || 0), 0));
  const outstanding = group?.combinedOutstanding ?? 0;

  async function submitPayment() {
    if (!group) return;
    if (totalEntered <= 0) {
      setPayError('Enter an amount for at least one payment mode.');
      return;
    }
    if (totalEntered > outstanding) {
      setPayError(`Payment exceeds the group's outstanding balance of ${inr(outstanding)}.`);
      return;
    }
    setPaying(true);
    setPayError('');
    try {
      const splits = PAYMENT_MODES.map((m) => ({ mode: m.mode, amount: Number(paymentAmounts[m.mode]) || 0 })).filter((s) => s.amount > 0);
      const result = await api.post<PaymentDistribution>(`/bill-groups/${group.id}/payments`, { splits });
      setPayOpen(false);
      setPaymentAmounts({ cash: '', upi: '', card: '', bank_transfer: '', insurance: '' });
      setLastDistribution(result);
      await load();
    } catch (e) {
      setPayError(e instanceof ApiError ? e.message : 'Could not record payment');
    } finally {
      setPaying(false);
    }
  }

  if (loading) return <Spinner label="Loading consolidated bill…" />;
  if (error) return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>;
  if (!group) return null;

  return (
    <div className="space-y-4">
      {/* Toolbar — hidden when printing */}
      <div className="no-print flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">Consolidated bill</p>
          <h1 className="text-lg font-bold text-slate-800">
            <span className="font-mono">BG-{group.id.slice(0, 8).toUpperCase()}</span>
            <span className="ml-2 text-[13px] font-normal text-slate-500">{group.orders.length} order{group.orders.length === 1 ? '' : 's'} · created {formatDateTime(group.createdAt)}</span>
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => window.print()}>
            Print
          </Button>
          <Button variant="primary" onClick={() => { setPayOpen(true); setPayError(''); }} disabled={outstanding <= 0} title={outstanding <= 0 ? 'Nothing outstanding' : undefined}>
            Record payment
          </Button>
        </div>
      </div>

      {lastDistribution && (
        <div className="no-print rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Recorded {inr(lastDistribution.totalPaid)} across {lastDistribution.distribution.length} order{lastDistribution.distribution.length === 1 ? '' : 's'}:{' '}
          {lastDistribution.distribution.map((d) => `${d.orderId.slice(0, 8).toUpperCase()} ← ${inr(d.distributed)} (${d.newStatus})`).join(' · ')}
        </div>
      )}

      {/* The printable sheet — same print hook as the A4 report (.report-sheet rules in index.css). */}
      <div className="overflow-x-auto pb-8">
        <div className="report-sheet mx-auto min-h-[1123px] w-[794px] bg-white px-10 py-8 text-slate-800 shadow-xl ring-1 ring-slate-200">
          {/* Bill header */}
          <header className="flex items-start justify-between border-b border-slate-200 pb-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight text-brand-900">Consolidated Bill</h2>
              <p className="mt-1 text-[12px] text-slate-500">
                Bill group <span className="font-mono">BG-{group.id.slice(0, 8).toUpperCase()}</span> · {formatDateTime(group.createdAt)}
              </p>
            </div>
            <Badge tone={outstanding <= 0 ? 'green' : 'amber'}>{outstanding <= 0 ? 'Fully paid' : `${inr(outstanding)} due`}</Badge>
          </header>

          {/* One section per patient/order */}
          <div className="mt-6 space-y-6">
            {group.orders.length === 0 && (
              <p className="rounded-md border border-dashed border-slate-300 px-4 py-8 text-center text-sm text-slate-500">
                No orders linked to this bill group yet.
              </p>
            )}
            {group.orders.map((order, idx) => (
              <section key={order.id}>
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-800">
                    {idx + 1}. {order.patient.firstName} {order.patient.lastName}
                    <span className="ml-2 font-normal text-[12px] text-slate-500">{order.patient.patientUid} · {order.patient.mobile}</span>
                  </h3>
                  <span className="font-mono text-[12px] text-slate-400">{order.id.slice(0, 8).toUpperCase()}</span>
                </div>

                <table className="mt-2 w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-slate-200 text-left text-[11px] uppercase tracking-wide text-slate-400">
                      <th className="py-1.5 pr-3 font-medium">Test / service</th>
                      <th className="py-1.5 pl-3 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.orderTests.map((t) => (
                      <tr key={t.id} className="border-b border-slate-100">
                        <td className="py-1.5 pr-3 text-slate-700">{t.testNameSnapshot}</td>
                        <td className="py-1.5 pl-3 text-right font-mono text-slate-700">{inr(t.snapshottedPrice)}</td>
                      </tr>
                    ))}
                    {order.orderTests.length === 0 && (
                      <tr>
                        <td colSpan={2} className="py-1.5 text-slate-400">No line items.</td>
                      </tr>
                    )}
                  </tbody>
                </table>

                {/* Per-order totals */}
                <dl className="mt-2 ml-auto w-64 space-y-1 text-[13px]">
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Subtotal</dt>
                    <dd className="font-mono">{inr(order.invoice?.subtotal ?? order.subtotal)}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Discount</dt>
                    <dd className="font-mono">{Number(order.invoice?.discountPercent ?? order.discountPercent)}%</dd>
                  </div>
                  <div className="flex justify-between border-t border-slate-200 pt-1">
                    <dt className="font-medium text-slate-700">Total</dt>
                    <dd className="font-mono font-semibold">{inr(order.invoice?.totalAmount ?? order.totalAmount)}</dd>
                  </div>
                  {order.invoice && (
                    <>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Paid</dt>
                        <dd className="font-mono text-emerald-700">{inr(order.invoice.paid)}</dd>
                      </div>
                      <div className="flex justify-between">
                        <dt className="text-slate-500">Due</dt>
                        <dd className={`font-mono ${order.invoice.outstanding > 0 ? 'text-amber-700' : 'text-slate-500'}`}>{inr(order.invoice.outstanding)}</dd>
                      </div>
                    </>
                  )}
                </dl>
              </section>
            ))}
          </div>

          {/* Combined summary */}
          <footer className="mt-8 border-t-2 border-slate-800 pt-4">
            <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-slate-700">Bill summary</h3>
            <dl className="ml-auto w-72 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Combined subtotal</dt>
                <dd className="font-mono">{inr(group.combinedSubtotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="font-medium text-slate-700">Combined total</dt>
                <dd className="font-mono font-bold">{inr(group.combinedTotal)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-500">Paid</dt>
                <dd className="font-mono text-emerald-700">{inr(group.combinedPaid)}</dd>
              </div>
              <div className="flex justify-between border-t border-slate-300 pt-1.5">
                <dt className="font-bold text-slate-800">Outstanding</dt>
                <dd className={`font-mono text-base font-bold ${group.combinedOutstanding > 0 ? 'text-amber-700' : 'text-emerald-700'}`}>
                  {inr(group.combinedOutstanding)}
                </dd>
              </div>
            </dl>
          </footer>
        </div>
      </div>

      {/* Record Payment modal — same split-entry pattern as OrderBillingStep */}
      <Modal
        open={payOpen}
        title="Record payment against bill group"
        onClose={() => setPayOpen(false)}
        footer={
          <>
            <Button variant="secondary" onClick={() => setPayOpen(false)} disabled={paying}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submitPayment()} disabled={paying || totalEntered <= 0}>
              {paying ? 'Recording…' : `Record ${inr(totalEntered)}`}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500">
            The payment is distributed across the group's orders automatically (smallest outstanding first).
            Outstanding balance: <span className="font-mono font-semibold text-slate-700">{inr(outstanding)}</span>
          </p>
          <div className="space-y-2">
            {PAYMENT_MODES.map((m) => (
              <div key={m.mode} className="flex items-center gap-2">
                <label className="w-28 shrink-0 text-[13px] text-slate-600">{m.label}</label>
                <div className="relative flex-1">
                  <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 font-mono text-[13px] text-slate-400">₹</span>
                  <TextInput
                    type="number"
                    min={0}
                    step="0.01"
                    placeholder="0.00"
                    value={paymentAmounts[m.mode]}
                    onChange={(e) => setPaymentAmounts((prev) => ({ ...prev, [m.mode]: e.target.value }))}
                    className="pl-6 text-right font-mono"
                  />
                </div>
              </div>
            ))}
          </div>
          {totalEntered > 0 && (
            <p className={`text-[12px] ${totalEntered > outstanding ? 'text-rose-600' : 'text-slate-500'}`}>
              {totalEntered > outstanding
                ? `Exceeds the outstanding balance by ${inr(round2(totalEntered - outstanding))}.`
                : totalEntered < outstanding
                  ? `Partial payment — ${inr(round2(outstanding - totalEntered))} will remain due.`
                  : 'This settles the bill in full.'}
            </p>
          )}
          {payError && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{payError}</p>}
        </div>
      </Modal>

      <p className="no-print pb-6 text-center text-[11px] text-slate-400">
        Printing uses the browser's native dialog — choose “Save as PDF” to generate a digital copy.
      </p>

      <div className="no-print">
        <Link to="/orders" className="text-[13px] text-brand-700 hover:underline">
          ← Back to orders
        </Link>
      </div>
    </div>
  );
}
