-- CreateTable
CREATE TABLE "public"."file_assets" (
    "id" TEXT NOT NULL,
    "storageKey" VARCHAR(600) NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "size" INTEGER NOT NULL,
    "mimeType" VARCHAR(150) NOT NULL,
    "ownerEmployeeId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "file_assets_storageKey_key" ON "public"."file_assets"("storageKey");

-- CreateIndex
CREATE INDEX "file_assets_ownerEmployeeId_createdAt_idx"
ON "public"."file_assets"("ownerEmployeeId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."file_assets"
ADD CONSTRAINT "file_assets_ownerEmployeeId_fkey"
FOREIGN KEY ("ownerEmployeeId") REFERENCES "public"."employees"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
