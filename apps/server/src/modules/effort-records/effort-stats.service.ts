import type {
  IEffortCompletionRecord,
  IEffortCustomerStat,
  IEffortPersonStat,
  IEffortProjectStat,
  IEffortWorkTypeStat,
} from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { ACTIVE_EMPLOYEE_WHERE } from '../employees/employees.helper';
import { HolidaysService } from '../holidays/holidays.service';

export interface StatsFilters {
  projectId?: string[];
  customerId?: string;
  ownerId?: string[];
}

// 统计聚合响应类型来源唯一：见 packages/shared/src/types/effort-record.ts
export type PersonStats = IEffortPersonStat;
export type ProjectStats = IEffortProjectStat;
export type CustomerStats = IEffortCustomerStat;
export type WorkTypeStats = IEffortWorkTypeStat;
export type CompletionRecord = IEffortCompletionRecord;

/**
 * 工时填报相关角色：填报完整性统计仅纳入这些角色的员工。
 * 与「记录人」筛选项的角色集合保持一致（前端 EffortStatsPage 同步注入）。
 *
 * 注：不使用 `as const`，因为下游 Prisma 类型期望 `string[]`（mutable），
 *     readonly tuple 推导会被 Prisma 类型拒绝。
 */
export const EFFORT_FILLING_ROLE_CODES: string[] = ['PM', 'DEVELOPER'];

/**
 * 工时统计服务
 *
 * @security filters.ownerId 必须由 controller 与 viewScope 取过交集后传入,
 *           本 service 不再做防御性过滤。如果未来新增 caller 直接绕过 controller,
 *           必须自行处理 scope。
 */
