/**
 * 跨盘总览聚合 service（GET /analytics/overview）
 *
 * 实现策略：
 * - 6 个跨盘 KPI 自查（一次性 Promise.all 直达 Prisma，避免穿透多个 service 的范围注入）
 * - CRM 漏斗 mini → 复用 CrmAnalyticsService.getFunnel（传同样的 dateRange + scope）
 * - 项目工时 Top5 mini → 复用 ProjectAnalyticsService.getEffort 取 byProject Top5
 * - DAU 14 天折线 → 自查 LoginLog
 * - 异常告警三联 → 各自轻量查询，避免再传 dateRange
 */

import { CUSTOMER_LEVEL, DEAL_STATUS, PROJECT_STATUS } from '@ky-azeroth/shared/constants';
import type { AnalyticsRangeInput } from '@ky-azeroth/shared/schemas';
import type { IAnalyticsOverviewResponse, ITrendPoint } from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { applyChargerOrCustomerScope } from '../../../common/services/data-scope.service';
import { resolveAnalyticsRange } from '../helpers/date-range.helper';
import { bucketizeTrend } from '../helpers/trend-bucket.helper';
import { CrmAnalyticsService } from './crm-analytics.service';
import { ProjectAnalyticsService } from './project-analytics.service';

const DECIMAL_2 = (n: number): number => Math.round(n * 100) / 100;
const dec = (v: Prisma.Decimal | number | null | undefined): number => {
  if (v == null) return 0;
  if (typeof v === 'number') return v;
  const t = v as { toNumber?: () => number };
  return typeof t.toNumber === 'function' ? t.toNumber() : Number(v);
};

const ACTIVE_PROJECT_STATUSES: string[] = [
  PROJECT_STATUS.OPPORTUNITY,
  PROJECT_STATUS.CONTRACT,
  PROJECT_STATUS.NOT_STARTED,
  PROJECT_STATUS.DEMO,
  PROJECT_STATUS.IN_PROGRESS,
  PROJECT_STATUS.TESTING,
  PROJECT_STATUS.MAINTENANCE,
];

const COMPLETED_STATUSES: string[] = [PROJECT_STATUS.COMPLETED, PROJECT_STATUS.LOST];

const SLEEPING_DAYS = 90;

