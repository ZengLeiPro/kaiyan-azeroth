import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ZodValidationPipe } from 'nestjs-zod';

import { CommonModule } from './common/common.module';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AttachmentDownloadUrlInterceptor } from './common/interceptors/attachment-download-url.interceptor';
import { OperationLogInterceptor } from './common/interceptors/operation-log.interceptor';
import { PrismaModule } from './common/prisma/prisma.module';
import { validateEnv } from './config/env.validation';
import { InternalModule } from './internal/internal.module';
import { ActivitiesModule } from './modules/activities/activities.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { ApprovalFlowsModule } from './modules/approval-flows/approval-flows.module';
import { ApprovalsModule } from './modules/approvals/approvals.module';
import { AuthModule } from './modules/auth/auth.module';
import { FreshJwtGuard } from './modules/auth/guards/fresh-jwt.guard';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { PermissionGuard } from './modules/auth/guards/permission.guard';
// 运维 / 云成本模块
import { CloudAlertsModule } from './modules/cloud-alerts/cloud-alerts.module';
import { CloudBillSnapshotsModule } from './modules/cloud-bill-snapshots/cloud-bill-snapshots.module';
import { CloudInstanceMetasModule } from './modules/cloud-instance-metas/cloud-instance-metas.module';
import { CloudUsageMetricsModule } from './modules/cloud-usage-metrics/cloud-usage-metrics.module';
import { ContactsModule } from './modules/contacts/contacts.module';
import { CrmProductsModule } from './modules/crm-products/crm-products.module';
import { CrmWorkDailiesModule } from './modules/crm-work-dailies/crm-work-dailies.module';
// CRM 模块
import { CustomersModule } from './modules/customers/customers.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DingtalkCalendarEventsModule } from './modules/dingtalk-calendar-events/dingtalk-calendar-events.module';
// 钉钉数据展示模块（只读）
import { DingtalkLogsModule } from './modules/dingtalk-logs/dingtalk-logs.module';
// 钉钉手动增量同步模块（管理员触发）
import { DingtalkSyncModule } from './modules/dingtalk-sync/dingtalk-sync.module';
import { EffortRecordsModule } from './modules/effort-records/effort-records.module';
import { EmployeeLeavesModule } from './modules/employee-leaves/employee-leaves.module';
import { EmployeesModule } from './modules/employees/employees.module';
import { FilterSchemesModule } from './modules/filter-schemes/filter-schemes.module';
import { FinanceModule } from './modules/finance/finance.module';
import { HealthModule } from './modules/health/health.module';
import { HolidaysModule } from './modules/holidays/holidays.module';
import { InvoicesModule } from './modules/invoices/invoices.module';
import { KeepRecordsModule } from './modules/keep-records/keep-records.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { OperationLogsModule } from './modules/operation-logs/operation-logs.module';
import { OpportunitiesModule } from './modules/opportunities/opportunities.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { PayrollModule } from './modules/payroll/payroll.module';
// 项目管理模块
import { ProjectTicketsModule } from './modules/project-tickets/project-tickets.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RateLimitTestModule } from './modules/rate-limit-test/rate-limit-test.module';
import { RolesModule } from './modules/roles/roles.module';
import { SaleOrdersModule } from './modules/sale-orders/sale-orders.module';
import { SalesActionItemsModule } from './modules/sales-action-items/sales-action-items.module';
// SEO 监测模块（数据看板，4 张表只读 + 同步运行历史）
import { SeoMonitorModule } from './modules/seo-monitor/seo-monitor.module';
import { SessionsModule } from './modules/sessions/sessions.module';
import { SystemParamsModule } from './modules/system-params/system-params.module';
import { TablePreferencesModule } from './modules/table-preferences/table-preferences.module';
import { UploadModule } from './modules/upload/upload.module';
import { UsersModule } from './modules/users/users.module';
import { VisitRecordsModule } from './modules/visit-records/visit-records.module';
import { WebAnalyticsModule } from './modules/web-analytics/web-analytics.module';
import { WebEventsModule } from './modules/web-events/web-events.module';
import { WebsiteLeadsModule } from './modules/website-leads/website-leads.module';
import { XiaohongshuOauthModule } from './modules/xiaohongshu-oauth/xiaohongshu-oauth.module';

