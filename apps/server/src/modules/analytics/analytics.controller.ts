/**
 * 经营分析（/analytics）控制器
 *
 * 19 个端点：
 * - 1 个跨盘总览：GET /analytics/overview
 * - 7 个 CRM 经营盘：/analytics/crm/{kpis,funnel,trend,distribution,ranking,aging,sleeping}
 * - 5 个项目交付盘：/analytics/projects/{kpis,distribution,effort,tickets,overdue}
 * - 6 个组织效率盘：/analytics/organization/{kpis,completion,sales-activity,approval-sla,headcount-trend,department-overview}
 *
 * 权限装饰器约定：
 * - module = 'analytics'
 * - menu   = 'overview' | 'crm' | 'projects' | 'organization'
 * - action = 'view'
 *
 * 数据范围：
 * - CRM/总览：resolveChargerScope → 双路径 OR
 * - 项目：resolveChargerScope（同源 employee.id 列表，service 层用单路径 ownerId IN scope）
 * - 组织：M1 ADMIN-only，无范围注入
 */

import type {
  IAnalyticsOverviewResponse,
  ICrmAgingResponse,
  ICrmDistributionResponse,
  ICrmFunnelResponse,
  ICrmKpisResponse,
  ICrmRankingResponse,
  ICrmSleepingResponse,
  ICrmTrendResponse,
  IOrgApprovalSlaResponse,
  IOrgCompletionResponse,
  IOrgDepartmentOverviewResponse,
  IOrgHeadcountTrendResponse,
  IOrgKpisResponse,
  IOrgSalesActivityResponse,
  IProjectDistributionResponse,
  IProjectEffortResponse,
  IProjectKpisResponse,
  IProjectOverdueResponse,
  IProjectTicketsResponse,
} from '@ky-azeroth/shared/types';
import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { DataScopeService } from '../../common/services/data-scope.service';
import { CurrentUser, CurrentUserType } from '../auth/decorators/current-user.decorator';
import { RequirePermission } from '../auth/decorators/require-permission.decorator';
import { AnalyticsRangeDto } from './dto/analytics-range.dto';
import { CrmDistributionQueryDto } from './dto/crm-distribution-query.dto';
import { CrmRankingQueryDto } from './dto/crm-ranking-query.dto';
import { CrmTrendQueryDto } from './dto/crm-trend-query.dto';
import { OrgHeadcountTrendQueryDto } from './dto/org-headcount-trend-query.dto';
import { ProjectDistributionQueryDto } from './dto/project-distribution-query.dto';
import { AnalyticsOverviewService } from './services/analytics-overview.service';
import { CrmAnalyticsService } from './services/crm-analytics.service';
import { OrgAnalyticsService } from './services/org-analytics.service';
import { ProjectAnalyticsService } from './services/project-analytics.service';