@Injectable()
export class AnalyticsOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crm: CrmAnalyticsService,
    private readonly projects: ProjectAnalyticsService
  ) {}

  async getOverview(
    range: AnalyticsRangeInput,
    chargerScope: string[] | null
  ): Promise<IAnalyticsOverviewResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    if (Array.isArray(chargerScope) && chargerScope.length === 0) {
      return this.emptyOverview(meta);
    }

    const ownerScope = chargerScope; // M1 项目 ownerScope = chargerScope（同源 employeeId 列表）

    const periodDays = Math.max(
      1,
      Math.round((endDate.getTime() - startDate.getTime()) / 86400000)
    );

    // ==================== 并发：6 个 KPI ====================
    const [
      newCustomers,
      paymentInAgg,
      paymentOutAgg,
      newOrderAgg,
      activeProjectCount,
      effortSum,
      keepRecordsCount,
    ] = await Promise.all([
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          createdAt: { gte: startDate, lt: endDate },
          ...(chargerScope && { chargerId: { in: chargerScope } }),
        },
      }),
      this.prisma.payment.aggregate({
        where: applyChargerOrCustomerScope(
          {
            deletedAt: null,
            flowStatus: 'approved',
            direction: 'IN',
            businessDate: { gte: startDate, lt: endDate },
          },
          chargerScope
        ),
        _sum: { paymentAmount: true },
      }),
      this.prisma.payment.aggregate({
        where: applyChargerOrCustomerScope(
          {
            deletedAt: null,
            flowStatus: 'approved',
            direction: 'OUT',
            businessDate: { gte: startDate, lt: endDate },
          },
          chargerScope
        ),
        _sum: { paymentAmount: true },
      }),
      this.prisma.saleOrder.aggregate({
        where: applyChargerOrCustomerScope(
          { deletedAt: null, createdAt: { gte: startDate, lt: endDate } },
          chargerScope
        ),
        _sum: { orderAmount: true },
      }),
      this.prisma.project.count({
        where: {
          deletedAt: null,
          status: { in: ACTIVE_PROJECT_STATUSES },
          ...(ownerScope && { ownerId: { in: ownerScope } }),
        },
      }),
      this.prisma.effortRecord.aggregate({
        where: {
          deletedAt: null,
          recordType: 'ACTUAL',
          workDate: { gte: startDate, lt: endDate },
          ...(ownerScope && { ownerId: { in: ownerScope } }),
        },
        _sum: { actualTime: true },
      }),
      this.prisma.keepRecord.count({
        where: applyChargerOrCustomerScope(
          { deletedAt: null, keepRecordTime: { gte: startDate, lt: endDate } },
          chargerScope
        ),
      }),
    ]);

    // ==================== CRM 漏斗 mini + 项目工时 Top5 + DAU 14d + 告警 ====================
    const dauStart = new Date();
    dauStart.setDate(dauStart.getDate() - 14);
    const sleepingCutoff = new Date();
    sleepingCutoff.setDate(sleepingCutoff.getDate() - SLEEPING_DAYS);

    const [
      funnel,
      effortResp,
      loginLogs,
      sleepingSaCount,
      overdueProjectCount,
      pendingApprovalCount,
    ] = await Promise.all([
      this.crm.getFunnel(range, chargerScope),
      this.projects.getEffort(range, ownerScope),
      this.prisma.loginLog.findMany({
        where: {
          actionType: 'login',
          status: 'success',
          createdAt: { gte: dauStart },
          employeeId: { not: null },
        },
        select: { employeeId: true, createdAt: true },
      }),
      this.prisma.customer.count({
        where: {
          deletedAt: null,
          customerLevel: { in: [CUSTOMER_LEVEL.S, CUSTOMER_LEVEL.A] },
          OR: [{ lastKeepRecordTime: null }, { lastKeepRecordTime: { lt: sleepingCutoff } }],
          NOT: { dealStatus: { in: [DEAL_STATUS.WON, DEAL_STATUS.MULTI_WON] } },
          ...(chargerScope && { chargerId: { in: chargerScope } }),
        },
      }),
      this.prisma.project.count({
        where: {
          deletedAt: null,
          endDate: { not: null, lt: new Date() },
          NOT: { status: { in: COMPLETED_STATUSES } },
          ...(ownerScope && { ownerId: { in: ownerScope } }),
        },
      }),
      this.prisma.approvalTask.count({
        where: { deletedAt: null, status: 'pending' },
      }),
    ]);

    // DAU 折线：14 天去重员工
    const dayDistinctMap = new Map<string, Set<string>>();
    for (const r of loginLogs) {
      if (!r.employeeId) continue;
      const k = this.ymd(r.createdAt);
      const s = dayDistinctMap.get(k) ?? new Set<string>();
      s.add(r.employeeId);
      dayDistinctMap.set(k, s);
    }
    const dauRows = Array.from(dayDistinctMap.entries()).map(([day, set]) => ({
      at: new Date(day),
      value: set.size,
    }));
    const dauTrend: ITrendPoint[] = bucketizeTrend(dauRows, dauStart, new Date(), 'day');

    const projectEffortMini = effortResp.byProject.slice(0, 5).map((p) => ({
      projectId: p.projectId,
      projectName: p.projectName,
      hours: p.totalHours,
    }));

    const crmFunnelMini = funnel.stages.map((s) => ({
      stage: s.stage,
      count: s.count,
      amount: s.amount,
    }));

    return {
      range: meta,
      kpis: {
        newCustomersCount: newCustomers,
        paymentAmount: DECIMAL_2(
          dec(paymentInAgg._sum.paymentAmount) - dec(paymentOutAgg._sum.paymentAmount)
        ),
        newOrderAmount: DECIMAL_2(dec(newOrderAgg._sum.orderAmount)),
        activeProjectCount,
        totalEffortHours: DECIMAL_2(dec(effortSum._sum.actualTime)),
        dailyKeepRecordAvg: DECIMAL_2(keepRecordsCount / periodDays),
      },
      crmFunnelMini,
      projectEffortMini,
      dauTrend,
      alerts: {
        sleepingSaCount,
        overdueProjectCount,
        pendingApprovalCount,
      },
    };
  }

  private emptyOverview(meta: IAnalyticsOverviewResponse['range']): IAnalyticsOverviewResponse {
    return {
      range: meta,
      kpis: {
        newCustomersCount: 0,
        paymentAmount: 0,
        newOrderAmount: 0,
        activeProjectCount: 0,
        totalEffortHours: 0,
        dailyKeepRecordAvg: 0,
      },
      crmFunnelMini: [],
      projectEffortMini: [],
      dauTrend: [],
      alerts: { sleepingSaCount: 0, overdueProjectCount: 0, pendingApprovalCount: 0 },
    };
  }

  private ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
}
