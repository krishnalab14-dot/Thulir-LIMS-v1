-- Add unique constraints to support idempotent seed upserts.
-- These constraints enable `createMany({ skipDuplicates: true })` and
-- `upsert` in the seed script, keyed by stable business identifiers
-- rather than opaque CUIDs. Safe to run repeatedly; migration deploy
-- only applies each migration once.

-- MasterTest: unique test code per organization
CREATE UNIQUE INDEX "MasterTest_organizationId_testCode_key" ON "MasterTest"("organizationId", "testCode");

-- MasterTestPackage: unique package code per organization
CREATE UNIQUE INDEX "MasterTestPackage_organizationId_packageCode_key" ON "MasterTestPackage"("organizationId", "packageCode");

-- MasterTestPackageItem: each test can appear in a package at most once
CREATE UNIQUE INDEX "MasterTestPackageItem_packageId_testId_key" ON "MasterTestPackageItem"("packageId", "testId");

-- TestSpecification: unique spec per test + age range + sex tier within an org
-- (NULL sex is allowed multiple times per PostgreSQL UNIQUE semantics —
--  that's correct: "any sex" specs don't conflict with each other.)
CREATE UNIQUE INDEX "TestSpecification_organizationId_testId_ageMinYears_ageMaxYears_sex_key" ON "TestSpecification"("organizationId", "testId", "ageMinYears", "ageMaxYears", "sex");
