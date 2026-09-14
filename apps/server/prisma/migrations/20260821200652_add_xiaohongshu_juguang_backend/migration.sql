-- CreateTable
CREATE TABLE "xiaohongshu_oauth_states" (
    "id" TEXT NOT NULL,
    "stateHash" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "xiaohongshu_oauth_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xiaohongshu_connections" (
    "id" TEXT NOT NULL,
    "appId" VARCHAR(50) NOT NULL,
    "userId" VARCHAR(128) NOT NULL,
    "roleType" INTEGER NOT NULL,
    "approvalRoleType" INTEGER,
    "platformType" INTEGER NOT NULL,
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "accessTokenCiphertext" TEXT NOT NULL,
    "refreshTokenCiphertext" TEXT NOT NULL,
    "accessTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshTokenExpiresAt" TIMESTAMP(3) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "lastRefreshedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "refreshLeaseId" VARCHAR(64),
    "refreshLeaseUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "xiaohongshu_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xiaohongshu_advertisers" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "advertiserId" VARCHAR(50) NOT NULL,
    "advertiserName" VARCHAR(200) NOT NULL,
    "corporationName" VARCHAR(200),
    "virtualSellerId" VARCHAR(128),
    "status" VARCHAR(20) NOT NULL DEFAULT 'active',
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "xiaohongshu_advertisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xiaohongshu_daily_reports" (
    "id" TEXT NOT NULL,
    "advertiserAccountId" TEXT NOT NULL,
    "statDate" DATE NOT NULL,
    "level" VARCHAR(20) NOT NULL,
    "entityId" VARCHAR(128) NOT NULL,
    "entityName" VARCHAR(300),
    "campaignId" VARCHAR(128),
    "campaignName" VARCHAR(300),
    "unitId" VARCHAR(128),
    "unitName" VARCHAR(300),
    "creativeId" VARCHAR(128),
    "creativeName" VARCHAR(300),
    "fee" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "impression" INTEGER NOT NULL DEFAULT 0,
    "click" INTEGER NOT NULL DEFAULT 0,
    "interaction" INTEGER NOT NULL DEFAULT 0,
    "like" INTEGER NOT NULL DEFAULT 0,
    "comment" INTEGER NOT NULL DEFAULT 0,
    "collect" INTEGER NOT NULL DEFAULT 0,
    "follow" INTEGER NOT NULL DEFAULT 0,
    "share" INTEGER NOT NULL DEFAULT 0,
    "ctr" DECIMAL(18,6),
    "acp" DECIMAL(18,6),
    "cpm" DECIMAL(18,6),
    "cpi" DECIMAL(18,6),
    "dataCaliber" INTEGER NOT NULL DEFAULT 0,
    "rawPayload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "xiaohongshu_daily_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "xiaohongshu_sync_runs" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT,
    "triggerSource" VARCHAR(20) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'running',
    "startDate" DATE,
    "endDate" DATE,
    "levels" JSONB NOT NULL DEFAULT '[]',
    "advertiserIds" JSONB NOT NULL DEFAULT '[]',
    "syncedRows" INTEGER NOT NULL DEFAULT 0,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "report" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "elapsedMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "xiaohongshu_sync_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "xiaohongshu_oauth_states_stateHash_key" ON "xiaohongshu_oauth_states"("stateHash");

-- CreateIndex
CREATE INDEX "xiaohongshu_oauth_states_expiresAt_idx" ON "xiaohongshu_oauth_states"("expiresAt");

-- CreateIndex
CREATE INDEX "xiaohongshu_oauth_states_consumedAt_idx" ON "xiaohongshu_oauth_states"("consumedAt");

-- CreateIndex
CREATE INDEX "xiaohongshu_connections_status_idx" ON "xiaohongshu_connections"("status");

-- CreateIndex
CREATE INDEX "xiaohongshu_connections_refreshTokenExpiresAt_idx" ON "xiaohongshu_connections"("refreshTokenExpiresAt");

-- CreateIndex
CREATE INDEX "xiaohongshu_connections_refreshLeaseUntil_idx" ON "xiaohongshu_connections"("refreshLeaseUntil");

-- CreateIndex
CREATE UNIQUE INDEX "xiaohongshu_connections_appId_userId_key" ON "xiaohongshu_connections"("appId", "userId");

-- CreateIndex
CREATE INDEX "xiaohongshu_advertisers_connectionId_idx" ON "xiaohongshu_advertisers"("connectionId");

-- CreateIndex
CREATE INDEX "xiaohongshu_advertisers_advertiserId_idx" ON "xiaohongshu_advertisers"("advertiserId");

-- CreateIndex
CREATE INDEX "xiaohongshu_advertisers_status_idx" ON "xiaohongshu_advertisers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "xiaohongshu_advertisers_connectionId_advertiserId_key" ON "xiaohongshu_advertisers"("connectionId", "advertiserId");

-- CreateIndex
CREATE INDEX "xiaohongshu_daily_reports_advertiserAccountId_idx" ON "xiaohongshu_daily_reports"("advertiserAccountId");

-- CreateIndex
CREATE INDEX "xiaohongshu_daily_reports_statDate_idx" ON "xiaohongshu_daily_reports"("statDate");

-- CreateIndex
CREATE INDEX "xiaohongshu_daily_reports_level_statDate_idx" ON "xiaohongshu_daily_reports"("level", "statDate");

-- CreateIndex
CREATE INDEX "xiaohongshu_daily_reports_advertiserAccountId_level_statDat_idx" ON "xiaohongshu_daily_reports"("advertiserAccountId", "level", "statDate");

-- CreateIndex
CREATE UNIQUE INDEX "xiaohongshu_daily_reports_advertiserAccountId_statDate_leve_key" ON "xiaohongshu_daily_reports"("advertiserAccountId", "statDate", "level", "entityId", "dataCaliber");

-- CreateIndex
CREATE INDEX "xiaohongshu_sync_runs_connectionId_idx" ON "xiaohongshu_sync_runs"("connectionId");

-- CreateIndex
CREATE INDEX "xiaohongshu_sync_runs_startedAt_idx" ON "xiaohongshu_sync_runs"("startedAt");

-- CreateIndex
CREATE INDEX "xiaohongshu_sync_runs_status_startedAt_idx" ON "xiaohongshu_sync_runs"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "xiaohongshu_advertisers" ADD CONSTRAINT "xiaohongshu_advertisers_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "xiaohongshu_connections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xiaohongshu_daily_reports" ADD CONSTRAINT "xiaohongshu_daily_reports_advertiserAccountId_fkey" FOREIGN KEY ("advertiserAccountId") REFERENCES "xiaohongshu_advertisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "xiaohongshu_sync_runs" ADD CONSTRAINT "xiaohongshu_sync_runs_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "xiaohongshu_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;
