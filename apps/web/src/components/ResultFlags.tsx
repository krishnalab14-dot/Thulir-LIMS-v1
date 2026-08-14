import type { ResultFlag } from '../lib/result-flags';

/** Inline abnormal/critical note under a flagged value — shared by Result
 *  Entry and the Review workspace (display-only, per Stage 3 scope). */
export function FlagNote({ flag }: { flag: ResultFlag | undefined }) {
  if (!flag) return null;
  if (flag.kind === 'critical') {
    return <p className="mt-1 text-[11px] font-semibold text-rose-700">⚠ {flag.warning}</p>;
  }
  if (flag.kind === 'abnormal') {
    return <p className="mt-1 text-[11px] font-semibold text-amber-700">Abnormal{flag.direction ? ` (${flag.direction})` : ''}</p>;
  }
  return null;
}
