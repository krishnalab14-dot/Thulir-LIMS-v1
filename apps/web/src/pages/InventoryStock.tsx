import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Modal, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate } from '../lib/format';

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  currentStock: number;
  reorderThreshold: number | null;
}

type Direction = 'in' | 'out';

export function InventoryStock() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [alertError, setAlertError] = useState('');
  const [showTransact, setShowTransact] = useState(false);
  const [form, setForm] = useState<{
    itemId: string;
    direction: Direction;
    quantity: string;
    batchNumber: string;
    expiryDate: string;
    reason: string;
  }>({ itemId: '', direction: 'in', quantity: '', batchNumber: '', expiryDate: '', reason: '' });
  const [saving, setSaving] = useState(false);

  // Stock detail for expanded view
  const [detailItem, setDetailItem] = useState<string | null>(null);
  const [stockDetail, setStockDetail] = useState<{
    currentStock: number;
    batches: { batchNumber: string | null; quantity: number; expiryDate: string | null }[];
  } | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.get<InventoryItem[]>('/inventory/items');
      setItems(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load inventory');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const loadDetail = useCallback(async (itemId: string) => {
    setLoadingDetail(true);
    try {
      const detail = await api.get<{
        currentStock: number;
        batches: { batchNumber: string | null; quantity: number; expiryDate: string | null }[];
      }>(`/inventory/items/${itemId}/stock`);
      setStockDetail(detail);
    } catch {
      setStockDetail(null);
    } finally {
      setLoadingDetail(false);
    }
  }, []);

  useEffect(() => {
    if (detailItem) void loadDetail(detailItem);
    else setStockDetail(null);
  }, [detailItem, loadDetail]);

  const submitTransaction = async () => {
    if (!form.itemId || !form.quantity) return;
    setSaving(true);
    setAlertError('');
    try {
      await api.post('/inventory/transactions', {
        itemId: form.itemId,
        direction: form.direction,
        quantity: parseFloat(form.quantity),
        batchNumber: form.batchNumber.trim() || undefined,
        expiryDate: form.expiryDate || undefined,
        reason: form.reason.trim() || undefined,
      });
      setShowTransact(false);
      setForm({ itemId: '', direction: 'in', quantity: '', batchNumber: '', expiryDate: '', reason: '' });
      await load();
    } catch (e) {
      setAlertError(e instanceof ApiError ? e.message : 'Failed to record transaction');
    } finally {
      setSaving(false);
    }
  };

  const selectedItem = items.find((i) => i.id === form.itemId);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Current Stock</h1>
          <p className="text-xs text-slate-500">All items with computed stock levels from the ledger.</p>
        </div>
        <Button variant="primary" onClick={() => setShowTransact(true)}>+ Stock Entry</Button>
      </header>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <Card>
        {loading ? (
          <Spinner label="Loading stock…" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No items in inventory. Add items in Item Master first.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Code</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Unit</th>
                  <th className="pb-2 pr-4 text-right">Current Stock</th>
                  <th className="pb-2 pr-4 text-right">Reorder At</th>
                  <th className="pb-2 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const isLow = item.reorderThreshold != null && item.currentStock <= item.reorderThreshold;
                  const isExpanded = detailItem === item.id;
                  return (
                    <tr key={item.id} className={`border-b border-slate-50 ${isLow ? 'bg-rose-50/40' : ''}`}>
                      <td className="py-2 pr-4">
                        <span className="font-mono text-[12px] font-semibold text-brand-700">{item.code}</span>
                      </td>
                      <td className="py-2 pr-4">
                        <button
                          onClick={() => setDetailItem(isExpanded ? null : item.id)}
                          className="text-left font-medium text-slate-800 hover:text-brand-700"
                        >
                          {item.name}
                        </button>
                      </td>
                      <td className="py-2 pr-4 text-slate-600">{item.unit}</td>
                      <td className="py-2 pr-4 text-right">
                        <span className={`font-mono text-sm font-semibold ${isLow ? 'text-rose-600' : 'text-slate-800'}`}>
                          {item.currentStock}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-right text-slate-500">{item.reorderThreshold ?? '—'}</td>
                      <td className="py-2 text-right">
                        {isLow ? (
                          <Badge tone="rose">Low Stock</Badge>
                        ) : (
                          <Badge tone="green">OK</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Stock detail panel */}
      {detailItem && stockDetail && (
        <Card title={`${stockDetail.batches.length > 0 ? 'Batch Breakdown' : 'No batch data'}`}>
          {loadingDetail ? (
            <Spinner label="Loading detail…" />
          ) : stockDetail.batches.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No batch-tracked transactions for this item.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Batch #</th>
                  <th className="pb-2 pr-4 text-right">Quantity</th>
                  <th className="pb-2 text-right">Expiry Date</th>
                </tr>
              </thead>
              <tbody>
                {stockDetail.batches.map((b, i) => (
                  <tr key={i} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-mono text-[12px] text-slate-700">{b.batchNumber ?? '—'}</td>
                    <td className="py-2 pr-4 text-right font-mono text-sm">{b.quantity}</td>
                    <td className="py-2 text-right text-[12px] text-slate-500">
                      {b.expiryDate ? formatDate(b.expiryDate) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      )}

      {/* Stock In/Out modal */}
      <Modal open={showTransact} title="Record Stock Entry" onClose={() => setShowTransact(false)}
        footer={
          <>
            <Button onClick={() => setShowTransact(false)}>Cancel</Button>
            <Button variant="primary" onClick={submitTransaction} disabled={saving || !form.itemId || !form.quantity}>
              {saving ? 'Saving…' : 'Record'}
            </Button>
          </>
        }
      >
        {alertError && <div className="mb-3 rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{alertError}</div>}
        <div className="space-y-3">
          <Field label="Item" required>
            <Select value={form.itemId} onChange={(e) => setForm({ ...form, itemId: e.target.value })}>
              <option value="">Select an item…</option>
              {items.map((item) => (
                <option key={item.id} value={item.id}>{item.code} — {item.name} (stock: {item.currentStock} {item.unit})</option>
              ))}
            </Select>
          </Field>

          <Field label="Direction" required>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setForm({ ...form, direction: 'in' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                  form.direction === 'in'
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                ↓ Stock In
              </button>
              <button
                type="button"
                onClick={() => setForm({ ...form, direction: 'out' })}
                className={`flex-1 rounded-md border px-3 py-2 text-sm font-medium transition ${
                  form.direction === 'out'
                    ? 'border-rose-300 bg-rose-50 text-rose-700'
                    : 'border-slate-200 text-slate-500 hover:bg-slate-50'
                }`}
              >
                ↑ Stock Out
              </button>
            </div>
          </Field>

          <Field label={`Quantity${selectedItem ? ` (${selectedItem.unit})` : ''}`} required>
            <TextInput
              type="number"
              min="0.001"
              step="any"
              value={form.quantity}
              onChange={(e) => setForm({ ...form, quantity: e.target.value })}
              placeholder="0"
            />
          </Field>

          <Field label="Batch Number" hint="Optional — for batch/lot tracking">
            <TextInput value={form.batchNumber} onChange={(e) => setForm({ ...form, batchNumber: e.target.value })} placeholder="e.g. LOT-2026-001" />
          </Field>

          <Field label="Expiry Date" hint="Optional — mainly for stock-in">
            <TextInput type="date" value={form.expiryDate} onChange={(e) => setForm({ ...form, expiryDate: e.target.value })} />
          </Field>

          <Field label="Reason" hint="Optional — e.g. Purchase, Consumption, Breakage, Expired write-off">
            <TextInput value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} placeholder="e.g. Purchase" />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
