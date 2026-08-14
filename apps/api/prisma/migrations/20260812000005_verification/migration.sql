-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "verifiedAt" TIMESTAMP(3),
ADD COLUMN     "verifiedBy" TEXT,
ADD COLUMN     "verifyRejectedNote" TEXT;
