import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatAge, formatDate, inr } from '../lib/format';
import { OrderBillingStep, type OrderResult, type PatientInfoForOrder } from './OrderBillingStep';

interface PatientSummary {
  id: string;
  patientUid: string;
  title?: string | null;
  firstName: string;
  lastName: string;
  gender: 'male' | 'female' | 'other';
  mobile: string;
  dob?: string | null;
  email?: string | null;
  externalMrn?: string | null;
  createdAt: string;
}

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { n: 1, label: 'Identify' },
  { n: 2, label: 'Demographics' },
  { n: 3, label: 'Order & Billing' },
  { n: 4, label: 'Done' },
];

const emptyDemographics = {
  title: '',
  firstName: '',
  lastName: '',
  dob: '',
  useAge: false,
  age: '',
  gender: '' as '' | 'male' | 'female' | 'other',
  mobile: '',
  email: '',
  address: '',
  externalMrn: '',
  abhaNumber: '',
};

export function RegisterWizard() {
  const [step, setStep] = useState<Step>(1);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [demographics, setDemographics] = useState(emptyDemographics);
  const [result, setResult] = useState<OrderResult | null>(null);

  // Step 1 — identify
  const [term, setTerm] = useState('');
  const [results, setResults] = useState<PatientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  const search = useCallback(async (t: string) => {
    if (!t.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const out = await api.get<{ results: PatientSummary[] }>(`/patients/check-duplicate?q=${encodeURIComponent(t.trim())}`);
      setResults(out.results);
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : 'Search failed');
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void search(term);
    }, 450);
    return () => clearTimeout(t);
  }, [term, search]);

  function reset() {
    setStep(1);
    setSelectedPatient(null);
    setDemographics(emptyDemographics);
    setResult(null);
    setTerm('');
    setResults([]);
    setSearchError('');
  }

  function pickExisting(p: PatientSummary) {
    setSelectedPatient(p);
    setStep(3); // skip demographics — link the existing patient
  }

  function demographicsValid(): string | null {
    if (!demographics.firstName.trim() || !demographics.lastName.trim()) return 'First and last name are required';
    if (!demographics.gender) return 'Gender is required';
    if (!demographics.mobile.trim()) return 'Mobile number is required';
    if (demographics.useAge) {
      const age = Number(demographics.age);
      if (demographics.age === '' || Number.isNaN(age) || age < 0 || age > 130) return 'Enter a valid age (0–130)';
    } else if (!demographics.dob) {
      return 'Date of birth or age is required';
    }
    return null;
  }

  const patientInfo: PatientInfoForOrder = selectedPatient
    ? {
        patientId: selectedPatient.id,
        patientUid: selectedPatient.patientUid,
        firstName: selectedPatient.firstName,
        lastName: selectedPatient.lastName,
        gender: selectedPatient.gender,
        mobile: selectedPatient.mobile,
        dob: selectedPatient.dob ?? undefined,
      }      : {
        firstName: demographics.firstName,
        lastName: demographics.lastName,
        gender: demographics.gender || undefined,
        mobile: demographics.mobile,
        dob: demographics.useAge ? undefined : demographics.dob || undefined,
        ageAtRegistration: demographics.useAge ? Number(demographics.age) : undefined,
      };

  function onComplete(completed: OrderResult) {
    setResult(completed);
    setStep(4);
  }

  return (
    <div className="w-full">
      {/* Step indicator */}
      <div className="mb-5 flex items-center justify-between">
        {STEPS.map((s, i) => {
          const active = step === s.n;
          const done = step > s.n;
          return (
            <div key={s.n} className="flex flex-1 items-center last:flex-none">
              <div className="flex flex-col items-center gap-1">
                <span
                  className={`flex h-8 w-8 items-center justify-center rounded-full border text-[13px] font-bold transition ${
                    done
                      ? 'border-brand-600 bg-brand-600 text-white'
                      : active
                        ? 'border-brand-700 bg-brand-700 text-white shadow-md'
                        : 'border-slate-300 bg-white text-slate-400'
                  }`}
                >
                  {done ? '✓' : s.n}
                </span>
                <span className={`text-[11px] font-semibold ${active || done ? 'text-brand-800' : 'text-slate-400'}`}>{s.label}</span>
              </div>
              {i < STEPS.length - 1 && <div className={`mx-2 mb-4 h-px flex-1 ${done ? 'bg-brand-600' : 'bg-slate-200'}`} />}
            </div>
          );
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div className="thulir-card p-5">
            <h1 className="text-lg font-bold text-slate-800">Patient Registration</h1>
            <p className="mt-0.5 text-[13px] text-slate-500">Search by name, phone or MRN to link an existing patient, or register a new one.</p>
            <div className="relative mt-4">
              <TextInput
                autoFocus
                placeholder="Search name / phone / MRN…"
                value={term}
                onChange={(e) => setTerm(e.target.value)}
                className="py-2.5 pl-9"
              />
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
            {searchError && <p className="mt-2 text-[12px] text-rose-600">{searchError}</p>}
          </div>

          {searching && <Spinner label="Searching…" />}

          {!searching && term.trim().length > 0 && results.length === 0 && !searchError && (
            <EmptyState title="No matching patient" hint="You can register a new patient below." />
          )}

          {results.length > 0 && (
            <div className="thulir-card overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="thulir-th">Patient</th>
                    <th className="thulir-th">UID</th>
                    <th className="thulir-th">Age</th>
                    <th className="thulir-th">Mobile</th>
                    <th className="thulir-th">Registered</th>
                    <th className="thulir-th w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                      <td className="thulir-td">
                        <span className="font-medium text-slate-800">
                          {p.title ? `${p.title} ` : ''}
                          {p.firstName} {p.lastName}
                        </span>
                        <span className="ml-2 text-[11px] capitalize text-slate-400">{p.gender}</span>
                      </td>
                      <td className="thulir-td font-mono text-[12px] text-brand-700">{p.patientUid}</td>
                      <td className="thulir-td">{formatAge(p.dob)}</td>
                      <td className="thulir-td font-mono text-[12px]">{p.mobile}</td>
                      <td className="thulir-td text-[12px] text-slate-500">{formatDate(p.createdAt)}</td>
                      <td className="thulir-td text-right">
                        <Button variant="secondary" className="h-7 px-2.5 text-[12px]" onClick={() => pickExisting(p)}>
                          Select
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-between">
            <span />
            <Button variant="primary" className="px-5 py-2" onClick={() => setStep(2)}>
              Register New Patient →
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="thulir-card p-5">
          <h2 className="mb-4 text-base font-bold text-slate-800">Demographics</h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            <Field label="Title">
              <Select value={demographics.title} onChange={(e) => setDemographics((d) => ({ ...d, title: e.target.value }))}>
                <option value="">—</option>
                <option value="Mr">Mr</option>
                <option value="Mrs">Mrs</option>
                <option value="Ms">Ms</option>
                <option value="Dr">Dr</option>
                <option value="Miss">Miss</option>
              </Select>
            </Field>
            <Field label="First Name" required>
              <TextInput value={demographics.firstName} onChange={(e) => setDemographics((d) => ({ ...d, firstName: e.target.value }))} placeholder="e.g. Ravi" />
            </Field>
            <Field label="Last Name" required>
              <TextInput value={demographics.lastName} onChange={(e) => setDemographics((d) => ({ ...d, lastName: e.target.value }))} placeholder="e.g. Kumar" />
            </Field>
            <Field label="Date of Birth" hint="Primary — age is derived automatically">
              <TextInput
                type="date"
                value={demographics.dob}
                disabled={demographics.useAge}
                onChange={(e) => setDemographics((d) => ({ ...d, dob: e.target.value }))}
              />
            </Field>
            <Field label="Age (if no DOB)">
              <div className="flex gap-2">
                <TextInput
                  type="number"
                  min={0}
                  max={130}
                  placeholder="Years"
                  value={demographics.age}
                  disabled={!demographics.useAge}
                  onChange={(e) => setDemographics((d) => ({ ...d, age: e.target.value }))}
                />
                <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-[12px] text-slate-600">
                  <input
                    type="checkbox"
                    checked={demographics.useAge}
                    onChange={(e) => setDemographics((d) => ({ ...d, useAge: e.target.checked }))}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600"
                  />
                  Use age
                </label>
              </div>
            </Field>
            <Field label="Gender" required>
              <Select value={demographics.gender} onChange={(e) => setDemographics((d) => ({ ...d, gender: e.target.value as never }))}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Mobile" required>
              <TextInput value={demographics.mobile} onChange={(e) => setDemographics((d) => ({ ...d, mobile: e.target.value }))} placeholder="10-digit number" maxLength={15} />
            </Field>
            <Field label="Email">
              <TextInput type="email" value={demographics.email} onChange={(e) => setDemographics((d) => ({ ...d, email: e.target.value }))} placeholder="optional" />
            </Field>
            <Field label="External MRN">
              <TextInput value={demographics.externalMrn} onChange={(e) => setDemographics((d) => ({ ...d, externalMrn: e.target.value }))} placeholder="optional" />
            </Field>
            <Field label="ABHA Number">
              <TextInput value={demographics.abhaNumber} onChange={(e) => setDemographics((d) => ({ ...d, abhaNumber: e.target.value }))} placeholder="optional" />
            </Field>
            <Field label="Address" className="sm:col-span-2 lg:col-span-3 xl:col-span-4 2xl:col-span-5">
              <TextInput value={demographics.address} onChange={(e) => setDemographics((d) => ({ ...d, address: e.target.value }))} placeholder="Street, city…" />
            </Field>
          </div>
          <div className="mt-5 flex justify-between">
            <Button onClick={() => setStep(1)}>← Back</Button>
            <Button
              variant="primary"
              className="px-5"
              onClick={() => {
                const err = demographicsValid();
                if (err) {
                  setSearchError(err);
                  return;
                }
                setSearchError('');
                setStep(3);
              }}
            >
              Continue to Order & Billing →
            </Button>
          </div>
          {searchError && <p className="mt-3 text-[12px] text-rose-600">{searchError}</p>}
        </div>
      )}

      {step === 3 && (
        <OrderBillingStep
          patientInfo={patientInfo}
          onBack={() => (selectedPatient ? setStep(1) : setStep(2))}
          onComplete={onComplete}
        />
      )}

      {step === 4 && result && (
        <div className="space-y-4">
          <div className="thulir-card overflow-hidden">
            <div className="border-b border-slate-100 bg-brand-700 px-5 py-4 text-white">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-brand-200">Registration complete</p>
              <h2 className="mt-0.5 text-xl font-bold">{result.patient.patientUid}</h2>
            </div>
            <div className="grid gap-4 p-5 sm:grid-cols-3">
              <div>
                <p className="thulir-label">Patient</p>
                <p className="text-sm font-medium text-slate-800">
                  {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : `${demographics.firstName} ${demographics.lastName}`}
                </p>
                <p className="text-[12px] text-slate-400">
                  {selectedPatient ? formatAge(selectedPatient.dob) : demographics.useAge ? `${demographics.age} y` : formatAge(demographics.dob)}
                  {' · '}
                  {selectedPatient ? selectedPatient.mobile : demographics.mobile}
                </p>
              </div>
              {result.order && (
                <>
                  <div>
                    <p className="thulir-label">Order</p>
                    <p className="font-mono text-sm font-medium text-slate-800">{result.order.id.slice(0, 8).toUpperCase()}</p>
                    <p className="text-[12px] text-slate-400">
                      {result.order.orderTestsCount ?? ''} item{result.order.orderTestsCount === 1 ? '' : 's'} ·{' '}
                      <Badge tone="slate">{result.order.status}</Badge>
                    </p>
                  </div>
                  <div>
                    <p className="thulir-label">Invoice</p>
                    <p className="font-mono text-sm font-bold text-brand-800">{inr(result.order.totalAmount)}</p>
                    <p className="mt-1">
                      <Badge tone={result.order.invoice?.status === 'paid' ? 'green' : result.order.invoice?.status === 'partial' ? 'amber' : 'slate'}>
                        {result.order.invoice?.status ?? 'due'}
                      </Badge>
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Printable label */}
          <div className="print-area thulir-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Thulir Demo Lab</p>
            <p className="mt-3 font-mono text-2xl font-bold tracking-widest text-slate-900">{result.patient.patientUid}</p>
            <p className="mt-2 text-sm text-slate-800">
              {selectedPatient ? `${selectedPatient.firstName} ${selectedPatient.lastName}` : `${demographics.firstName} ${demographics.lastName}`}
              {selectedPatient ? ` · ${formatAge(selectedPatient.dob)}` : demographics.useAge ? ` · ${demographics.age} y` : ` · ${formatAge(demographics.dob)}`}
            </p>
            <p className="text-sm text-slate-700">{selectedPatient ? selectedPatient.mobile : demographics.mobile}</p>
            {result.order && <p className="mt-2 text-sm text-slate-700">Order: {result.order.id.slice(0, 8).toUpperCase()} · {inr(result.order.totalAmount)}</p>}
            <p className="mt-4 border-t border-dashed border-slate-300 pt-2 text-[10px] uppercase tracking-wide text-slate-400">{new Date().toLocaleString('en-IN')}</p>
          </div>

          <div className="flex items-center justify-between">
            <Button onClick={reset}>Register Another Patient</Button>
            <Button variant="primary" onClick={() => window.print()}>
              🖨 Print Label / Receipt
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
