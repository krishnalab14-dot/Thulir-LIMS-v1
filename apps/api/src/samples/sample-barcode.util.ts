/**
 * Deterministic sample barcode generation — no counter, no race risk.
 *
 * Barcodes are derived from data already known inside the order-creation
 * transaction: `<order.id, uppercased>-<sampleType.code>`. The FULL order id
 * is used, not a truncated prefix — cuid v2's first 8 characters encode the
 * creation timestamp, so same-millisecond orders share that prefix and a
 * truncated barcode collides (this was caught by the real-DB concurrency
 * test: 3 of 20 parallel orders 500'd on the barcodeValue unique constraint).
 * The full id is unique by construction, so barcodes are unique by
 * construction (the DB unique constraint remains as the safety net).
 *
 * On rejection a recollection is auto-created with a suffix that increments
 * per rejection of that same logical sample: `-R2`, `-R3`, … (the original is
 * the implicit R1).
 */
export function deriveSampleTypeCode(name: string | null | undefined, code?: string | null): string {
  if (code?.trim()) {
    return code.trim().toUpperCase();
  }
  // Fallback when a SampleType has no explicit code: first 4 alphanumerics.
  const cleaned = (name ?? '').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
  return cleaned || 'SAMP';
}

/** e.g. order `cm5abcdefg…` + code `EDTA` → `CM5ABCDEFG…-EDTA`. */
export function buildSampleBarcode(orderId: string, sampleTypeCode: string | null | undefined, sampleTypeName?: string | null): string {
  const code = deriveSampleTypeCode(sampleTypeName, sampleTypeCode);
  return `${orderId.toUpperCase()}-${code}`;
}

/**
 * Dedicated-sample variant (Stage 2.1): appends the FULL test id so two tests
 * of the same sample type on the same order always get distinct barcodes.
 * The full id is used (never a truncated slice) for the same reason as the
 * order id: cuid v2's leading characters are timestamp-derived, so truncating
 * would reintroduce the same-millisecond collision the concurrency test caught.
 * e.g. order `cm5a…` + code `EDTA` + test `cm5t…` → `CM5A…-EDTA-CM5T…`.
 */
export function buildDedicatedSampleBarcode(
  orderId: string,
  sampleTypeCode: string | null | undefined,
  sampleTypeName: string | null | undefined,
  testId: string,
): string {
  const code = deriveSampleTypeCode(sampleTypeName, sampleTypeCode);
  return `${orderId.toUpperCase()}-${code}-${testId.toUpperCase()}`;
}

/** `ABC-EDTA` → `ABC-EDTA-R2`; `ABC-EDTA-R2` → `ABC-EDTA-R3`. */
export function nextRecollectionBarcode(currentBarcode: string): string {
  const match = /^(.*)-R(\d+)$/.exec(currentBarcode);
  if (match) {
    return `${match[1]}-R${Number(match[2]) + 1}`;
  }
  return `${currentBarcode}-R2`;
}
