import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../lib/api';
import { inr, round2 } from '../lib/format';
import { useAuth } from '../auth/useAuth';
import {
  packageAddConfirmMessage,
  packageSwapConfirmMessage,
  packagesCoveringTest,
  packagesOverlappingPackage,
  removeCoveredStandaloneTests,
  removeOverlappingPackages,
  testCoveredBlockMessage,
  testsOverlappingPackage,
} from '../lib/order-overlap';
import type { PackageOverlap, PackageRef, SelectedTest } from '../lib/order-overlap';
import { Badge, Button, Field, Modal, TextInput } from '../components/ui';

export interface TestOption {
  id: string;
  testCode: string;
  testName: string;
  currentPrice: string;
  requiredSampleTypeId: string | null;
  /** When "package", this is a MasterTestPackage returned from the test search. */
  kind?: 'test' | 'package';
}

export interface PackageOption {
  id: string;
  packageCode: string;
  packageName: string;
  packagePrice: string;
  items: { testId: string; testName: string; price: string }[];
}

export interface PartyOption {
  id: string;
  name: string;
  type: string;
}

export interface PatientInfoForOrder {
  patientId?: string;
  patientUid?: string;
  firstName?: string;
  lastName?: string;
  gender?: 'male' | 'female' | 'other';
  mobile?: string;
  dob?: string;
  ageAtRegistration?: number;
  // §3 Inpatient context fields (passed from Demographics step)
  patientType?: string;
  wardDesc?: string;
  bedNo?: string;
  ipOpNo?: string;
}

export interface OrderResult {
  patient: { id: string; patientUid: string };
  order?: {
    id: string;
    subtotal: string;
    discountPercent: string;
    totalAmount: string;
    status: string;
    orderTestsCount?: number;
    invoice?: { id: string; status: string };
  };
}

type Line =
  | { kind: 'test'; id: string; code: string; name: string; price: number }
  | {
      kind: 'package';
      id: string;
      code: string;
      name: string;
      /** The package's OWN price — billed as-is, never the sum of its tests. */
      price: number;
      items: { testId: string; testName: string }[];
    };

const PAYMENT_MODES = [
  { mode: 'cash', label: 'Cash' },
  { mode: 'upi', label: 'UPI' },
  { mode: 'card', label: 'Card' },
  { mode: 'bank_transfer', label: 'Bank Transfer' },
  { mode: 'insurance', label: 'Insurance' },
] as const;

function toPackageRef(pkg: { id: string; name: string; items: { testId: string; testName: string }[] }): PackageRef {
  return { id: pkg.id, name: pkg.name, items: pkg.items.map((i) => ({ testId: i.testId, testName: i.testName })) };
}

function useDebounced(value: string, delay = 350) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return debounced;
}