@Module({
  imports: [
    // 配置模块
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      validate: validateEnv,
    }),

    // 速率限制
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('THROTTLE_TTL') * 1000,
          limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
        },
      ],
    }),

    // 定时任务
    ScheduleModule.forRoot(),

    // 数据库
    PrismaModule,

    // 公共模块
    CommonModule,

    // 认证授权
    AuthModule,
    UsersModule,
    RolesModule,
    SessionsModule,

    // 组织管理
    EmployeesModule,
    DepartmentsModule,

    // CRM 模块
    CustomersModule,
    ContactsModule,
    OpportunitiesModule,
    SaleOrdersModule,
    PaymentsModule,
    PayrollModule,
    FinanceModule,
    InvoicesModule,
    KeepRecordsModule,
    VisitRecordsModule,
    CrmProductsModule,
    CrmWorkDailiesModule,
    SalesActionItemsModule,
    // 客户活动时间线（投影派，只读 union）
    ActivitiesModule,

    // 项目管理模块
    ProjectsModule,
    EffortRecordsModule,
    ProjectTicketsModule,

    // 钉钉数据展示模块（只读）
    DingtalkLogsModule,
    DingtalkCalendarEventsModule,
    EmployeeLeavesModule,

    // 钉钉手动增量同步（管理员按钮触发，仅 logs/calendar 两个实体）
    DingtalkSyncModule,

    // 系统管理模块
    SystemParamsModule,
    FilterSchemesModule,
    TablePreferencesModule,
    OperationLogsModule,
    NotificationsModule,
    UploadModule,
    HolidaysModule,

    // 仪表盘模块
    DashboardModule,

    // 经营分析模块（19 个只读聚合端点 / overview + crm + projects + organization）
    AnalyticsModule,

    // 内部接口模块（CLI 分发 + 带幂等账本的 prepared 财务导入；数据库迁移已独立）
    InternalModule,

    // 健康检查模块（liveness/readiness，不是业务健康中心）
    HealthModule,

    // 限流测试模块（开发/演示用）
    RateLimitTestModule,

    // 审批流程模块
    ApprovalsModule,
    ApprovalFlowsModule,

    // 运维 / 云成本模块
    CloudAlertsModule,
    CloudBillSnapshotsModule,
    CloudInstanceMetasModule,
    CloudUsageMetricsModule,

    // SEO 监测模块（4 张表只读看板 + 同步任务历史）
    SeoMonitorModule,

    // 官网第一方埋点分析（web_analytics schema 只读）
    // - WebAnalyticsModule：聚合接口（KPI / 漏斗 / 归因），前端「数据看板」用
    // - WebEventsModule：事件流原始数据 list/get + admin 归档，CLI 自动派生
    WebAnalyticsModule,
    WebEventsModule,
    WebsiteLeadsModule,

    // 第三方 OAuth 回调
    XiaohongshuOauthModule,
  ],
  controllers: [],
  providers: [
    {
      provide: APP_PIPE,
      useClass: ZodValidationPipe,
    },
    {
      provide: APP_FILTER,
      useClass: GlobalExceptionFilter,
    },
    // 全局速率限制守卫：所有端点默认受限，@Throttle() 可自定义
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // 全局认证守卫：所有端点默认需要 JWT 认证，@Public() 可跳过
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    // 全局权限守卫：配合 @RequirePermission 装饰器进行细粒度权限检查
    {
      provide: APP_GUARD,
      useClass: PermissionGuard,
    },
    // 高风险 step-up：配合 @RequireFreshJwt 要求最近五分钟 JWT，PAT 一律拒绝
    {
      provide: APP_GUARD,
      useClass: FreshJwtGuard,
    },
    // 全局操作日志拦截器：自动记录 POST/PUT/PATCH/DELETE 到 operation_logs
    // @SkipAudit() 装饰器可跳过单个端点或整个 controller
    {
      provide: APP_INTERCEPTOR,
      useClass: OperationLogInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AttachmentDownloadUrlInterceptor,
    },
  ],
})
export class AppModule {}
