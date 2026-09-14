-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "crm_products" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "crm_work_dailies" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "keep_records" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "opportunities" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "opportunity_products" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "order_products" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "sale_orders" ADD COLUMN     "flowStatus" VARCHAR(50);

-- AlterTable
ALTER TABLE "visit_records" ADD COLUMN     "flowStatus" VARCHAR(50);