@Injectable()
export class EffortStatsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holidaysService: HolidaysService
  ) {}

  /**
   * 按人汇总：返回每人总工时、饱和度
   */
  async statsByPerson(
    startDate: string,
    endDate: string,
    filters?: StatsFilters
  ): Promise<PersonStats[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // 真实工作日数：HolidaysService 已综合 HOLIDAY/WORKDAY override + 周末规则
    const workDays = Math.max(
      1,
      (await this.holidaysService.listWorkDates(startDate, endDate)).length
    );

    const where: Prisma.EffortRecordWhereInput = {
      deletedAt: null,
      recordType: 'ACTUAL',
      workDate: { gte: start, lte: end },
      ...(filters?.ownerId?.length && { ownerId: { in: filters.ownerId } }),
      ...(filters?.projectId?.length && { projectId: { in: filters.projectId } }),
      ...(filters?.customerId && { project: { customerId: filters.customerId } }),
    };

    const records = await this.prisma.effortRecord.groupBy({
      by: ['ownerId'],
      where,
      _sum: { actualTime: true },
      _count: { id: true },
    });

    // 补充 Employee name
    const ownerIds = records.map((r) => r.ownerId).filter((id): id is string => id !== null);
    const employees =
      ownerIds.length > 0
        ? await this.prisma.employee.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, name: true },
          })
        : [];
    const empMap = new Map(employees.map((e) => [e.id, e.name]));

    return records.map((r) => {
      const totalHours = r._sum.actualTime ? Number(r._sum.actualTime) : 0;
      return {
        ownerId: r.ownerId ?? '',
        ownerName: r.ownerId ? (empMap.get(r.ownerId) ?? null) : null,
        totalHours,
        recordCount: r._count.id,
        saturation: Math.round((totalHours / (workDays * 8)) * 100) / 100,
      };
    });
  }

  /**
   * 按项目汇总：返回每项目总工时、参与人数
   */
  async statsByProject(
    startDate?: string,
    endDate?: string,
    filters?: StatsFilters
  ): Promise<ProjectStats[]> {
    const dateFilter =
      startDate && endDate
        ? Prisma.sql`
          AND er."workDate" >= ${startDate}::date
          AND er."workDate" <= ${endDate}::date
        `
        : Prisma.empty;
    const ownerFilter = filters?.ownerId?.length
      ? Prisma.sql`AND er."ownerId" IN (${Prisma.join(filters.ownerId)})`
      : Prisma.empty;
    const projectFilter = filters?.projectId?.length
      ? Prisma.sql`AND er."projectId" IN (${Prisma.join(filters.projectId)})`
      : Prisma.empty;
    const customerFilter = filters?.customerId
      ? Prisma.sql`AND p."customerId" = ${filters.customerId}`
      : Prisma.empty;

    // @prisma-raw-sql: 按项目聚合工时需要 COUNT(DISTINCT ownerId)，Prisma groupBy 不支持
    const results = await this.prisma.$queryRaw<
      Array<{
        projectId: string;
        projectName: string | null;
        customerName: string | null;
        total_hours: number;
        participant_count: number;
      }>
    >`
      SELECT
        er."projectId" AS "projectId",
        p.name AS "projectName",
        c."customerName" AS "customerName",
        SUM(er."actualTime")::float AS total_hours,
        COUNT(DISTINCT er."ownerId")::int AS participant_count
      FROM effort_records er
      JOIN projects p ON p.id = er."projectId"
      LEFT JOIN customers c ON c.id = p."customerId"
      WHERE er."deletedAt" IS NULL
        AND er."recordType" = 'ACTUAL'
        AND er."projectId" IS NOT NULL
        ${dateFilter}
        ${ownerFilter}
        ${projectFilter}
        ${customerFilter}
      GROUP BY er."projectId", p.name, c."customerName"
      ORDER BY total_hours DESC
    `;

    return results.map((r) => ({
      projectId: r.projectId,
      projectName: r.projectName,
      customerName: r.customerName,
      totalHours: Math.round(Number(r.total_hours) * 100) / 100,
      participantCount: Number(r.participant_count),
    }));
  }

  /**
   * 按客户汇总：含成本计算（JOIN employee.hourlyRate）
   */
  async statsByCustomer(
    startDate: string,
    endDate: string,
    filters?: StatsFilters
  ): Promise<CustomerStats[]> {
    const projectFilter = filters?.projectId?.length
      ? Prisma.sql`AND er."projectId" IN (${Prisma.join(filters.projectId)})`
      : Prisma.empty;
    const ownerFilter = filters?.ownerId?.length
      ? Prisma.sql`AND er."ownerId" IN (${Prisma.join(filters.ownerId)})`
      : Prisma.empty;
    const customerFilter = filters?.customerId
      ? Prisma.sql`AND p."customerId" = ${filters.customerId}`
      : Prisma.empty;

    // @prisma-raw-sql: 按客户聚合工时+成本需要跨 4 表 JOIN + hourlyRate 计算，Prisma ORM 无法表达
    const results = await this.prisma.$queryRaw<
      Array<{
        customerId: string;
        customerName: string | null;
        total_hours: number;
        total_cost: number;
      }>
    >`
      SELECT
        p."customerId",
        c."customerName",
        SUM(er."actualTime")::float AS total_hours,
        SUM(er."actualTime" * COALESCE(e."hourlyRate", 0))::float AS total_cost
      FROM effort_records er
      JOIN projects p ON p.id = er."projectId"
      LEFT JOIN customers c ON c.id = p."customerId"
      LEFT JOIN employees e ON e.id = er."ownerId"
      WHERE er."deletedAt" IS NULL
        AND er."recordType" = 'ACTUAL'
        AND er."workDate" >= ${startDate}::date
        AND er."workDate" <= ${endDate}::date
        AND p."customerId" IS NOT NULL
        AND er."projectId" IS NOT NULL
        ${projectFilter}
        ${ownerFilter}
        ${customerFilter}
      GROUP BY p."customerId", c."customerName"
      ORDER BY total_hours DESC
    `;

    return results.map((r) => ({
      customerId: r.customerId,
      customerName: r.customerName,
      totalHours: Math.round(Number(r.total_hours) * 100) / 100,
      totalCost: Math.round(Number(r.total_cost) * 100) / 100,
    }));
  }

  /**
   * 按工时类型分布
   */
  async statsByWorkType(
    startDate: string,
    endDate: string,
    filters?: StatsFilters
  ): Promise<WorkTypeStats[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    const where: Prisma.EffortRecordWhereInput = {
      deletedAt: null,
      recordType: 'ACTUAL',
      workDate: { gte: start, lte: end },
      ...(filters?.ownerId?.length && { ownerId: { in: filters.ownerId } }),
      ...(filters?.projectId?.length && { projectId: { in: filters.projectId } }),
      ...(filters?.customerId && { project: { customerId: filters.customerId } }),
    };

    const records = await this.prisma.effortRecord.groupBy({
      by: ['workType'],
      where,
      _sum: { actualTime: true },
      _count: { id: true },
    });

    const grandTotal = records.reduce(
      (sum, r) => sum + (r._sum.actualTime ? Number(r._sum.actualTime) : 0),
      0
    );

    return records.map((r) => {
      const totalHours = r._sum.actualTime ? Number(r._sum.actualTime) : 0;
      return {
        workType: r.workType ?? '未分类',
        totalHours: Math.round(totalHours * 100) / 100,
        recordCount: r._count.id,
        percentage: grandTotal > 0 ? Math.round((totalHours / grandTotal) * 10000) / 100 : 0,
      };
    });
  }

  /**
   * 填报完整性：员工列表×工作日，标记哪些天填了 / 哪些天缺填
   *
   * 仅纳入承担工时填报职责的角色（PM、DEVELOPER）。销售/财务/行政等不参与
   * 工时填报，纳入会让"缺填"噪声盖过真实开发交付盘。完成状态由 service 返回，
   * 前端可同时展示已填和未填。
   */
  async statsCompletion(
    startDate: string,
    endDate: string,
    filters?: StatsFilters
  ): Promise<CompletionRecord[]> {
    const start = new Date(startDate);
    const end = new Date(endDate);

    // 获取活跃员工列表，并且仅纳入工时填报相关角色（PM/DEVELOPER）
    const employeeWhere: Prisma.EmployeeWhereInput = {
      ...ACTIVE_EMPLOYEE_WHERE,
      userRoles: {
        some: { role: { code: { in: EFFORT_FILLING_ROLE_CODES } } },
      },
    };

    const employees = await this.prisma.employee.findMany({
      where: employeeWhere,
      select: {
        id: true,
        name: true,
      },
    });

    // 获取日期范围内所有工时记录（仅实际工时）
    const records = await this.prisma.effortRecord.findMany({
      where: {
        deletedAt: null,
        recordType: 'ACTUAL',
        workDate: { gte: start, lte: end },
        ...(filters?.ownerId?.length && { ownerId: { in: filters.ownerId } }),
        ...(filters?.projectId?.length && { projectId: { in: filters.projectId } }),
        ...(filters?.customerId && { project: { customerId: filters.customerId } }),
      },
      select: {
        ownerId: true,
        workDate: true,
      },
    });

    // 构建已填报集合 ownerId:date
    const filledSet = new Set<string>();
    for (const r of records) {
      if (r.ownerId && r.workDate) {
        const dateKey = r.workDate.toISOString().slice(0, 10);
        filledSet.add(`${r.ownerId}:${dateKey}`);
      }
    }

    // 真实工作日列表：考虑 HOLIDAY/WORKDAY override，非简单按 dayOfWeek
    const workDates = await this.holidaysService.listWorkDates(startDate, endDate);

    // 生成完整性记录
    const result: CompletionRecord[] = [];
    for (const emp of employees) {
      // 如果指定了 ownerId 过滤，仅返回匹配的员工
      if (filters?.ownerId?.length && !filters.ownerId.includes(emp.id)) continue;

      for (const date of workDates) {
        result.push({
          employeeId: emp.id,
          employeeName: emp.name,
          date,
          filled: filledSet.has(`${emp.id}:${date}`),
        });
      }
    }

    return result;
  }
}
