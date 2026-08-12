import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { inr } from '../lib/format';

interface TestRow {
  id: string;
  testCode: string;
  testName: string;
  currentPrice: string;
  active: boolean;
  requiredSampleType: { id: string; name: string } | null;
}

interface SampleType {
  id: string;
  name: string;
}

export function MastersTests() {
  const [tests, setTests] = useState<TestRow[]>([]);
  const [sampleTypes, setSampleTypes] = useState<SampleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({ testCode: '', testName: '', currentPrice: '', requiredSampleTypeId: '' });

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [t, st] = await Promise.all([api.get<TestRow[]>('/masters/tests'), api.get<SampleType[]>('/masters/sample-types')]);
      setTests(t);
      setSampleTypes(st);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not load tests');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function createTest() {
    setError('');
    if (!form.testCode.trim() || !form.testName.trim() || form.currentPrice === '') {
      setError('Code, name and price are required');
      return;
    }
    const price = Number(form.currentPrice);
    if (Number.isNaN(price) || price < 0) {
      setError('Price must be a valid amount');
      return;
    }
    setSaving(true);
    try {
      await api.post('/masters/tests', {
        testCode: form.testCode.trim(),
        testName: form.testName.trim(),
        currentPrice: price,
        requiredSampleTypeId: form.requiredSampleTypeId || undefined,
      });
      setForm({ testCode: '', testName: '', currentPrice: '', requiredSampleTypeId: '' });
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the test');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">Test Catalog</h1>
        <p className="text-[13px] text-slate-500">
          Minimal Stage 1 master — searchable, priced, with a required sample type. Full parameter-level Test Master is a later stage.
        </p>
      </div>

      {error && <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Add Test" className="lg:col-span-1">
          <div className="space-y-3">
            <Field label="Test Code" required>
              <TextInput value={form.testCode} onChange={(e) => setForm((f) => ({ ...f, testCode: e.target.value }))} placeholder="e.g. CBC" className="font-mono" />
            </Field>
            <Field label="Test Name" required>
              <TextInput value={form.testName} onChange={(e) => setForm((f) => ({ ...f, testName: e.target.value }))} placeholder="e.g. Complete Blood Count" />
            </Field>
            <Field label="Price (₹)" required>
              <TextInput type="number" min={0} step="0.01" value={form.currentPrice} onChange={(e) => setForm((f) => ({ ...f, currentPrice: e.target.value }))} className="font-mono" />
            </Field>
            <Field label="Required Sample Type">
              <Select value={form.requiredSampleTypeId} onChange={(e) => setForm((f) => ({ ...f, requiredSampleTypeId: e.target.value }))}>
                <option value="">—</option>
                {sampleTypes.map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Button variant="primary" className="w-full" onClick={() => void createTest()} disabled={saving}>
              {saving ? 'Saving…' : 'Add Test'}
            </Button>
          </div>
        </Card>

        <div className="lg:col-span-2">
          {loading ? (
            <Spinner label="Loading tests…" />
          ) : (
            <Card pad={false}>
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="thulir-th">Code</th>
                    <th className="thulir-th">Name</th>
                    <th className="thulir-th">Sample Type</th>
                    <th className="thulir-th text-right">Price</th>
                    <th className="thulir-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                      <td className="thulir-td font-mono text-[12px] font-semibold text-brand-700">{t.testCode}</td>
                      <td className="thulir-td text-[13px]">{t.testName}</td>
                      <td className="thulir-td text-[12px] text-slate-500">{t.requiredSampleType?.name ?? '—'}</td>
                      <td className="thulir-td text-right font-mono text-[13px] font-semibold">{inr(t.currentPrice)}</td>
                      <td className="thulir-td">
                        <Badge tone={t.active ? 'green' : 'slate'}>{t.active ? 'active' : 'inactive'}</Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {tests.length === 0 && <p className="px-4 py-8 text-center text-sm text-slate-400">No tests yet — add one on the left.</p>}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
