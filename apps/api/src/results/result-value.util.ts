import { ResultType } from '@prisma/client';

/** The snapshot fields Result Entry validates against — never a live MasterTest lookup. */
export interface ResultSnapshotLike {
  snapshottedResultType: ResultType | null;
  snapshottedResultOptions: unknown; // Json — a string[] for options-type tests
}

/**
 * Validates a raw result value against the test's OWN snapshotted result
 * type (§2.2) — never against a live MasterTest lookup. Returns null when
 * valid, or a human-readable error message naming the constraint.
 *
 * Empty string is treated as "not yet entered" for EVERY type: it is valid
 * and clears the result (the caller reverts the row to pending rather than
 * advancing status — an empty text field must never count as entered).
 */
export function validateResultValue(row: ResultSnapshotLike, raw: string): string | null {
  if (raw === '') {
    return null; // clear semantics — valid for every type
  }
  const type = row.snapshottedResultType ?? ResultType.numeric;

  if (type === ResultType.numeric) {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return `must be a valid number (got "${raw}")`;
    }
    return null;
  }

  if (type === ResultType.options) {
    const options = Array.isArray(row.snapshottedResultOptions) ? (row.snapshottedResultOptions as string[]) : [];
    if (!options.includes(raw)) {
      return `must be one of the defined options (${options.join(', ') || 'none defined'})`;
    }
    return null;
  }

  return null; // text — any non-empty string is valid
}
