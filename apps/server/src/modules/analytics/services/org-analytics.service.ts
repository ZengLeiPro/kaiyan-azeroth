/**
 * 组织效率盘聚合 service（6 个端点完整实现）
 *
 * 数据源：employees / employee_departments / departments / login_logs /
 *         employee_leaves / effort_records / crm_work_dailies / dingtalk_logs /
 *         keep_records / visit_records / approval_instances / approval_tasks /
 *         sync_states
 *
 * RBAC：M1 默认 ADMIN-only（controller 通过 menu='organization' 守住，
 * service 内部不再过滤 chargerScope）。
 *
 * 同步滞后提示：DingtalkLog/EmployeeLeave 等钉钉同步数据手动触发，
 * 在 kpis 端点返回最新 syncedAt 让前端显示「数据更新于 X」。
 */

import { APPROVAL_EVENT_TYPE_LABELS, KEEP_RECORD_TYPE } from '@ky-azeroth/shared/constants';
import type { AnalyticsRangeInput, OrgHeadcountTrendQueryInput } from '@ky-azeroth/shared/schemas';
import type {
  IDistributionItem,
  IOrgApprovalSlaResponse,
  IOrgCompletionResponse,
  IOrgDepartmentNode,
  IOrgDepartmentOverviewResponse,
  IOrgHeadcountTrendResponse,
  IOrgKpisResponse,
  IOrgSalesActivityResponse,
  IRankingItem,
  ITrendPoint,
} from '@ky-azeroth/shared/types';
import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../../common/prisma/prisma.service';
import { ACTIVE_EMPLOYEE_WHERE } from '../../employees/employees.helper';
import { resolveAnalyticsRange } from '../helpers/date-range.helper';
import { bucketizeTrend } from '../helpers/trend-bucket.helper';
import { listWorkDays } from '../helpers/work-days.helper';

const DECIMAL_2 = (n: number): number => Math.round(n * 100) / 100;

