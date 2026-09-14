/**
 * 项目交付盘聚合 service（5 个端点完整实现）
 *
 * 数据源：projects / project_sale_orders / sale_orders /
 *         effort_records / employees / project_tickets / customers
 *
 * RBAC（M1 简化）：以 ownerScope = chargerScope 单路径 Project.ownerId IN scope
 * 过滤；工时类查询走 EffortRecord.ownerId IN scope；
 * Tickets 走 assigneeId/dispatcherId IN scope。
 *
 * 工时口径：与 effort-stats.service 一致——仅 recordType='ACTUAL' AND deletedAt IS NULL。
 * hourlyRate 来自 Employee 表手工维护字段。
 */

import {
  PROJECT_STATUS,
  PROJECT_TICKET_PRIORITY,
  PROJECT_TICKET_PRIORITY_LABELS,
  PROJECT_TICKET_STATUS,
  PROJECT_TICKET_TYPE_LABELS,
  type ProjectTicketPriorityValue,
  type ProjectTicketTypeValue,
} from '@ky-azeroth/shared/constants';
import type { AnalyticsRangeInput } from '@ky-azeroth/shared/schemas';
import type {
  IDistributionItem,
  IProjectDistributionResponse,
  IProjectEffortResponse,
  IProjectKpisResponse,
  IProjectOverdueResponse,
  IProjectTicketsResponse,
} from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_EMPLOYEE_WHERE } from '../../employees/employees.helper';
import { resolveAnalyticsRange } from '../helpers/date-range.helper';

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

