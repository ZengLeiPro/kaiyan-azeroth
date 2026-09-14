-- CreateTable
CREATE TABLE "seo_search_performances" (
    "id" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'google',
    "siteUrl" VARCHAR(200) NOT NULL,
    "dimension" VARCHAR(20) NOT NULL,
    "dimensionValue" VARCHAR(500) NOT NULL,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "avgPosition" DECIMAL(6,2),
    "ctr" DECIMAL(6,4),
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seo_search_performances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seo_search_performances_statDate_idx"
ON "seo_search_performances"("statDate");

-- CreateIndex
CREATE INDEX "seo_search_performances_source_dimension_statDate_idx"
ON "seo_search_performances"("source", "dimension", "statDate");

-- CreateIndex
CREATE INDEX "seo_search_performances_siteUrl_dimension_statDate_idx"
ON "seo_search_performances"("siteUrl", "dimension", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "seo_search_performances_source_siteUrl_statDate_dimension_dimensionValue_key"
ON "seo_search_performances"("source", "siteUrl", "statDate", "dimension", "dimensionValue");
