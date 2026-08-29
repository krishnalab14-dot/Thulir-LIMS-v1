import { useMemo, type ReactNode } from 'react';
import { pseudoQrCells } from '../lib/pseudo-qr';

/**
 * The live A4 preview QR placeholder — deterministic grid from the seed.
 * Replaced by a real QR on the final report (RealQr).
 */
export function PseudoQr({ seed, className }: { seed: string; className?: string }) {
  const cells = useMemo(() => pseudoQrCells(seed), [seed]);
  return (
    <div className={`grid ${className ?? ''}`} style={{ gridTemplateColumns: 'repeat(21, 1fr)' }} aria-hidden>
      {cells.map((on, i) => (
        <span key={i} className={on ? 'bg-slate-900' : 'bg-white'} />
      ))}
    </div>
  );
}

export interface ReportSheetRow {
  id: string;
  testNameSnapshot: string;
  status: string;
  resultType: 'numeric' | 'options' | 'text';
  resultValue: string | null;
  unit: string | null;
  refLow: number | null;
  refHigh: number | null;
}

export interface ReportSheetData {
  labName: string;
  labAddress?: string | null;
  labPhone?: string | null;
  labEmail?: string | null;
  nablAccreditationNumber?: string | null;
  logoUrl?: string | null;
  patient: { patientUid: string; firstName: string; lastName: string; gender: string; ageYears: number };
  order: { id: string; isUrgent: boolean };
  rows: ReportSheetRow[];
  signatureStamp: string | null;
  verificationCode: string;
  /** The QR element (pseudo for the approval preview, real for the report). */
  qr: ReactNode;
  /** Status banner under the signature block (e.g. "Ready for Report" / "Report issued …"). */
  footer: ReactNode;
  /** Optional line under the letterhead, e.g. the report issue date. */
  reportDate?: string | null;
}

const GENDER_SHORT: Record<string, string> = { male: 'M', female: 'F', other: 'Other' };

/**
 * The A4 report sheet — ONE layout shared by Stage 5's approval preview and
 * Stage 6's final report, so the printed report is exactly what the
 * pathologist reviewed during approval. Rendered at TRUE A4 proportions
 * (794×1123 px @96dpi, i.e. 210×297 mm) with print-correct typography; the
 * approval preview embeds a scaled copy (transform: scale) rather than a
 * second layout. `report-sheet` is the print hook (see index.css).
 *
 * Row rendering follows the approval lock-in rule: approved rows show their
 * value (+ ✓), verified rows show "…" (pending approval), everything else a
 * dash.
 */
export function ReportSheet({ data }: { data: ReportSheetData }) {
  return (
    <div className="report-sheet flex min-h-[1123px] w-[794px] flex-col bg-white px-10 py-8 text-slate-800 shadow-xl ring-1 ring-slate-200">
      {/* Letterhead */}
      <div className="border-b-2 border-slate-800 pb-3 text-center">
        {data.logoUrl && (
          <div className="mb-2">
            <img src={data.logoUrl} alt="Lab logo" className="mx-auto h-14 w-auto object-contain" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
          </div>
        )}
        <div className="text-2xl font-bold leading-tight tracking-tight">{data.labName}</div>
        <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.3em] text-slate-500">Pathology Laboratory</div>
        {data.nablAccreditationNumber && (
          <div className="mt-1 text-[10px] font-medium text-slate-500">NABL Accredited · {data.nablAccreditationNumber}</div>
        )}
        {(data.labAddress || data.labPhone || data.labEmail) && (
          <div className="mt-1 text-[10px] text-slate-500">
            {data.labAddress && <span>{data.labAddress}</span>}
            {data.labAddress && (data.labPhone || data.labEmail) && <span> · </span>}
            {data.labPhone && <span>{data.labPhone}</span>}
            {data.labPhone && data.labEmail && <span> · </span>}
            {data.labEmail && <span>{data.labEmail}</span>}
          </div>
        )}
      </div>

      {data.reportDate && (
        <div className="mt-2 text-center text-[11px] font-medium text-slate-500">
          Report issued {data.reportDate}
        </div>
      )}

      {/* Patient / order header */}
      <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 text-[12px] leading-snug">
        <div>
          Patient: <span className="font-semibold">{data.patient.firstName} {data.patient.lastName}</span>
        </div>
        <div>
          UID: <span className="font-mono font-semibold">{data.patient.patientUid}</span>
        </div>
        <div>
          Age / Sex: <span className="font-semibold">{data.patient.ageYears} y · {GENDER_SHORT[data.patient.gender] ?? '—'}</span>
        </div>
        <div>
          Order: <span className="font-mono font-semibold">{data.order.id.slice(0, 8).toUpperCase()}</span>
          {data.order.isUrgent && <span className="ml-2 rounded bg-rose-100 px-1.5 py-0.5 text-[10px] font-bold text-rose-700">URGENT</span>}
        </div>
      </div>

      {/* Results table */}
      <table className="mt-5 w-full border-collapse text-[12px]">
        <thead>
          <tr className="border-y-2 border-slate-700 text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="py-1.5 pr-3 font-semibold">Test</th>
            <th className="py-1.5 pr-3 font-semibold">Result</th>
            <th className="py-1.5 pr-3 font-semibold">Unit</th>
            <th className="py-1.5 font-semibold">Ref Range</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => {
            const approved = r.status === 'approved';
            return (
              <tr key={r.id} className="border-b border-slate-200">
                <td className="py-1.5 pr-3">
                  <span className="font-medium">{r.testNameSnapshot}</span>
                  {approved && <span className="ml-1 text-emerald-700">✓</span>}
                </td>
                <td className="py-1.5 pr-3 font-mono font-semibold">
                  {approved ? (r.resultValue ?? '—') : <span className="text-slate-400">{r.status === 'verified' ? '…' : '—'}</span>}
                </td>
                <td className="py-1.5 pr-3 text-slate-600">{r.unit ?? '—'}</td>
                <td className="py-1.5 font-mono text-slate-600">
                  {r.resultType === 'numeric' && r.refLow != null && r.refHigh != null ? `${r.refLow}–${r.refHigh}` : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* Footer: signature block + QR */}
      <div className="mt-auto pt-8">
        <div className="flex items-end justify-between gap-6">
          <div className="min-w-0 flex-1">
            <div className="border-t-2 border-slate-700 pt-2">
              <div className="text-[13px] font-semibold">Dr. Pathologist</div>
              <div className="mt-0.5 truncate text-[10px] text-slate-500">
                {data.signatureStamp ? `Signature on file · stamp ${data.signatureStamp}` : 'Awaiting approval signature'}
              </div>
            </div>
          </div>
          <div className="shrink-0 text-right">
            {data.qr}
            <div className="mt-1.5 font-mono text-[9px] font-semibold tracking-tight text-slate-600">{data.verificationCode}</div>
          </div>
        </div>

        <div className="mt-4">{data.footer}</div>
      </div>
    </div>
  );
}

/**
 * The scaled preview wrapper used by the approval workspace: renders the
 * true-size sheet at 58% (≈ the old 460px-wide preview) inside a fixed box.
 * No second layout — the printed report is exactly what was previewed.
 */
export function ScaledSheet({ data }: { data: ReportSheetData }) {
  return (
    <div className="w-[461px] overflow-hidden rounded-lg bg-slate-100 p-3 shadow-inner">
      <div className="h-[640px] overflow-hidden">
        <div style={{ width: 794, transform: 'scale(0.58)', transformOrigin: 'top left' }}>
          <ReportSheet data={data} />
        </div>
      </div>
    </div>
  );
}
