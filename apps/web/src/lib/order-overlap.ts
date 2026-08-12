/**
 * Overlap prevention for the order screen: a test must never be billed BOTH
 * standalone and inside a package (that would double-bill it). The UI rules:
 *
 *  1. Adding a package whose constituents overlap already-selected standalone
 *     tests → blocked with an explicit confirm that removes the standalone
 *     item(s) ("Add package & remove duplicate(s)") or cancels. Never merged
 *     silently — this is a visible billing change.
 *  2. Adding a standalone test already covered by a selected package → blocked
 *     outright (nothing valid to confirm — the test is already on the order).
 *  3. Adding a package whose constituents overlap another already-selected
 *     package → blocked with an explicit swap ("Remove [Package A] & add
 *     [Package B]") or cancel. No partial merge — the overlapping test is
 *     embedded inside two independently-priced bundles, so there is no safe
 *     way to remove just that test from either package.
 *
 * These are pure helpers so the rules are unit-testable without a DOM; the
 * OrderBillingStep component wires them into the add flows. The server also
 * rejects overlapping payloads in POST /api/orders — this UI is the friendly
 * layer, not the source of truth.
 */

export interface SelectedTest {
  id: string;
  name: string;
}

export interface PackageRef {
  id: string;
  name: string;
  items: { testId: string; testName: string }[];
}

/** Packages in the current list whose constituents include `testId`. */
export function packagesCoveringTest(testId: string, packages: PackageRef[]): PackageRef[] {
  return packages.filter((p) => p.items.some((i) => i.testId === testId));
}

/** Standalone tests in the current list that the package's constituents include. */
export function testsOverlappingPackage(pkg: PackageRef, tests: SelectedTest[]): SelectedTest[] {
  const inPackage = new Set(pkg.items.map((i) => i.testId));
  return tests.filter((t) => inPackage.has(t.id));
}

/**
 * The confirm-resolution for rule 1: drop the standalone tests covered by the
 * package and keep everything else (in order). The caller then appends the
 * package line item, so the package price applies as normal.
 */
export function removeCoveredStandaloneTests(pkg: PackageRef, tests: SelectedTest[]): {
  remaining: SelectedTest[];
  removed: SelectedTest[];
} {
  const inPackage = new Set(pkg.items.map((i) => i.testId));
  return {
    remaining: tests.filter((t) => !inPackage.has(t.id)),
    removed: tests.filter((t) => inPackage.has(t.id)),
  };
}

/** Rule-1 message shown alongside the confirm action. */
export function packageAddConfirmMessage(overlap: SelectedTest[], packageName: string): string {
  const names = overlap.map((t) => t.name).join(', ');
  const plural = overlap.length !== 1;
  return `${names} ${plural ? 'are' : 'is'} already added individually. Adding this package will remove ${
    plural ? 'the standalone items' : 'the standalone item'
  } and price ${plural ? 'them' : 'it'} as part of "${packageName}" instead.`;
}

/** Rule-2 message shown when a standalone add is blocked. */
export function testCoveredBlockMessage(testName: string, packages: PackageRef[]): string {
  const names = packages.map((p) => `"${p.name}"`).join(' and ');
  return `${testName} is already included in the ${names} package${packages.length === 1 ? '' : 's'} you've added.`;
}

/** An existing selected package that conflicts with an incoming package, plus
 *  the constituent test ids they share. */
export interface PackageOverlap {
  existing: PackageRef;
  overlappingTestIds: string[];
}

/**
 * Rule-3 detection: every already-selected package whose constituents overlap
 * the incoming package's constituents (RFT added, then Kidney Panel sharing
 * Creatinine → reports RFT with the shared test). The incoming package itself
 * is never reported.
 */
export function packagesOverlappingPackage(incoming: PackageRef, packages: PackageRef[]): PackageOverlap[] {
  const incomingIds = new Set(incoming.items.map((i) => i.testId));
  const result: PackageOverlap[] = [];
  for (const p of packages) {
    if (p.id === incoming.id) continue;
    const overlappingTestIds = p.items.filter((i) => incomingIds.has(i.testId)).map((i) => i.testId);
    if (overlappingTestIds.length > 0) {
      result.push({ existing: p, overlappingTestIds });
    }
  }
  return result;
}

/**
 * Rule-3 swap resolution: drop every existing package that overlaps the
 * incoming package (their full linkage goes with them — the swap replaces the
 * old bundle, never merges into it) and keep the rest, in order.
 */
export function removeOverlappingPackages(
  incoming: PackageRef,
  packages: PackageRef[],
): { remaining: PackageRef[]; removed: PackageRef[] } {
  const incomingIds = new Set(incoming.items.map((i) => i.testId));
  return {
    remaining: packages.filter((p) => !p.items.some((i) => incomingIds.has(i.testId))),
    removed: packages.filter((p) => p.items.some((i) => incomingIds.has(i.testId))),
  };
}

/** Rule-3 message shown alongside the swap action. */
export function packageSwapConfirmMessage(incoming: PackageRef, overlaps: PackageOverlap[]): string {
  const testNames = [
    ...new Set(
      overlaps.flatMap((o) => o.overlappingTestIds.map((id) => incoming.items.find((i) => i.testId === id)?.testName ?? id)),
    ),
  ];
  const testPlural = testNames.length !== 1;
  const pkgNames = overlaps.map((o) => `"${o.existing.name}"`).join(' and ');
  const pkgPlural = overlaps.length !== 1;
  return `${testNames.join(', ')} ${testPlural ? 'are' : 'is'} already included in ${pkgNames} (already added to this order). Remove ${
    pkgPlural ? 'those packages' : `"${overlaps[0].existing.name}"`
  } first if you want to add "${incoming.name}" instead.`;
}
