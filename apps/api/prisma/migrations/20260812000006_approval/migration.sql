-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedBy" TEXT,
ADD COLUMN     "approvalSignatureStamp" TEXT;
