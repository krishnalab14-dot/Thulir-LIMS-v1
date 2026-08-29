-- AlterTable: add printable letterhead fields for Settings / Report / Invoice
ALTER TABLE "Organization" ADD COLUMN "address" TEXT;
ALTER TABLE "Organization" ADD COLUMN "phone" TEXT;
ALTER TABLE "Organization" ADD COLUMN "email" TEXT;
ALTER TABLE "Organization" ADD COLUMN "nablAccreditationNumber" TEXT;
ALTER TABLE "Organization" ADD COLUMN "gstNumber" TEXT;
ALTER TABLE "Organization" ADD COLUMN "logoUrl" TEXT;
