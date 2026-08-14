import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

/**
 * A REAL, scannable QR code — client-side encode only (the `qrcode` package
 * is a pure encode operation, no service involved). Used on the final report
 * to encode the public verification URL; the Stage 5 approval preview keeps
 * the deterministic pseudo-QR until the report is actually issued.
 */
export function RealQr({ url, size = 120, className }: { url: string; size?: number; className?: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setFailed(false);
    setDataUrl(null);
    QRCode.toDataURL(url, { margin: 1, width: size, errorCorrectionLevel: 'M' })
      .then((data) => {
        if (!cancelled) setDataUrl(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url, size]);

  if (failed) {
    return (
      <div className={`flex items-center justify-center border border-slate-300 bg-slate-50 font-mono text-[9px] text-slate-500 ${className ?? ''}`}>
        QR unavailable
      </div>
    );
  }
  if (!dataUrl) {
    return <div className={`animate-pulse bg-slate-100 ${className ?? ''}`} aria-label="Generating QR code" />;
  }
  return <img src={dataUrl} alt={`Verify this report: ${url}`} className={className ?? ''} />;
}
