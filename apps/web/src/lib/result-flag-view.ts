import type { ResultFlag } from './result-flags';

/**
 * Cell styling per flag kind (applied on blur, not per keystroke) — the
 * EXACT treatment shared by Result Entry's inputs (Stage 3) and the Stage 4
 * Review workspace's read-only value cells, so the two screens never drift
 * apart visually. Pure helper (no JSX) so it lives outside the component
 * files that consume it.
 */
export function flagCellClasses(flag: ResultFlag | undefined, focused: boolean): string {
  const base = 'w-full rounded-md border px-2 py-1.5 text-[13px] font-mono outline-none transition focus:ring-2 focus:ring-brand-500';
  if (focused) return `${base} border-brand-300 bg-white focus:ring-brand-500`;
  switch (flag?.kind) {
    case 'critical':
      return `${base} border-rose-400 bg-rose-100 font-bold text-rose-800`;
    case 'abnormal':
      return `${base} border-amber-300 bg-amber-50 font-bold text-amber-700`;
    case 'invalid':
      return `${base} border-rose-400 bg-rose-50 text-rose-700`;
    default:
      return `${base} border-slate-200 bg-white text-slate-800`;
  }
}
