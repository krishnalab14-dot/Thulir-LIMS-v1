import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Modal, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface Supplier {
  id: string;
  name: string;
}

interface InventoryItem {
  id: string;
  code: string;
  name: string;
  unit: string;
  currentStock: number;
  reorderThreshold: number | null;
  active: boolean;
  preferredSupplier: { id: string; name: string } | null;
}

export function InventoryItems() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: '', unit: '', reorderThreshold: '', preferredSupplierId: '' });
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ name: '', unit: '', reorderThreshold: '', preferredSupplierId: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [i, s] = await Promise.all([
        api.get<InventoryItem[]>('/inventory/items'),
        api.get<Supplier[]>('/inventory/suppliers'),
      ]);
      setItems(i);
      setSuppliers(s);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load items');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    if (!form.name.trim() || !form.unit.trim()) return;
    setSaving(true);
    try {
      await api.post('/inventory/items', {
        name: form.name.trim(),
        unit: form.unit.trim(),
        reorderThreshold: form.reorderThreshold ? parseFloat(form.reorderThreshold) : undefined,
        preferredSupplierId: form.preferredSupplierId || undefined,
      });
      setForm({ name: '', unit: '', reorderThreshold: '', preferredSupplierId: '' });
      setShowCreate(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create item');
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, active: boolean) => {
    await api.patch(`/inventory/items/${id}`, { active: !active });
    await load();
  };

  const startEdit = (item: InventoryItem) => {
    setEditingId(item.id);
    setEditForm({
      name: item.name,
      unit: item.unit,
      reorderThreshold: item.reorderThreshold?.toString() ?? '',
      preferredSupplierId: item.preferredSupplier?.id ?? '',
    });
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    try {
      await api.patch(`/inventory/items/${editingId}`, {
        name: editForm.name.trim(),
        unit: editForm.unit.trim(),
        reorderThreshold: editForm.reorderThreshold ? parseFloat(editForm.reorderThreshold) : null,
        preferredSupplierId: editForm.preferredSupplierId || null,
      });
      setEditingId(null);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Item Master</h1>
          <p className="text-xs text-slate-500">Manage inventory items (reagents, kits, consumables).</p>
        </div>
        <Button variant="primary" onClick={() => setShowCreate(true)}>+ Add Item</Button>
      </header>

      {error && <div className="rounded-md bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</div>}

      <Card>
        {loading ? (
          <Spinner label="Loading items…" />
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No items added yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Code</th>
                  <th className="pb-2 pr-4">Name</th>
                  <th className="pb-2 pr-4">Unit</th>
                  <th className="pb-2 pr-4 text-right">Stock</th>
                  <th className="pb-2 pr-4 text-right">Reorder At</th>
                  <th className="pb-2 pr-4">Supplier</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className={`border-b border-slate-50 ${!item.active ? 'opacity-60' : ''}`}>
                    <td className="py-2 pr-4">
                      <span className="font-mono text-[12px] font-semibold text-brand-700">{item.code}</span>
                    </td>
                    <td className="py-2 pr-4">
                      {editingId === item.id ? (
                        <TextInput value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="text-sm" />
                      ) : (
                        <span className="font-medium text-slate-800">{item.name}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      {editingId === item.id ? (
                        <TextInput value={editForm.unit} onChange={(e) => setEditForm({ ...editForm, unit: e.target.value })} className="w-20 text-sm" />
                      ) : (
                        <span className="text-slate-600">{item.unit}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      <span className={`font-mono text-sm font-semibold ${
                        item.reorderThreshold != null && item.currentStock <= item.reorderThreshold
                          ? 'text-rose-600' : 'text-slate-800'
                      }`}>
                        {item.currentStock}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {editingId === item.id ? (
                        <TextInput value={editForm.reorderThreshold} onChange={(e) => setEditForm({ ...editForm, reorderThreshold: e.target.value })} className="w-16 text-sm text-right" placeholder="—" />
                      ) : (
                        <span className="text-slate-500">{item.reorderThreshold ?? '—'}</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 text-[12px] text-slate-500">
                      {editingId === item.id ? (
                        <Select value={editForm.preferredSupplierId} onChange={(e) => setEditForm({ ...editForm, preferredSupplierId: e.target.value })} className="text-sm">
                          <option value="">None</option>
                          {suppliers.map((s) => (
                            <option key={s.id} value={s.id}>{s.name}</option>
                          ))}
                        </Select>
                      ) : (
                        item.preferredSupplier?.name ?? '—'
                      )}
                    </td>
                    <td className="py-2 pr-4">
                      <Badge tone={item.active ? 'green' : 'slate'}>{item.active ? 'Active' : 'Disabled'}</Badge>
                    </td>
                    <td className="py-2 text-right space-x-3">
                      {editingId === item.id ? (
                        <>
                          <button onClick={saveEdit} disabled={saving} className="text-[12px] font-medium text-brand-700 hover:text-brand-900 disabled:opacity-50">Save</button>
                          <button onClick={() => setEditingId(null)} className="text-[12px] font-medium text-slate-500 hover:text-slate-700">Cancel</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startEdit(item)} className="text-[12px] font-medium text-brand-700 hover:text-brand-900">Edit</button>
                          <button onClick={() => toggle(item.id, item.active)} className={`text-[12px] font-medium ${item.active ? 'text-rose-600 hover:text-rose-800' : 'text-brand-700 hover:text-brand-900'}`}>
                            {item.active ? 'Disable' : 'Enable'}
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create modal */}
      <Modal open={showCreate} title="Add Inventory Item" onClose={() => setShowCreate(false)}
        footer={
          <>
            <Button onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button variant="primary" onClick={add} disabled={saving || !form.name.trim() || !form.unit.trim()}>
              {saving ? 'Creating…' : 'Create'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Field label="Item Name" required>
            <TextInput value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Glucose Reagent Kit" autoFocus />
          </Field>
          <Field label="Unit" required hint="Measurement unit (mL, kit, box, etc.)">
            <TextInput value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="e.g. kit" />
          </Field>
          <Field label="Reorder Threshold" hint="Alert when stock falls at or below this">
            <TextInput type="number" value={form.reorderThreshold} onChange={(e) => setForm({ ...form, reorderThreshold: e.target.value })} placeholder="e.g. 5" />
          </Field>
          <Field label="Preferred Supplier">
            <Select value={form.preferredSupplierId} onChange={(e) => setForm({ ...form, preferredSupplierId: e.target.value })}>
              <option value="">None</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
        </div>
      </Modal>
    </div>
  );
}
