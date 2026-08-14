import { createHash } from 'node:crypto';

/**
 * Deterministic recorded-event reference for one approval: sha256 of
 * orderTestId + actor + timestamp + the signature reference, truncated to a
 * readable stamp. Enough to prove "this specific approval event happened" for
 * Report rendering and audit purposes — NOT a legal e-signature.
 */
export function signatureStamp(orderTestId: string, approvedBy: string, approvedAt: Date): string {
  return createHash('sha256')
    .update(`${orderTestId}|${approvedBy}|${approvedAt.toISOString()}|THULIR-v2-signature-ref`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
}

/**
 * The order's PUBLIC verification code (printed on the report, encoded in the
 * QR): `THU-VR-<first 8 chars of the order id, uppercased>-<4-hex sha1
 * checksum of the full id>`. Deterministic (same order → same code, forever)
 * and resolvable back to the order id from the code alone: the prefix narrows
 * to candidate ids and the checksum disambiguates exactly. The QR on the
 * report encodes a URL carrying this code, and the public verification
 * endpoint accepts it as the "order number" — no database-backed code table
 * needed.
 */
export const VERIFICATION_CODE_RE = /^THU-VR-([0-9A-Z]{8})-([0-9A-F]{4})$/;

export function verificationCode(orderId: string): string {
  const prefix = orderId.slice(0, 8).toUpperCase();
  const check = createHash('sha1').update(orderId).digest('hex').slice(0, 4).toUpperCase();
  return `THU-VR-${prefix}-${check}`;
}

/**
 * Resolves a verification code back to the order id, or null if the code is
 * malformed or its checksum matches no candidate. The 8-char prefix is the
 * uppercased start of the (lowercase) cuid, so the lookup lowercases it and
 * matches by prefix; the recomputed checksum then picks the exact id. A
 * malformed or unknown code resolves to null — callers treat that identically
 * to any other "not found" case.
 */
export function orderIdFromVerificationCode(
  code: string,
  candidates: Array<{ id: string }>,
): string | null {
  const match = VERIFICATION_CODE_RE.exec(code.trim());
  if (!match) {
    return null;
  }
  const prefix = match[1].toLowerCase();
  return candidates.find((c) => c.id.startsWith(prefix) && verificationCode(c.id) === code)?.id ?? null;
}
