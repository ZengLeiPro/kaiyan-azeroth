import { Module } from '@nestjs/common';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { CrmAnalyticsService } from './services/crm-analytics.service';
import { OrgAnalyticsService } from './services/org-analytics.service';
import { ProjectAnalyticsService } from './services/project-analytics.service';

/**
 * 经营分析模块（/analytics）
 *
 * 提供跨盘总览 + 三盘详情共 19 个只读聚合端点。
 *
 * 依赖：
 * - PrismaService（全局，通过 CommonModule 暴露）
 * - DataScopeService（全局，通过 CommonModule 暴露）
 *
 * 后续如需复用 EffortStatsService / ProjectTicketsService，
 * 在 imports 中加入对应模块；C4 阶段决定。
 */
@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsOverviewService,
    CrmAnalyticsService,
    ProjectAnalyticsService,
    OrgAnalyticsService,
  ],
})
export class AnalyticsModule {}
