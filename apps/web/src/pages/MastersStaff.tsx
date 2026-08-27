import { useCallback, useEffect, useState } from 'react';
import { Button, Field, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';

interface StaffUser {
  id: string;
  staffCode?: string | null;
  username: string;
  role: string;
  isActive: boolean;
  createdAt: string;
}

const ROLES = [
  { value: 'receptionist', label: 'Receptionist' },
  { value: 'technician', label: 'Technician' },
  { value: 'pathologist', label: 'Pathologist' },
  { value: 'lab_manager', label: 'Lab Manager' },
  { value: 'admin', label: 'Admin' },
];

export function MastersStaff() {
  const [items, setItems] = useState<StaffUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('receptionist');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.get<StaffUser[]>('/users');
      setItems(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const addUser = async () => {
    setError('');
    if (!newUsername.trim()) { setError('Username is required'); return; }
    if (newPassword.length < 8) { setError('Password must be at least 8 characters'); return; }
    setSaving(true);
    try {
      await api.post('/users', { username: newUsername.trim(), password: newPassword, role: newRole });
      setNewUsername('');
      setNewPassword('');
      setNewRole('receptionist');
      setShowAdd(false);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to create user');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="thulir-card overflow-hidden">
        <div className="border-b border-slate-100 bg-brand-700 px-5 py-4 text-white">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-200">Staff</p>
          <h2 className="mt-0.5 text-lg font-bold">Staff Management</h2>
        </div>

        <div className="p-5">
          <div className="mb-4 flex items-center justify-between">
            <p className="text-[13px] text-slate-500">
              {items.length} staff member{items.length === 1 ? '' : 's'}
            </p>
            <Button variant="primary" onClick={() => setShowAdd(!showAdd)}>
              {showAdd ? 'Cancel' : '+ Add Staff'}
            </Button>
          </div>

          {showAdd && (
            <div className="mb-4 rounded-md border border-slate-200 bg-slate-50 p-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Username" required>
                  <TextInput value={newUsername} onChange={(e) => setNewUsername(e.target.value)} placeholder="e.g. lab_tech_1" />
                </Field>
                <Field label="Password" required>
                  <TextInput type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="min 8 characters" />
                </Field>
                <Field label="Role">
                  <Select value={newRole} onChange={(e) => setNewRole(e.target.value)}>
                    {ROLES.map((r) => (
                      <option key={r.value} value={r.value}>{r.label}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              {error && <p className="mt-2 text-[12px] text-rose-600">{error}</p>}
              <div className="mt-3 flex justify-end">
                <Button variant="primary" onClick={addUser} disabled={saving}>
                  {saving ? 'Creating…' : 'Create Staff'}
                </Button>
              </div>
            </div>
          )}

          {loading ? (
            <div className="flex justify-center py-8"><Spinner /></div>
          ) : items.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No staff members yet.</p>
          ) : (
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                  <th className="pb-2 pr-4">Code</th>
                  <th className="pb-2 pr-4">Username</th>
                  <th className="pb-2 pr-4">Role</th>
                  <th className="pb-2 pr-4">Status</th>
                  <th className="pb-2 pr-4">Created</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-50">
                    <td className="py-2 pr-4">
                      {item.staffCode ? (
                        <span className="font-mono text-[12px] font-semibold text-brand-700">{item.staffCode}</span>
                      ) : (
                        <span className="text-[11px] text-slate-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-4 font-medium text-slate-800">{item.username}</td>
                    <td className="py-2 pr-4">
                      <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold capitalize text-brand-700">
                        {item.role.replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="py-2 pr-4">
                      <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.isActive ? 'bg-green-50 text-green-700' : 'bg-slate-100 text-slate-400'}`}>
                        {item.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </td>
                    <td className="py-2 pr-4 text-[12px] text-slate-400">
                      {new Date(item.createdAt).toLocaleDateString('en-IN')}
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
