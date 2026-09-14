import { APPROVAL_INSTANCE_STATUS, APPROVAL_TASK_STATUS } from '@ky-azeroth/shared/constants';
import type {
  ApprovalInstanceResponseOutput,
  ApprovalTaskResponseOutput,
} from '@ky-azeroth/shared/schemas/approval';
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../common/prisma/prisma.service';
import { calculatePagination, serializeEntity } from '../../common/utils/response-helpers';
import { buildApprovalInstanceVisibilityWhere } from './approval-visibility.helper';
import { QueryApprovalDto } from './dto/query-approval.dto';

const TASK_SORTABLE_FIELDS = new Set(['createdAt', 'actionTime', 'status', 'nodeName']);
const INSTANCE_SORTABLE_FIELDS = new Set([
  'createdAt',
  'completedAt',
  'status',
  'code',
  'title',
  'eventType',
  'initiatorName',
  'currentNode',
]);

function resolveTaskOrderBy(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
  fallback: Prisma.ApprovalTaskOrderByWithRelationInput
): Prisma.ApprovalTaskOrderByWithRelationInput {
  if (!sortBy || !TASK_SORTABLE_FIELDS.has(sortBy)) return fallback;
  return { [sortBy]: sortOrder ?? 'desc' } as Prisma.ApprovalTaskOrderByWithRelationInput;
}

function resolveInstanceOrderBy(
  sortBy: string | undefined,
  sortOrder: 'asc' | 'desc' | undefined,
  fallback: Prisma.ApprovalInstanceOrderByWithRelationInput
): Prisma.ApprovalInstanceOrderByWithRelationInput {
  if (!sortBy || !INSTANCE_SORTABLE_FIELDS.has(sortBy)) return fallback;
  return { [sortBy]: sortOrder ?? 'desc' } as Prisma.ApprovalInstanceOrderByWithRelationInput;
}

