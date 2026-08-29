import { Prisma } from '@prisma/client';
import { deriveOrgPrefix } from '../patients/patient-uid.util';

/**
 * Builds the staff-code string, e.g. THU-ST-0001.
 *
 * Format is consistent with patientUid (THU-2026-0001), billNo
 * (THU-BILL-2026-0001), and doctorCode (THU-DR-0001) — an explicit "ST"
 * segment distinguishes staff codes from all other entity codes.
 * Staff codes are NOT year-scoped (same rationale as doctorCode — small set,
 * year-rolling breaks staff memory of their own code).
 */
export function buildStaffCode(prefix: string, counter: number): string {
  return `${prefix}-ST-${String(counter).padStart(4, '0')}`;
}

/**
 * Atomically increments the per-org staff counter and returns the next staffCode.
 *
 * Same UidCounter table + INSERT ... ON CONFLICT ... RETURNING pattern as
 * patientUid, billNo, and doctorCode. The counter row key is `${orgId}:staff`,
 * with NO year component — staff codes are global-per-org, not year-scoped.
 * Each lab's staff numbering is its own clean, sequential sequence.
 *
 * Resilient to UidCounter truncation: if the counter row was truncated, it
 * seeds from the MAX existing staffCode number in the User table for this org,
 * so old records are never collided with.
 */
export async function nextStaffCode(
  tx: Prisma.TransactionClient,
  org: { id: string; name: string },
): Promise<string> {
  const key = `${org.id}:staff`;

  // Seed from the MAX existing staffCode if the counter row was truncated.
  const maxRow = await tx.$queryRaw<Array<{ max_num: bigint | null }>>`
    SELECT COALESCE(MAX(
      CAST(SUBSTRING("staffCode" FROM '\\d+$') AS INTEGER)
    ), 0) as max_num FROM "User" WHERE "staffCode" IS NOT NULL AND "organizationId" = ${org.id}`;
  const maxExisting = Number(maxRow[0]?.max_num ?? 0);

  const rows = await tx.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO "UidCounter" ("id", "orgId", "year", "counter")
    VALUES (${key}, ${org.id}, 0, ${Math.max(maxExisting, 0) + 1})
    ON CONFLICT ("id") DO UPDATE SET "counter" = GREATEST("UidCounter"."counter" + 1, ${maxExisting + 1})
    RETURNING "counter"`;
  const counter = Number(rows[0]?.counter ?? 1);
  return buildStaffCode(deriveOrgPrefix(org.name), counter);
}
