import { Module } from '@nestjs/common';

import { SeoBackupCronService } from './seo-backup-cron.service';
import {
  SeoPageInsightsAliasController,
  SeoSearchQueriesAliasController,
  SeoSyncRunsAliasController,
  SeoTrafficSnapshotsAliasController,
} from './seo-entity-aliases.controller';
import { SeoMonitorController } from './seo-monitor.controller';
import { SeoMonitorService } from './seo-monitor.service';

@Module({
  controllers: [
    SeoMonitorController,
    // CLI 自动派生别名（/seo-* 桥接到 /seo/*，详见 seo-entity-aliases.controller.ts）
    SeoSearchQueriesAliasController,
    SeoPageInsightsAliasController,
    SeoTrafficSnapshotsAliasController,
    SeoSyncRunsAliasController,
  ],
  providers: [SeoMonitorService, SeoBackupCronService],
  exports: [SeoMonitorService],
})
export class SeoMonitorModule {}
