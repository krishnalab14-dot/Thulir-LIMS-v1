-- AlterTable: Drop global unique constraints, add compound per-org unique constraints
-- staffCode: two different orgs can both have -0001 as long as they're in different orgs
ALTER TABLE "User" DROP CONSTRAINT IF EXISTS "User_staffCode_key";
ALTER TABLE "User" ADD CONSTRAINT "User_organizationId_staffCode_key" UNIQUE ("organizationId", "staffCode");

-- doctorCode: same principle
ALTER TABLE "Party" DROP CONSTRAINT IF EXISTS "Party_doctorCode_key";
ALTER TABLE "Party" ADD CONSTRAINT "Party_organizationId_doctorCode_key" UNIQUE ("organizationId", "doctorCode");
