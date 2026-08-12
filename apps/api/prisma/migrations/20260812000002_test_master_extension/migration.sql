-- CreateEnum
CREATE TYPE "ResultType" AS ENUM ('numeric', 'options', 'text');

-- AlterTable
ALTER TABLE "MasterTest" ADD COLUMN     "criticalHigh" DOUBLE PRECISION,
ADD COLUMN     "criticalLow" DOUBLE PRECISION,
ADD COLUMN     "defaultRefHigh" DOUBLE PRECISION,
ADD COLUMN     "defaultRefLow" DOUBLE PRECISION,
ADD COLUMN     "resultOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "resultType" "ResultType" NOT NULL DEFAULT 'numeric';

-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "snapshottedCriticalHigh" DOUBLE PRECISION,
ADD COLUMN     "snapshottedCriticalLow" DOUBLE PRECISION,
ADD COLUMN     "snapshottedRefHigh" DOUBLE PRECISION,
ADD COLUMN     "snapshottedRefLow" DOUBLE PRECISION,
ADD COLUMN     "snapshottedResultOptions" JSONB,
ADD COLUMN     "snapshottedResultType" "ResultType";

-- CreateTable
CREATE TABLE "TestSpecification" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "ageMinYears" INTEGER NOT NULL,
    "ageMaxYears" INTEGER NOT NULL,
    "sex" "Gender",
    "refLow" DOUBLE PRECISION NOT NULL,
    "refHigh" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TestSpecification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestSpecification_organizationId_idx" ON "TestSpecification"("organizationId");

-- CreateIndex
CREATE INDEX "TestSpecification_testId_idx" ON "TestSpecification"("testId");

-- AddForeignKey
ALTER TABLE "TestSpecification" ADD CONSTRAINT "TestSpecification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestSpecification" ADD CONSTRAINT "TestSpecification_testId_fkey" FOREIGN KEY ("testId") REFERENCES "MasterTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
