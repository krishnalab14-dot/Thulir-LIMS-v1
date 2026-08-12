import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { flagResult, normalOptionFor, FlagRow } from './result-flags';

const numericRow: FlagRow = {
  resultType: 'numeric',
  refLow: 70,
  refHigh: 99,
  criticalLow: 40,
  criticalHigh: 400,
  abnormalOptions: [],
};

describe('flagResult (display-only; server remains source of truth)', () => {
  it('numeric normal value → normal', () => {
    assert.equal(flagResult(numericRow, '92').kind, 'normal');
    assert.equal(flagResult(numericRow, '70').kind, 'normal'); // bounds inclusive
    assert.equal(flagResult(numericRow, '99').kind, 'normal');
  });

  it('numeric outside the reference range → abnormal with (H)/(L) indicator', () => {
    const high = flagResult(numericRow, '140');
    assert.equal(high.kind, 'abnormal');
    assert.equal(high.direction, 'H');
    const low = flagResult(numericRow, '55');
    assert.equal(low.kind, 'abnormal');
    assert.equal(low.direction, 'L');
  });

  it('numeric past critical thresholds → critical with the inline warning', () => {
    const low = flagResult(numericRow, '30');
    assert.equal(low.kind, 'critical');
    assert.equal(low.direction, 'L');
    assert.equal(low.warning, 'Critical value — please verify.');
    const high = flagResult(numericRow, '500');
    assert.equal(high.kind, 'critical');
    assert.equal(high.direction, 'H');
  });

  it('critical beats abnormal when both apply', () => {
    // 10 is below criticalLow 40 — critical, not abnormal.
    assert.equal(flagResult(numericRow, '10').kind, 'critical');
  });

  it('tests with no critical thresholds only ever flag abnormal (not critical)', () => {
    const row = { ...numericRow, criticalLow: null, criticalHigh: null };
    assert.equal(flagResult(row, '30').kind, 'abnormal');
  });

  it('options → abnormal only when the chosen option is in abnormalOptions', () => {
    const row: FlagRow = { resultType: 'options', refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, abnormalOptions: ['B+'] };
    assert.equal(flagResult(row, 'B+').kind, 'abnormal');
    assert.equal(flagResult(row, 'A+').kind, 'normal');
  });

  it('text is never flagged', () => {
    const row: FlagRow = { resultType: 'text', refLow: null, refHigh: null, criticalLow: null, criticalHigh: null, abnormalOptions: [] };
    assert.equal(flagResult(row, 'Occasional pus cells').kind, 'normal');
  });

  it('empty value → empty (not yet entered), invalid numeric → invalid', () => {
    assert.equal(flagResult(numericRow, '').kind, 'empty');
    assert.equal(flagResult(numericRow, 'abc').kind, 'invalid');
  });

  it('normalOptionFor fills options with the first non-abnormal option, never numeric/text', () => {
    const opts: FlagRow & { resultOptions: string[] } = {
      ...numericRow,
      resultType: 'options',
      resultOptions: ['A+', 'A-', 'B+'],
      abnormalOptions: ['B+'],
    };
    assert.equal(normalOptionFor(opts), 'A+');
    const allAbnormal = { ...opts, abnormalOptions: ['A+', 'A-', 'B+'] };
    assert.equal(normalOptionFor(allAbnormal), null); // no normal option → leave unentered
    assert.equal(normalOptionFor({ ...numericRow, resultType: 'numeric', resultOptions: [] }), null);
    assert.equal(normalOptionFor({ ...numericRow, resultType: 'text', resultOptions: [] }), null);
  });
});
