import type {
  IXiaohongshuAdvertiserResponse,
  IXiaohongshuConnectionResponse,
  IXiaohongshuDailyReportResponse,
  IXiaohongshuDatasetCatalogResponse,
  IXiaohongshuDatasetDefinition,
  IXiaohongshuDatasetQueryResponse,
  IXiaohongshuManualSyncResult,
  IXiaohongshuRankingResponse,
  IXiaohongshuSummaryResponse,
  IXiaohongshuSyncRun,
  IXiaohongshuSyncRunDetail,
  IXiaohongshuTrendResponse,
  PaginatedResponse,
} from '@ky-azeroth/shared/types';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import {
  XiaohongshuDailyReportQueryDto,
  XiaohongshuDatasetCatalogQueryDto,
  XiaohongshuDatasetQueryDto,
  XiaohongshuManualSyncDto,
  XiaohongshuRankingQueryDto,
  XiaohongshuSummaryQueryDto,
  XiaohongshuSyncRunQueryDto,
  XiaohongshuTrendQueryDto,
} from './dto';
import { XiaohongshuService } from './xiaohongshu.service';
import { XiaohongshuDatasetService } from './xiaohongshu-dataset.service';

@ApiTags('小红书聚光数据')
@ApiBearerAuth()
@Controller('xiaohongshu')
@RequirePermission({ module: 'analytics', menu: 'xiaohongshu', action: 'view' })
export class XiaohongshuController {
  constructor(
    private readonly service: XiaohongshuService,
    private readonly datasets: XiaohongshuDatasetService
  ) {}

  @Get('connection')
  @ApiOperation({ summary: '查询小红书聚光连接状态' })
  getConnection(): Promise<IXiaohongshuConnectionResponse | null> {
    return this.service.getConnection();
  }

  @Get('advertisers')
  @ApiOperation({ summary: '查询已授权广告主' })
  getAdvertisers(): Promise<IXiaohongshuAdvertiserResponse[]> {
    return this.service.getAdvertisers();
  }

  @Get('datasets')
  @ApiOperation({ summary: '查询小红书官方只读数据能力目录' })
  getDatasets(
    @Query() query: XiaohongshuDatasetCatalogQueryDto
  ): Promise<IXiaohongshuDatasetCatalogResponse> {
    return this.datasets.getCatalog(query);
  }

  @Get('datasets/:dataset')
  @ApiOperation({ summary: '查询一个小红书只读数据集的完整调用契约' })
  getDataset(
    @Param('dataset') dataset: string,
    @Query() query: XiaohongshuDatasetCatalogQueryDto
  ): Promise<IXiaohongshuDatasetDefinition> {
    return this.datasets.getDefinition(dataset, query);
  }

  @Post('datasets/:dataset/query')
  @ApiOperation({ summary: '受控分页查询一个小红书官方只读数据集' })
  queryDataset(
    @Param('dataset') dataset: string,
    @Body() input: XiaohongshuDatasetQueryDto
  ): Promise<IXiaohongshuDatasetQueryResponse> {
    return this.datasets.query(dataset, input);
  }

  @Get('reports')
  getReports(
    @Query() query: XiaohongshuDailyReportQueryDto
  ): Promise<IXiaohongshuDailyReportResponse> {
    return this.service.getReports(query);
  }

  @Get('summary')
  getSummary(@Query() query: XiaohongshuSummaryQueryDto): Promise<IXiaohongshuSummaryResponse> {
    return this.service.getSummary(query);
  }

  @Get('trend')
  getTrend(@Query() query: XiaohongshuTrendQueryDto): Promise<IXiaohongshuTrendResponse> {
    return this.service.getTrend(query);
  }

  @Get('ranking')
  getRanking(@Query() query: XiaohongshuRankingQueryDto): Promise<IXiaohongshuRankingResponse> {
    return this.service.getRanking(query);
  }

  @Get('sync-runs')
  getSyncRuns(
    @Query() query: XiaohongshuSyncRunQueryDto
  ): Promise<PaginatedResponse<IXiaohongshuSyncRun>> {
    return this.service.getSyncRuns(query);
  }

  @Get('sync-runs/latest')
  getLatestSyncRun(
    @Query() query: XiaohongshuSyncRunQueryDto
  ): Promise<IXiaohongshuSyncRun | null> {
    return this.service.getLatestSyncRun(query.advertiserId);
  }

  @Get('sync-runs/:id')
  getSyncRun(@Param('id') id: string): Promise<IXiaohongshuSyncRunDetail> {
    return this.service.getSyncRun(id);
  }

  @Post('sync-runs/trigger')
  triggerSync(
    @Body() input: XiaohongshuManualSyncDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IXiaohongshuManualSyncResult> {
    return this.service.triggerSync(input, 'manual', user.id);
  }
}
