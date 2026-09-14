import type { LoginLogResponse, OperationLogResponse } from '@ky-azeroth/shared/schemas/system';
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { toJsonValue } from '../../common/utils/json-type-helpers';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';

@Injectable()
export class OperationLogsService {
  constructor(private prisma: PrismaService) {}

  /**
   * 记录操作日志（push 6: 单写 employeeId）
   * targetCustomerId（2026-06-16）：CRM 活动时间线投影字段，由
   * CrmChangeLogService 自动推导后传入；非 CRM 调用方传 undefined/null 即可。
   */
  async log(data: {
    employeeId?: string | null;
    ipAddress?: string;
    module: string;
    action: string;
    target?: string;
    targetCustomerId?: string | null;
    details?: object;
  }) {
    return this.prisma.operationLog.create({
      data: {
        employeeId: data.employeeId ?? null,
        ipAddress: data.ipAddress,
        module: data.module,
        action: data.action,
        target: data.target,
        targetCustomerId: data.targetCustomerId ?? null,
        details: toJsonValue(data.details),
      },
    });
  }

  /**
   * 查询操作日志列表
   */
  async findAll(params: {
    page?: number;
    pageSize?: number;
    employeeId?: string;
    module?: string[];
    action?: string[];
    target?: string;
    kind?: string;
    operator?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<OperationLogResponse>> {
    const {
      employeeId,
      module,
      action,
      target,
      kind,
      operator,
      startDate,
      endDate,
      page = 1,
      pageSize = 10,
    } = params;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.OperationLogWhereInput = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (module?.length) {
      where.module = { in: module };
    }

    if (action?.length) {
      where.action = { in: action };
    }

    if (target) {
      where.target = target;
    }

    if (kind) {
      where.details = { path: ['kind'], equals: kind };
    }

    // 操作人模糊筛选：按 employee.username / employee.name 包含匹配
    if (operator) {
      where.employee = {
        OR: [
          { username: { contains: operator, mode: 'insensitive' } },
          { name: { contains: operator, mode: 'insensitive' } },
        ],
      };
    }

    if (startDate) {
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        gte: new Date(startDate),
      };
    }

    if (endDate) {
      // 如果只传了日期（无时间），则取当天结束时刻
      const endDateTime = endDate.includes('T')
        ? new Date(endDate)
        : new Date(endDate + 'T23:59:59.999Z');
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: endDateTime,
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.operationLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { id: true, username: true, name: true } },
        },
      }),
      this.prisma.operationLog.count({ where }),
    ]);

    // 数据映射：添加前端期望的字段别名
    const mappedItems = items.map((item) => {
      const details = item.details as Record<string, unknown> | null;
      const targetName = typeof details?.targetName === 'string' ? details.targetName : undefined;

      return serializeEntity<OperationLogResponse>({
        ...item,
        userId: item.employeeId ?? undefined,
        content: targetName || item.target || `${item.action} 操作`,
        operator: item.employee?.name ?? item.employee?.username,
        operatorName: item.employee?.name,
        operatorUsername: item.employee?.username,
        operatorId: item.employeeId,
        operationType: item.action,
        operationDesc: targetName || item.target || `${item.action} 操作`,
        operatorIp: item.ipAddress,
        targetId: item.target,
        targetName,
        beforeData: details?.before,
        afterData: details?.after,
      } as Record<string, unknown>);
    });

    return {
      items: mappedItems,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 查询登录日志
   */
  async findLoginLogs(params: {
    page?: number;
    pageSize?: number;
    employeeId?: string;
    username?: string;
    actionType?: string[];
    status?: string[];
    startDate?: string;
    endDate?: string;
  }): Promise<PaginatedResponse<LoginLogResponse>> {
    const {
      employeeId,
      username,
      actionType,
      status,
      startDate,
      endDate,
      page = 1,
      pageSize = 10,
    } = params;
    const { skip, take } = calculatePagination(page, pageSize);

    const where: Prisma.LoginLogWhereInput = {};

    if (employeeId) {
      where.employeeId = employeeId;
    }

    if (username) {
      where.username = { contains: username, mode: 'insensitive' };
    }

    if (actionType?.length) {
      where.actionType = { in: actionType };
    }

    if (status?.length) {
      where.status = { in: status };
    }

    if (startDate) {
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        gte: new Date(startDate),
      };
    }

    if (endDate) {
      // 如果只传了日期（无时间），则取当天结束时刻
      const endDateTime = endDate.includes('T')
        ? new Date(endDate)
        : new Date(endDate + 'T23:59:59.999Z');
      where.createdAt = {
        ...((where.createdAt as Prisma.DateTimeFilter) || {}),
        lte: endDateTime,
      };
    }

    const [items, total] = await Promise.all([
      this.prisma.loginLog.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
        include: {
          employee: { select: { name: true } },
        },
      }),
      this.prisma.loginLog.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<LoginLogResponse>({
          ...item,
          userId: item.employeeId,
          employeeName: item.employee?.name,
        } as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
