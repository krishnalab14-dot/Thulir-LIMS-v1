import { Prisma } from '@prisma/client';

/**
 * Derives the 3-letter org prefix from the organization name
 * (first 3 alphabetic characters, uppercased, padded with X).
 * e.g. "Thulir Demo Lab" → "THU".
 */
export function deriveOrgPrefix(orgName: string): string {
  const cleaned = (orgName ?? '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 3);
  return cleaned.padEnd(3, 'X');
}

/** Builds the patientUid string, e.g. THU-2026-0001. */
export function buildPatientUid(prefix: string, year: number, counter: number): string {
  return `${prefix}-${year}-${String(counter).padStart(4, '0')}`;
}

/**
 * Atomically increments the org+year counter and returns the next patientUid.
 *
 * Uses a single `INSERT ... ON CONFLICT ... RETURNING` statement, so concurrent
 * registrations serialize on the row lock and can never observe the same
 * counter value. Safe under load by construction (DB-level sequence), not by
 * "usually works" retries.
 */
export async function nextPatientUid(
  tx: Prisma.TransactionClient,
  org: { id: string; name: string },
  year: number,
): Promise<string> {
  const key = `${org.id}:${year}`;
  const rows = await tx.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO "UidCounter" ("id", "orgId", "year", "counter")
    VALUES (${key}, ${org.id}, ${year}, 1)
    ON CONFLICT ("id") DO UPDATE SET "counter" = "UidCounter"."counter" + 1
    RETURNING "counter"`;
  const counter = Number(rows[0]?.counter ?? 0);
  return buildPatientUid(deriveOrgPrefix(org.name), year, counter);
}
