-- CreateTable
CREATE TABLE "store_inspection_standards" (
    "id" TEXT NOT NULL,
    "standardName" VARCHAR(200) NOT NULL,
    "standardType" VARCHAR(100),
    "description" TEXT,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "inspectionItems" JSONB,
    "totalScore" DECIMAL(8,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "store_inspection_standards_pkey" PRIMARY KEY ("id")
);
