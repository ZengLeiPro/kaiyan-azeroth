-- AlterTable
ALTER TABLE "customers" ADD COLUMN "collaboratorIds" JSONB;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN "itemType" VARCHAR(50);
ALTER TABLE "invoices" ADD COLUMN "bankName" VARCHAR(200);
ALTER TABLE "invoices" ADD COLUMN "bankAccount" VARCHAR(100);
ALTER TABLE "invoices" ADD COLUMN "registeredAddress" VARCHAR(500);
ALTER TABLE "invoices" ADD COLUMN "registeredPhone" VARCHAR(50);

-- AlterTable
ALTER TABLE "projects" ADD COLUMN "flowStatus" VARCHAR(50);
