import type {
  IWebAnalyticsAttributionResponse,
  IWebAnalyticsBreakdownResponse,
  IWebAnalyticsCampaignConversionResponse,
  IWebAnalyticsContentResponse,
  IWebAnalyticsEngineLandingMatrixResponse,
  IWebAnalyticsEventRow,
  IWebAnalyticsFilterOptionsResponse,
  IWebAnalyticsFunnelResponse,
  IWebAnalyticsLandingPagesResponse,
  IWebAnalyticsLeadRadarResponse,
  IWebAnalyticsSearchKeywordsResponse,
  IWebAnalyticsSummaryResponse,
  IWebAnalyticsTrendResponse,
  IWebAnalyticsVisitorTypeResponse,
} from '@ky-azeroth/shared/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  QueryWebAnalyticsAttributionDto,
  QueryWebAnalyticsBreakdownDto,
  QueryWebAnalyticsCampaignConversionDto,
  QueryWebAnalyticsContentDto,
  QueryWebAnalyticsEngineLandingMatrixDto,
  QueryWebAnalyticsEventsDto,
  QueryWebAnalyticsFilterOptionsDto,
  QueryWebAnalyticsFunnelDto,
  QueryWebAnalyticsLandingPagesDto,
  QueryWebAnalyticsLeadRadarDto,
  QueryWebAnalyticsSearchKeywordsDto,
  QueryWebAnalyticsSummaryDto,
  QueryWebAnalyticsTrendDto,
  QueryWebAnalyticsVisitorTypeDto,
} from './dto';
import { WebAnalyticsService } from './web-analytics.service';

@ApiTags('官网分析')
@ApiBearerAuth()
@Controller('web-analytics')
// 类级 @RequirePermission 自动应用到所有 @Get（PermissionGuard 用 getAllAndOverride
// [handler, class] 读 metadata，方法级未单独装饰则继承类级）。从原 旧超管装饰器（已移除）
// 改为 RBAC，2026-06-13：让普通角色（销售/运营）可通过 system/roles 配置授权查看。
@RequirePermission({ module: 'analytics', menu: 'web', action: 'view' })
export class WebAnalyticsController {
  constructor(private readonly service: WebAnalyticsService) {}

  @Get('summary')
  @ApiOperation({ summary: '官网分析 KPI 汇总' })
  getSummary(@Query() query: QueryWebAnalyticsSummaryDto): Promise<IWebAnalyticsSummaryResponse> {
    return this.service.getSummary(query);
  }

  @Get('trend')
  @ApiOperation({ summary: '官网分析按日趋势' })
  getTrend(@Query() query: QueryWebAnalyticsTrendDto): Promise<IWebAnalyticsTrendResponse> {
    return this.service.getTrend(query);
  }

  @Get('breakdown')
  @ApiOperation({ summary: '官网分析维度排行' })
  getBreakdown(
    @Query() query: QueryWebAnalyticsBreakdownDto
  ): Promise<IWebAnalyticsBreakdownResponse> {
    return this.service.getBreakdown(query);
  }

  @Get('funnel')
  @ApiOperation({ summary: '官网咨询漏斗' })
  getFunnel(@Query() query: QueryWebAnalyticsFunnelDto): Promise<IWebAnalyticsFunnelResponse> {
    return this.service.getFunnel(query);
  }

  @Get('attribution')
  @ApiOperation({ summary: '官网 sid 首触点归因' })
  getAttribution(
    @Query() query: QueryWebAnalyticsAttributionDto
  ): Promise<IWebAnalyticsAttributionResponse> {
    return this.service.getAttribution(query);
  }

  @Get('campaign-conversion')
  @ApiOperation({ summary: '官网 UTM 活动转化对比（utm_campaign · 按转化率降序）' })
  getCampaignConversion(
    @Query() query: QueryWebAnalyticsCampaignConversionDto
  ): Promise<IWebAnalyticsCampaignConversionResponse> {
    return this.service.getCampaignConversion(query);
  }

  @Get('events')
  @ApiOperation({ summary: '官网埋点事件明细分页' })
  findEvents(
    @Query() query: QueryWebAnalyticsEventsDto
  ): Promise<PaginatedResponse<IWebAnalyticsEventRow>> {
    return this.service.findEvents(query);
  }

  @Get('content-engagement')
  @ApiOperation({ summary: '官网博客内容质量榜（滚动深度/停留/读完率）' })
  getContentEngagement(
    @Query() query: QueryWebAnalyticsContentDto
  ): Promise<IWebAnalyticsContentResponse> {
    return this.service.getContentEngagement(query);
  }

  @Get('landing-pages')
  @ApiOperation({ summary: '官网入口页报告（会话首 pageview · 跳出/转化）' })
  getLandingPages(
    @Query() query: QueryWebAnalyticsLandingPagesDto
  ): Promise<IWebAnalyticsLandingPagesResponse> {
    return this.service.getLandingPages(query);
  }

  @Get('engine-landing-matrix')
  @ApiOperation({ summary: '搜索引擎 × 落地页 热力下钻矩阵（行=入口页 · 列=引擎 · 值=会话数）' })
  getEngineLandingMatrix(
    @Query() query: QueryWebAnalyticsEngineLandingMatrixDto
  ): Promise<IWebAnalyticsEngineLandingMatrixResponse> {
    return this.service.getEngineLandingMatrix(query);
  }

  @Get('visitor-type')
  @ApiOperation({ summary: '官网新访客 vs 回访' })
  getVisitorType(
    @Query() query: QueryWebAnalyticsVisitorTypeDto
  ): Promise<IWebAnalyticsVisitorTypeResponse> {
    return this.service.getVisitorType(query);
  }

  @Get('search-keywords')
  @ApiOperation({ summary: '官网搜索词（referrer 提取）' })
  getSearchKeywords(
    @Query() query: QueryWebAnalyticsSearchKeywordsDto
  ): Promise<IWebAnalyticsSearchKeywordsResponse> {
    return this.service.getSearchKeywords(query);
  }

  @Get('lead-radar')
  @ApiOperation({ summary: 'B2B 线索雷达（按 IP 聚合疑似企业访客）' })
  getLeadRadar(
    @Query() query: QueryWebAnalyticsLeadRadarDto
  ): Promise<IWebAnalyticsLeadRadarResponse> {
    return this.service.getLeadRadar(query);
  }

  @Get('filter-options')
  @ApiOperation({ summary: '官网分析筛选项动态选项' })
  getFilterOptions(
    @Query() query: QueryWebAnalyticsFilterOptionsDto
  ): Promise<IWebAnalyticsFilterOptionsResponse> {
    return this.service.getFilterOptions(query);
  }
}
