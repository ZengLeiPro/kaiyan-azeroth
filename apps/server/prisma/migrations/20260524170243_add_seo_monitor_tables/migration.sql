-- CreateTable
CREATE TABLE "seo_search_queries" (
    "id" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'bing',
    "siteUrl" VARCHAR(200) NOT NULL,
    "query" VARCHAR(500) NOT NULL,
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

    CONSTRAINT "seo_search_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_page_insights" (
    "id" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'clarity',
    "siteUrl" VARCHAR(200) NOT NULL,
    "pageUrl" VARCHAR(500) NOT NULL,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    "uniqueUsers" INTEGER NOT NULL DEFAULT 0,
    "pageViews" INTEGER NOT NULL DEFAULT 0,
    "avgEngagementMs" INTEGER,
    "scrollDepthAvg" INTEGER,
    "deadClicks" INTEGER NOT NULL DEFAULT 0,
    "rageClicks" INTEGER NOT NULL DEFAULT 0,
    "quickbacks" INTEGER NOT NULL DEFAULT 0,
    "excessiveScroll" INTEGER NOT NULL DEFAULT 0,
    "jsErrors" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seo_page_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_traffic_snapshots" (
    "id" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "source" VARCHAR(20) NOT NULL DEFAULT 'baidu-tongji',
    "siteUrl" VARCHAR(200) NOT NULL,
    "pv" INTEGER NOT NULL DEFAULT 0,
    "uv" INTEGER NOT NULL DEFAULT 0,
    "ip" INTEGER NOT NULL DEFAULT 0,
    "visitCount" INTEGER NOT NULL DEFAULT 0,
    "bounceRate" DECIMAL(6,4),
    "avgVisitTime" INTEGER,
    "avgVisitPages" DECIMAL(6,2),
    "newVisitor" INTEGER NOT NULL DEFAULT 0,
    "sourceBreakdown" JSONB NOT NULL DEFAULT '[]',
    "rawPayload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seo_traffic_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seo_sync_runs" (
    "id" TEXT NOT NULL,
    "triggerSource" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "elapsedMs" INTEGER,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "seo_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "seo_search_queries_statDate_idx" ON "seo_search_queries"("statDate");

-- CreateIndex
CREATE INDEX "seo_search_queries_source_statDate_idx" ON "seo_search_queries"("source", "statDate");

-- CreateIndex
CREATE INDEX "seo_search_queries_siteUrl_statDate_idx" ON "seo_search_queries"("siteUrl", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "seo_search_queries_source_siteUrl_statDate_query_key" ON "seo_search_queries"("source", "siteUrl", "statDate", "query");

-- CreateIndex
CREATE INDEX "seo_page_insights_statDate_idx" ON "seo_page_insights"("statDate");

-- CreateIndex
CREATE INDEX "seo_page_insights_source_statDate_idx" ON "seo_page_insights"("source", "statDate");

-- CreateIndex
CREATE INDEX "seo_page_insights_siteUrl_statDate_idx" ON "seo_page_insights"("siteUrl", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "seo_page_insights_source_siteUrl_statDate_pageUrl_key" ON "seo_page_insights"("source", "siteUrl", "statDate", "pageUrl");

-- CreateIndex
CREATE INDEX "seo_traffic_snapshots_statDate_idx" ON "seo_traffic_snapshots"("statDate");

-- CreateIndex
CREATE INDEX "seo_traffic_snapshots_source_statDate_idx" ON "seo_traffic_snapshots"("source", "statDate");

-- CreateIndex
CREATE INDEX "seo_traffic_snapshots_siteUrl_statDate_idx" ON "seo_traffic_snapshots"("siteUrl", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "seo_traffic_snapshots_source_siteUrl_statDate_key" ON "seo_traffic_snapshots"("source", "siteUrl", "statDate");

-- CreateIndex
CREATE INDEX "seo_sync_runs_startedAt_idx" ON "seo_sync_runs"("startedAt");

-- CreateIndex
CREATE INDEX "seo_sync_runs_status_idx" ON "seo_sync_runs"("status");

-- CreateIndex
CREATE INDEX "seo_sync_runs_status_startedAt_idx" ON "seo_sync_runs"("status", "startedAt");
