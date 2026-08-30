import { useCallback, useEffect, useState } from 'react';
import { Button, Card, Field, Spinner, TextInput } from '../components/ui';
import { api } from '../lib/api';

interface Supplier {
  id: string;
  name: string;
  contactPhone: string | null;
  contactEmail: string | null;
  active: boolean;
}

export function InventorySuppliers() {
  const [items, setItems] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<Supplier[]>('/inventory/suppliers');
      setItems(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const add = async () => {
    const val = newName.trim();
    if (!val) return;
    setSaving(true);
    try {
      await api.post('/inventory/suppliers', {
        name: val,
        contactPhone: newPhone.trim() || undefined,
        contactEmail: newEmail.trim() || undefined,
      });
      setNewName('');
      setNewPhone('');
      setNewEmail('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, active: boolean) => {
    await api.patch(`/inventory/suppliers/${id}`, { active: !active });
    await load();
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    await api.patch(`/inventory/suppliers/${editingId}`, { name: editName.trim() });
    setEditingId(null);
    await load();
  };

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-slate-800">Supplier Master</h1>
          <p className="text-xs text-slate-500">Manage reagent and consumable suppliers.</p>
        </div>
      </header>

      <Card>
        <div className="mb-4 grid gap-2 sm:grid-cols-3">
          <Field label="Supplier Name" required className="sm:col-span-2">
            <TextInput
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Bio-Rad Laboratories"
              onKeyDown={(e) => e.key === 'Enter' && add()}
            />
          </Field>
          <Field label="Phone">
            <TextInput value={newPhone} onChange={(e) => setNewPhone(e.target.value)} placeholder="Optional" />
          </Field>
          <Field label="Email">
            <TextInput value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="Optional" className="sm:col-span-2" />
          </Field>
          <div className="flex items-end">
            <Button variant="primary" onClick={add} disabled={saving || !newName.trim()}>
              {saving ? 'Adding…' : '+ Add'}
            </Button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-8"><Spinner /></div>
        ) : items.length === 0 ? (
          <p className="py-8 text-center text-sm text-slate-400">No suppliers added yet.</p>
        ) : (
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                <th className="pb-2 pr-4">Name</th>
                <th className="pb-2 pr-4">Phone</th>
                <th className="pb-2 pr-4">Email</th>
                <th className="pb-2 pr-4">Status</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className="border-b border-slate-50">
                  <td className="py-2 pr-4">
                    {editingId === item.id ? (
                      <div className="flex gap-1">
                        <TextInput value={editName} onChange={(e) => setEditName(e.target.value)} className="text-sm" />
                        <Button onClick={saveEdit} className="text-xs">Save</Button>
                        <Button onClick={() => setEditingId(null)} className="text-xs">Cancel</Button>
                      </div>
                    ) : (
                      <span className="font-medium text-slate-800">{item.name}</span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-[12px] text-slate-500">{item.contactPhone ?? '—'}</td>
                  <td className="py-2 pr-4 text-[12px] text-slate-500">{item.contactEmail ?? '—'}</td>
                  <td className="py-2 pr-4">
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                      {item.active ? 'Active' : 'Disabled'}
                    </span>
                  </td>
                  <td className="py-2 text-right space-x-3">
                    {editingId !== item.id && (
                      <button
                        type="button"
                        onClick={() => { setEditingId(item.id); setEditName(item.name); }}
                        className="text-[12px] font-medium text-brand-700 hover:text-brand-900"
                      >
                        Edit
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => toggle(item.id, item.active)}
                      className={`text-[12px] font-medium ${item.active ? 'text-rose-600 hover:text-rose-800' : 'text-brand-700 hover:text-brand-900'}`}
                    >
                      {item.active ? 'Disable' : 'Enable'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}