@ApiTags('经营分析')
@ApiBearerAuth()
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly overview: AnalyticsOverviewService,
    private readonly crm: CrmAnalyticsService,
    private readonly projects: ProjectAnalyticsService,
    private readonly org: OrgAnalyticsService,
    private readonly dataScope: DataScopeService
  ) {}

  // ========== 跨盘总览 ==========

  @Get('overview')
  @ApiOperation({ summary: '跨盘总览' })
  @RequirePermission({ module: 'analytics', menu: 'overview', action: 'view' })
  async getOverview(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IAnalyticsOverviewResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'overview',
      { employeeId: user.employeeId }
    );
    return this.overview.getOverview(query, scope);
  }

  // ========== CRM 经营盘 ==========

  @Get('crm/kpis')
  @ApiOperation({ summary: 'CRM 经营盘 - 核心 KPI' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmKpis(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ICrmKpisResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getKpis(query, scope);
  }

  @Get('crm/funnel')
  @ApiOperation({ summary: 'CRM 经营盘 - 商机阶段漏斗' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmFunnel(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ICrmFunnelResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getFunnel(query, scope);
  }

  @Get('crm/trend')
  @ApiOperation({ summary: 'CRM 经营盘 - 趋势（metric × bucket）' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmTrend(
    @Query() query: CrmTrendQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ICrmTrendResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getTrend(query, scope);
  }

  @Get('crm/distribution')
  @ApiOperation({ summary: 'CRM 经营盘 - 客户分布（4 维度）' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmDistribution(
    @Query() query: CrmDistributionQueryDto
  ): Promise<ICrmDistributionResponse> {
    // 客户分布不区分 charger 范围（按口径全公司维度）
    return this.crm.getDistribution(query.dimension);
  }

  @Get('crm/ranking')
  @ApiOperation({ summary: 'CRM 经营盘 - 排行榜（销售/客户/产品）' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmRanking(
    @Query() query: CrmRankingQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<ICrmRankingResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getRanking(query, scope);
  }

  @Get('crm/aging')
  @ApiOperation({ summary: 'CRM 经营盘 - 应收账款账龄' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmAging(@CurrentUser() user: CurrentUserType): Promise<ICrmAgingResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getAging(scope);
  }

  @Get('crm/sleeping')
  @ApiOperation({ summary: 'CRM 经营盘 - 沉睡 S+A 客户' })
  @RequirePermission({ module: 'analytics', menu: 'crm', action: 'view' })
  async getCrmSleeping(@CurrentUser() user: CurrentUserType): Promise<ICrmSleepingResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'crm',
      { employeeId: user.employeeId }
    );
    return this.crm.getSleeping(scope);
  }

  // ========== 项目交付盘 ==========

  @Get('projects/kpis')
  @ApiOperation({ summary: '项目交付盘 - 核心 KPI' })
  @RequirePermission({ module: 'analytics', menu: 'projects', action: 'view' })
  async getProjectKpis(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IProjectKpisResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'projects',
      { employeeId: user.employeeId }
    );
    return this.projects.getKpis(query, scope);
  }

  @Get('projects/distribution')
  @ApiOperation({ summary: '项目交付盘 - 状态/分类分布' })
  @RequirePermission({ module: 'analytics', menu: 'projects', action: 'view' })
  async getProjectDistribution(
    @Query() query: ProjectDistributionQueryDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IProjectDistributionResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'projects',
      { employeeId: user.employeeId }
    );
    return this.projects.getDistribution(query.dimension, scope);
  }

  @Get('projects/effort')
  @ApiOperation({ summary: '项目交付盘 - 工时四维（项目/人员/工种/客户）' })
  @RequirePermission({ module: 'analytics', menu: 'projects', action: 'view' })
  async getProjectEffort(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IProjectEffortResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'projects',
      { employeeId: user.employeeId }
    );
    return this.projects.getEffort(query, scope);
  }

  @Get('projects/tickets')
  @ApiOperation({ summary: '项目交付盘 - 工单统计（含 SLA）' })
  @RequirePermission({ module: 'analytics', menu: 'projects', action: 'view' })
  async getProjectTickets(
    @Query() query: AnalyticsRangeDto,
    @CurrentUser() user: CurrentUserType
  ): Promise<IProjectTicketsResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'projects',
      { employeeId: user.employeeId }
    );
    return this.projects.getTickets(query, scope);
  }

  @Get('projects/overdue')
  @ApiOperation({ summary: '项目交付盘 - 延期项目明细' })
  @RequirePermission({ module: 'analytics', menu: 'projects', action: 'view' })
  async getProjectOverdue(@CurrentUser() user: CurrentUserType): Promise<IProjectOverdueResponse> {
    const scope = await this.dataScope.resolveChargerScope(
      user.id,
      user.roles,
      'analytics',
      'projects',
      { employeeId: user.employeeId }
    );
    return this.projects.getOverdue(scope);
  }

  // ========== 组织效率盘（M1 ADMIN-only，靠 menu 权限控制） ==========

  @Get('organization/kpis')
  @ApiOperation({ summary: '组织效率盘 - 核心 KPI' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgKpis(@Query() query: AnalyticsRangeDto): Promise<IOrgKpisResponse> {
    return this.org.getKpis(query);
  }

  @Get('organization/completion')
  @ApiOperation({ summary: '组织效率盘 - 填报完成率（三联）' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgCompletion(@Query() query: AnalyticsRangeDto): Promise<IOrgCompletionResponse> {
    return this.org.getCompletion(query);
  }

  @Get('organization/sales-activity')
  @ApiOperation({ summary: '组织效率盘 - 销售行为' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgSalesActivity(@Query() query: AnalyticsRangeDto): Promise<IOrgSalesActivityResponse> {
    return this.org.getSalesActivity(query);
  }

  @Get('organization/approval-sla')
  @ApiOperation({ summary: '组织效率盘 - 审批 SLA' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgApprovalSla(@Query() query: AnalyticsRangeDto): Promise<IOrgApprovalSlaResponse> {
    return this.org.getApprovalSla(query);
  }

  @Get('organization/headcount-trend')
  @ApiOperation({ summary: '组织效率盘 - 在职/入职/离职月度趋势' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgHeadcountTrend(
    @Query() query: OrgHeadcountTrendQueryDto
  ): Promise<IOrgHeadcountTrendResponse> {
    return this.org.getHeadcountTrend(query);
  }

  @Get('organization/department-overview')
  @ApiOperation({ summary: '组织效率盘 - 部门规模概览' })
  @RequirePermission({ module: 'analytics', menu: 'organization', action: 'view' })
  async getOrgDepartmentOverview(): Promise<IOrgDepartmentOverviewResponse> {
    return this.org.getDepartmentOverview();
  }
}
