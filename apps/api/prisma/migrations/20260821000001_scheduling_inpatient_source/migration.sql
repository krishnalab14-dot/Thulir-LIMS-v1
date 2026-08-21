-- Migration: §1–4 Registration Refinement 2
-- Adds scheduling estimate, inpatient context fields, and source to Order.

ALTER TABLE "Order"
  ADD COLUMN "scheduledCollectionAt" TIMESTAMP(3),
  ADD COLUMN "patientType"           TEXT,
  ADD COLUMN "wardDesc"              TEXT,
  ADD COLUMN "bedNo"                 TEXT,
  ADD COLUMN "ipOpNo"                TEXT,
  ADD COLUMN "source"                TEXT;
