-- CreateEnum
CREATE TYPE "SampleStatus" AS ENUM ('pending_collection', 'collected', 'rejected');

-- CreateEnum
CREATE TYPE "RejectionReason" AS ENUM ('hemolyzed', 'clotted', 'insufficient_quantity', 'mislabeled', 'container_leaked', 'other');

-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "sampleId" TEXT;

-- AlterTable
ALTER TABLE "SampleType" ADD COLUMN     "code" TEXT;

-- CreateTable
CREATE TABLE "Sample" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "sampleTypeId" TEXT NOT NULL,
    "barcodeValue" TEXT NOT NULL,
    "status" "SampleStatus" NOT NULL DEFAULT 'pending_collection',
    "collectedBy" TEXT,
    "collectedAt" TIMESTAMP(3),
    "rejectedReason" "RejectionReason",
    "rejectedReasonNote" TEXT,
    "rejectedBy" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "recollectionOfSampleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Sample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Sample_barcodeValue_key" ON "Sample"("barcodeValue");

-- CreateIndex
CREATE INDEX "Sample_organizationId_idx" ON "Sample"("organizationId");

-- CreateIndex
CREATE INDEX "Sample_orderId_idx" ON "Sample"("orderId");

-- CreateIndex
CREATE INDEX "Sample_status_idx" ON "Sample"("status");

-- CreateIndex
CREATE INDEX "Sample_recollectionOfSampleId_idx" ON "Sample"("recollectionOfSampleId");

-- CreateIndex
CREATE INDEX "OrderTest_sampleId_idx" ON "OrderTest"("sampleId");

-- AddForeignKey
ALTER TABLE "OrderTest" ADD CONSTRAINT "OrderTest_sampleId_fkey" FOREIGN KEY ("sampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_sampleTypeId_fkey" FOREIGN KEY ("sampleTypeId") REFERENCES "SampleType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Sample" ADD CONSTRAINT "Sample_recollectionOfSampleId_fkey" FOREIGN KEY ("recollectionOfSampleId") REFERENCES "Sample"("id") ON DELETE SET NULL ON UPDATE CASCADE;