@Injectable()
export class OrgAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  // ==================== KPIs ====================

  async getKpis(range: AnalyticsRangeInput): Promise<IOrgKpisResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    const mauStart = new Date();
    mauStart.setDate(mauStart.getDate() - 30);
    const dauStart = new Date();
    dauStart.setDate(dauStart.getDate() - 30);

    const [
      activeHeadcount,
      newHires,
      leavers,
      loginDistinct,
      mauDistinct,
      dingtalkLogsSync,
      employeeLeavesSync,
    ] = await Promise.all([
      this.prisma.employee.count({ where: ACTIVE_EMPLOYEE_WHERE }),
      this.prisma.employee.count({
        where: {
          deletedAt: null,
          entryDate: { gte: startDate, lt: endDate },
        },
      }),
      this.prisma.employeeLeave.count({
        where: { leaveTime: { gte: startDate, lt: endDate } },
      }),
      // DAU 30d：近 30 天去重活跃员工
      this.prisma.loginLog.findMany({
        where: {
          actionType: 'login',
          status: 'success',
          createdAt: { gte: dauStart },
          employeeId: { not: null },
        },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
      // MAU 30d 同 DAU30d（M1 简化口径）
      this.prisma.loginLog.findMany({
        where: {
          actionType: 'login',
          status: 'success',
          createdAt: { gte: mauStart },
          employeeId: { not: null },
        },
        distinct: ['employeeId'],
        select: { employeeId: true },
      }),
      this.prisma.dingtalkLog.aggregate({ _max: { syncedAt: true } }),
      this.prisma.employeeLeave.aggregate({ _max: { syncedAt: true } }),
    ]);

    return {
      range: meta,
      activeHeadcount,
      newHiresInPeriod: newHires,
      leaversInPeriod: leavers,
      dau30d: loginDistinct.length,
      mau: mauDistinct.length,
      syncStaleHint: {
        dingtalkLogsUpdatedAt: dingtalkLogsSync._max.syncedAt?.toISOString() ?? null,
        employeeLeavesUpdatedAt: employeeLeavesSync._max.syncedAt?.toISOString() ?? null,
      },
    };
  }

  // ==================== 填报完成率（工时 / CRM 日报 / 钉钉日报） ====================

  async getCompletion(range: AnalyticsRangeInput): Promise<IOrgCompletionResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    const metaEndDate = new Date(endDate);
    metaEndDate.setDate(metaEndDate.getDate() - 1);
    const workDays = listWorkDays(startDate, metaEndDate);

    const [activeEmployees, effortRecords, crmDailies, dingtalkLogs] = await Promise.all([
      this.prisma.employee.findMany({
        where: ACTIVE_EMPLOYEE_WHERE,
        select: { id: true, dingtalkUserId: true },
      }),
      this.prisma.effortRecord.findMany({
        where: {
          deletedAt: null,
          recordType: 'ACTUAL',
          workDate: { gte: startDate, lt: endDate },
        },
        select: { ownerId: true, workDate: true },
      }),
      this.prisma.crmWorkDaily.findMany({
        where: {
          deletedAt: null,
          reportDate: { gte: startDate, lt: endDate },
        },
        select: { senderId: true, reportDate: true },
      }),
      this.prisma.dingtalkLog.findMany({
        where: {
          createTime: { gte: startDate, lt: endDate },
        },
        select: { creatorId: true, createTime: true },
      }),
    ]);

    // 工时填报：(ownerId, YYYY-MM-DD) 集合
    const effortSet = new Set<string>();
    for (const r of effortRecords) {
      if (r.ownerId && r.workDate) {
        effortSet.add(`${r.ownerId}:${this.ymd(r.workDate)}`);
      }
    }
    // 应填：active 员工 × workDays
    const effortExpected = activeEmployees.length * workDays.length;

    // CRM 日报：(senderId, YYYY-MM-DD) 集合
    const crmSet = new Set<string>();
    for (const r of crmDailies) {
      if (r.senderId && r.reportDate) {
        crmSet.add(`${r.senderId}:${this.ymd(r.reportDate)}`);
      }
    }

    // 钉钉日报：(dingtalkUserId, YYYY-MM-DD) 集合
    const dingtalkSet = new Set<string>();
    for (const r of dingtalkLogs) {
      if (r.creatorId && r.createTime) {
        dingtalkSet.add(`${r.creatorId}:${this.ymd(r.createTime)}`);
      }
    }
    const employeesWithDingtalk = activeEmployees.filter(
      (e): e is { id: string; dingtalkUserId: string } => Boolean(e.dingtalkUserId)
    );

    return {
      range: meta,
      effort: {
        expectedSlots: effortExpected,
        filledSlots: effortSet.size,
        rate: effortExpected ? DECIMAL_2((effortSet.size / effortExpected) * 100) : 0,
      },
      crmDaily: {
        expectedSlots: effortExpected, // CRM 日报应提交群体与工时同口径（active 员工）
        filledSlots: crmSet.size,
        rate: effortExpected ? DECIMAL_2((crmSet.size / effortExpected) * 100) : 0,
      },
      dingtalkDaily: {
        expectedSlots: employeesWithDingtalk.length * workDays.length,
        filledSlots: dingtalkSet.size,
        rate:
          employeesWithDingtalk.length && workDays.length
            ? DECIMAL_2((dingtalkSet.size / (employeesWithDingtalk.length * workDays.length)) * 100)
            : 0,
      },
    };
  }

  // ==================== 销售行为 ====================

  async getSalesActivity(range: AnalyticsRangeInput): Promise<IOrgSalesActivityResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    const [densityGrouped, visitRecords, typeGrouped] = await Promise.all([
      this.prisma.keepRecord.groupBy({
        by: ['chargerId'],
        where: {
          deletedAt: null,
          keepRecordTime: { gte: startDate, lt: endDate },
        },
        _count: { _all: true },
        orderBy: { _count: { chargerId: 'desc' } },
        take: 15,
      }),
      this.prisma.visitRecord.findMany({
        where: {
          deletedAt: null,
          signInTime: { gte: startDate, lt: endDate },
        },
        select: { signInTime: true },
      }),
      this.prisma.keepRecord.groupBy({
        by: ['keepRecordType'],
        where: {
          deletedAt: null,
          keepRecordTime: { gte: startDate, lt: endDate },
        },
        _count: { _all: true },
      }),
    ]);

    // 排行榜：拼员工名
    const chargerIds = densityGrouped
      .map((g) => g.chargerId)
      .filter((x): x is string => Boolean(x));
    const employees =
      chargerIds.length === 0
        ? []
        : await this.prisma.employee.findMany({
            where: { id: { in: chargerIds } },
            select: { id: true, name: true },
          });
    const nameMap = new Map(employees.map((e) => [e.id, e.name]));
    const keepRecordDensity: IRankingItem[] = densityGrouped.map((g) => ({
      id: g.chargerId ?? '',
      name: g.chargerId ? (nameMap.get(g.chargerId) ?? '（已离职）') : '（未指派）',
      value: g._count._all,
    }));

    // 拜访签到趋势：按 day 桶
    const visitTrend: ITrendPoint[] = bucketizeTrend(
      visitRecords
        .filter((r): r is { signInTime: Date } => Boolean(r.signInTime))
        .map((r) => ({ at: r.signInTime, value: 1 })),
      startDate,
      endDate,
      'day'
    );

    // 跟进类型分布
    const typeTotal = typeGrouped.reduce((a, r) => a + r._count._all, 0) || 1;
    const orderedTypes = [
      KEEP_RECORD_TYPE.PHONE,
      KEEP_RECORD_TYPE.ONLINE,
      KEEP_RECORD_TYPE.FACE_TO_FACE,
      KEEP_RECORD_TYPE.OTHER,
    ];
    const typeMap = new Map(typeGrouped.map((g) => [g.keepRecordType ?? '其他', g._count._all]));
    const keepRecordTypeDistribution: IDistributionItem[] = orderedTypes.map((t) => {
      const count = typeMap.get(t) ?? 0;
      return {
        key: t,
        label: t,
        count,
        percentage: DECIMAL_2((count / typeTotal) * 100),
      };
    });

    return {
      range: meta,
      keepRecordDensity,
      visitTrend,
      keepRecordTypeDistribution,
    };
  }

  // ==================== 审批 SLA ====================

  async getApprovalSla(range: AnalyticsRangeInput): Promise<IOrgApprovalSlaResponse> {
    const { startDate, endDate, meta } = resolveAnalyticsRange(range);

    const [instances, taskSamples, pendingTopRaw] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where: {
          deletedAt: null,
          createdAt: { gte: startDate, lt: endDate },
        },
        select: {
          eventType: true,
          status: true,
          completedAt: true,
          createdAt: true,
        },
        take: 10000,
      }),
      this.prisma.approvalTask.findMany({
        where: {
          deletedAt: null,
          actionTime: { not: null },
          status: { in: ['approved', 'rejected', 'skipped'] },
          instance: {
            createdAt: { gte: startDate, lt: endDate },
          },
        },
        select: {
          nodeName: true,
          actionTime: true,
          createdAt: true,
        },
        take: 10000,
      }),
      this.prisma.approvalTask.groupBy({
        by: ['approverId', 'approverName'],
        where: {
          deletedAt: null,
          status: 'pending',
        },
        _count: { _all: true },
        orderBy: { _count: { approverId: 'desc' } },
        take: 10,
      }),
    ]);

    // 端到端：按 eventType 分组取平均耗时（仅 status='approved'）
    const e2eByType = new Map<string, { totalHours: number; count: number }>();
    let approvedCount = 0;
    let decidedCount = 0;
    for (const inst of instances) {
      if (inst.status === 'approved') approvedCount++;
      if (['approved', 'rejected', 'withdrawn'].includes(inst.status)) decidedCount++;
      if (inst.status === 'approved' && inst.completedAt) {
        const hours = (inst.completedAt.getTime() - inst.createdAt.getTime()) / 3600000;
        const prev = e2eByType.get(inst.eventType) ?? { totalHours: 0, count: 0 };
        prev.totalHours += hours;
        prev.count += 1;
        e2eByType.set(inst.eventType, prev);
      }
    }
    const endToEndByEventType = Array.from(e2eByType.entries())
      .map(([eventType, v]) => ({
        eventType,
        label: APPROVAL_EVENT_TYPE_LABELS[eventType] ?? eventType,
        avgHours: DECIMAL_2(v.totalHours / Math.max(1, v.count)),
        sampleCount: v.count,
      }))
      .sort((a, b) => b.sampleCount - a.sampleCount);

    // 节点停留：按 nodeName 平均
    const nodeMap = new Map<string, { totalHours: number; count: number }>();
    for (const t of taskSamples) {
      if (!t.actionTime || !t.nodeName) continue;
      const hours = (t.actionTime.getTime() - t.createdAt.getTime()) / 3600000;
      const prev = nodeMap.get(t.nodeName) ?? { totalHours: 0, count: 0 };
      prev.totalHours += hours;
      prev.count += 1;
      nodeMap.set(t.nodeName, prev);
    }
    const nodeStay = Array.from(nodeMap.entries())
      .map(([nodeName, v]) => ({
        nodeName,
        avgHours: DECIMAL_2(v.totalHours / Math.max(1, v.count)),
        sampleCount: v.count,
      }))
      .sort((a, b) => b.sampleCount - a.sampleCount);

    const approveRate = decidedCount ? DECIMAL_2((approvedCount / decidedCount) * 100) : 0;

    const pendingTopApprovers: IRankingItem[] = pendingTopRaw.map((r) => ({
      id: r.approverId,
      name: r.approverName,
      value: r._count._all,
    }));

    return {
      range: meta,
      endToEndByEventType,
      nodeStay,
      approveRate,
      pendingTopApprovers,
    };
  }

  // ==================== 在职 / 入职 / 离职 月度趋势 ====================

  async getHeadcountTrend(query: OrgHeadcountTrendQueryInput): Promise<IOrgHeadcountTrendResponse> {
    const now = new Date();
    const months: Array<{
      month: string;
      activeAtMonthEnd: number;
      newHires: number;
      leavers: number;
    }> = [];

    // 拉全量员工的 entryDate 和 离职表，做内存聚合
    const [allEmployees, allLeaves] = await Promise.all([
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: { id: true, entryDate: true, status: true },
      }),
      this.prisma.employeeLeave.findMany({
        select: { leaveTime: true },
      }),
    ]);

    for (let i = query.months - 1; i >= 0; i--) {
      const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);

      const newHires = allEmployees.filter(
        (e) => e.entryDate && e.entryDate >= monthStart && e.entryDate < monthEnd
      ).length;
      const leavers = allLeaves.filter(
        (l) => l.leaveTime && l.leaveTime >= monthStart && l.leaveTime < monthEnd
      ).length;

      // 「期末在职」= 入职日期 ≤ monthEnd 且 不在离职名单中（按整体当前 status 推测）
      // M1 简化：直接用「active 员工中 entryDate ≤ monthEnd 的人数」近似
      const activeAtMonthEnd = allEmployees.filter(
        (e) => e.status === 'active' && e.entryDate && e.entryDate < monthEnd
      ).length;

      months.push({
        month: this.ymMonth(monthStart),
        activeAtMonthEnd,
        newHires,
        leavers,
      });
    }

    return { months };
  }

  // ==================== 部门规模概览 ====================

  async getDepartmentOverview(): Promise<IOrgDepartmentOverviewResponse> {
    const [departments, memberships, managers] = await Promise.all([
      this.prisma.department.findMany({
        where: { deletedAt: null },
        select: {
          id: true,
          name: true,
          parentId: true,
          managerId: true,
          sortOrder: true,
        },
      }),
      this.prisma.employeeDepartment.findMany({
        where: { employee: ACTIVE_EMPLOYEE_WHERE },
        select: { departmentId: true, employeeId: true },
      }),
      this.prisma.employee.findMany({
        where: { deletedAt: null },
        select: { id: true, name: true },
      }),
    ]);

    const managerMap = new Map(managers.map((m) => [m.id, m.name]));

    // 部门→直接成员集
    const directMembers = new Map<string, Set<string>>();
    for (const m of memberships) {
      const set = directMembers.get(m.departmentId) ?? new Set<string>();
      set.add(m.employeeId);
      directMembers.set(m.departmentId, set);
    }

    // 父子关系
    const childrenMap = new Map<string | null, typeof departments>();
    for (const d of departments) {
      const arr = childrenMap.get(d.parentId) ?? [];
      arr.push(d);
      childrenMap.set(d.parentId, arr);
    }

    const buildNode = (d: (typeof departments)[number], depth: number): IOrgDepartmentNode => {
      if (depth > 10) {
        // 防御性递归深度封顶（与 DataScopeService 一致）
        return {
          id: d.id,
          name: d.name,
          managerId: d.managerId,
          managerName: d.managerId ? (managerMap.get(d.managerId) ?? null) : null,
          directEmployeeCount: directMembers.get(d.id)?.size ?? 0,
          recursiveEmployeeCount: directMembers.get(d.id)?.size ?? 0,
          children: [],
        };
      }
      const children = (childrenMap.get(d.id) ?? [])
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => buildNode(c, depth + 1));
      const direct = directMembers.get(d.id)?.size ?? 0;
      const recursive = direct + children.reduce((acc, c) => acc + c.recursiveEmployeeCount, 0);
      return {
        id: d.id,
        name: d.name,
        managerId: d.managerId,
        managerName: d.managerId ? (managerMap.get(d.managerId) ?? null) : null,
        directEmployeeCount: direct,
        recursiveEmployeeCount: recursive,
        children,
      };
    };

    const roots = (childrenMap.get(null) ?? []).sort((a, b) => a.sortOrder - b.sortOrder);
    const tree = roots.map((r) => buildNode(r, 0));

    const missingManagerDepartments = departments
      .filter((d) => !d.managerId)
      .map((d) => ({ id: d.id, name: d.name }));

    return { tree, missingManagerDepartments };
  }

  // ==================== 内部 helper ====================

  private ymd(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  private ymMonth(d: Date): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
  }
}
