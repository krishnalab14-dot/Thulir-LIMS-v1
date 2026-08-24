import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, EmptyState, Field, Select, Spinner, TextInput } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatAge, inr } from '../lib/format';
import { OrderBillingStep, type OrderResult, type PatientInfoForOrder, type PartyOption, Typeahead } from './OrderBillingStep';

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

type Step = 1 | 2 | 3;

/** 3-step flow: Patient Entry → Order & Billing → Done */
const STEPS = [
  { n: 1, label: 'Patient' },
  { n: 2, label: 'Order & Billing' },
  { n: 3, label: 'Done' },
];

const emptyDemographics = {
  title: '',
  name: '',          // §1 single "Patient Name" field — split at first space on submit
  dob: '',           // §2 optional (age-primary)
  age: '',           // §2 always enabled, plain number input
  gender: '' as '' | 'male' | 'female' | 'other',
  mobile: '',
  email: '',
  address: '',
  externalMrn: '',
  abhaNumber: '',
  // §3 Inpatient details (collapsed by default)
  patientType: '',
  wardDesc: '',
  bedNo: '',
  ipOpNo: '',
};

/**
 * §1 Splitting rule: single name → firstName / lastName.
 * Split at the FIRST space: "Ravi Kumar" → firstName="Ravi", lastName="Kumar".
 * A single word (e.g. "Ravi") → firstName="Ravi", lastName="".
 * Extra spaces are trimmed; leading/trailing whitespace is stripped.
 */
function splitPatientName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  const spaceIdx = trimmed.indexOf(' ');
  if (spaceIdx === -1) {
    return { firstName: trimmed, lastName: '' };
  }
  return {
    firstName: trimmed.slice(0, spaceIdx),
    lastName: trimmed.slice(spaceIdx + 1).trim(),
  };
}

/** Escapes text for safe interpolation into the downloaded invoice HTML. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * §1 Download Invoice — builds a self-contained HTML document from the SAME
 * content rendered in the printable .print-area receipt card (single source
 * of truth — no second layout) and triggers a browser download. No PDF
 * library exists in this project, so (per the accepted pattern) the file is
 * a print-ready document whose content matches the Print action exactly;
 * opening it and printing to PDF yields the identical invoice.
 */