@Injectable()
export class ProjectAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== KPIs ====================

  async getKpis(
    range: AnalyticsRangeInput,
    ownerScope: string[] | null
  ): Promise<IProjectKpisResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    if (Array.isArray(ownerScope) && ownerScope.length === 0) {
      return {
        range: meta,
        activeProjectCount: 0,
        totalProjectCount: 0,
        newProjectCountMtd: 0,
        overdueProjectCount: 0,
        totalEffortHours: 0,
        totalLaborCost: 0,
        hourlyRateCoverage: 0,
      };
    }

    const ownerWhere: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(ownerScope && { ownerId: { in: ownerScope } }),
    };
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
    const effortOwnerWhere: Prisma.EffortRecordWhereInput = {
      deletedAt: null,
      recordType: 'ACTUAL',
      workDate: { gte: startDate, lt: endDate },
      ...(ownerScope && { ownerId: { in: ownerScope } }),
    };

    const [
      activeProjectCount,
      totalProjectCount,
      newProjectCountMtd,
      overdueProjectCount,
      effortSum,
      hourlyRateStats,
    ] = await Promise.all([
      this.prisma.project.count({
        where: { ...ownerWhere, status: { in: ACTIVE_PROJECT_STATUSES } },
      }),
      this.prisma.project.count({ where: ownerWhere }),
      this.prisma.project.count({
        where: { ...ownerWhere, createdAt: { gte: monthStart } },
      }),
      this.prisma.project.count({
        where: {
          ...ownerWhere,
          endDate: { not: null, lt: new Date() },
          NOT: { status: { in: COMPLETED_STATUSES } },
        },
      }),
      this.prisma.effortRecord.aggregate({
        where: effortOwnerWhere,
        _sum: { actualTime: true },
      }),
      this.computeHourlyRateCoverage(),
    ]);

    // @prisma-raw-sql: 总成本需 SUM(actualTime × hourlyRate) 跨表算术，Prisma aggregate 不支持表达式聚合
    const costRows = await this.prisma.$queryRaw<Array<{ total_cost: number | string | null }>>`
      SELECT COALESCE(SUM(er."actualTime" * COALESCE(e."hourlyRate", 0)), 0)::float AS total_cost
      FROM effort_records er
      LEFT JOIN employees e ON e.id = er."ownerId"
      WHERE er."deletedAt" IS NULL
        AND er."recordType" = 'ACTUAL'
        AND er."workDate" >= ${startDate}
        AND er."workDate" < ${endDate}
        ${ownerScope ? Prisma.sql`AND er."ownerId" = ANY(${ownerScope}::text[])` : Prisma.empty}
    `;
    const totalLaborCost = DECIMAL_2(Number(costRows[0]?.total_cost ?? 0));

    return {
      range: meta,
      activeProjectCount,
      totalProjectCount,
      newProjectCountMtd,
      overdueProjectCount,
      totalEffortHours: DECIMAL_2(dec(effortSum._sum.actualTime)),
      totalLaborCost,
      hourlyRateCoverage: hourlyRateStats,
    };
  }

  private async computeHourlyRateCoverage(): Promise<number> {
    const [total, withRate] = await Promise.all([
      this.prisma.employee.count({ where: ACTIVE_EMPLOYEE_WHERE }),
      this.prisma.employee.count({
        where: { ...ACTIVE_EMPLOYEE_WHERE, hourlyRate: { not: null, gt: 0 } },
      }),
    ]);
    if (total === 0) return 0;
    return DECIMAL_2((withRate / total) * 100);
  }

  // ==================== 项目分布 ====================

  async getDistribution(
    dimension: string,
    ownerScope: string[] | null
  ): Promise<IProjectDistributionResponse> {
    if (Array.isArray(ownerScope) && ownerScope.length === 0) {
      return { dimension, items: [] };
    }

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      ...(ownerScope && { ownerId: { in: ownerScope } }),
    };

    if (dimension === 'status') {
      const rows = await this.prisma.project.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => ({
          key: r.status,
          label: r.status,
          count: r._count._all,
          percentage: DECIMAL_2((r._count._all / total) * 100),
        }))
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    if (dimension === 'category') {
      const rows = await this.prisma.project.groupBy({
        by: ['category'],
        where: { ...where, NOT: { category: null } },
        _count: { _all: true },
      });
      const total = rows.reduce((a, r) => a + r._count._all, 0) || 1;
      const items: IDistributionItem[] = rows
        .map((r) => ({
          key: r.category ?? '未分类',
          label: r.category ?? '未分类',
          count: r._count._all,
          percentage: DECIMAL_2((r._count._all / total) * 100),
        }))
        .sort((a, b) => b.count - a.count);
      return { dimension, items };
    }

    return { dimension, items: [] };
  }

  // ==================== 工时四维 ====================

  async getEffort(
    range: AnalyticsRangeInput,
    ownerScope: string[] | null
  ): Promise<IProjectEffortResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    if (Array.isArray(ownerScope) && ownerScope.length === 0) {
      return { range: meta, byProject: [], byPerson: [], byWorkType: [], byCustomer: [] };
    }

    const effortWhere: Prisma.EffortRecordWhereInput = {
      deletedAt: null,
      recordType: 'ACTUAL',
      workDate: { gte: startDate, lt: endDate },
      ...(ownerScope && { ownerId: { in: ownerScope } }),
    };

    // byPerson：ownerId 聚合 + 饱和度（5/7 工作日数粗算）
    const personRowsP = this.prisma.effortRecord.groupBy({
      by: ['ownerId'],
      where: effortWhere,
      _sum: { actualTime: true },
      _count: { _all: true },
    });

    // byProject：projectId 聚合，需要 distinct ownerId（独立查询）
    const projectGroupP = this.prisma.effortRecord.groupBy({
      by: ['projectId'],
      where: effortWhere,
      _sum: { actualTime: true },
    });

    // byWorkType：workType 聚合
    const workTypeRowsP = this.prisma.effortRecord.groupBy({
      by: ['workType'],
      where: effortWhere,
      _sum: { actualTime: true },
      _count: { _all: true },
    });

    // @prisma-raw-sql: byCustomer 需 effort_records → projects → customers 三表 JOIN + actualTime×hourlyRate 跨表算术，Prisma groupBy 不支持
    const customerRowsP = this.prisma.$queryRaw<
      Array<{
        customerId: string | null;
        customerName: string | null;
        total_hours: number | string | null;
        total_cost: number | string | null;
      }>
    >`
      SELECT
        p."customerId" AS "customerId",
        c."customerName" AS "customerName",
        COALESCE(SUM(er."actualTime"), 0)::float AS total_hours,
        COALESCE(SUM(er."actualTime" * COALESCE(e."hourlyRate", 0)), 0)::float AS total_cost
      FROM effort_records er
      JOIN projects p ON p.id = er."projectId"
      LEFT JOIN customers c ON c.id = p."customerId"
      LEFT JOIN employees e ON e.id = er."ownerId"
      WHERE er."deletedAt" IS NULL
        AND er."recordType" = 'ACTUAL'
        AND er."workDate" >= ${startDate}
        AND er."workDate" < ${endDate}
        ${ownerScope ? Prisma.sql`AND er."ownerId" = ANY(${ownerScope}::text[])` : Prisma.empty}
      GROUP BY p."customerId", c."customerName"
      ORDER BY total_hours DESC
      LIMIT 30
    `;

    const [personRows, projectGroup, workTypeRows, customerRows] = await Promise.all([
      personRowsP,
      projectGroupP,
      workTypeRowsP,
      customerRowsP,
    ]);

    // ==================== byPerson：补员工名 + 饱和度 ====================
    const personEmployeeIds = personRows
      .map((r) => r.ownerId)
      .filter((x): x is string => Boolean(x));
    const personEmployees =
      personEmployeeIds.length === 0
        ? []
        : await this.prisma.employee.findMany({
            where: { id: { in: personEmployeeIds } },
            select: { id: true, name: true },
          });
    const personNameMap = new Map(personEmployees.map((e) => [e.id, e.name]));

    const totalDays = Math.floor((endDate.getTime() - startDate.getTime()) / 86400000);
    const workDays = Math.max(1, Math.round((totalDays * 5) / 7));

    const byPerson = personRows
      .map((r) => {
        const totalHours = dec(r._sum.actualTime);
        return {
          ownerId: r.ownerId ?? '',
          ownerName: r.ownerId ? (personNameMap.get(r.ownerId) ?? '（已离职）') : '（未指派）',
          totalHours: DECIMAL_2(totalHours),
          recordCount: r._count._all,
          saturation: DECIMAL_2(totalHours / (workDays * 8)),
        };
      })
      .sort((a, b) => b.totalHours - a.totalHours);

    // ==================== byProject：补项目名 + participantCount ====================
    const projectIds = projectGroup.map((r) => r.projectId);
    const [projectMeta, participantsByProject] = await Promise.all([
      projectIds.length === 0
        ? Promise.resolve([] as Array<{ id: string; name: string }>)
        : this.prisma.project.findMany({
            where: { id: { in: projectIds } },
            select: { id: true, name: true },
          }),
      projectIds.length === 0
        ? Promise.resolve([] as Array<{ projectId: string; participant_count: number | string }>)
        : // @prisma-raw-sql: 需要 COUNT(DISTINCT ownerId)，Prisma groupBy 不支持 distinct count
          this.prisma.$queryRaw<Array<{ projectId: string; participant_count: number | string }>>`
            SELECT "projectId", COUNT(DISTINCT "ownerId")::int AS participant_count
            FROM effort_records
            WHERE "deletedAt" IS NULL
              AND "recordType" = 'ACTUAL'
              AND "projectId" = ANY(${projectIds}::text[])
              AND "workDate" >= ${startDate}
              AND "workDate" < ${endDate}
            GROUP BY "projectId"
          `,
    ]);
    const projectMetaMap = new Map(projectMeta.map((p) => [p.id, p.name]));
    const participantMap = new Map<string, number>();
    for (const row of participantsByProject) {
      participantMap.set(row.projectId, Number(row.participant_count));
    }

    const byProject = projectGroup
      .map((r) => ({
        projectId: r.projectId,
        projectName: projectMetaMap.get(r.projectId) ?? '（已删除项目）',
        totalHours: DECIMAL_2(dec(r._sum.actualTime)),
        participantCount: participantMap.get(r.projectId) ?? 0,
      }))
      .sort((a, b) => b.totalHours - a.totalHours);

    // ==================== byWorkType ====================
    const workTypeTotal = workTypeRows.reduce((a, r) => a + dec(r._sum.actualTime), 0) || 1;
    const byWorkType = workTypeRows
      .map((r) => {
        const h = dec(r._sum.actualTime);
        return {
          workType: r.workType ?? '未填工种',
          totalHours: DECIMAL_2(h),
          recordCount: r._count._all,
          percentage: DECIMAL_2((h / workTypeTotal) * 100),
        };
      })
      .sort((a, b) => b.totalHours - a.totalHours);

    // ==================== byCustomer ====================
    const byCustomer = customerRows
      .filter((r) => r.customerId)
      .map((r) => ({
        customerId: r.customerId!,
        customerName: r.customerName ?? '（未关联客户）',
        totalHours: DECIMAL_2(Number(r.total_hours ?? 0)),
        totalCost: DECIMAL_2(Number(r.total_cost ?? 0)),
      }));

    return { range: meta, byProject, byPerson, byWorkType, byCustomer };
  }

  // ==================== 工单统计（含 SLA + 平均时长 + 类型/优先级分布） ====================

  async getTickets(
    range: AnalyticsRangeInput,
    ownerScope: string[] | null
  ): Promise<IProjectTicketsResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    if (Array.isArray(ownerScope) && ownerScope.length === 0) {
      return this.emptyTickets(meta);
    }

    // 期间过滤：工单按 createdAt 入口期间
    const baseWhere: Prisma.ProjectTicketWhereInput = {
      deletedAt: null,
      createdAt: { gte: startDate, lt: endDate },
      ...(ownerScope && {
        OR: [{ assigneeId: { in: ownerScope } }, { dispatcherId: { in: ownerScope } }],
      }),
    };

    const [
      counts,
      typeRows,
      priorityRows,
      completedSamples,
      closedSamples,
      slaTotalSamples,
      slaWithinSamples,
    ] = await Promise.all([
      this.computeTicketCounts(baseWhere),
      this.prisma.projectTicket.groupBy({
        by: ['ticketType'],
        where: baseWhere,
        _count: { _all: true },
      }),
      this.prisma.projectTicket.groupBy({
        by: ['priority'],
        where: baseWhere,
        _count: { _all: true },
      }),
      // 平均解决时长样本（COMPLETED + CLOSED，含 startedAt 与 completedAt）
      this.prisma.projectTicket.findMany({
        where: {
          ...baseWhere,
          status: { in: [PROJECT_TICKET_STATUS.COMPLETED, PROJECT_TICKET_STATUS.CLOSED] },
          startedAt: { not: null },
          completedAt: { not: null },
        },
        select: { startedAt: true, completedAt: true },
        take: 5000,
      }),
      // 平均闭环时长样本（CLOSED，createdAt → closedAt）
      this.prisma.projectTicket.findMany({
        where: {
          ...baseWhere,
          status: PROJECT_TICKET_STATUS.CLOSED,
          closedAt: { not: null },
        },
        select: { createdAt: true, closedAt: true },
        take: 5000,
      }),
      // SLA：完成且有 dueDate 的样本数
      this.prisma.projectTicket.count({
        where: {
          ...baseWhere,
          completedAt: { not: null },
          dueDate: { not: null },
        },
      }),
      // @prisma-raw-sql: SLA 达成数需 completedAt ≤ dueDate 字段间比较，Prisma where 不支持双字段比较
      this.prisma.$queryRaw<Array<{ count: number | string }>>`
        SELECT COUNT(*)::int AS count
        FROM project_tickets
        WHERE "deletedAt" IS NULL
          AND "createdAt" >= ${startDate}
          AND "createdAt" < ${endDate}
          AND "completedAt" IS NOT NULL
          AND "dueDate" IS NOT NULL
          AND "completedAt" <= "dueDate"
          ${
            ownerScope
              ? Prisma.sql`AND ("assigneeId" = ANY(${ownerScope}::text[]) OR "dispatcherId" = ANY(${ownerScope}::text[]))`
              : Prisma.empty
          }
      `,
    ]);

    const typeTotal = typeRows.reduce((a, r) => a + r._count._all, 0) || 1;
    const byType: IDistributionItem[] = typeRows
      .map((r) => ({
        key: r.ticketType,
        label: PROJECT_TICKET_TYPE_LABELS[r.ticketType as ProjectTicketTypeValue] ?? r.ticketType,
        count: r._count._all,
        percentage: DECIMAL_2((r._count._all / typeTotal) * 100),
      }))
      .sort((a, b) => b.count - a.count);

    const priorityTotal = priorityRows.reduce((a, r) => a + r._count._all, 0) || 1;
    // 按 HIGH/MEDIUM/LOW 顺序固定
    const priorityOrder: ProjectTicketPriorityValue[] = [
      PROJECT_TICKET_PRIORITY.HIGH,
      PROJECT_TICKET_PRIORITY.MEDIUM,
      PROJECT_TICKET_PRIORITY.LOW,
    ];
    const priorityMap = new Map(priorityRows.map((r) => [r.priority, r._count._all]));
    const byPriority: IDistributionItem[] = priorityOrder.map((p) => {
      const count = priorityMap.get(p) ?? 0;
      return {
        key: p,
        label: PROJECT_TICKET_PRIORITY_LABELS[p],
        count,
        percentage: DECIMAL_2((count / priorityTotal) * 100),
      };
    });

    // 平均解决时长（小时）
    const avgResolutionHours = completedSamples.length
      ? DECIMAL_2(
          completedSamples.reduce((acc, t) => {
            if (!t.startedAt || !t.completedAt) return acc;
            return acc + (t.completedAt.getTime() - t.startedAt.getTime()) / 3600000;
          }, 0) / completedSamples.length
        )
      : 0;

    // 平均闭环时长（小时）
    const avgClosureHours = closedSamples.length
      ? DECIMAL_2(
          closedSamples.reduce((acc, t) => {
            if (!t.closedAt) return acc;
            return acc + (t.closedAt.getTime() - t.createdAt.getTime()) / 3600000;
          }, 0) / closedSamples.length
        )
      : 0;

    const slaRate = slaTotalSamples
      ? DECIMAL_2((Number(slaWithinSamples[0]?.count ?? 0) / slaTotalSamples) * 100)
      : 0;

    return {
      range: meta,
      counts,
      byType,
      byPriority,
      slaRate,
      avgResolutionHours,
      avgClosureHours,
    };
  }

  private async computeTicketCounts(
    baseWhere: Prisma.ProjectTicketWhereInput
  ): Promise<IProjectTicketsResponse['counts']> {
    const grouped = await this.prisma.projectTicket.groupBy({
      by: ['status'],
      where: baseWhere,
      _count: { _all: true },
    });
    const map = new Map(grouped.map((g) => [g.status, g._count._all]));
    const overdue = await this.prisma.projectTicket.count({
      where: {
        ...baseWhere,
        status: { in: [PROJECT_TICKET_STATUS.PENDING, PROJECT_TICKET_STATUS.IN_PROGRESS] },
        dueDate: { not: null, lt: new Date() },
      },
    });
    return {
      pending: map.get(PROJECT_TICKET_STATUS.PENDING) ?? 0,
      inProgress: map.get(PROJECT_TICKET_STATUS.IN_PROGRESS) ?? 0,
      completed: map.get(PROJECT_TICKET_STATUS.COMPLETED) ?? 0,
      closed: map.get(PROJECT_TICKET_STATUS.CLOSED) ?? 0,
      cancelled: map.get(PROJECT_TICKET_STATUS.CANCELLED) ?? 0,
      overdue,
    };
  }

  private emptyTickets(meta: IProjectTicketsResponse['range']): IProjectTicketsResponse {
    return {
      range: meta,
      counts: {
        pending: 0,
        inProgress: 0,
        completed: 0,
        closed: 0,
        cancelled: 0,
        overdue: 0,
      },
      byType: [],
      byPriority: [],
      slaRate: 0,
      avgResolutionHours: 0,
      avgClosureHours: 0,
    };
  }

  // ==================== 延期项目明细 ====================

  async getOverdue(ownerScope: string[] | null): Promise<IProjectOverdueResponse> {
    if (Array.isArray(ownerScope) && ownerScope.length === 0) {
      return { items: [], total: 0 };
    }

    const where: Prisma.ProjectWhereInput = {
      deletedAt: null,
      endDate: { not: null, lt: new Date() },
      NOT: { status: { in: COMPLETED_STATUSES } },
      ...(ownerScope && { ownerId: { in: ownerScope } }),
    };

    const [total, projects] = await Promise.all([
      this.prisma.project.count({ where }),
      this.prisma.project.findMany({
        where,
        select: {
          id: true,
          name: true,
          status: true,
          endDate: true,
          ownerName: true,
          customer: { select: { customerName: true } },
        },
        orderBy: [{ endDate: 'asc' }],
        take: 200,
      }),
    ]);

    const now = Date.now();
    return {
      items: projects.map((p) => ({
        projectId: p.id,
        projectName: p.name,
        customerName: p.customer?.customerName ?? null,
        ownerName: p.ownerName,
        status: p.status,
        endDate: p.endDate!.toISOString(),
        daysOverdue: Math.floor((now - p.endDate!.getTime()) / 86400000),
      })),
      total,
    };
  }
}
