import { ResultType } from '@prisma/client';
import { validateResultValue } from '../src/results/result-value.util';

describe('validateResultValue (§2.2 — against snapshots, never live MasterTest)', () => {
  const numeric = { snapshottedResultType: ResultType.numeric, snapshottedResultOptions: null };
  const options = { snapshottedResultType: ResultType.options, snapshottedResultOptions: ['A+', 'A-', 'B+'] };
  const text = { snapshottedResultType: ResultType.text, snapshottedResultOptions: null };

  it('accepts any parseable number for numeric', () => {
    expect(validateResultValue(numeric, '12')).toBeNull();
    expect(validateResultValue(numeric, '12.5')).toBeNull();
    expect(validateResultValue(numeric, '-5')).toBeNull();
    expect(validateResultValue(numeric, '1e2')).toBeNull();
    expect(validateResultValue(numeric, ' 42 ')).toBeNull();
  });

  it('rejects non-numeric input server-side (never trusts the frontend input type)', () => {
    expect(validateResultValue(numeric, 'abc')).toContain('valid number');
    expect(validateResultValue(numeric, '12.5.3')).toContain('valid number');
    expect(validateResultValue(numeric, 'Infinity')).toContain('valid number');
    expect(validateResultValue(numeric, 'NaN')).toContain('valid number');
  });

  it('accepts only exact members of snapshottedResultOptions for options', () => {
    expect(validateResultValue(options, 'A+')).toBeNull();
    expect(validateResultValue(options, 'A-')).toBeNull();
    expect(validateResultValue(options, 'AB+')).toContain('A+, A-, B+'); // not in list
    expect(validateResultValue(options, 'a+')).toContain('A+, A-, B+'); // case-sensitive
  });

  it('accepts any non-empty string for text', () => {
    expect(validateResultValue(text, 'Occasional RBCs seen')).toBeNull();
    expect(validateResultValue(text, 'x')).toBeNull();
  });

  it('treats empty string as "not yet entered" for every type (valid, clears)', () => {
    expect(validateResultValue(numeric, '')).toBeNull();
    expect(validateResultValue(options, '')).toBeNull();
    expect(validateResultValue(text, '')).toBeNull();
  });

  it('defaults a null snapshottedResultType to numeric (pre-2.5 rows)', () => {
    expect(validateResultValue({ snapshottedResultType: null, snapshottedResultOptions: null }, '5')).toBeNull();
    expect(validateResultValue({ snapshottedResultType: null, snapshottedResultOptions: null }, 'nope')).toContain('valid number');
  });
});
