import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { RealQr } from '../components/RealQr';
import { ReportSheet, type ReportSheetData, type ReportSheetRow } from '../components/ReportSheet';
import { Badge, Card, EmptyState, Spinner } from '../components/ui';
import { api, ApiError } from '../lib/api';
import { formatDate, formatDateTime } from '../lib/format';

interface ReportRow {
  id: string;
  testNameSnapshot: string;
  status: string;
  resultType: 'numeric' | 'options' | 'text';
  resultValue: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
  approvalSignatureStamp: string | null;
  approvedAt: string | null;
}

interface ReportData {
  order: { id: string; status: string; isUrgent: boolean; createdAt: string; reportGeneratedAt: string | null; verificationCode: string };
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number; dob: string | null };
  samples: Array<{ id: string; barcodeValue: string; sampleType: { id: string; name: string; code: string | null }; orderTests: ReportRow[] }>;
  summary: { total: number };
  lab: { labName: string; labAddress: string | null };
  signature: { signatureRef: string; stamp: string | null; approvedAt: string | null };
  verify: { code: string; path: string };
}

export function Report() {
  const { id } = useParams<{ id: string }>();
  const [data, setData] = useState<ReportData | null>(null);
  const [notReady, setNotReady] = useState<string | null>(null); // server 409 message
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    setNotReady(null);
    try {
      const report = await api.get<ReportData>(`/orders/${id}/report`);
      setData(report);
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setNotReady(e.message);
      } else {
        setError(e instanceof ApiError ? e.message : 'Could not load the report');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="Loading report…" />;
  if (notReady) {
    return (
      <div className="mx-auto max-w-xl">
        <Card>
          <EmptyState
            title="Report not ready yet"
            hint="A report can only be issued once every result in the order is approved by the pathologist."
          />
          <p className="mt-1 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[13px] text-amber-800">{notReady}</p>
          <div className="mt-4 flex items-center gap-3">
            <Link to={`/approvals`} className="thulir-btn thulir-btn-primary">
              Go to the approval queue
            </Link>
            <Link to={`/orders/${id}`} className="thulir-btn thulir-btn-secondary">
              View order
            </Link>
          </div>
        </Card>
      </div>
    );
  }
  if (error || !data) {
    return <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error || 'Order not found'}</p>;
  }

  const rows: ReportSheetRow[] = data.samples.flatMap((s) => s.orderTests);
  const verifyUrl = `${window.location.origin}${data.verify.path}`;
  const sheet: ReportSheetData = {
    labName: data.lab.labName,
    patient: data.patient,
    order: data.order,
    rows,
    signatureStamp: data.signature.stamp,
    verificationCode: data.verify.code,
    qr: <RealQr url={verifyUrl} className="h-24 w-24" />,
    reportDate: data.order.reportGeneratedAt ? formatDate(data.order.reportGeneratedAt) : null,
    footer: (
      <div className="rounded-sm border border-emerald-200 bg-emerald-50 py-2 text-center">
        <div className="text-[11px] font-bold uppercase tracking-wider text-emerald-800">
          ✓ Report issued {data.order.reportGeneratedAt ? formatDate(data.order.reportGeneratedAt) : ''}
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Authenticate this report by scanning the QR code or entering the order number on the verification page.
        </div>
      </div>
    ),
  };

  return (
    <div>
      {/* Toolbar — hidden on print. */}
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link to={`/orders/${data.order.id}`} className="thulir-btn thulir-btn-secondary">
            ← Back
          </Link>
          <span className="text-[13px] text-slate-500">
            Order <span className="font-mono font-semibold text-brand-700">{data.order.id.slice(0, 8).toUpperCase()}</span>
          </span>
          {data.order.isUrgent && <Badge tone="rose">URGENT</Badge>}
          <Badge tone="green">approved</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-[12px] text-slate-500">
            Issued {data.order.reportGeneratedAt ? formatDateTime(data.order.reportGeneratedAt) : '—'}
          </span>
          <button onClick={() => window.print()} className="thulir-btn thulir-btn-primary">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden>
              <path
                d="M4 5V2.5h8V5M4 10H2.5v4h11v-4H12M5 8h6"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            Print / Save as PDF
          </button>
        </div>
      </div>

      {/* The A4 sheet — the print surface (report-sheet print rules in index.css). */}
      <div className="overflow-x-auto pb-8">
        <div className="mx-auto w-fit">
          <ReportSheet data={sheet} />
        </div>
      </div>

      <p className="no-print pb-6 text-center text-[11px] text-slate-400">
        Printing uses the browser's native dialog — choose “Save as PDF” to generate a digital copy.
      </p>
    </div>
  );
}