@Injectable()
export class ApprovalQueryService {
  constructor(private readonly prisma: PrismaService) {}
  async getPendingList(userId: string, query: QueryApprovalDto) {
    const { page, pageSize, eventType, keyword, startDate, endDate, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    // 始终按 approverId 过滤——或签节点下同一 instance 会对应多个 task，
    // 若管理员放宽过滤，列表会出现重复行。管理员看全部走 getAllApprovals。
    const where: Prisma.ApprovalTaskWhereInput = {
      approverId: userId,
      status: APPROVAL_TASK_STATUS.PENDING,
      instance: {
        status: APPROVAL_INSTANCE_STATUS.PENDING,
      },
    };

    if (eventType?.length) {
      where.instance = {
        ...where.instance,
        eventType: { in: eventType },
      } as Prisma.ApprovalInstanceWhereInput;
    }
    if (keyword) {
      where.instance = {
        ...where.instance,
        title: { contains: keyword },
      } as Prisma.ApprovalInstanceWhereInput;
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalTask.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: resolveTaskOrderBy(sortBy, sortOrder, { createdAt: 'desc' }),
        include: {
          instance: {
            include: {
              flow: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.approvalTask.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalTaskResponseOutput & { instance?: ApprovalInstanceResponseOutput }>(
          item as Record<string, unknown>
        )
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取待审批数量（按 approverId 过滤，管理员看全部走 getAllApprovals）
   */
  async getPendingCount(userId: string) {
    return await this.prisma.approvalTask.count({
      where: {
        approverId: userId,
        status: APPROVAL_TASK_STATUS.PENDING,
        instance: {
          status: APPROVAL_INSTANCE_STATUS.PENDING,
        },
      },
    });
  }

  /**
   * 获取我已审批列表（按 approverId 过滤，管理员看全部走 getAllApprovals）
   */
  async getCompletedList(userId: string, query: QueryApprovalDto) {
    const { page, pageSize, eventType, keyword, startDate, endDate, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    const instanceWhere: Prisma.ApprovalInstanceWhereInput = {};
    if (eventType?.length) {
      instanceWhere.eventType = { in: eventType };
    }
    if (keyword) {
      instanceWhere.title = { contains: keyword };
    }

    const where: Prisma.ApprovalTaskWhereInput = {
      approverId: userId,
      status: { in: [APPROVAL_TASK_STATUS.APPROVED, APPROVAL_TASK_STATUS.REJECTED] },
      // actionTime 必须存在：把「申请人=审批人系统自动通过」的 task（actionTime=null）
      // 排除在"我已审批"列表外，避免发起人看到一堆自己"审批"过的记录。
      actionTime: { not: null },
      ...(Object.keys(instanceWhere).length > 0 && { instance: instanceWhere }),
    };

    if (startDate || endDate) {
      const range: Prisma.DateTimeNullableFilter = { not: null };
      if (startDate) range.gte = new Date(startDate);
      if (endDate) range.lte = new Date(endDate);
      where.actionTime = range;
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalTask.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: resolveTaskOrderBy(sortBy, sortOrder, { actionTime: 'desc' }),
        include: {
          instance: {
            include: {
              flow: { select: { id: true, name: true, code: true } },
            },
          },
        },
      }),
      this.prisma.approvalTask.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalTaskResponseOutput & { instance?: ApprovalInstanceResponseOutput }>(
          item as Record<string, unknown>
        )
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取抄送给我的列表
   */
  async getCopyToList(userId: string, query: QueryApprovalDto) {
    const { page, pageSize, eventType, keyword, startDate, endDate, sortBy, sortOrder } = query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.ApprovalInstanceWhereInput = {
      copyToIds: { has: userId },
    };

    if (eventType?.length) {
      where.eventType = { in: eventType };
    }
    if (keyword) {
      where.title = { contains: keyword };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: resolveInstanceOrderBy(sortBy, sortOrder, { createdAt: 'desc' }),
        include: {
          flow: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.approvalInstance.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalInstanceResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取我发起的审批列表
   */
  async getInitiatedList(userId: string, query: QueryApprovalDto) {
    const { page, pageSize, status, eventType, keyword, startDate, endDate, sortBy, sortOrder } =
      query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.ApprovalInstanceWhereInput = {
      initiatorId: userId,
    };

    if (status) {
      where.status = status;
    }
    if (eventType?.length) {
      where.eventType = { in: eventType };
    }
    if (keyword) {
      where.title = { contains: keyword };
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: resolveInstanceOrderBy(sortBy, sortOrder, { createdAt: 'desc' }),
        include: {
          flow: { select: { id: true, name: true, code: true } },
        },
      }),
      this.prisma.approvalInstance.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalInstanceResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  /**
   * 获取审批实例详情
   */
  async getInstanceDetail(instanceId: string, viewerId: string, hasAllScope: boolean) {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: {
        id: instanceId,
        ...buildApprovalInstanceVisibilityWhere(viewerId, hasAllScope),
      },
      include: {
        flow: { select: { id: true, name: true, code: true } },
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ nodeOrder: 'asc' }, { sequence: 'asc' }],
        },
        records: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!instance) {
      throw new NotFoundException('审批实例不存在');
    }

    return serializeEntity<ApprovalInstanceResponseOutput>(instance as Record<string, unknown>);
  }

  /**
   * 根据表单查询审批实例
   */
  async getByForm(eventType: string, formId: string, viewerId: string, hasAllScope: boolean) {
    const instance = await this.prisma.approvalInstance.findFirst({
      where: {
        eventType,
        formId,
        ...buildApprovalInstanceVisibilityWhere(viewerId, hasAllScope),
      },
      include: {
        flow: { select: { id: true, name: true, code: true } },
        tasks: {
          where: { deletedAt: null },
          orderBy: [{ nodeOrder: 'asc' }, { sequence: 'asc' }],
        },
        records: {
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    if (!instance) {
      throw new NotFoundException('审批实例不存在');
    }
    return serializeEntity<ApprovalInstanceResponseOutput>(instance as Record<string, unknown>);
  }

  /**
   * 获取全部审批列表（仅管理员）
   */
  async getAllApprovals(query: QueryApprovalDto) {
    const { page, pageSize, status, eventType, keyword, startDate, endDate, sortBy, sortOrder } =
      query;
    const { skip } = calculatePagination(page, pageSize);

    const where: Prisma.ApprovalInstanceWhereInput = {};

    if (status) {
      where.status = status;
    }
    if (eventType?.length) {
      where.eventType = { in: eventType };
    }
    if (keyword) {
      where.OR = [
        { title: { contains: keyword } },
        { code: { contains: keyword } },
        { initiatorName: { contains: keyword } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate);
    }

    const [items, total] = await Promise.all([
      this.prisma.approvalInstance.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: resolveInstanceOrderBy(sortBy, sortOrder, { createdAt: 'desc' }),
        include: {
          flow: { select: { id: true, name: true, code: true } },
          tasks: {
            where: { status: APPROVAL_TASK_STATUS.PENDING },
            select: { id: true, approverName: true },
          },
        },
      }),
      this.prisma.approvalInstance.count({ where }),
    ]);

    return {
      items: items.map((item) =>
        serializeEntity<ApprovalInstanceResponseOutput>(item as Record<string, unknown>)
      ),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }
}
