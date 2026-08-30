-- CreateEnum
CREATE TYPE "InventoryDirection" AS ENUM ('in', 'out');

-- CreateTable
CREATE TABLE "InventorySupplier" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT,
    "contactEmail" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventorySupplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "reorderThreshold" DOUBLE PRECISION,
    "preferredSupplierId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryTransaction" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "direction" "InventoryDirection" NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "batchNumber" TEXT,
    "expiryDate" TIMESTAMP(3),
    "reason" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestInventoryRequirement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "quantityPerTest" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TestInventoryRequirement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_organizationId_code_key" ON "InventoryItem"("organizationId", "code");

-- CreateIndex
CREATE INDEX "InventorySupplier_organizationId_idx" ON "InventorySupplier"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryItem_organizationId_idx" ON "InventoryItem"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_organizationId_idx" ON "InventoryTransaction"("organizationId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_itemId_idx" ON "InventoryTransaction"("itemId");

-- CreateIndex
CREATE INDEX "InventoryTransaction_organizationId_itemId_idx" ON "InventoryTransaction"("organizationId", "itemId");

-- CreateIndex
CREATE INDEX "TestInventoryRequirement_organizationId_idx" ON "TestInventoryRequirement"("organizationId");

-- CreateIndex
CREATE INDEX "TestInventoryRequirement_testId_idx" ON "TestInventoryRequirement"("testId");

-- CreateIndex
CREATE INDEX "TestInventoryRequirement_itemId_idx" ON "TestInventoryRequirement"("itemId");

-- AddForeignKey
ALTER TABLE "InventorySupplier" ADD CONSTRAINT "InventorySupplier_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_preferredSupplierId_fkey" FOREIGN KEY ("preferredSupplierId") REFERENCES "InventorySupplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryTransaction" ADD CONSTRAINT "InventoryTransaction_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestInventoryRequirement" ADD CONSTRAINT "TestInventoryRequirement_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestInventoryRequirement" ADD CONSTRAINT "TestInventoryRequirement_testId_fkey" FOREIGN KEY ("testId") REFERENCES "MasterTest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestInventoryRequirement" ADD CONSTRAINT "TestInventoryRequirement_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "InventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
