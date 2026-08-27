-- AlterTable: add auto-generated entity code columns (nullable for existing rows)
ALTER TABLE "Party" ADD COLUMN "doctorCode" TEXT;
ALTER TABLE "User" ADD COLUMN "staffCode" TEXT;

-- Unique indexes (nullable columns can have multiple nulls in PostgreSQL, so no conflict)
CREATE UNIQUE INDEX "Party_doctorCode_key" ON "Party"("doctorCode");
CREATE UNIQUE INDEX "User_staffCode_key" ON "User"("staffCode");
