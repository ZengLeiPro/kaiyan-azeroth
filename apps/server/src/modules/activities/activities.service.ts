import {
  type ActivityCategory,
  type ActivityImportance,
  type ActivityItem,
  type ActivityListResponse,
} from '@ky-azeroth/shared/schemas/activity';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import {
  type KeepRecordRow,
  mapKeepRecord,
  mapOperationLog,
  mapSalesActionItem,
  mapVisitRecord,
  type OperationLogRow,
  type SalesActionItemRow,
  type VisitRecordRow,
} from './activity-mapper';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

export interface ActivityQueryOptions {
  since?: string;
  until?: string;
  importance?: ActivityImportance[];
  category?: ActivityCategory[];
  limit?: number;
  cursor?: string;
}

@Injectable()
export class ActivitiesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 客户活动时间线（union: keep + visit + operation_logs）。
   *
   * 权限边界：调用方在 controller 解析 chargerScope 后传入；
   *   - chargerScope === null → 全量可见角色，不加过滤
   *   - chargerScope: string[] → 仅当 customer.chargerId 在数组内可查
   *
   * 性能：单客户活动一般数十到数百条；三表 union 走 customerId 索引（operation_logs
   * 走新加的 targetCustomerId+createdAt 索引）。cursor=occurredAt，向更早翻页。
   */
  async findByCustomer(
    customerId: string,
    options: ActivityQueryOptions,
    chargerScope: string[] | null
  ): Promise<ActivityListResponse> {
    // 1. 校验客户存在且在 scope 内
    const customer = await this.prisma.customer.findFirst({
      where: {
        id: customerId,
        deletedAt: null,
        ...(chargerScope ? { chargerId: { in: chargerScope } } : {}),
      },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException('客户不存在或无权限');
    }

    // 2. 解析查询参数
    const limit = Math.min(options.limit ?? DEFAULT_LIMIT, MAX_LIMIT);
    const since = options.since ? new Date(options.since) : undefined;
    const until = options.until ? new Date(options.until) : undefined;
    const cursor = options.cursor ? new Date(options.cursor) : undefined;
    const categorySet = options.category ? new Set(options.category) : null;
    const importanceSet = options.importance ? new Set(options.importance) : null;

    // 3. 并行拉四源（2026-06-16：新增 sales_action_items 第四源）
    // 为避免大客户拉太多 operation_log，每源单独 limit = limit * 2（过滤后再合并截取）
    const fetchLimit = limit * 2;

    const [keepRows, visitRows, opLogs, todoRows] = await Promise.all([
      this.fetchKeepRecords(customerId, { since, until, cursor, limit: fetchLimit, categorySet }),
      this.fetchVisitRecords(customerId, { since, until, cursor, limit: fetchLimit, categorySet }),
      this.fetchOperationLogs(customerId, { since, until, cursor, limit: fetchLimit, categorySet }),
      this.fetchSalesActionItems(customerId, {
        since,
        until,
        cursor,
        limit: fetchLimit,
        categorySet,
      }),
    ]);

    // 4. 投影 + 按 importance 过滤
    const items: ActivityItem[] = [];
    for (const row of keepRows) items.push(mapKeepRecord(row));
    for (const row of visitRows) items.push(mapVisitRecord(row));
    for (const log of opLogs) {
      const item = mapOperationLog(log);
      if (item) items.push(item);
    }
    for (const row of todoRows) items.push(mapSalesActionItem(row));

    const filtered = items.filter((item) => {
      if (importanceSet && !importanceSet.has(item.importance)) return false;
      if (categorySet && !categorySet.has(item.category)) return false;
      return true;
    });

    // 5. 排序（occurredAt desc）+ 截取
    filtered.sort((a, b) => {
      if (a.occurredAt === b.occurredAt) return a.id < b.id ? 1 : -1;
      return a.occurredAt < b.occurredAt ? 1 : -1;
    });

    const sliced = filtered.slice(0, limit);
    const nextCursor =
      sliced.length === limit && filtered.length > limit
        ? (sliced[sliced.length - 1]?.occurredAt ?? null)
        : null;

    // 6. count（同一过滤条件，不分页）—— 单客户量级小，直接 sum 四表 count
    const [keepCount, visitCount, opLogCount, todoCount] = await Promise.all([
      this.countKeepRecords(customerId, { since, until, categorySet }),
      this.countVisitRecords(customerId, { since, until, categorySet }),
      this.countOperationLogs(customerId, { since, until, categorySet }),
      this.countSalesActionItems(customerId, { since, until, categorySet }),
    ]);

    // 注意：opLogCount 是 PG 里 op_log 行数，不等于过滤后 ActivityItem 数（importance/category）；
    // 这里 total 是「DB 里某客户有多少条原始活动事件」，是合理近似——若严格精确需要重算。
    const total =
      categorySet === null && importanceSet === null
        ? keepCount + visitCount + opLogCount + todoCount
        : filtered.length; // 有过滤时返回过滤后准确数

    return {
      items: sliced,
      total,
      nextCursor,
    };
  }

  // ── 三源取数 ─────────────────────────────────────────────────────────

  private buildDateRangeFilter(
    field: string,
    args: { since?: Date; until?: Date; cursor?: Date }
  ): Prisma.DateTimeFilter | undefined {
    const filter: Prisma.DateTimeFilter = {};
    if (args.since) filter.gte = args.since;
    if (args.until) filter.lte = args.until;
    if (args.cursor) filter.lt = args.cursor;
    return Object.keys(filter).length > 0 ? filter : undefined;
  }

  private async fetchKeepRecords(
    customerId: string,
    args: {
      since?: Date;
      until?: Date;
      cursor?: Date;
      limit: number;
      categorySet: Set<ActivityCategory> | null;
    }
  ): Promise<KeepRecordRow[]> {
    if (args.categorySet && !args.categorySet.has('follow_up')) return [];
    // keep 的时间锚点是 keepRecordTime ?? createdAt；查询时统一用 keepRecordTime
    // （多数行有值）；NULL 兜底 createdAt 会让排序边界稍宽，可接受。
    const rows = await this.prisma.keepRecord.findMany({
      where: {
        customerId,
        deletedAt: null,
        keepRecordTime: this.buildDateRangeFilter('keepRecordTime', args),
      },
      orderBy: { keepRecordTime: 'desc' },
      take: args.limit,
      select: {
        id: true,
        customerId: true,
        keepRecordType: true,
        keepRecordTime: true,
        keepRecordContent: true,
        keepRecordStatus: true,
        chargerId: true,
        chargerName: true,
        createdAt: true,
      },
    });
    return rows;
  }

  private async fetchVisitRecords(
    customerId: string,
    args: {
      since?: Date;
      until?: Date;
      cursor?: Date;
      limit: number;
      categorySet: Set<ActivityCategory> | null;
    }
  ): Promise<VisitRecordRow[]> {
    if (args.categorySet && !args.categorySet.has('visit')) return [];
    const rows = await this.prisma.visitRecord.findMany({
      where: {
        customerId,
        deletedAt: null,
        signInTime: this.buildDateRangeFilter('signInTime', args),
      },
      orderBy: { signInTime: 'desc' },
      take: args.limit,
      select: {
        id: true,
        customerId: true,
        visitType: true,
        content: true,
        signInTime: true,
        signOutTime: true,
        signAddress: true,
        duration: true,
        visitStatus: true,
        chargerId: true,
        chargerName: true,
        createdAt: true,
      },
    });
    return rows;
  }

  private async fetchOperationLogs(
    customerId: string,
    args: {
      since?: Date;
      until?: Date;
      cursor?: Date;
      limit: number;
      categorySet: Set<ActivityCategory> | null;
    }
  ): Promise<OperationLogRow[]> {
    // category 过滤反推 module：如果 categorySet 不含任何 op_log 来源 category，跳过查询
    // refund 与 payment 同源 payments 表（mapper 按 direction 分流），所以一并算入。
    const opLogCategories: ActivityCategory[] = [
      'customer',
      'contact',
      'opportunity',
      'order',
      'payment',
      'refund',
      'invoice',
    ];
    if (args.categorySet && !opLogCategories.some((c) => args.categorySet!.has(c))) return [];

    // 反向：category → module 列表
    const allowedModules = args.categorySet
      ? this.modulesForCategories(args.categorySet)
      : undefined;

    const where: Prisma.OperationLogWhereInput = {
      targetCustomerId: customerId,
      details: { path: ['kind'], equals: 'change' },
      createdAt: this.buildDateRangeFilter('createdAt', args),
    };
    if (allowedModules && allowedModules.length > 0) {
      where.module = { in: allowedModules };
    }

    const rows = await this.prisma.operationLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      include: {
        employee: { select: { id: true, name: true, username: true } },
      },
    });
    return rows as unknown as OperationLogRow[];
  }

  private modulesForCategories(categorySet: Set<ActivityCategory>): string[] {
    const result: string[] = [];
    if (categorySet.has('customer')) result.push('customers');
    if (categorySet.has('contact')) result.push('contacts');
    if (categorySet.has('opportunity')) result.push('opportunities');
    if (categorySet.has('order')) result.push('sale-orders');
    // payment 与 refund 同源 payments 表（mapper 按 direction 分流）；任一选中都要拉 payments
    if (categorySet.has('payment') || categorySet.has('refund')) result.push('payments');
    if (categorySet.has('invoice')) result.push('invoices');
    return result;
  }

  // ── count（不分页，仅时间窗+category） ───────────────────────────────

  private async countKeepRecords(
    customerId: string,
    args: { since?: Date; until?: Date; categorySet: Set<ActivityCategory> | null }
  ): Promise<number> {
    if (args.categorySet && !args.categorySet.has('follow_up')) return 0;
    return this.prisma.keepRecord.count({
      where: {
        customerId,
        deletedAt: null,
        keepRecordTime: this.buildDateRangeFilter('keepRecordTime', args),
      },
    });
  }

  private async countVisitRecords(
    customerId: string,
    args: { since?: Date; until?: Date; categorySet: Set<ActivityCategory> | null }
  ): Promise<number> {
    if (args.categorySet && !args.categorySet.has('visit')) return 0;
    return this.prisma.visitRecord.count({
      where: {
        customerId,
        deletedAt: null,
        signInTime: this.buildDateRangeFilter('signInTime', args),
      },
    });
  }

  private async countOperationLogs(
    customerId: string,
    args: { since?: Date; until?: Date; categorySet: Set<ActivityCategory> | null }
  ): Promise<number> {
    const opLogCategories: ActivityCategory[] = [
      'customer',
      'contact',
      'opportunity',
      'order',
      'payment',
      'refund',
      'invoice',
    ];
    if (args.categorySet && !opLogCategories.some((c) => args.categorySet!.has(c))) return 0;
    const allowedModules = args.categorySet
      ? this.modulesForCategories(args.categorySet)
      : undefined;

    return this.prisma.operationLog.count({
      where: {
        targetCustomerId: customerId,
        details: { path: ['kind'], equals: 'change' },
        createdAt: this.buildDateRangeFilter('createdAt', args),
        ...(allowedModules && allowedModules.length > 0 ? { module: { in: allowedModules } } : {}),
      },
    });
  }

  // ── sales_action_items（2026-06-16 第四源） ─────────────────────────
  //
  // sales_action_items 表没有 customerId 字段，通过 refType+refId 反向关联到 customer。
  // 接入两种 refType：
  //   - 'Customer'    → refId = customerId 直接命中
  //   - 'Opportunity' → 先拿该客户的 opportunityIds，再 OR 过滤
  // 其他 refType（KeepRecord/SaleOrder/Payment 等）暂不接入，本次范围之内 ServiceBuilder/夜间 cron
  // 的待办几乎全部走 Customer/Opportunity 两类。
  //
  // 时间锚点：用 createdAt 做 DB 排序；mapper 投影时已结案行会切换到 resolvedAt，
  // 因此返回前不再做内存重排——上层 service 合并后会统一按 occurredAt 排。

  private async fetchSalesActionItems(
    customerId: string,
    args: {
      since?: Date;
      until?: Date;
      cursor?: Date;
      limit: number;
      categorySet: Set<ActivityCategory> | null;
    }
  ): Promise<SalesActionItemRow[]> {
    if (args.categorySet && !args.categorySet.has('todo')) return [];

    const opportunityIds = await this.getCustomerOpportunityIds(customerId);
    const refOr: Prisma.SalesActionItemWhereInput[] = [{ refType: 'Customer', refId: customerId }];
    if (opportunityIds.length > 0) {
      refOr.push({ refType: 'Opportunity', refId: { in: opportunityIds } });
    }

    const rows = await this.prisma.salesActionItem.findMany({
      where: {
        deletedAt: null,
        OR: refOr,
        createdAt: this.buildDateRangeFilter('createdAt', args),
      },
      orderBy: { createdAt: 'desc' },
      take: args.limit,
      select: {
        id: true,
        category: true,
        priority: true,
        refType: true,
        refId: true,
        title: true,
        reason: true,
        status: true,
        doneType: true,
        resolveNote: true,
        employeeId: true,
        employee: { select: { id: true, name: true, username: true } },
        resolvedById: true,
        resolvedBy: { select: { id: true, name: true, username: true } },
        resolvedAt: true,
        createdAt: true,
      },
    });

    // 注入反查到的 customerId（mapper 不再二次反查）
    return rows.map((row) => ({ ...row, customerId }));
  }

  private async countSalesActionItems(
    customerId: string,
    args: { since?: Date; until?: Date; categorySet: Set<ActivityCategory> | null }
  ): Promise<number> {
    if (args.categorySet && !args.categorySet.has('todo')) return 0;
    const opportunityIds = await this.getCustomerOpportunityIds(customerId);
    const refOr: Prisma.SalesActionItemWhereInput[] = [{ refType: 'Customer', refId: customerId }];
    if (opportunityIds.length > 0) {
      refOr.push({ refType: 'Opportunity', refId: { in: opportunityIds } });
    }
    return this.prisma.salesActionItem.count({
      where: {
        deletedAt: null,
        OR: refOr,
        createdAt: this.buildDateRangeFilter('createdAt', args),
      },
    });
  }

  /** 取某客户的所有 opportunity ids（含软删？不含——和 isGapRecovered 路径口径对齐：deletedAt: null） */
  private async getCustomerOpportunityIds(customerId: string): Promise<string[]> {
    const opps = await this.prisma.opportunity.findMany({
      where: { customerId, deletedAt: null },
      select: { id: true },
    });
    return opps.map((o) => o.id);
  }
}
