import { Prisma } from '@prisma/client';
import { deriveOrgPrefix } from '../patients/patient-uid.util';

/**
 * Builds the doctor-code string, e.g. THU-DR-0001.
 *
 * Format is consistent with patientUid (THU-2026-0001) and billNo
 * (THU-BILL-2026-0001) — an explicit "DR" segment distinguishes it.
 * Doctor codes are NOT year-scoped (unlike patientUid/billNo) because the
 * set of doctors is small and year-rolling would break staff memory of codes.
 */
export function buildDoctorCode(prefix: string, counter: number): string {
  return `${prefix}-DR-${String(counter).padStart(4, '0')}`;
}

/**
 * Atomically increments the org DOCTOR counter and returns the next doctorCode.
 *
 * Same UidCounter table + INSERT ... ON CONFLICT ... RETURNING pattern as
 * patientUid and billNo. The counter row key is `${orgId}:doctor`, with NO
 * year component — doctor codes are global-per-org, not year-scoped.
 *
 * Resilient to UidCounter truncation: if the counter row was truncated, it
 * seeds from the MAX existing doctorCode number in the Party table, so old
 * records are never collided with.
 */
export async function nextDoctorCode(
  tx: Prisma.TransactionClient,
  org: { id: string; name: string },
): Promise<string> {
  const key = `${org.id}:doctor`;

  // Seed from the MAX existing doctorCode if the counter row was truncated.
  const maxRow = await tx.$queryRaw<Array<{ max_num: bigint | null }>>`
    SELECT COALESCE(MAX(
      CAST(SUBSTRING("doctorCode" FROM '\\d+$') AS INTEGER)
    ), 0) as max_num FROM "Party" WHERE "doctorCode" IS NOT NULL AND "organizationId" = ${org.id}`;
  const maxExisting = Number(maxRow[0]?.max_num ?? 0);

  const rows = await tx.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO "UidCounter" ("id", "orgId", "year", "counter")
    VALUES (${key}, ${org.id}, 0, ${Math.max(maxExisting, 0) + 1})
    ON CONFLICT ("id") DO UPDATE SET "counter" = GREATEST("UidCounter"."counter" + 1, ${maxExisting + 1})
    RETURNING "counter"`;
  const counter = Number(rows[0]?.counter ?? 1);
  return buildDoctorCode(deriveOrgPrefix(org.name), counter);
}
