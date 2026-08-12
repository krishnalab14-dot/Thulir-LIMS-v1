import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  packageAddConfirmMessage,
  packageSwapConfirmMessage,
  packagesCoveringTest,
  packagesOverlappingPackage,
  removeCoveredStandaloneTests,
  removeOverlappingPackages,
  testCoveredBlockMessage,
  testsOverlappingPackage,
} from './order-overlap';
import type { PackageOverlap, PackageRef, SelectedTest } from './order-overlap';

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

  // --- rule 3: package-vs-package overlap (Stage 1 follow-up 2) ---

  const kidney: PackageRef = {
    id: 'pkg_kidney',
    name: 'Kidney Panel',
    items: [
      { testId: 't_creat', testName: 'Creatinine' },
      { testId: 't_gluc', testName: 'Glucose' },
    ],
  };
  const lft: PackageRef = {
    id: 'pkg_lft',
    name: 'LFT',
    items: [
      { testId: 't_alt', testName: 'ALT' },
      { testId: 't_ast', testName: 'AST' },
    ],
  };

  it('blocked package add: detects an existing package overlapping the incoming package', () => {
    const overlaps = packagesOverlappingPackage(kidney, [rft]);
    assert.deepEqual(overlaps, [{ existing: rft, overlappingTestIds: ['t_creat'] }]);
  });

  it('blocked package add: no false positive for disjoint packages', () => {
    assert.deepEqual(packagesOverlappingPackage(kidney, [lft]), []);
  });

  it('blocked package add: every overlapping existing package is reported', () => {
    const lipid: PackageRef = { id: 'pkg_lipid', name: 'Lipid', items: [{ testId: 't_gluc', testName: 'Glucose' }] };
    const overlaps = packagesOverlappingPackage(kidney, [rft, lipid]);
    assert.deepEqual(overlaps, [
      { existing: rft, overlappingTestIds: ['t_creat'] },
      { existing: lipid, overlappingTestIds: ['t_gluc'] },
    ]);
  });

  it('swap-resolution removes every overlapping existing package and keeps the rest', () => {
    const { remaining, removed } = removeOverlappingPackages(kidney, [rft, lft]);
    assert.deepEqual(removed, [rft]);
    assert.deepEqual(remaining, [lft]);
  });

  it('swap-resolution with no overlap removes nothing', () => {
    const { remaining, removed } = removeOverlappingPackages(kidney, [lft]);
    assert.deepEqual(remaining, [lft]);
    assert.deepEqual(removed, []);
  });

  it('swap message names the shared test, the covering package, and the incoming package', () => {
    const overlaps: PackageOverlap[] = [{ existing: rft, overlappingTestIds: ['t_creat'] }];
    assert.equal(
      packageSwapConfirmMessage(kidney, overlaps),
      'Creatinine is already included in "RFT" (already added to this order). Remove "RFT" first if you want to add "Kidney Panel" instead.',
    );
  });

  it('swap message names every shared test and every covering package', () => {
    const overlaps: PackageOverlap[] = [
      { existing: rft, overlappingTestIds: ['t_creat'] },
      { existing: { id: 'pkg_lipid', name: 'Lipid', items: [{ testId: 't_gluc', testName: 'Glucose' }] }, overlappingTestIds: ['t_gluc'] },
    ];
    assert.equal(
      packageSwapConfirmMessage(kidney, overlaps),
      'Creatinine, Glucose are already included in "RFT" and "Lipid" (already added to this order). Remove those packages first if you want to add "Kidney Panel" instead.',
    );
  });
});
