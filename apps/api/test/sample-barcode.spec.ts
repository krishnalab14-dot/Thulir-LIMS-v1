import {
  buildDedicatedSampleBarcode,
  buildSampleBarcode,
  deriveSampleTypeCode,
  nextRecollectionBarcode,
} from '../src/samples/sample-barcode.util';

describe('sample barcode util', () => {
  it('builds deterministic order-scoped barcodes from the FULL order id + sample type code', () => {
    expect(buildSampleBarcode('cm5abcdef1234567890', 'EDTA', 'EDTA Blood')).toBe('CM5ABCDEF1234567890-EDTA');
    expect(buildSampleBarcode('cm5abcdef1234567890', 'ser', 'Serum')).toBe('CM5ABCDEF1234567890-SER');
  });

  it('derives a short code from the name when the sample type has no explicit code', () => {
    expect(deriveSampleTypeCode('Urine Routine & Microscopy', null)).toBe('URIN');
    expect(deriveSampleTypeCode('Whole Blood', undefined)).toBe('WHOL');
    expect(buildSampleBarcode('cm5x', null, 'Urine')).toBe('CM5X-URIN');
  });

  it('increments the recollection suffix per rejection of the same logical sample', () => {
    expect(nextRecollectionBarcode('CM5ABCDE-EDTA')).toBe('CM5ABCDE-EDTA-R2');
    expect(nextRecollectionBarcode('CM5ABCDE-EDTA-R2')).toBe('CM5ABCDE-EDTA-R3');
    expect(nextRecollectionBarcode('CM5ABCDE-EDTA-R9')).toBe('CM5ABCDE-EDTA-R10');
  });

  it('different orders always produce different barcodes for the same tube type', () => {
    const a = buildSampleBarcode('cm5aaaaaaaaaaaaaaaa', 'EDTA', 'EDTA Blood');
    const b = buildSampleBarcode('cm5bbbbbbbbbbbbbbbb', 'EDTA', 'EDTA Blood');
    expect(a).not.toBe(b);
  });

  it('dedicated barcodes append the FULL test id and stay distinct from shared barcodes', () => {
    const orderId = 'cm5abcdef1234567890';
    const t1 = 'cm5t111111111111111';
    const t2 = 'cm5t222222222222222';
    // Format: <ORDER-ID>-<CODE>-<TEST-ID>
    expect(buildDedicatedSampleBarcode(orderId, 'EDTA', 'EDTA Blood', t1)).toBe(
      `CM5ABCDEF1234567890-EDTA-${t1.toUpperCase()}`,
    );
    // Two dedicated tests of the same type on the same order never collide.
    const a = buildDedicatedSampleBarcode(orderId, 'EDTA', 'EDTA Blood', t1);
    const b = buildDedicatedSampleBarcode(orderId, 'EDTA', 'EDTA Blood', t2);
    expect(a).not.toBe(b);
    // And neither collides with the shared sample of that type on the same order.
    const shared = buildSampleBarcode(orderId, 'EDTA', 'EDTA Blood');
    expect(new Set([a, b, shared]).size).toBe(3);
  });

  it('recollection of a dedicated sample increments the suffix after the test id (-R2, -R3…)', () => {
    const base = buildDedicatedSampleBarcode('cm5abcdef1234567890', 'EDTA', 'EDTA Blood', 'cm5t111111111111111');
    expect(nextRecollectionBarcode(base)).toBe(`${base}-R2`);
    expect(nextRecollectionBarcode(`${base}-R2`)).toBe(`${base}-R3`);
  });

  it('dedicated barcodes with a shared order prefix still differ (full test id, not a truncated slice)', () => {
    // Two tests whose test ids share a cuid timestamp prefix.
    const tA = 'cm5sameprefixaaaaaaaaa';
    const tB = 'cm5sameprefixbbbbbbbbb';
    const a = buildDedicatedSampleBarcode('cm5order', 'SER', 'Serum', tA);
    const b = buildDedicatedSampleBarcode('cm5order', 'SER', 'Serum', tB);
    expect(a).not.toBe(b);
  });
});
