import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Spinner, TextInput } from '../components/ui';
import { api } from '../lib/api';

interface LookupItem {
  id: string;
  category: string;
  value: string;
  sortOrder: number;
  active: boolean;
}

export function MastersTitles() {
  const [items, setItems] = useState<LookupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<LookupItem[]>('/lookup-items?category=title&all=true');
      setItems(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const val = newTitle.trim();
    if (!val) return;
    setSaving(true);
    try {
      await api.post('/lookup-items', { category: 'title', value: val, sortOrder: items.length });
      setNewTitle('');
      await load();
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (id: string, active: boolean) => {
    await api.patch(`/lookup-items/${id}`, { active: !active });
    await load();
  };

  return (
    <div className="space-y-4">
      <div className="thulir-card overflow-hidden">
        <div className="border-b border-slate-100 bg-brand-700 px-5 py-4 text-white">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-200">Masters</p>
          <h2 className="mt-0.5 text-lg font-bold">Title Options</h2>
        </div>

        <div className="p-5">
          {/* Add new */}
          <div className="mb-4 flex gap-2">
            <Field label="New Title" className="flex-1">
              <TextInput
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                placeholder="e.g. Mx, Baby, Sister"
                onKeyDown={(e) => e.key === 'Enter' && add()}
              />
            </Field>
            <div className="flex items-end">
              <Button variant="primary" onClick={add} disabled={saving || !newTitle.trim()}>
                {saving ? 'Adding…' : '+ Add'}
              </Button>
            </div>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No titles configured yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Title</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="py-2 pr-4 font-medium text-slate-800">{item.value}</td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.active ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                        {item.active ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-2 text-right">
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
        </div>
      </div>
    </div>
  );
}
