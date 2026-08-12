-- AlterTable
ALTER TABLE "MasterTest" ADD COLUMN     "resultOptionsAbnormal" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "OrderTest" ADD COLUMN     "enteredAt" TIMESTAMP(3),
ADD COLUMN     "enteredBy" TEXT,
ADD COLUMN     "resultValue" TEXT,
ADD COLUMN     "snapshottedResultOptionsAbnormal" TEXT[] DEFAULT ARRAY[]::TEXT[];
