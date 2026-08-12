import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  packageAddConfirmMessage,
  packagesCoveringTest,
  removeCoveredStandaloneTests,
  testCoveredBlockMessage,
  testsOverlappingPackage,
} from './order-overlap';
import type { PackageRef, SelectedTest } from './order-overlap';

const urea: SelectedTest = { id: 't_urea', name: 'Urea' };
const creat: SelectedTest = { id: 't_creat', name: 'Creatinine' };
const cbc: SelectedTest = { id: 't_cbc', name: 'CBC' };

const rft: PackageRef = {
  id: 'pkg_rft',
  name: 'RFT',
  items: [
    { testId: 't_urea', testName: 'Urea' },
    { testId: 't_creat', testName: 'Creatinine' },
  ],
};

describe('order overlap prevention (frontend rules)', () => {
  it('blocked package add: detects the overlapping standalone tests (Urea standalone → add RFT)', () => {
    const overlap = testsOverlappingPackage(rft, [urea, cbc]);
    assert.deepEqual(overlap, [urea]);
  });

  it('blocked package add: detects every overlapping standalone test', () => {
    const overlap = testsOverlappingPackage(rft, [urea, creat, cbc]);
    assert.deepEqual(overlap, [urea, creat]);
  });

  it('no false positive: disjoint standalone tests and package items', () => {
    assert.deepEqual(testsOverlappingPackage(rft, [cbc]), []);
  });

  it('confirm-resolution removes the covered standalone item and keeps the rest', () => {
    const { remaining, removed } = removeCoveredStandaloneTests(rft, [urea, cbc]);
    assert.deepEqual(removed, [urea]);
    assert.deepEqual(remaining, [cbc]);
  });

  it('confirm-resolution removes every covered test and preserves line order', () => {
    const { remaining, removed } = removeCoveredStandaloneTests(rft, [cbc, urea, creat]);
    assert.deepEqual(remaining, [cbc]);
    assert.deepEqual(removed, [urea, creat]);
  });

  it('confirm-resolution with no overlap removes nothing', () => {
    const { remaining, removed } = removeCoveredStandaloneTests(rft, [cbc]);
    assert.deepEqual(remaining, [cbc]);
    assert.deepEqual(removed, []);
  });

  it('blocked standalone add: the selected package covering the test is reported (RFT selected → add Urea)', () => {
    const covering = packagesCoveringTest('t_urea', [rft]);
    assert.deepEqual(covering, [rft]);
  });

  it('blocked standalone add: every covering package is reported', () => {
    const renal: PackageRef = { id: 'pkg_rp', name: 'Renal Profile', items: [{ testId: 't_urea', testName: 'Urea' }] };
    assert.deepEqual(packagesCoveringTest('t_urea', [rft, renal]), [rft, renal]);
  });

  it('blocked standalone add: no covering package → not blocked', () => {
    assert.deepEqual(packagesCoveringTest('t_cbc', [rft]), []);
  });

  it('confirm message names the tests and the package', () => {
    assert.equal(
      packageAddConfirmMessage([urea], 'RFT'),
      'Urea is already added individually. Adding this package will remove the standalone item and price it as part of "RFT" instead.',
    );
    assert.equal(
      packageAddConfirmMessage([urea, creat], 'RFT'),
      'Urea, Creatinine are already added individually. Adding this package will remove the standalone items and price them as part of "RFT" instead.',
    );
  });

  it('block message names the test and the covering package', () => {
    assert.equal(testCoveredBlockMessage('Urea', [rft]), 'Urea is already included in the "RFT" package you\'ve added.');
  });
});
