/**
 * Display-only flag computation for the Result Entry grid (§3 "Real-time
 * visual flagging"). The server's validation in PUT /results remains the
 * source of truth — these helpers only decide how a value is STYLED on blur:
 *   numeric → normal / abnormal (outside snapshottedRefLow-High) / critical
 *             (past snapshottedCriticalLow/High, only when those are set)
 *   options → abnormal when the chosen option is in abnormalOptions
 *   text    → never flagged
 */

export type ResultFlagKind = 'empty' | 'normal' | 'abnormal' | 'critical' | 'invalid';

export interface ResultFlag {
  kind: ResultFlagKind;
  /** (H) high / (L) low indicator for numeric abnormalities. */
  direction?: 'H' | 'L';
  /** Inline warning shown for critical values. */
  warning?: string;
}

export interface FlagRow {
  resultType: 'numeric' | 'options' | 'text';
  refLow: number | null;
  refHigh: number | null;
  criticalLow: number | null;
  criticalHigh: number | null;
  abnormalOptions: string[];
}

export function flagResult(row: FlagRow, rawValue: string): ResultFlag {
  const value = rawValue.trim();
  if (value === '') {
    return { kind: 'empty' };
  }

  if (row.resultType === 'numeric') {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      return { kind: 'invalid' };
    }
    if (row.criticalLow != null && n < row.criticalLow) {
      return { kind: 'critical', direction: 'L', warning: 'Critical value — please verify.' };
    }
    if (row.criticalHigh != null && n > row.criticalHigh) {
      return { kind: 'critical', direction: 'H', warning: 'Critical value — please verify.' };
    }
    if (row.refLow != null && n < row.refLow) {
      return { kind: 'abnormal', direction: 'L' };
    }
    if (row.refHigh != null && n > row.refHigh) {
      return { kind: 'abnormal', direction: 'H' };
    }
    return { kind: 'normal' };
  }

  if (row.resultType === 'options') {
    return row.abnormalOptions.includes(value) ? { kind: 'abnormal' } : { kind: 'normal' };
  }

  return { kind: 'normal' }; // text — no flagging
}

/**
 * The value "Mark All Normal" writes for an unentered options-type field:
 * the first option NOT marked abnormal. Returns null for non-options tests
 * — numeric and text fields are never auto-filled (no value is guessed).
 */
export function normalOptionFor(row: FlagRow & { resultOptions: string[] }): string | null {
  if (row.resultType !== 'options') {
    return null;
  }
  const abnormal = new Set(row.abnormalOptions);
  return row.resultOptions.find((o) => !abnormal.has(o)) ?? null;
}
