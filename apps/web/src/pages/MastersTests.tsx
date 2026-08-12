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
  requiresDedicatedSample: boolean;
  resultType: 'numeric' | 'options' | 'text';
  resultOptions?: string[];
  resultOptionsAbnormal?: string[];
  requiredSampleType: { id: string; name: string } | null;
  specifications?: { id: string; ageMinYears: number; ageMaxYears: number; sex: string | null; refLow: number; refHigh: number }[];
}

interface SampleType {
  id: string;
  name: string;
}

type ResultType = 'numeric' | 'options' | 'text';

interface SpecRow {
  ageMinYears: string;
  ageMaxYears: string;
  sex: '' | 'male' | 'female' | 'other'; // '' = any sex
  refLow: string;
  refHigh: string;
}

const RESULT_TYPES: { value: ResultType; label: string }[] = [
  { value: 'numeric', label: 'Numeric' },
  { value: 'options', label: 'Options' },
  { value: 'text', label: 'Text' },
];

const RESULT_TYPE_TONE: Record<ResultType, string> = {
  numeric: 'blue',
  options: 'violet',
  text: 'slate',
};

const emptySpec = (): SpecRow => ({ ageMinYears: '', ageMaxYears: '', sex: '', refLow: '', refHigh: '' });

export function MastersTests() {
  const [tests, setTests] = useState<TestRow[]>([]);
  const [sampleTypes, setSampleTypes] = useState<SampleType[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    testCode: '',
    testName: '',
    currentPrice: '',
    requiredSampleTypeId: '',
    requiresDedicatedSample: false,
    resultType: 'numeric' as ResultType,
    defaultRefLow: '',
    defaultRefHigh: '',
    criticalLow: '',
    criticalHigh: '',
    resultOptions: [] as string[],
    resultOptionsAbnormal: [] as string[],
    specifications: [] as SpecRow[],
  });
  const [optionInput, setOptionInput] = useState('');

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

  function resetForm() {
    setForm({
      testCode: '',
      testName: '',
      currentPrice: '',
      requiredSampleTypeId: '',
      requiresDedicatedSample: false,
      resultType: 'numeric',
      defaultRefLow: '',
      defaultRefHigh: '',
      criticalLow: '',
      criticalHigh: '',
      resultOptions: [],
      resultOptionsAbnormal: [],
      specifications: [],
    });
    setOptionInput('');
  }

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
    if (form.resultType === 'options' && form.resultOptions.length === 0) {
      setError('An options-type test needs at least one result option');
      return;
    }
    // Every filled spec row must be complete; empty rows are dropped.
    const specifications = form.specifications
      .filter((s) => s.ageMinYears !== '' || s.ageMaxYears !== '' || s.refLow !== '' || s.refHigh !== '' || s.sex !== '')
      .map((s) => ({
        ageMinYears: Number(s.ageMinYears),
        ageMaxYears: Number(s.ageMaxYears),
        ...(s.sex ? { sex: s.sex } : {}),
        refLow: Number(s.refLow),
        refHigh: Number(s.refHigh),
      }));
    if (specifications.some((s) => Number.isNaN(s.ageMinYears) || Number.isNaN(s.ageMaxYears) || Number.isNaN(s.refLow) || Number.isNaN(s.refHigh))) {
      setError('Every age/sex specification needs valid age bounds and a low/high range');
      return;
    }

    setSaving(true);
    try {
      await api.post('/masters/tests', {
        testCode: form.testCode.trim(),
        testName: form.testName.trim(),
        currentPrice: price,
        requiredSampleTypeId: form.requiredSampleTypeId || undefined,
        requiresDedicatedSample: form.requiresDedicatedSample,
        resultType: form.resultType,
        ...(form.resultType === 'options'
          ? { resultOptions: form.resultOptions, resultOptionsAbnormal: form.resultOptionsAbnormal }
          : {}),
        ...(form.resultType === 'numeric'
          ? {
              ...(form.defaultRefLow !== '' ? { defaultRefLow: Number(form.defaultRefLow) } : {}),
              ...(form.defaultRefHigh !== '' ? { defaultRefHigh: Number(form.defaultRefHigh) } : {}),
              ...(form.criticalLow !== '' ? { criticalLow: Number(form.criticalLow) } : {}),
              ...(form.criticalHigh !== '' ? { criticalHigh: Number(form.criticalHigh) } : {}),
            }
          : {}),
        ...(specifications.length > 0 ? { specifications } : {}),
      });
      resetForm();
      await load();
    } catch (e) {
      // The server's overlap error already names the conflicting rows/ages —
      // surface it verbatim so the user can fix the data, not a generic failure.
      setError(e instanceof ApiError ? e.message : 'Could not create the test');
    } finally {
      setSaving(false);
    }
  }

  function addOption() {
    const value = optionInput.trim();
    if (!value) return;
    if (!form.resultOptions.includes(value)) {
      setForm((f) => ({ ...f, resultOptions: [...f.resultOptions, value] }));
    }
    setOptionInput('');
  }

  /** Click a chip to toggle whether that option is ABNORMAL (Stage 3 flagging). */
  function toggleAbnormal(option: string) {
    setForm((f) => ({
      ...f,
      resultOptionsAbnormal: f.resultOptionsAbnormal.includes(option)
        ? f.resultOptionsAbnormal.filter((o) => o !== option)
        : [...f.resultOptionsAbnormal, option],
    }));
  }

  function updateSpec(index: number, patch: Partial<SpecRow>) {
    setForm((f) => ({
      ...f,
      specifications: f.specifications.map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold text-slate-800">Test Catalog</h1>
        <p className="text-[13px] text-slate-500">
          Minimal Masters — searchable, priced, sample-type aware, and with the Stage 2.5 result model (type, reference ranges, critical thresholds, age/sex specifications) that Result Entry will consume.
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
            <label className="flex items-start gap-2 pt-1">
              <input
                type="checkbox"
                checked={form.requiresDedicatedSample}
                onChange={(e) => setForm((f) => ({ ...f, requiresDedicatedSample: e.target.checked }))}
                className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
              />
              <span className="text-[13px] leading-snug text-slate-700">
                Requires dedicated sample tube
                <span className="block text-[11px] font-normal text-slate-400">
                  Always gets its own tube, even when another test on the same order shares its sample type.
                </span>
              </span>
            </label>

            <Field label="Result Type">
              <Select value={form.resultType} onChange={(e) => setForm((f) => ({ ...f, resultType: e.target.value as ResultType }))}>
                {RESULT_TYPES.map((rt) => (
                  <option key={rt.value} value={rt.value}>
                    {rt.label}
                  </option>
                ))}
              </Select>
            </Field>

            {form.resultType === 'numeric' && (
              <div className="space-y-3 rounded-md border border-slate-200 p-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Reference Range</p>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Default Low">
                    <TextInput type="number" step="any" value={form.defaultRefLow} onChange={(e) => setForm((f) => ({ ...f, defaultRefLow: e.target.value }))} className="font-mono" placeholder="e.g. 70" />
                  </Field>
                  <Field label="Default High">
                    <TextInput type="number" step="any" value={form.defaultRefHigh} onChange={(e) => setForm((f) => ({ ...f, defaultRefHigh: e.target.value }))} className="font-mono" placeholder="e.g. 99" />
                  </Field>
                </div>

                {/* Critical thresholds — visually distinct (red-accented): these are
                    alerting boundaries, not the normal range. */}
                <div className="space-y-2 rounded-md border border-rose-200 bg-rose-50/50 p-3">
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-rose-700">Critical Low / High (alerting)</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Critical Low">
                      <TextInput type="number" step="any" value={form.criticalLow} onChange={(e) => setForm((f) => ({ ...f, criticalLow: e.target.value }))} className="font-mono" placeholder="e.g. 40" />
                    </Field>
                    <Field label="Critical High">
                      <TextInput type="number" step="any" value={form.criticalHigh} onChange={(e) => setForm((f) => ({ ...f, criticalHigh: e.target.value }))} className="font-mono" placeholder="e.g. 400" />
                    </Field>
                  </div>
                </div>

                {/* Age/sex specifications sub-table — add/edit/remove rows. */}
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Age / Sex Specifications</p>
                    <Button
                      className="h-6 px-2 text-[11px]"
                      onClick={() => setForm((f) => ({ ...f, specifications: [...f.specifications, emptySpec()] }))}
                    >
                      + Add row
                    </Button>
                  </div>
                  {form.specifications.length === 0 ? (
                    <p className="text-[11px] text-slate-400">
                      No age/sex overrides — the default range above applies to everyone. Rows are checked against each other for overlaps on save.
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {form.specifications.map((s, i) => (
                        <div key={i} className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_auto] items-center gap-1.5 rounded border border-slate-200 bg-slate-50/60 p-1.5">
                          <TextInput type="number" min={0} placeholder="Min yrs" value={s.ageMinYears} onChange={(e) => updateSpec(i, { ageMinYears: e.target.value })} className="px-1.5 py-1 text-[11px]" />
                          <TextInput type="number" min={0} placeholder="Max yrs" value={s.ageMaxYears} onChange={(e) => updateSpec(i, { ageMaxYears: e.target.value })} className="px-1.5 py-1 text-[11px]" />
                          <Select value={s.sex} onChange={(e) => updateSpec(i, { sex: e.target.value as SpecRow['sex'] })} className="px-1.5 py-1 text-[11px]">
                            <option value="">Any</option>
                            <option value="male">Male</option>
                            <option value="female">Female</option>
                            <option value="other">Other</option>
                          </Select>
                          <TextInput type="number" step="any" placeholder="Low" value={s.refLow} onChange={(e) => updateSpec(i, { refLow: e.target.value })} className="px-1.5 py-1 text-[11px] font-mono" />
                          <TextInput type="number" step="any" placeholder="High" value={s.refHigh} onChange={(e) => updateSpec(i, { refHigh: e.target.value })} className="px-1.5 py-1 text-[11px] font-mono" />
                          <button
                            onClick={() => setForm((f) => ({ ...f, specifications: f.specifications.filter((_, idx) => idx !== i) }))}
                            className="rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Remove specification row ${i + 1}`}
                          >
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
                              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {form.resultType === 'options' && (
              <div className="space-y-2 rounded-md border border-slate-200 p-3">
                <p className="text-[12px] font-semibold uppercase tracking-wide text-slate-500">Result Options</p>
                <div className="flex gap-1.5">
                  <TextInput value={optionInput} onChange={(e) => setOptionInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addOption(); } }} placeholder="Type an option, Enter to add" className="flex-1 text-[12px]" />
                  <Button className="h-8 px-2.5 text-[12px]" onClick={addOption}>Add</Button>
                </div>
                {form.resultOptions.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.resultOptions.map((opt) => {
                      const abnormal = form.resultOptionsAbnormal.includes(opt);
                      return (
                        <span
                          key={opt}
                          onClick={() => toggleAbnormal(opt)}
                          title={abnormal ? 'Marked abnormal — click to make normal' : 'Normal — click to mark abnormal'}
                          className={`inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-0.5 text-[12px] font-medium transition ${
                            abnormal ? 'bg-rose-100 text-rose-800 ring-1 ring-rose-300' : 'bg-brand-50 text-brand-800'
                          }`}
                        >
                          {opt}
                          {abnormal && <span className="text-[10px] font-semibold uppercase text-rose-500">abn</span>}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setForm((f) => ({ ...f, resultOptions: f.resultOptions.filter((o) => o !== opt), resultOptionsAbnormal: f.resultOptionsAbnormal.filter((o) => o !== opt) }));
                            }}
                            className="text-brand-400 transition hover:text-rose-600"
                            aria-label={`Remove option ${opt}`}
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                {form.resultOptionsAbnormal.length > 0 && (
                  <p className="text-[11px] text-slate-400">
                    Abnormal options are flagged at Result Entry and skipped by "Mark All Normal". Click a chip to toggle.
                  </p>
                )}
              </div>
            )}

            {form.resultType === 'text' && (
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-[12px] text-slate-500">
                Text results are free-form — no reference range, options or critical thresholds apply.
              </p>
            )}

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
                    <th className="thulir-th">Result Type</th>
                    <th className="thulir-th">Sample Type</th>
                    <th className="thulir-th">Tube</th>
                    <th className="thulir-th text-right">Price</th>
                    <th className="thulir-th">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {tests.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                      <td className="thulir-td font-mono text-[12px] font-semibold text-brand-700">{t.testCode}</td>
                      <td className="thulir-td text-[13px]">
                        {t.testName}
                        {(t.specifications?.length ?? 0) > 0 && (
                          <span className="ml-1.5 text-[11px] text-slate-400">{t.specifications!.length} age/sex spec{(t.specifications!.length ?? 0) === 1 ? '' : 's'}</span>
                        )}
                      </td>
                      <td className="thulir-td">
                        <Badge tone={RESULT_TYPE_TONE[t.resultType] ?? 'slate'}>{t.resultType}</Badge>
                        {t.resultType === 'options' && (t.resultOptionsAbnormal?.length ?? 0) > 0 && (
                          <span className="ml-1.5 text-[11px] text-rose-500">
                            {t.resultOptionsAbnormal!.length} abnormal
                          </span>
                        )}
                      </td>
                      <td className="thulir-td text-[12px] text-slate-500">{t.requiredSampleType?.name ?? '—'}</td>
                      <td className="thulir-td">
                        {t.requiresDedicatedSample ? (
                          <Badge tone="amber">dedicated</Badge>
                        ) : (
                          <Badge tone="slate">shared</Badge>
                        )}
                      </td>
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
