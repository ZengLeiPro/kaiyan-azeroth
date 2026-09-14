import type {
  ISeoPageInsightResponse,
  ISeoSearchQueryResponse,
  ISeoSyncRun,
  ISeoSyncRunResponse,
  ISeoTrafficSnapshotResponse,
} from '@ky-azeroth/shared/types';
import { Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  QuerySeoPageInsightDto,
  QuerySeoSearchQueryDto,
  QuerySeoSearchRankingDto,
  QuerySeoSearchTrendDto,
  QuerySeoSiteSummaryDto,
  QuerySeoSummaryDto,
  QuerySeoSyncRunDto,
  QuerySeoTrafficSnapshotDto,
} from './dto';
import {
  type SeoManualSyncResult,
  SeoMonitorService,
  type SeoSearchRankingResponse,
  type SeoSearchTrendResponse,
  type SeoSiteSummaryResponse,
  type SeoSummaryResponse,
} from './seo-monitor.service';

/**
 * SEO 监测只读控制器
 *
 * 路由分两类：
 * 1. 明细（findXxx）：分页原始行，列表 select 排除大体积 raw 字段
 * 2. 聚合（getXxx）：后端 groupBy/aggregate，前端看板 KPI/趋势/排行专用
 *
 * 数据由 FC 子应用 `apps/seo-sync` 每日 09:00 写入。
 * 权限统一 `analytics:seo:view`，与同组 4 个 analytics 端点对齐。
 */
@ApiTags('SEO 监测')
@ApiBearerAuth()
@Controller('seo')
export class SeoMonitorController {
  constructor(private readonly service: SeoMonitorService) {}

  // ---------- 明细列表 ----------

  @Get('search-queries')
  @ApiOperation({ summary: '查询 SEO 具名关键词列表（Google 存在匿名缺口）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findSearchQueries(
    @Query() query: QuerySeoSearchQueryDto
  ): Promise<PaginatedResponse<ISeoSearchQueryResponse>> {
    return this.service.findSearchQueries(query);
  }

  @Get('page-insights')
  @ApiOperation({ summary: '查询 SEO 页面级洞察（Microsoft Clarity）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findPageInsights(
    @Query() query: QuerySeoPageInsightDto
  ): Promise<PaginatedResponse<ISeoPageInsightResponse>> {
    return this.service.findPageInsights(query);
  }

  @Get('traffic-snapshots')
  @ApiOperation({ summary: '查询 SEO 整站流量快照（百度统计，待 PV>100 开通）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findTrafficSnapshots(
    @Query() query: QuerySeoTrafficSnapshotDto
  ): Promise<PaginatedResponse<ISeoTrafficSnapshotResponse>> {
    return this.service.findTrafficSnapshots(query);
  }

  // ---------- 聚合（看板专用） ----------

  @Get('summary')
  @ApiOperation({ summary: 'SEO 综合 KPI（搜索平台 + Clarity，区间聚合）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  getSummary(@Query() query: QuerySeoSummaryDto): Promise<SeoSummaryResponse> {
    return this.service.getSummary(query);
  }

  @Get('search-trend')
  @ApiOperation({ summary: '搜索表现按日趋势（曝光/点击/加权CTR/加权排名）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  getSearchTrend(@Query() query: QuerySeoSearchTrendDto): Promise<SeoSearchTrendResponse> {
    return this.service.getSearchTrend(query);
  }

  @Get('search-ranking')
  @ApiOperation({ summary: 'Top N 排行（dim=keyword 或 page）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  getSearchRanking(@Query() query: QuerySeoSearchRankingDto): Promise<SeoSearchRankingResponse> {
    return this.service.getSearchRanking(query);
  }

  @Get('page-insights/site-summary')
  @ApiOperation({ summary: 'Clarity 全站聚合行按日序列（用户行为趋势）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  getSiteSummary(@Query() query: QuerySeoSiteSummaryDto): Promise<SeoSiteSummaryResponse> {
    return this.service.getSiteSummary(query);
  }

  // ---------- 同步任务 ----------

  @Get('sync-runs')
  @ApiOperation({ summary: '查询 SEO 同步任务历史（列表 select 排除 report 大对象）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findSyncRuns(
    @Query() query: QuerySeoSyncRunDto
  ): Promise<PaginatedResponse<ISeoSyncRunResponse>> {
    return this.service.findSyncRuns(query);
  }

  @Get('sync-runs/latest')
  @ApiOperation({ summary: '查询最近一次 SEO 同步任务（看板顶部 banner 用）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findLatestSyncRun(): Promise<ISeoSyncRun | null> {
    return this.service.findLatestSyncRun();
  }

  @Get('sync-runs/:id')
  @ApiOperation({ summary: '查询 SEO 同步任务详情（含完整 report JSON）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  findSyncRunById(@Param('id') id: string): Promise<ISeoSyncRunResponse> {
    return this.service.findSyncRunById(id);
  }

  /**
   * 手动触发 FC 子应用跑一次全量同步（Bing + Clarity）。
   * 每日 9:00 timer 触发器照常运行，本端点用于按需补跑。
   *
   * 权限沿用 `analytics:seo:view`（能看 SEO 看板的人即可触发，单次几十秒、可承受）。
   * 返回 shape 兼容前端 `ManualSyncButton`：`{ count, durationMs, ... }`。
   */
  @Post('sync-runs/trigger')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '手动触发 SEO 同步（Bing + Clarity，FC 子应用执行）' })
  @RequirePermission({ module: 'analytics', menu: 'seo', action: 'view' })
  triggerManualSync(): Promise<SeoManualSyncResult> {
    return this.service.triggerManualSync();
  }
}
