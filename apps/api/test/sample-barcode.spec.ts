import { buildSampleBarcode, deriveSampleTypeCode, nextRecollectionBarcode } from '../src/samples/sample-barcode.util';

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
});
