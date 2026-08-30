import { Prisma } from '@prisma/client';
import { deriveOrgPrefix } from '../patients/patient-uid.util';

/**
 * Builds the inventory-item code string, e.g. THU-INV-0001.
 *
 * Format is consistent with doctorCode (THU-DR-0001) and staffCode (THU-ST-0001)
 * — an explicit "INV" segment distinguishes inventory codes from all other
 * entity codes. Not year-scoped (same rationale as doctorCode/staffCode).
 */
export function buildItemCode(prefix: string, counter: number): string {
  return `${prefix}-INV-${String(counter).padStart(4, '0')}`;
}

/**
 * Atomically increments the per-org inventory counter and returns the next item code.
 *
 * Same UidCounter table + INSERT ... ON CONFLICT ... RETURNING pattern as
 * patientUid, billNo, doctorCode, and staffCode. The counter row key is
 * `${orgId}:inventory`, with NO year component — inventory item codes are
 * global-per-org, not year-scoped.
 *
 * Resilient to UidCounter truncation: if the counter row was truncated, it
 * seeds from the MAX existing code number in the InventoryItem table for this
 * org, so old records are never collided with.
 */
export async function nextItemCode(
  tx: Prisma.TransactionClient,
  org: { id: string; name: string },
): Promise<string> {
  const key = `${org.id}:inventory`;

  // Seed from the MAX existing code if the counter row was truncated.
  const maxRow = await tx.$queryRaw<Array<{ max_num: bigint | null }>>`
    SELECT COALESCE(MAX(
      CAST(SUBSTRING("code" FROM '\\d+$') AS INTEGER)
    ), 0) as max_num FROM "InventoryItem" WHERE "code" IS NOT NULL AND "organizationId" = ${org.id}`;
  const maxExisting = Number(maxRow[0]?.max_num ?? 0);

  const rows = await tx.$queryRaw<Array<{ counter: bigint }>>`
    INSERT INTO "UidCounter" ("id", "orgId", "year", "counter")
    VALUES (${key}, ${org.id}, 0, ${Math.max(maxExisting, 0) + 1})
    ON CONFLICT ("id") DO UPDATE SET "counter" = GREATEST("UidCounter"."counter" + 1, ${maxExisting + 1})
    RETURNING "counter"`;
  const counter = Number(rows[0]?.counter ?? 1);
  return buildItemCode(deriveOrgPrefix(org.name), counter);
}
