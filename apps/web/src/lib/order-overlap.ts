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
