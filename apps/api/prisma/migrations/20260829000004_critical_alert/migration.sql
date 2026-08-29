-- CriticalValueAlerting: create CriticalAlert table and wire relations
-- Stage 9: acknowledgment layer for critical lab values

CREATE TABLE "CriticalAlert" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderTestId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CriticalAlert_pkey" PRIMARY KEY ("id")
);

-- FK to Organization (tenant scope)
ALTER TABLE "CriticalAlert" ADD CONSTRAINT "CriticalAlert_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- FK to OrderTest (cascade delete: if the OrderTest is deleted, the alert is too)
ALTER TABLE "CriticalAlert" ADD CONSTRAINT "CriticalAlert_orderTestId_fkey"
    FOREIGN KEY ("orderTestId") REFERENCES "OrderTest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Indexes for tenant-scoped queries + lookup patterns
CREATE INDEX "CriticalAlert_organizationId_idx" ON "CriticalAlert"("organizationId");
CREATE INDEX "CriticalAlert_orderTestId_idx" ON "CriticalAlert"("orderTestId");
CREATE INDEX "CriticalAlert_organizationId_acknowledgedAt_idx" ON "CriticalAlert"("organizationId", "acknowledgedAt");
