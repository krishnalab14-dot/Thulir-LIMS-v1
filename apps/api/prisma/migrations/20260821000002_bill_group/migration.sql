-- Consolidated billing: BillGroup model + billGroupId FK on Order

-- CreateTable
CREATE TABLE "BillGroup" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BillGroup_organizationId_idx" ON "BillGroup"("organizationId");

-- AddForeignKey
ALTER TABLE "BillGroup" ADD CONSTRAINT "BillGroup_organizationId_fkey"
  FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN "billGroupId" TEXT;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_billGroupId_fkey"
  FOREIGN KEY ("billGroupId") REFERENCES "BillGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;
