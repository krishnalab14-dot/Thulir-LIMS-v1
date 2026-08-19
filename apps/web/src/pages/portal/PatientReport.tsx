import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { RealQr } from '../../components/RealQr';
import { ReportSheet, type ReportSheetData, type ReportSheetRow } from '../../components/ReportSheet';
import { Badge, Spinner } from '../../components/ui';
import { patientApi } from '../../lib/portal-auth';
import { ApiError } from '../../lib/http';
import { formatDate, formatDateTime } from '../../lib/format';

interface ReportData {
  order: { id: string; status: string; isUrgent: boolean; createdAt: string; reportGeneratedAt: string | null; verificationCode: string };
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number; dob: string | null };
  samples: Array<{ id: string; barcodeValue: string; sampleType: { id: string; name: string; code: string | null }; orderTests: Array<ReportSheetRow & { verifiedBy: string | null; verifiedAt: string | null; approvedBy: string | null; approvedAt: string | null; approvalSignatureStamp: string | null }> }>;
  summary: { total: number };
  lab: { labName: string; labAddress: string | null };
  signature: { signatureRef: string; stamp: string | null; approvedAt: string | null };
  verify: { code: string; path: string };
}

export function PatientReport() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const report = await patientApi.get<ReportData>(`/portal/patient/orders/${id}/report`);
      setData(report);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        navigate('/portal/patient/login', { replace: true });
        return;
      }
      setError(err instanceof ApiError ? err.message : 'Could not load the report');
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <Spinner label="Loading report…" />;
  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50">
        <header className="sticky top-0 z-40 border-b border-brand-900 bg-brand-800 shadow-sm">
          <div className="mx-auto flex h-12 max-w-4xl items-center px-4">
            <span className="text-sm font-bold text-white">Patient Portal</span>
          </div>
        </header>
        <main className="mx-auto max-w-4xl px-4 py-6">
          <p className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">{error || 'Order not found'}</p>
          <Link to="/portal/patient" className="mt-4 thulir-btn thulir-btn-secondary inline-flex">Back to orders</Link>
        </main>
      </div>
    );
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
          Report issued {data.order.reportGeneratedAt ? formatDate(data.order.reportGeneratedAt) : ''}
        </div>
        <div className="mt-1 text-[10px] text-slate-500">
          Authenticate this report by scanning the QR code or entering the order number on the verification page.
        </div>
      </div>
    ),
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-40 border-b border-brand-900 bg-brand-800 shadow-sm">
        <div className="mx-auto flex h-12 max-w-4xl items-center justify-between px-4">
          <Link to="/portal/patient" className="text-sm font-bold text-white">Patient Portal</Link>
          <div className="flex items-center gap-2">
            <span className="text-[12px] text-slate-100">
              Order <span className="font-mono font-semibold">{data.order.id.slice(0, 8).toUpperCase()}</span>
            </span>
            {data.order.isUrgent && <Badge tone="rose">URGENT</Badge>}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-6">
        <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link to="/portal/patient" className="thulir-btn thulir-btn-secondary">
            Back to orders
          </Link>
          <div className="flex items-center gap-3">
            <span className="text-[12px] text-slate-500">
              Issued {data.order.reportGeneratedAt ? formatDateTime(data.order.reportGeneratedAt) : ''}
            </span>
            <button onClick={() => window.print()} className="thulir-btn thulir-btn-primary">
              Print / Save as PDF
            </button>
          </div>
        </div>

        <div className="overflow-x-auto pb-8">
          <div className="mx-auto w-fit">
            <ReportSheet data={sheet} />
          </div>
        </div>
      </main>
    </div>
  );
}
