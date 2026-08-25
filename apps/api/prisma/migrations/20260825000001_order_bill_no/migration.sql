-- Sequential human-friendly bill number on Order (e.g. THU-BILL-2026-0001).
-- Nullable: orders created before this field existed keep null; every new
-- order gets one at creation time via the shared UidCounter table.
ALTER TABLE "Order" ADD COLUMN "billNo" TEXT;

-- Create the index as CONCURRENTLY is not allowed inside a transaction block;
-- a plain unique index build is fine here (table is small, migration runs in
-- a transaction like every other Prisma migration).
CREATE UNIQUE INDEX "Order_billNo_key" ON "Order"("billNo");
