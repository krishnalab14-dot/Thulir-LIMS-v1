import { Prisma } from '@prisma/client';
import { deriveOrgPrefix } from '../patients/patient-uid.util';

/**
 * Builds the order bill-number string, e.g. THU-BILL-2026-0001.
 *
 * Deliberately consistent with the patientUid format (<PREFIX>-<YEAR>-<NNNN>):
 * same org prefix, same zero-padded sequential counter — with an explicit
 * "BILL" segment so staff can never confuse a PID with a bill reference.
 */
export function buildBillNo(prefix: string, year: number, counter: number): string {
  return `${prefix}-BILL-${year}-${String(counter).padStart(4, '0')}`;
}

/**
 * Atomically increments the org+year BILL counter and returns the next billNo.
 *
 * Reuses the SAME UidCounter table + INSERT ... ON CONFLICT ... RETURNING
 * pattern proven for patientUid — no second mechanism. The counter row key is
 * `${orgId}:bill:${year}`, a separate namespace from patientUid's
 * `${orgId}:${year}`, so bill numbers and PIDs each sequence independently.
 * Concurrent order creations serialize on the row lock and can never observe
 * the same counter value (collision-safe by construction, not by retries).
 */
export async function nextBillNo(
  tx: Prisma.TransactionClient,
  org: { id: string; name: string },
  year: number,
): Promise<string> {
  const key = `${org.id}:bill:${year}`;
  const rows = await tx.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO "UidCounter" ("id", "orgId", "year", "counter")
    VALUES (${key}, ${org.id}, ${year}, 1)
    ON CONFLICT ("id") DO UPDATE SET "counter" = "UidCounter"."counter" + 1
    RETURNING "counter"`;
  const counter = Number(rows[0]?.counter ?? 0);
  return buildBillNo(deriveOrgPrefix(org.name), year, counter);
}