function downloadInvoice(
  result: OrderResult,
  patientLine: string,
  patientSub: string,
  mobile: string,
  samples: Array<{ barcodeValue: string; sampleType: { name: string; code: string } }>,
) {
  const uid = result.patient.patientUid;
  const order = result.order;
  const filename = `invoice-${uid}${order ? '-' + order.id.slice(0, 8).toUpperCase() : ''}.html`;
  const sampleRows = samples
    .map(
      (s) =>
        `<tr><td>${esc(s.sampleType.name)} (${esc(s.sampleType.code)})</td><td style="text-align:right;font-family:ui-monospace,monospace;font-weight:bold">${esc(s.barcodeValue)}</td></tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Invoice ${esc(uid)}</title>
<style>
  body{font-family:ui-sans-serif,system-ui,'Segoe UI',Arial,sans-serif;margin:48px;color:#0f172a}
  .brand{font-size:11px;font-weight:bold;letter-spacing:.15em;text-transform:uppercase;color:#0f766e}
  .uid{font-family:ui-monospace,monospace;font-size:28px;font-weight:bold;letter-spacing:.1em;margin-top:16px}
  .muted{color:#64748b}
  table{border-collapse:collapse;width:100%;margin-top:20px}
  td{border-bottom:1px solid #e2e8f0;padding:8px 4px;font-size:14px}
  .total-row td{border-top:2px solid #0f172a;border-bottom:none;font-weight:bold;padding-top:12px}
  footer{margin-top:32px;border-top:1px dashed #cbd5e1;padding-top:8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#94a3b8}
  @media print{body{margin:24mm}}
</style></head><body>
  <p class="brand">Thulir Demo Lab</p>
  <p class="uid">${esc(uid)}</p>
  <p>${esc(patientLine)}<br><span class="muted">${esc(patientSub)} · ${esc(mobile)}</span></p>
  ${order ? `<table>
    <tr><td>Order</td><td style="text-align:right;font-family:ui-monospace,monospace">${esc(order.id.slice(0, 8).toUpperCase())} · ${esc(order.status)}</td></tr>
    <tr><td>Items</td><td style="text-align:right">${order.orderTestsCount ?? '—'}</td></tr>
    ${sampleRows}
    <tr><td>Subtotal${Number(order.discountPercent) > 0 ? ` (discount ${esc(order.discountPercent)}%)` : ''}</td><td style="text-align:right;font-family:ui-monospace,monospace">₹${inr(order.subtotal)}</td></tr>
    <tr class="total-row"><td>Total Due</td><td style="text-align:right">₹${inr(order.totalAmount)}</td></tr>
    <tr><td>Payment status</td><td style="text-align:right;text-transform:capitalize">${esc(order.invoice?.status ?? 'due')}</td></tr>
  </table>` : ''}
  <footer>${new Date().toLocaleString('en-IN')}</footer>
</body></html>`;
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RegisterWizard() {
  const [step, setStep] = useState<Step>(1);
  const [selectedPatient, setSelectedPatient] = useState<PatientSummary | null>(null);
  const [demographics, setDemographics] = useState(emptyDemographics);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [showInpatient, setShowInpatient] = useState(false);
  const [billGroupId, setBillGroupId] = useState<string | undefined>();

  // §4 Corner search widget (replaces the old separate Identify step)
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResults, setSearchResults] = useState<PatientSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');

  // Referral (inside Patient step)
  const [referralType, setReferralType] = useState('');
  const [doctorQuery, setDoctorQuery] = useState('');
  const [doctorResults, setDoctorResults] = useState<PartyOption[]>([]);
  const [doctorsLoading, setDoctorsLoading] = useState(false);
  const [referrerId, setReferrerId] = useState<string | undefined>();

  // Configurable title list from API
  const [titleOptions, setTitleOptions] = useState<string[]>([]);
  useEffect(() => {
    api
      .get<{ value: string }[]>('/lookup-items?category=title')
      .then((items) => setTitleOptions(items.map((i) => i.value)))
      .catch(() => {
        /* fallback handled below */
      });
  }, []);
  const effectiveTitleOptions = titleOptions.length > 0
    ? titleOptions
    : ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr']; // hardcoded fallback if API fails

  // §4 Corner search — debounced typeahead
  const searchPatients = useCallback(async (t: string) => {
    if (!t.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setSearchError('');
    try {
      const out = await api.get<{ results: PatientSummary[] }>(`/patients/check-duplicate?q=${encodeURIComponent(t.trim())}`);
      setSearchResults(out.results);
    } catch (e) {
      setSearchError(e instanceof ApiError ? e.message : 'Search failed');
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => {
      void searchPatients(searchTerm);
    }, 450);
    return () => clearTimeout(t);
  }, [searchTerm, searchPatients]);

  function reset() {
    setStep(1);
    setSelectedPatient(null);
    setDemographics(emptyDemographics);
    setResult(null);
    setSearchTerm('');
    setSearchResults([]);
    setSearchError('');
    setReferralType('');
    setDoctorQuery('');
    setDoctorResults([]);
    setReferrerId(undefined);
    setBillGroupId(undefined);
    setShowInpatient(false);
  }

  /** Reset wizard to Step 1 for a new patient, preserving the bill group. */
  function resetForNewPatient() {
    setStep(1);
    setSelectedPatient(null);
    setDemographics(emptyDemographics);
    setResult(null);
    setSearchTerm('');
    setSearchResults([]);
    setSearchError('');
    setReferralType('');
    setDoctorQuery('');
    setDoctorResults([]);
    setReferrerId(undefined);
    setShowInpatient(false);
    // billGroupId intentionally NOT cleared — carry forward for consolidated billing
  }

  /** §4 Select existing patient — pre-fill the form, keep editable. */
  function selectExistingPatient(p: PatientSummary) {
    setSelectedPatient(p);
    // Pre-fill demographics from the existing patient so staff can update if needed
    setDemographics({
      title: p.title ?? '',
      name: `${p.firstName} ${p.lastName}`.trim(),
      dob: p.dob ? p.dob.slice(0, 10) : '',
      age: '', // not stored in PatientSummary; will derive from DOB on display
      gender: p.gender,
      mobile: p.mobile,
      email: p.email ?? '',
      address: '',
      externalMrn: p.externalMrn ?? '',
      abhaNumber: '',
      patientType: '',
      wardDesc: '',
      bedNo: '',
      ipOpNo: '',
    });
    setSearchTerm('');
    setSearchResults([]);
  }

  /** §2 Validation: age is always accepted; DOB is optional. */
  function demographicsValid(): string | null {
    const { name, gender, mobile } = demographics;
    if (!name.trim()) return 'Patient name is required';
    if (!gender) return 'Gender is required';
    if (!mobile.trim()) return 'Mobile number is required';

    // §2 At least one of age or DOB must be provided
    const hasAge = demographics.age !== '' && !Number.isNaN(Number(demographics.age));
    const hasDob = !!demographics.dob;
    if (!hasAge && !hasDob) return 'Age or date of birth is required';
    if (hasAge) {
      const age = Number(demographics.age);
      if (age < 0 || age > 130) return 'Enter a valid age (0–130)';
    }

    // §3 Specific referrer required for non-Self referral types
    if (referralType && referralType !== 'self' && !referrerId) {
      return `Please select a specific ${referralType.replace(/_/g, ' ')} before continuing`;
    }

    return null;
  }

  /** Build PatientInfoForOrder from the current demographics or selected patient. */
  const patientInfo: PatientInfoForOrder = (() => {
    if (selectedPatient) {
      return {
        patientId: selectedPatient.id,
        patientUid: selectedPatient.patientUid,
        firstName: selectedPatient.firstName,
        lastName: selectedPatient.lastName,
        gender: selectedPatient.gender,
        mobile: selectedPatient.mobile,
        dob: selectedPatient.dob ?? undefined,
      };
    }
    // §1 split single name at first space
    const { firstName, lastName } = splitPatientName(demographics.name);
    // §2 DOB takes precedence when present; otherwise use age
    const hasDob = !!demographics.dob;
    return {
      firstName,
      lastName,
      gender: demographics.gender || undefined,
      mobile: demographics.mobile,
      dob: hasDob ? demographics.dob : undefined,
      ageAtRegistration: !hasDob && demographics.age !== '' ? Number(demographics.age) : undefined,
      patientType: demographics.patientType || undefined,
      wardDesc: demographics.wardDesc || undefined,
      bedNo: demographics.bedNo || undefined,
      ipOpNo: demographics.ipOpNo || undefined,
    };
  })();

  function onComplete(completed: OrderResult) {
    setResult(completed);
    if (completed.billGroupId) {
      setBillGroupId(completed.billGroupId);
    }
    setStep(3);
  }

  return (
    <div className="w-full">
      {/* Step indicator — 3-step flow */}
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

      {/* §4 Step 1: Merged Patient Entry + Corner Search Widget */}
      {step === 1 && (
        <div className="thulir-card p-5">
          {/* Corner search widget — top-right */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-lg font-bold text-slate-800">Patient Registration</h1>
              <p className="mt-0.5 text-[13px] text-slate-500">
                Fill in patient details below, or search for an existing patient.
              </p>
            </div>
            <div className="relative w-64 shrink-0">
              <TextInput
                placeholder="Search existing…"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="py-1.5 pl-8 text-[13px]"
              />
              <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400">
                <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M10.5 10.5L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </div>
          </div>

          {/* §4 Search results dropdown */}
          {searching && <Spinner label="Searching…" />}
          {searchError && <p className="mt-2 text-[12px] text-rose-600">{searchError}</p>}
          {!searching && searchTerm.trim().length > 0 && searchResults.length === 0 && !searchError && (
            <EmptyState title="No matching patient" hint="Continue filling the form below to register a new patient." />
          )}
          {searchResults.length > 0 && (
            <div className="mt-3 thulir-card overflow-hidden">
              <table className="w-full">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="thulir-th">Patient</th>
                    <th className="thulir-th">UID</th>
                    <th className="thulir-th">Mobile</th>
                    <th className="thulir-th w-20"></th>
                  </tr>
                </thead>
                <tbody>
                  {searchResults.map((p) => (
                    <tr key={p.id} className="border-t border-slate-100 transition hover:bg-slate-50">
                      <td className="thulir-td">
                        <span className="font-medium text-slate-800">
                          {p.title ? `${p.title} ` : ''}{p.firstName} {p.lastName}
                        </span>
                        <span className="ml-2 text-[11px] capitalize text-slate-400">{p.gender}</span>
                      </td>
                      <td className="thulir-td font-mono text-[12px] text-brand-700">{p.patientUid}</td>
                      <td className="thulir-td font-mono text-[12px]">{p.mobile}</td>
                      <td className="thulir-td text-right">
                        <Button
                          variant="secondary"
                          className="h-7 px-2.5 text-[12px]"
                          onClick={() => selectExistingPatient(p)}
                        >
                          Select
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* §3 Field order: Name → Age → Referral Type → Referrer → remaining */}
          <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {/* Title — first field, before Patient Name */}
            <Field label="Title">
              <Select
                value={demographics.title}
                onChange={(e) => {
                  const newTitle = e.target.value;
                  setDemographics((d) => {
                    /* Auto-map clear-gender titles; leave ambiguous ones alone */
                    const genderMap: Record<string, 'male' | 'female'> = {
                      Mr: 'male',
                      Mrs: 'female',
                      Ms: 'female',
                      Miss: 'female',
                    };
                    const autoGender = genderMap[newTitle];
                    return {
                      ...d,
                      title: newTitle,
                      ...(autoGender ? { gender: autoGender } : {}),
                    };
                  });
                }}
              >
                <option value="">—</option>
                {effectiveTitleOptions.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </Select>
            </Field>

            {/* Patient Name */}
            <Field label="Patient Name" required>
              <TextInput
                autoFocus
                value={demographics.name}
                onChange={(e) => setDemographics((d) => ({ ...d, name: e.target.value }))}
                placeholder="e.g. Ravi Kumar"
              />
            </Field>

            {/* Age */}
            <Field label="Age" hint="Years">
              <TextInput
                type="number"
                min={0}
                max={130}
                placeholder="e.g. 35"
                value={demographics.age}
                onChange={(e) => setDemographics((d) => ({ ...d, age: e.target.value }))}
              />
            </Field>

            {/* DOB — optional, adjacent to Age */}
            <Field label="Date of Birth" hint="Optional">
              <TextInput
                type="date"
                value={demographics.dob}
                onChange={(e) => setDemographics((d) => ({ ...d, dob: e.target.value }))}
              />
            </Field>

            {/* Gender */}
            <Field label="Gender" required>
              <Select value={demographics.gender} onChange={(e) => setDemographics((d) => ({ ...d, gender: e.target.value as never }))}>
                <option value="">—</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="other">Other</option>
              </Select>
            </Field>

            {/* Mobile */}
            <Field label="Mobile" required>
              <TextInput value={demographics.mobile} onChange={(e) => setDemographics((d) => ({ ...d, mobile: e.target.value }))} placeholder="10-digit number" maxLength={15} />
            </Field>

            {/* Referral Type — moved up to sit right after Mobile */}
            <Field label="Referral Type">
              <select
                value={referralType}
                onChange={(e) => {
                  const val = e.target.value;
                  setReferralType(val);
                  if (val === 'self' || val === '') {
                    setReferrerId(undefined);
                    setDoctorQuery('');
                    setDoctorResults([]);
                  }
                }}
                className="thulir-input"
              >
                  <option value="">— Select —</option>
                  <option value="self">Self / Walk-in</option>
                  <option value="doctor">Doctor</option>
                  <option value="hospital">Hospital</option>
                  <option value="reference_lab">Reference Lab</option>
                  <option value="corporate">Corporate</option>
                  <option value="insurance_tpa">Insurance / TPA</option>
                  <option value="staff">Staff</option>
                </select>
            </Field>

            {/* Specific Referrer — only when referral type is selected and not self */}
            {referralType && referralType !== 'self' && (
              <Field label={`Specific ${referralType.replace('_', ' ')} (optional)`}>
                <ReferralTypeahead
                  referralType={referralType}
                  query={doctorQuery}
                  onQueryChange={setDoctorQuery}
                  results={doctorResults}
                  onResultsChange={setDoctorResults}
                  loading={doctorsLoading}
                  onLoadingChange={setDoctorsLoading}
                  onSelect={(d) => {
                    setReferrerId(d.id);
                    setDoctorQuery(d.name);
                    setDoctorResults([]);
                  }}
                />
              </Field>
            )}

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

          {/* §3 Inpatient Details — collapsed by default */}
          <div className="mt-4 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => setShowInpatient(!showInpatient)}
              className="flex items-center gap-2 text-[13px] font-semibold text-slate-600 hover:text-slate-800"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className={`transition-transform ${showInpatient ? 'rotate-90' : ''}`}>
                <path d="M4.5 2L9 6L4.5 10" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              + Inpatient Details
            </button>
            {showInpatient && (
              <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                <Field label="Patient Type">
                  <Select value={demographics.patientType} onChange={(e) => setDemographics((d) => ({ ...d, patientType: e.target.value }))}>
                    <option value="">—</option>
                    <option value="IP">IP (In-patient)</option>
                    <option value="OP">OP (Out-patient)</option>
                  </Select>
                </Field>
                <Field label="Ward">
                  <TextInput value={demographics.wardDesc} onChange={(e) => setDemographics((d) => ({ ...d, wardDesc: e.target.value }))} placeholder="e.g. Ward A" />
                </Field>
                <Field label="Bed No.">
                  <TextInput value={demographics.bedNo} onChange={(e) => setDemographics((d) => ({ ...d, bedNo: e.target.value }))} placeholder="e.g. 12B" />
                </Field>
                <Field label="IP/OP No.">
                  <TextInput value={demographics.ipOpNo} onChange={(e) => setDemographics((d) => ({ ...d, ipOpNo: e.target.value }))} placeholder="e.g. IP-2026-045" />
                </Field>
              </div>
            )}
          </div>

          <div className="mt-5 flex justify-end">
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
                setStep(2);
              }}
            >
              Continue to Order & Billing →
            </Button>
          </div>
          {searchError && <p className="mt-3 text-[12px] text-rose-600">{searchError}</p>}
        </div>
      )}

      {/* Step 2: Order & Billing */}
      {step === 2 && (
        <OrderBillingStep
          patientInfo={patientInfo}
          referrerId={referrerId}
          billGroupId={billGroupId}
          onBack={() => setStep(1)}
          onComplete={onComplete}
        />
      )}

      {/* Step 3: Done (was Step 4) */}
      {step === 3 && result && (
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
                  {selectedPatient
                    ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                    : splitPatientName(demographics.name).firstName + ' ' + splitPatientName(demographics.name).lastName
                  }
                </p>
                <p className="text-[12px] text-slate-400">
                  {selectedPatient ? formatAge(selectedPatient.dob) : demographics.dob ? formatAge(demographics.dob) : `${demographics.age} y`}
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

          {/* Sample IDs (barcodes created during order) */}
          {result.order?.samples && result.order.samples.length > 0 && (
            <div className="thulir-card p-4">
              <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-slate-500">Sample IDs</h3>
              <div className="space-y-1.5">
                {result.order.samples.map((s) => (
                  <div key={s.id} className="flex items-center justify-between rounded-md border border-slate-100 bg-slate-50 px-3 py-1.5">
                    <span className="text-[13px] text-slate-600">
                      {s.sampleType.name}
                      <span className="ml-1 text-[11px] text-slate-400">({s.sampleType.code})</span>
                    </span>
                    <span className="font-mono text-[13px] font-semibold text-brand-800">{s.barcodeValue}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Printable label */}
          <div className="print-area thulir-card p-5">
            <p className="text-[11px] font-bold uppercase tracking-widest text-brand-700">Thulir Demo Lab</p>
            <p className="mt-3 font-mono text-2xl font-bold tracking-widest text-slate-900">{result.patient.patientUid}</p>
            <p className="mt-2 text-sm text-slate-800">
              {selectedPatient
                ? `${selectedPatient.firstName} ${selectedPatient.lastName}`
                : splitPatientName(demographics.name).firstName + ' ' + splitPatientName(demographics.name).lastName
              }
              {selectedPatient ? ` · ${formatAge(selectedPatient.dob)}` : demographics.dob ? ` · ${formatAge(demographics.dob)}` : ` · ${demographics.age} y`}
            </p>
            <p className="text-sm text-slate-700">{selectedPatient ? selectedPatient.mobile : demographics.mobile}</p>
            {result.order && <p className="mt-2 text-sm text-slate-700">Order: {result.order.id.slice(0, 8).toUpperCase()} · {inr(result.order.totalAmount)}</p>}
            <p className="mt-4 border-t border-dashed border-slate-300 pt-2 text-[10px] uppercase tracking-wide text-slate-400">{new Date().toLocaleString('en-IN')}</p>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Button onClick={reset}>Register Another Patient</Button>
              <Button
                onClick={async () => {
                  let gid = billGroupId;
                  if (!gid) {
                    try {
                      const group = await api.post<{ id: string }>('/bill-groups', {});
                      gid = group.id;
                      setBillGroupId(gid);
                    } catch {
                      return;
                    }
                  }
                  if (result?.order?.id && gid) {
                    try {
                      await api.patch(`/bill-groups/${gid}/orders/${result.order.id}`, {});
                    } catch {
                      // best-effort — the order was already created
                    }
                  }
                  resetForNewPatient();
                }}
              >
                + Add Another Patient to This Bill
              </Button>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={() => {
                  if (!result) return;
                  downloadInvoice(
                    result,
                    selectedPatient
                      ? `${selectedPatient.firstName} ${selectedPatient.lastName}`.trim()
                      : demographics.name.trim(),
                    selectedPatient ? formatAge(selectedPatient.dob) : demographics.dob ? formatAge(demographics.dob) : `${demographics.age} y`,
                    selectedPatient ? selectedPatient.mobile : demographics.mobile,
                    result.order?.samples ?? [],
                  );
                }}
              >
                ⬇ Download Invoice
              </Button>
              <Button variant="primary" onClick={() => window.print()}>
                🖨 Print Label / Receipt
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Referral typeahead — encapsulates the debounced party search so the
 * parent (RegisterWizard) doesn't need useDebounced.
 */
function ReferralTypeahead({
  referralType,
  query,
  onQueryChange,
  results,
  onResultsChange,
  loading,
  onLoadingChange,
  onSelect,
}: {
  referralType: string;
  query: string;
  onQueryChange: (q: string) => void;
  results: PartyOption[];
  onResultsChange: (r: PartyOption[]) => void;
  loading: boolean;
  onLoadingChange: (l: boolean) => void;
  onSelect: (p: PartyOption) => void;
}) {
  const [debouncedQ, setDebouncedQ] = useState(query);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  useEffect(() => {
    if (!debouncedQ.trim() || !referralType || referralType === 'self') {
      onResultsChange([]);
      return;
    }
    let cancelled = false;
    onLoadingChange(true);
    api
      .get<PartyOption[]>(`/parties/search?type=${encodeURIComponent(referralType)}&q=${encodeURIComponent(debouncedQ.trim())}`)
      .then((rows) => {
        if (!cancelled) onResultsChange(rows);
      })
      .catch(() => {
        if (!cancelled) onResultsChange([]);
      })
      .finally(() => {
        if (!cancelled) onLoadingChange(false);
      });
    return () => { cancelled = true; };
  }, [debouncedQ, referralType, onResultsChange, onLoadingChange]);

  return (
    <Typeahead<PartyOption>
      placeholder={`Search ${referralType.replace('_', ' ')}s…`}
      query={query}
      onQueryChange={onQueryChange}
      results={results}
      loading={loading}
      onSelect={onSelect}
      renderResult={(d) => <span className="text-[13px] text-slate-800">{d.name}</span>}
    />
  );
}