export function Typeahead<T extends { id: string }>({
  placeholder,
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
  renderResult,
}: {
  placeholder: string;
  query: string;
  onQueryChange: (v: string) => void;
  results: T[];
  loading: boolean;
  onSelect: (item: T) => void;
  renderResult: (item: T) => React.ReactNode;
}) {
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focused) return;
    const onDocDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setFocused(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [focused]);

  return (
    <div ref={ref} className="relative">
      <TextInput placeholder={placeholder} value={query} onChange={(e) => onQueryChange(e.target.value)} onFocus={() => setFocused(true)} />
      {focused && query.trim().length > 0 && (
        <div className="absolute z-30 mt-1 max-h-64 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 shadow-lg">
          {loading ? (
            <div className="px-3 py-2 text-xs text-slate-400">Searching…</div>
          ) : results.length === 0 ? (
            <div className="px-3 py-2 text-xs text-slate-400">No matches</div>
          ) : (
            results.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => {
                  onSelect(r);
                  setFocused(false);
                }}
                className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left transition hover:bg-brand-50"
              >
                {renderResult(r)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export function OrderBillingStep({
  patientInfo,
  referrerId,
  onBack,
  onComplete,
}: {
  patientInfo: PatientInfoForOrder;
  onBack: () => void;
  onComplete: (result: OrderResult) => void;
  /** Selected referrer party ID — passed from the Demographics step. */
  referrerId?: string;
}) {
  // --- search state ---
  const [testQuery, setTestQuery] = useState('');
  const [testResults, setTestResults] = useState<TestOption[]>([]);
  const [testsLoading, setTestsLoading] = useState(false);
  const [pkgQuery, setPkgQuery] = useState('');
  const [pkgResults, setPkgResults] = useState<PackageOption[]>([]);
  const [pkgsLoading, setPkgsLoading] = useState(false);
  const [expectedReportDate, setExpectedReportDate] = useState('');
  const [scheduledCollectionAt, setScheduledCollectionAt] = useState('');
  const [source, setSource] = useState('');

  const debouncedTest = useDebounced(testQuery);
  const debouncedPkg = useDebounced(pkgQuery);

  const { user } = useAuth();

  // --- line items / billing state ---
  const [lines, setLines] = useState<Line[]>([]);
  const [discount, setDiscount] = useState('');
  const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({ cash: '', upi: '', card: '', bank_transfer: '', insurance: '' });
  const [urgent, setUrgent] = useState(false);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // --- overlap-prevention banners: package-confirm, package-swap, blocked standalone add ---
  const [packageConfirm, setPackageConfirm] = useState<{ pkg: PackageOption; overlap: SelectedTest[] } | null>(null);
  const [packageSwap, setPackageSwap] = useState<{ pkg: PackageOption; overlaps: PackageOverlap[] } | null>(null);
  const [coveredBlock, setCoveredBlock] = useState<{ test: TestOption; packages: PackageRef[] } | null>(null);

  // --- create-package dialog ---
  const [dialogOpen, setDialogOpen] = useState(false);
  const [pkgName, setPkgName] = useState('');
  const [pkgPrice, setPkgPrice] = useState('');

  useEffect(() => {
    if (!debouncedTest.trim()) {
      setTestResults([]);
      return;
    }
    let cancelled = false;
    setTestsLoading(true);
    api
      .get<TestOption[]>(`/masters/tests/search?q=${encodeURIComponent(debouncedTest.trim())}`)
      .then((rows) => {
        if (!cancelled) setTestResults(rows);
      })
      .catch(() => {
        if (!cancelled) setTestResults([]);
      })
      .finally(() => {
        if (!cancelled) setTestsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedTest]);

  useEffect(() => {
    if (!debouncedPkg.trim()) {
      setPkgResults([]);
      return;
    }
    let cancelled = false;
    setPkgsLoading(true);
    api
      .get<PackageOption[]>(`/masters/packages/search?q=${encodeURIComponent(debouncedPkg.trim())}`)
      .then((rows) => {
        if (!cancelled) setPkgResults(rows);
      })
      .catch(() => {
        if (!cancelled) setPkgResults([]);
      })
      .finally(() => {
        if (!cancelled) setPkgsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debouncedPkg]);

  // --- derived totals (mirror the server rules: tests bill at currentPrice,
  // --- packages bill at their OWN packagePrice — see POST /api/orders) ---
  const { subtotal, uniqueTestCount } = useMemo(() => {
    let subtotal = 0;
    const seenTests = new Set<string>();
    for (const line of lines) {
      if (line.kind === 'test') {
        subtotal += line.price;
        seenTests.add(line.id);
      } else {
        subtotal += line.price;
        for (const item of line.items) seenTests.add(item.testId);
      }
    }
    return { subtotal: round2(subtotal), uniqueTestCount: seenTests.size };
  }, [lines]);

  const discountPct = Number(discount) || 0;
  const total = round2(subtotal * (1 - discountPct / 100));
  const totalEntered = round2(PAYMENT_MODES.reduce((acc, m) => acc + (Number(paymentAmounts[m.mode]) || 0), 0));

  const testLines = lines.filter((l): l is Extract<Line, { kind: 'test' }> => l.kind === 'test');
  const hasPackages = lines.some((l) => l.kind === 'package');
  const canCreatePackage = testLines.length >= 2 && !hasPackages;

  function addTest(test: TestOption) {
    // A selected package that already covers this test → block outright
    // (adding it standalone would double-bill it; nothing valid to confirm).
    const covering = packagesCoveringTest(
      test.id,
      lines.filter((l): l is Extract<Line, { kind: 'package' }> => l.kind === 'package').map((l) => toPackageRef({ id: l.id, name: l.name, items: l.items })),
    );
    if (covering.length > 0) {
      setCoveredBlock({ test, packages: covering });
      setTestQuery('');
      setTestResults([]);
      return;
    }
    setCoveredBlock(null);
    setLines((prev) => (prev.some((l) => l.kind === 'test' && l.id === test.id) ? prev : [...prev, { kind: 'test', id: test.id, code: test.testCode, name: test.testName, price: Number(test.currentPrice) }]));
    setTestQuery('');
    setTestResults([]);
  }

  function addPackage(pkg: PackageOption) {
    // Already in the list → ignore (existing behavior).
    if (lines.some((l) => l.kind === 'package' && l.id === pkg.id)) {
      setPkgQuery('');
      setPkgResults([]);
      return;
    }
    const incomingRef = toPackageRef({ id: pkg.id, name: pkg.packageName, items: pkg.items });
    const existingPackages = lines
      .filter((l): l is Extract<Line, { kind: 'package' }> => l.kind === 'package')
      .map((l) => toPackageRef({ id: l.id, name: l.name, items: l.items }));

    // Overlap with an already-selected package → block with an explicit swap
    // (rule 3): the shared test sits inside two independently-priced bundles,
    // so there is no safe "remove just that test" resolution. The only actions
    // are "Remove [A] & add [B]" (full swap) or Cancel. Checked BEFORE the
    // standalone rule — a standalone confirm would still leave the
    // package-vs-package conflict in place, which the server would reject.
    const pkgOverlaps = packagesOverlappingPackage(incomingRef, existingPackages);
    if (pkgOverlaps.length > 0) {
      setPackageSwap({ pkg, overlaps: pkgOverlaps });
      setPkgQuery('');
      setPkgResults([]);
      return;
    }

    // Overlap with already-selected standalone tests → require an explicit
    // confirm (this removes the standalone item and prices it as part of the
    // package — a visible billing change, never merged silently).
    const overlap = testsOverlappingPackage(
      incomingRef,
      lines.filter((l): l is Extract<Line, { kind: 'test' }> => l.kind === 'test').map((l) => ({ id: l.id, name: l.name })),
    );
    if (overlap.length > 0) {
      setPackageConfirm({ pkg, overlap });
      setPkgQuery('');
      setPkgResults([]);
      return;
    }
    setPackageConfirm(null);
    setLines((prev) => [
      ...prev,
      {
        kind: 'package',
        id: pkg.id,
        code: pkg.packageCode,
        name: pkg.packageName,
        price: Number(pkg.packagePrice),
        items: pkg.items.map((i) => ({ testId: i.testId, testName: i.testName })),
      },
    ]);
    setPkgQuery('');
    setPkgResults([]);
  }

  /** "Add package & remove duplicate(s)" — drops the overlapping standalone items, adds the package. */
  function confirmPackageAdd() {
    if (!packageConfirm) return;
    const { pkg } = packageConfirm;
    setLines((prev) => {
      const { remaining } = removeCoveredStandaloneTests(
        toPackageRef({ id: pkg.id, name: pkg.packageName, items: pkg.items }),
        prev.filter((l): l is Extract<Line, { kind: 'test' }> => l.kind === 'test').map((l) => ({ id: l.id, name: l.name })),
      );
      const remainingIds = new Set(remaining.map((t) => t.id));
      return [
        ...prev.filter((l) => l.kind !== 'test' || remainingIds.has(l.id)),
        {
          kind: 'package',
          id: pkg.id,
          code: pkg.packageCode,
          name: pkg.packageName,
          price: Number(pkg.packagePrice),
          items: pkg.items.map((i) => ({ testId: i.testId, testName: i.testName })),
        },
      ];
    });
    setPackageConfirm(null);
  }

  /**
   * "Remove [A] & add [B]" — the rule-3 swap. Drops every existing package
   * overlapping the incoming one (full line-item removal; their OrderTest /
   * Sample linkage never exists because the order hasn't been submitted yet),
   * also drops standalone tests the new package covers (they're now priced as
   * part of the bundle — same rule as the standalone-confirm path), and adds
   * the incoming package fresh, priced and grouped normally. No partial merge.
   */
  function confirmPackageSwap() {
    if (!packageSwap) return;
    const { pkg } = packageSwap;
    const incomingRef = toPackageRef({ id: pkg.id, name: pkg.packageName, items: pkg.items });
    setLines((prev) => {
      const existingPackages = prev
        .filter((l): l is Extract<Line, { kind: 'package' }> => l.kind === 'package')
        .map((l) => toPackageRef({ id: l.id, name: l.name, items: l.items }));
      const { removed } = removeOverlappingPackages(incomingRef, existingPackages);
      const removedIds = new Set(removed.map((p) => p.id));
      const { remaining } = removeCoveredStandaloneTests(
        incomingRef,
        prev.filter((l): l is Extract<Line, { kind: 'test' }> => l.kind === 'test').map((l) => ({ id: l.id, name: l.name })),
      );
      const remainingTestIds = new Set(remaining.map((t) => t.id));
      return [
        ...prev.filter((l) => (l.kind === 'package' ? !removedIds.has(l.id) : remainingTestIds.has(l.id))),
        {
          kind: 'package',
          id: pkg.id,
          code: pkg.packageCode,
          name: pkg.packageName,
          price: Number(pkg.packagePrice),
          items: pkg.items.map((i) => ({ testId: i.testId, testName: i.testName })),
        },
      ];
    });
    setPackageSwap(null);
  }

  function openPackageDialog() {
    setPkgName(testLines.map((l) => l.code).join(' + ').slice(0, 90));
    setPkgPrice(String(round2(testLines.reduce((a, l) => a + l.price, 0))));
    setDialogOpen(true);
  }

  async function createPackageFromSelection() {
    setError('');
    if (!pkgName.trim()) {
      setError('Package name is required');
      return;
    }
    const price = Number(pkgPrice);
    if (Number.isNaN(price) || price < 0) {
      setError('Package price must be a valid amount');
      return;
    }
    try {
      const pkg = await api.post<PackageOption>('/masters/packages', {
        packageName: pkgName.trim(),
        packagePrice: price,
        testIds: testLines.map((l) => l.id),
      });
      setLines((prev) => [
        ...prev.filter((l) => l.kind !== 'test'),
        { kind: 'package', id: pkg.id, code: pkg.packageCode, name: pkg.packageName, price: Number(pkg.packagePrice), items: pkg.items.map((i) => ({ testId: i.testId, testName: i.testName })) },
      ]);
      setDialogOpen(false);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not create the package');
    }
  }

  function validatePayments(): string | null {
    if (discountPct < 0 || discountPct > 100) return 'Discount must be between 0 and 100%';
    if (totalEntered > total) return `Total entered (${inr(totalEntered)}) cannot exceed total due (${inr(total)})`;
    return null;
  }

  async function submit() {
    setError('');
    if (lines.length === 0) {
      // Patient-only registration (no order).
      if (patientInfo.patientId) {
        onComplete({ patient: { id: patientInfo.patientId, patientUid: patientInfo.patientUid ?? '' } });
        return;
      }
      setSubmitting(true);
      try {
        const patient = await api.post<{ id: string; patientUid: string }>('/patients', {
          title: undefined,
          firstName: patientInfo.firstName,
          lastName: patientInfo.lastName,
          gender: patientInfo.gender,
          mobile: patientInfo.mobile,
          dob: patientInfo.dob ? new Date(patientInfo.dob) : undefined,
          ageAtRegistration: patientInfo.dob ? undefined : patientInfo.ageAtRegistration,
        });
        onComplete({ patient });
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Registration failed');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    const paymentError = validatePayments();
    if (paymentError) {
      setError(paymentError);
      return;
    }

    const splits = PAYMENT_MODES.map((m) => ({ mode: m.mode, amount: Number(paymentAmounts[m.mode]) || 0 })).filter((s) => s.amount > 0);

    const payload = {
      patient: patientInfo.patientId
        ? { patientId: patientInfo.patientId }
        : {
            firstName: patientInfo.firstName,
            lastName: patientInfo.lastName,
            gender: patientInfo.gender,
            mobile: patientInfo.mobile,
            ...(patientInfo.dob ? { dob: new Date(patientInfo.dob) } : { ageAtRegistration: patientInfo.ageAtRegistration }),
          },
      orderDetails: {
        ...(referrerId ? { referrerPartyId: referrerId } : {}),

        ...(notes.trim() ? { clinicalNotes: notes.trim() } : {}),
        isUrgent: urgent,
        ...(expectedReportDate ? { expectedReportDate: new Date(expectedReportDate) } : {}),
        ...(scheduledCollectionAt ? { scheduledCollectionAt: new Date(scheduledCollectionAt) } : {}),
        ...(source ? { source } : {}),
        // §3 Inpatient fields passed from Demographics step
        ...(patientInfo.patientType ? { patientType: patientInfo.patientType } : {}),
        ...(patientInfo.wardDesc ? { wardDesc: patientInfo.wardDesc } : {}),
        ...(patientInfo.bedNo ? { bedNo: patientInfo.bedNo } : {}),
        ...(patientInfo.ipOpNo ? { ipOpNo: patientInfo.ipOpNo } : {}),
      },
      testIds: lines.filter((l) => l.kind === 'test').map((l) => l.id),
      packageIds: lines.filter((l) => l.kind === 'package').map((l) => l.id),
      billing: { discountPercent: discountPct },
      ...(splits.length ? { payment: { splits } } : {}),
    };

    setSubmitting(true);
    try {
      const res = await api.post<{
        id: string;
        subtotal: string;
        discountPercent: string;
        totalAmount: string;
        status: string;
        patient: { id: string; patientUid: string };
        orderTests: unknown[];
        invoice?: { id: string; status: string };
      }>('/orders', payload);
      onComplete({
        patient: { id: res.patient.id, patientUid: res.patient.patientUid },
        order: {
          id: res.id,
          subtotal: res.subtotal,
          discountPercent: res.discountPercent,
          totalAmount: res.totalAmount,
          status: res.status,
          orderTestsCount: res.orderTests?.length,
          invoice: res.invoice,
        },
      });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Order submission failed');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
          <span>{error}</span>
          <button onClick={() => setError('')} className="font-semibold hover:text-rose-900" aria-label="Dismiss">
            ×
          </button>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-5">
        {/* Left: search + line items */}
        <div className="space-y-4 lg:col-span-3">
          <div className="thulir-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Add Tests & Packages</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Add Test">
                <Typeahead<TestOption>
                  placeholder="Search by code or name…"
                  query={testQuery}
                  onQueryChange={setTestQuery}
                  results={testResults}
                  loading={testsLoading}
                  onSelect={async (t) => {
                    if (t.kind === 'package') {
                      // Fetch full package details (with items) then add it.
                      try {
                        const pkgs = await api.get<PackageOption[]>(`/masters/packages/search?q=${encodeURIComponent(t.testName)}`);
                        const match = pkgs.find((p) => p.id === t.id);
                        if (match) addPackage(match);
                      } catch {
                        // Silently ignore — user can retry or use the Package search
                      }
                      setTestQuery('');
                      setTestResults([]);
                      return;
                    }
                    addTest(t);
                  }}
                  renderResult={(t) => (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-slate-800">
                          {t.testName}
                          {t.kind === 'package' && (
                            <span className="ml-1.5 inline-block rounded bg-brand-100 px-1 py-0.5 text-[9px] font-semibold uppercase text-brand-700">panel</span>
                          )}
                        </span>
                        <span className="block text-[11px] text-slate-400">{t.testCode}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-semibold text-brand-700">{inr(t.currentPrice)}</span>
                    </>
                  )}
                />
              </Field>
              <Field label="Add Package">
                <Typeahead<PackageOption>
                  placeholder="Search packages…"
                  query={pkgQuery}
                  onQueryChange={setPkgQuery}
                  results={pkgResults}
                  loading={pkgsLoading}
                  onSelect={addPackage}
                  renderResult={(p) => (
                    <>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-slate-800">{p.packageName}</span>
                        <span className="block text-[11px] text-slate-400">
                          {p.items.length} tests · {p.items.map((i) => i.testName).join(', ')}
                        </span>
                      </span>
                      <span className="shrink-0 font-mono text-[12px] font-semibold text-brand-700">{inr(p.packagePrice)}</span>
                    </>
                  )}
                />
              </Field>
            </div>
          </div>

          {/* Overlap prevention: blocked standalone add (dismissible). */}
          {coveredBlock && (
            <div className="flex items-start justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
              <span>{testCoveredBlockMessage(coveredBlock.test.testName, coveredBlock.packages)}</span>
              <button onClick={() => setCoveredBlock(null)} className="font-semibold hover:text-amber-900" aria-label="Dismiss">
                ×
              </button>
            </div>
          )}

          {/* Overlap prevention: package add needs explicit confirm (billing change). */}
          {packageConfirm && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <p>{packageAddConfirmMessage(packageConfirm.overlap, packageConfirm.pkg.packageName)}</p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="h-7 px-2.5 text-[12px]" onClick={confirmPackageAdd}>
                  Add package &amp; remove duplicate(s)
                </Button>
                <Button className="h-7 px-2.5 text-[12px]" onClick={() => setPackageConfirm(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {/* Overlap prevention: package-vs-package → explicit swap, never a merge. */}
          {packageSwap && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <p>
                {packageSwapConfirmMessage(
                  toPackageRef({ id: packageSwap.pkg.id, name: packageSwap.pkg.packageName, items: packageSwap.pkg.items }),
                  packageSwap.overlaps,
                )}
              </p>
              <div className="mt-2 flex gap-2">
                <Button variant="primary" className="h-7 px-2.5 text-[12px]" onClick={confirmPackageSwap}>
                  Remove {packageSwap.overlaps.map((o) => `"${o.existing.name}"`).join(' & ')} &amp; add "{packageSwap.pkg.packageName}"
                </Button>
                <Button className="h-7 px-2.5 text-[12px]" onClick={() => setPackageSwap(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          <div className="thulir-card">
            <header className="flex items-center justify-between border-b border-slate-100 px-4 py-2.5">
              <h3 className="text-sm font-semibold text-slate-700">Line Items</h3>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-slate-400">{uniqueTestCount} unique test{uniqueTestCount === 1 ? '' : 's'}</span>
                {canCreatePackage && (
                  <Button variant="primary" className="h-7 px-2.5 text-[12px]" onClick={openPackageDialog} title="Create a reusable package from the selected tests">
                    Create Package from Selection
                  </Button>
                )}
              </div>
            </header>
            {lines.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-slate-400">
                No items yet — search above to add tests or packages. <span className="text-slate-300">(You can also skip ordering.)</span>
              </p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="thulir-th">Item</th>
                    <th className="thulir-th text-right">Price</th>
                    <th className="thulir-th w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line) => (
                    <tr key={`${line.kind}-${line.id}`} className="border-b border-slate-50 last:border-0">
                      <td className="thulir-td">
                        <span className="block text-[13px] font-medium text-slate-800">{line.name}</span>
                        <span className="block text-[11px] text-slate-400">
                          {line.kind === 'test' ? line.code : `${line.items.length} tests — ${line.items.map((i) => i.testName).join(', ')}`}
                        </span>
                      </td>
                      <td className="thulir-td text-right font-mono text-[13px] font-semibold text-slate-800">
                        {inr(line.price)}
                      </td>
                      <td className="thulir-td text-right">
                        <button
                          onClick={() => setLines((prev) => prev.filter((l) => l !== line))}
                          className="rounded p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-600"
                          aria-label={`Remove ${line.name}`}
                        >
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                            <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right: totals + payment + details */}
        <div className="space-y-4 lg:col-span-2">
          <div className="thulir-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Totals</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-slate-500">Subtotal</dt>
                <dd className="font-mono font-semibold text-slate-800">{inr(subtotal)}</dd>
              </div>
              <div className="flex items-center justify-between gap-2">
                <dt className="text-slate-500">Discount %</dt>
                <dd className="w-24">
                  <TextInput type="number" min={0} max={100} step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} className="px-2 py-1 text-right font-mono" placeholder="0" />
                </dd>
              </div>
              {discountPct > 0 && user && (
                <div className="flex items-center justify-between gap-2">
                  <dt className="text-[12px] text-slate-400">Authorized by</dt>
                  <dd className="text-[12px] font-medium text-slate-600">
                    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-100 text-[9px] font-bold text-brand-700">
                      {user.username.charAt(0).toUpperCase()}
                    </span>
                    {' '}{user.username}
                  </dd>
                </div>
              )}
              <div className="flex justify-between border-t border-slate-100 pt-2">
                <dt className="font-semibold text-slate-700">Total Due</dt>
                <dd className="font-mono text-base font-bold text-brand-800">{inr(total)}</dd>
              </div>
            </dl>
          </div>

          <div className="thulir-card p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">Payment</h3>
              <Badge tone={totalEntered === 0 ? 'slate' : totalEntered >= total ? 'green' : 'amber'}>
                {totalEntered === 0 ? `No payment — ${inr(total)} due` : totalEntered >= total ? 'Fully paid' : `Paid ${inr(totalEntered)} — ${inr(total - totalEntered)} due`}
              </Badge>
            </div>
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
            {totalEntered > 0 && totalEntered < total && (
              <p className="mt-2 text-[12px] text-amber-700">
                Partial payment — {inr(total - totalEntered)} will be due after registration.
              </p>
            )}
          </div>

          <div className="thulir-card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Order Details</h3>
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Expected Report Date (optional)">
                  <input
                    type="date"
                    value={expectedReportDate}
                    onChange={(e) => setExpectedReportDate(e.target.value)}
                    className="thulir-input"
                  />
                </Field>
                <Field label="Scheduled Collection (optional)">
                  <input
                    type="datetime-local"
                    value={scheduledCollectionAt}
                    onChange={(e) => setScheduledCollectionAt(e.target.value)}
                    className="thulir-input"
                  />
                </Field>
              </div>

              <Field label="Source (optional)">
                <select
                  value={source}
                  onChange={(e) => setSource(e.target.value)}
                  className="thulir-input"
                >
                  <option value="">— Select —</option>
                  <option value="Walk-in">Walk-in</option>
                  <option value="Referral">Referral</option>
                  <option value="Online">Online</option>
                  <option value="Corporate">Corporate</option>
                  <option value="Insurance">Insurance</option>
                  <option value="Camp">Camp</option>
                  <option value="Other">Other</option>
                </select>
              </Field>

              <label className="flex items-center gap-2 text-[13px] text-slate-700">
                <input type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300 text-brand-600 focus:ring-brand-600" />
                Urgent order
              </label>

              <Field label="Clinical Notes (optional)">
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} className="thulir-input resize-y" placeholder="e.g. Fasting sample required" />
              </Field>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <Button onClick={onBack} disabled={submitting}>
          ← Back
        </Button>
        <Button variant="primary" onClick={submit} disabled={submitting} className="px-5">
          {submitting ? 'Submitting…' : lines.length === 0 ? 'Finish Registration (no order)' : 'Submit Order & Finish'}
        </Button>
      </div>

      <Modal
        open={dialogOpen}
        title="Create Package from Selection"
        onClose={() => setDialogOpen(false)}
        footer={
          <>
            <Button onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={createPackageFromSelection}>
              Create Package
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-[13px] text-slate-500">
            These {testLines.length} tests will become one reusable package and appear in package searches immediately.
          </p>
          <Field label="Package Name" required>
            <TextInput value={pkgName} onChange={(e) => setPkgName(e.target.value)} placeholder="e.g. CBC + Lipid" />
          </Field>
          <Field label="Package Price (₹)" required>
            <TextInput type="number" min={0} step="0.01" value={pkgPrice} onChange={(e) => setPkgPrice(e.target.value)} />
          </Field>
        </div>
      </Modal>
    </div>
  );
}
