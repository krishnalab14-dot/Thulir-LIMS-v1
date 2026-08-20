-- AlterEnum
ALTER TYPE "PartyType" ADD VALUE 'reference_lab';
ALTER TYPE "PartyType" ADD VALUE 'staff';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "discountAuthorizedBy" TEXT,
ADD COLUMN     "expectedReportDate" TIMESTAMP(3);
