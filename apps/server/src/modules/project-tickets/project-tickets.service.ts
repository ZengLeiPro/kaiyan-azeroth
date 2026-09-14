import {
  buildTicketNotification,
  PROJECT_TICKET_NOTIFICATION_TYPE,
  PROJECT_TICKET_STATUS,
  PROJECT_TICKET_TRANSITIONS,
  type ProjectTicketNotificationTypeValue,
  type ProjectTicketStatusValue,
} from '@ky-azeroth/shared/constants';
import type {
  ProjectTicketResponseOutput,
  ProjectTicketStatsResponseOutput,
} from '@ky-azeroth/shared/schemas';
import type { IAttachment } from '@ky-azeroth/shared/types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { SerialNumberType } from '../../common/constants/serial-number.constants';
import { FilterApplierService } from '../../common/filter-scheme';
import type { PaginatedResponse } from '../../common/interfaces/pagination.interface';
import { PrismaService } from '../../common/prisma/prisma.service';
import { DataScopeService } from '../../common/services/data-scope.service';
import { SerialNumberService } from '../../common/services/serial-number.service';
import { auditCreate, auditUpdate } from '../../common/utils/audit-helper';
import { fromJsonAttachments, toJsonAttachments } from '../../common/utils/json-type-helpers';
import {
  calculatePagination,
  serializeEntity,
  toDateOnlyString,
} from '../../common/utils/response-helpers';
import type { CurrentUserType } from '../auth/decorators/current-user.decorator';
import { NotificationsService } from '../notifications/notifications.service';
import { CreateProjectTicketDto } from './dto/create-project-ticket.dto';
import { QueryProjectTicketDto } from './dto/query-project-ticket.dto';
import { ReassignProjectTicketDto } from './dto/reassign-project-ticket.dto';
import { TransitionProjectTicketDto } from './dto/transition-project-ticket.dto';
import { UpdateProjectTicketDto } from './dto/update-project-ticket.dto';
import { PROJECT_TICKET_FILTER_REGISTRY } from './project-tickets.filter-registry';

/**
 * 用于 service 内部 include 结构的 Prisma 返回值宽泛类型
 */
type TicketWithRelations = Prisma.ProjectTicketGetPayload<{
  include: {
    project: {
      select: {
        id: true;
        name: true;
        customer: { select: { customerName: true } };
      };
    };
    dispatcher: { select: { id: true; name: true } };
    assignee: { select: { id: true; name: true } };
  };
}>;

const TICKET_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      customer: { select: { customerName: true } },
    },
  },
  dispatcher: { select: { id: true, name: true } },
  assignee: { select: { id: true, name: true } },
} as const;

const ACTIVE_STATUSES: ProjectTicketStatusValue[] = [
  PROJECT_TICKET_STATUS.PENDING,
  PROJECT_TICKET_STATUS.IN_PROGRESS,
];

@Injectable()
export class ProjectTicketsService {
  private readonly logger = new Logger(ProjectTicketsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly serialNumberService: SerialNumberService,
    private readonly notificationsService: NotificationsService,
    private readonly filterApplier: FilterApplierService,
    private readonly dataScope: DataScopeService
  ) {}

  private async canSeeAllTickets(currentUser: CurrentUserType): Promise<boolean> {
    const scope = await this.dataScope.resolveChargerScope(
      currentUser.id,
      currentUser.roles ?? [],
      'projects',
      'project_tickets',
      { employeeId: currentUser.employeeId ?? undefined }
    );
    return scope === null;
  }

  // ==================== CREATE ====================

  async create(
    dto: CreateProjectTicketDto,
    currentUser: CurrentUserType
  ): Promise<ProjectTicketResponseOutput> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const dispatcherId = await this.requireEmployeeIdFromUser(currentUser);
    const ticketNo = await this.serialNumberService.generate(SerialNumberType.PROJECT_TICKET);

    const created = await this.prisma.projectTicket.create({
      data: {
        ticketNo,
        projectId: dto.projectId,
        title: dto.title,
        description: dto.description,
        ticketType: dto.ticketType,
        priority: dto.priority,
        status: PROJECT_TICKET_STATUS.PENDING,
        dispatcherId,
        assigneeId: dto.assigneeId,
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        attachments: toJsonAttachments(dto.attachments ?? undefined),
        ...auditCreate(currentUser),
      },
      include: TICKET_INCLUDE,
    });

    await this.notifyOnEvent(created, PROJECT_TICKET_NOTIFICATION_TYPE.CREATED, created.assigneeId);

    return this.serializeTicket(created);
  }

  // ==================== READ ====================

  async findAll(
    query: QueryProjectTicketDto,
    currentUser: CurrentUserType,
    rawQuery?: unknown
  ): Promise<PaginatedResponse<ProjectTicketResponseOutput>> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const { page = 1, pageSize = 20, view, dueDateFrom, dueDateTo, isOverdue } = query;

    const { skip } = calculatePagination(page, pageSize);

    // 可见性/视图/是否超期 这类业务硬规则，保留在 service 层的 baseWhere 里
    // （FilterApplier 的 registry build 不适合表达"依赖 currentUser 的条件"与组合逻辑）。
    const baseWhereAnd: Prisma.ProjectTicketWhereInput[] = [];

    // view 权限范围过滤（仅在业务 service 层处理，不暴露到 registry）
    const myEmployeeId = currentUser.employeeId ?? null;
    const isAdmin = await this.canSeeAllTickets(currentUser);

    if (view === 'ASSIGNED') {
      if (!myEmployeeId) {
        return { items: [], total: 0, page, pageSize, totalPages: 0 };
      }
      baseWhereAnd.push({ assigneeId: myEmployeeId });
    } else if (view === 'DISPATCHED') {
      if (!myEmployeeId) {
        return { items: [], total: 0, page, pageSize, totalPages: 0 };
      }
      baseWhereAnd.push({ dispatcherId: myEmployeeId });
    } else if (view === 'ALL') {
      if (!isAdmin) {
        if (!myEmployeeId) {
          return { items: [], total: 0, page, pageSize, totalPages: 0 };
        }
        baseWhereAnd.push({
          OR: [{ assigneeId: myEmployeeId }, { dispatcherId: myEmployeeId }],
        });
      }
    }

    // 截止时间区间（旧参数 dueDateFrom/To 的兜底，保留；新接口统一走 registry 的 dueDate dateRange）
    if (dueDateFrom || dueDateTo) {
      const dueDateFilter: Prisma.DateTimeNullableFilter = {};
      if (dueDateFrom) {
        dueDateFilter.gte = new Date(dueDateFrom);
      }
      if (dueDateTo) {
        const endDateTime = dueDateTo.includes('T')
          ? new Date(dueDateTo)
          : new Date(`${dueDateTo}T23:59:59.999Z`);
        dueDateFilter.lte = endDateTime;
      }
      baseWhereAnd.push({ dueDate: { not: null, ...dueDateFilter } });
    }

    // 仅看超期（派生条件，不适合作为 registry 字段）
    if (isOverdue === true) {
      baseWhereAnd.push({
        dueDate: { not: null, lt: new Date() },
        status: { in: ACTIVE_STATUSES },
      });
    }

    const baseWhere: Prisma.ProjectTicketWhereInput = {
      deletedAt: null,
      ...(baseWhereAnd.length > 0 ? { AND: baseWhereAnd } : {}),
    };

    const where = await this.filterApplier.buildWhere<Prisma.ProjectTicketWhereInput>({
      registry: PROJECT_TICKET_FILTER_REGISTRY,
      rawQuery,
      legacyKeyword: query.keyword,
      legacyFilters: {
        projectId: query.projectId,
        assigneeId: query.assigneeId,
        dispatcherId: query.dispatcherId,
        status: query.status,
        ticketType: query.ticketType,
        priority: query.priority,
      },
      chargerScope: null,
      baseWhere,
    });

    const [total, items] = await Promise.all([
      this.prisma.projectTicket.count({ where }),
      this.prisma.projectTicket.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        include: TICKET_INCLUDE,
      }),
    ]);

    return {
      items: items.map((item) => this.serializeTicket(item)),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    };
  }

  async findOne(id: string, currentUser: CurrentUserType): Promise<ProjectTicketResponseOutput> {
    const record = await this.prisma.projectTicket.findFirst({
      where: { id, deletedAt: null },
      include: TICKET_INCLUDE,
    });

    if (!record) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    // 可见性校验：无权访问时统一抛 NotFoundException，避免向非授权用户泄漏工单存在性
    if (!this.canSeeTicket(record, currentUser, await this.canSeeAllTickets(currentUser))) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    return this.serializeTicket(record);
  }

  // ==================== UPDATE ====================

  async update(
    id: string,
    dto: UpdateProjectTicketDto,
    currentUser: CurrentUserType
  ): Promise<ProjectTicketResponseOutput> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const existing = await this.prisma.projectTicket.findFirst({
      where: { id, deletedAt: null },
      include: TICKET_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    const isAdmin = await this.canSeeAllTickets(currentUser);
    this.assertVisibility(existing, currentUser, isAdmin);

    // 仅 dispatcher 或 viewScope=ALL 可编辑业务字段
    const myEmployeeId = currentUser.employeeId ?? null;
    if (!isAdmin && existing.dispatcherId !== myEmployeeId) {
      throw new ForbiddenException('只有派单人或管理员可以编辑工单');
    }

    const {
      version: requestVersion,
      title,
      description,
      ticketType,
      priority,
      assigneeId,
      dueDate,
      attachments,
    } = dto;

    // 白名单式构造 update data（禁止 status/projectId/dispatcherId）
    const updateData: Prisma.ProjectTicketUncheckedUpdateInput = {
      ...(title !== undefined && { title }),
      ...(description !== undefined && { description }),
      ...(ticketType !== undefined && { ticketType }),
      ...(priority !== undefined && { priority }),
      ...(assigneeId !== undefined && { assigneeId }),
      ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
      ...(attachments !== undefined && {
        attachments: attachments
          ? (toJsonAttachments(attachments) ?? Prisma.JsonNull)
          : Prisma.JsonNull,
      }),
      ...auditUpdate(currentUser),
      version: { increment: 1 },
    };

    try {
      const updated = await this.prisma.projectTicket.update({
        where: {
          id,
          version: requestVersion,
          deletedAt: null,
        },
        data: updateData,
        include: TICKET_INCLUDE,
      });

      // 若改派了 assignee，通知新接单人
      if (assigneeId && assigneeId !== existing.assigneeId) {
        await this.notifyOnEvent(
          updated,
          PROJECT_TICKET_NOTIFICATION_TYPE.REASSIGNED,
          updated.assigneeId
        );
      }

      return this.serializeTicket(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  // ==================== TRANSITION ====================

  /**
   * 状态流转
   * @no-optimistic-lock: 通过独立方法实现乐观锁（where 带 version + P2025 抛 Conflict）
   */
  async transition(
    id: string,
    dto: TransitionProjectTicketDto,
    currentUser: CurrentUserType
  ): Promise<ProjectTicketResponseOutput> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const existing = await this.prisma.projectTicket.findFirst({
      where: { id, deletedAt: null },
      include: TICKET_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    const currentStatus = existing.status as ProjectTicketStatusValue;
    const toStatus = dto.toStatus as ProjectTicketStatusValue;

    // 合法转移校验
    const allowedTargets = PROJECT_TICKET_TRANSITIONS[currentStatus] ?? [];
    if (!allowedTargets.includes(toStatus)) {
      throw new BadRequestException(`无法从 ${currentStatus} 转换到 ${toStatus}`);
    }

    // 操作者权限校验
    const isAdmin = await this.canSeeAllTickets(currentUser);
    const myEmployeeId = currentUser.employeeId ?? null;
    const isAssignee = !!myEmployeeId && existing.assigneeId === myEmployeeId;
    const isDispatcher = !!myEmployeeId && existing.dispatcherId === myEmployeeId;

    if (!isAdmin) {
      if (toStatus === PROJECT_TICKET_STATUS.IN_PROGRESS && !isAssignee) {
        throw new ForbiddenException('只有接单人可以开始处理');
      }
      if (toStatus === PROJECT_TICKET_STATUS.COMPLETED && !isAssignee) {
        throw new ForbiddenException('只有接单人可以完成工单');
      }
      if (toStatus === PROJECT_TICKET_STATUS.CLOSED && !isDispatcher) {
        throw new ForbiddenException('只有派单人可以关闭工单');
      }
      if (toStatus === PROJECT_TICKET_STATUS.CANCELLED && !isAssignee && !isDispatcher) {
        throw new ForbiddenException('只有派单人或接单人可以取消工单');
      }
    }

    // 构造时间戳字段与说明字段
    const now = new Date();
    const data: Prisma.ProjectTicketUncheckedUpdateInput = {
      status: toStatus,
      ...auditUpdate(currentUser),
      version: { increment: 1 },
    };

    if (toStatus === PROJECT_TICKET_STATUS.IN_PROGRESS) {
      data.startedAt = existing.startedAt ?? now;
    } else if (toStatus === PROJECT_TICKET_STATUS.COMPLETED) {
      data.startedAt = existing.startedAt ?? now;
      data.completedAt = now;
      if (dto.completionNote !== undefined) {
        data.completionNote = dto.completionNote ?? null;
      }
    } else if (toStatus === PROJECT_TICKET_STATUS.CLOSED) {
      data.closedAt = now;
      if (dto.closeNote !== undefined) {
        data.closeNote = dto.closeNote ?? null;
      }
    } else if (toStatus === PROJECT_TICKET_STATUS.CANCELLED) {
      data.cancelledAt = now;
      if (dto.cancelReason !== undefined) {
        data.cancelReason = dto.cancelReason ?? null;
      }
    }

    const requestVersion = dto.version;

    try {
      const updated = await this.prisma.projectTicket.update({
        where: {
          id,
          status: currentStatus,
          version: requestVersion,
          deletedAt: null,
        },
        data,
        include: TICKET_INCLUDE,
      });

      // 发送通知（通知对手方）
      const notificationType = this.transitionToNotificationType(toStatus);
      if (notificationType) {
        const targetEmployeeId = this.pickNotifyTargetForTransition(updated, toStatus);
        if (targetEmployeeId) {
          await this.notifyOnEvent(updated, notificationType, targetEmployeeId);
        }
      }

      return this.serializeTicket(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        // 重新查实际状态，决定抛 Conflict 还是 BadRequest
        const fresh = await this.prisma.projectTicket.findFirst({
          where: { id, deletedAt: null },
          select: { status: true, version: true },
        });
        if (!fresh) {
          throw new NotFoundException(`项目工单 ${id} 不存在`);
        }
        if (fresh.status !== currentStatus) {
          throw new BadRequestException(
            `工单状态已变更为 ${fresh.status}，无法执行此操作。请刷新后重试。`
          );
        }
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  // ==================== REASSIGN ====================

  /**
   * 改派
   * @no-optimistic-lock: 通过独立方法实现乐观锁（where 带 version + P2025 抛 Conflict）
   */
  async reassign(
    id: string,
    dto: ReassignProjectTicketDto,
    currentUser: CurrentUserType
  ): Promise<ProjectTicketResponseOutput> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const existing = await this.prisma.projectTicket.findFirst({
      where: { id, deletedAt: null },
      include: TICKET_INCLUDE,
    });
    if (!existing) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    // 仅 dispatcher 或 ADMIN 可以改派
    const isAdmin = await this.canSeeAllTickets(currentUser);
    const myEmployeeId = currentUser.employeeId ?? null;
    if (!isAdmin && existing.dispatcherId !== myEmployeeId) {
      throw new ForbiddenException('只有派单人或管理员可以改派工单');
    }

    // 当前状态必须是 PENDING 或 IN_PROGRESS
    if (!ACTIVE_STATUSES.includes(existing.status as ProjectTicketStatusValue)) {
      throw new BadRequestException('已完成/已关闭/已取消的工单不能改派');
    }

    const requestVersion = dto.version;

    try {
      const updated = await this.prisma.projectTicket.update({
        where: {
          id,
          version: requestVersion,
          deletedAt: null,
        },
        data: {
          assigneeId: dto.assigneeId,
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
        include: TICKET_INCLUDE,
      });

      if (updated.assigneeId !== existing.assigneeId) {
        await this.notifyOnEvent(
          updated,
          PROJECT_TICKET_NOTIFICATION_TYPE.REASSIGNED,
          updated.assigneeId
        );
      }

      return this.serializeTicket(updated);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }
  }

  // ==================== DELETE ====================

  async remove(
    id: string,
    requestVersion: number,
    currentUser: CurrentUserType
  ): Promise<{ success: boolean }> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const existing = await this.prisma.projectTicket.findFirst({
      where: { id, deletedAt: null },
    });
    if (!existing) {
      throw new NotFoundException(`项目工单 ${id} 不存在`);
    }

    const isAdmin = await this.canSeeAllTickets(currentUser);
    const myEmployeeId = currentUser.employeeId ?? null;
    if (!isAdmin && existing.dispatcherId !== myEmployeeId) {
      throw new ForbiddenException('只有派单人或管理员可以删除工单');
    }

    try {
      await this.prisma.projectTicket.update({
        where: { id, version: requestVersion, deletedAt: null },
        data: {
          deletedAt: new Date(),
          ...auditUpdate(currentUser),
          version: { increment: 1 },
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new ConflictException(
          `数据已被其他用户修改，当前版本 ${existing.version}。请刷新后重试。`
        );
      }
      throw error;
    }

    return { success: true };
  }

  // ==================== STATS ====================

  async getStats(currentUser: CurrentUserType): Promise<ProjectTicketStatsResponseOutput> {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }

    const myEmployeeId = currentUser.employeeId ?? null;
    const isAdmin = await this.canSeeAllTickets(currentUser);

    // 非 admin：只统计自己派出的或指派给自己的
    const baseWhere: Prisma.ProjectTicketWhereInput = { deletedAt: null };
    if (!isAdmin) {
      if (!myEmployeeId) {
        return {
          pending: 0,
          inProgress: 0,
          completed: 0,
          closed: 0,
          cancelled: 0,
          overdue: 0,
          myTodoCount: 0,
        };
      }
      baseWhere.OR = [{ assigneeId: myEmployeeId }, { dispatcherId: myEmployeeId }];
    }

    const [pending, inProgress, completed, closed, cancelled, overdue, myTodoCount] =
      await Promise.all([
        this.prisma.projectTicket.count({
          where: { ...baseWhere, status: PROJECT_TICKET_STATUS.PENDING },
        }),
        this.prisma.projectTicket.count({
          where: { ...baseWhere, status: PROJECT_TICKET_STATUS.IN_PROGRESS },
        }),
        this.prisma.projectTicket.count({
          where: { ...baseWhere, status: PROJECT_TICKET_STATUS.COMPLETED },
        }),
        this.prisma.projectTicket.count({
          where: { ...baseWhere, status: PROJECT_TICKET_STATUS.CLOSED },
        }),
        this.prisma.projectTicket.count({
          where: { ...baseWhere, status: PROJECT_TICKET_STATUS.CANCELLED },
        }),
        this.prisma.projectTicket.count({
          where: {
            ...baseWhere,
            dueDate: { not: null, lt: new Date() },
            status: { in: ACTIVE_STATUSES },
          },
        }),
        myEmployeeId
          ? this.prisma.projectTicket.count({
              where: {
                deletedAt: null,
                assigneeId: myEmployeeId,
                status: { in: ACTIVE_STATUSES },
              },
            })
          : Promise.resolve(0),
      ]);

    return {
      pending,
      inProgress,
      completed,
      closed,
      cancelled,
      overdue,
      myTodoCount,
    };
  }

  // ==================== 内部辅助 ====================

  /**
   * 纯函数：判断当前用户是否可见某张工单（不抛异常）
   * 用于 findOne 等查询场景，以便统一返回 NotFoundException 避免泄漏存在性
   */
  private canSeeTicket(
    record: TicketWithRelations,
    currentUser: CurrentUserType,
    canSeeAll: boolean
  ): boolean {
    if (!currentUser) return false;
    if (canSeeAll) return true;
    const myEmployeeId = currentUser.employeeId ?? null;
    if (!myEmployeeId) return false;
    return record.dispatcherId === myEmployeeId || record.assigneeId === myEmployeeId;
  }

  /**
   * 权限校验：viewScope=SELF 必须是 dispatcher 或 assignee 才能访问
   * 用于 update/remove 等修改场景——此时调用者已证明知晓工单存在，可直接返回 Forbidden
   */
  private assertVisibility(
    record: TicketWithRelations,
    currentUser: CurrentUserType,
    canSeeAll: boolean
  ): void {
    if (!currentUser) {
      throw new ForbiddenException('缺少当前用户信息');
    }
    if (canSeeAll) return;
    const myEmployeeId = currentUser.employeeId ?? null;
    if (!myEmployeeId) {
      throw new ForbiddenException('当前用户未关联员工，无权访问该工单');
    }
    if (record.dispatcherId !== myEmployeeId && record.assigneeId !== myEmployeeId) {
      throw new ForbiddenException('您无权访问该工单');
    }
  }

  /**
   * 序列化单条 ticket（含 isOverdue 派生字段）
   */
  private serializeTicket(record: TicketWithRelations): ProjectTicketResponseOutput {
    const isOverdue =
      !!record.dueDate &&
      record.dueDate.getTime() < Date.now() &&
      ACTIVE_STATUSES.includes(record.status as ProjectTicketStatusValue);

    const attachments: IAttachment[] | null = record.attachments
      ? fromJsonAttachments(record.attachments)
      : null;

    return serializeEntity<ProjectTicketResponseOutput>({
      ...record,
      dueDate: toDateOnlyString(record.dueDate),
      attachments,
      project: record.project
        ? {
            id: record.project.id,
            name: record.project.name,
            customerName: record.project.customer?.customerName ?? null,
          }
        : undefined,
      dispatcher: record.dispatcher
        ? { id: record.dispatcher.id, name: record.dispatcher.name }
        : undefined,
      assignee: record.assignee
        ? { id: record.assignee.id, name: record.assignee.name }
        : undefined,
      isOverdue,
    });
  }

  /**
   * 从 currentUser 解析 employeeId
   * push 6: currentUser.id 直接是 employee.id
   */
  private async requireEmployeeIdFromUser(currentUser: CurrentUserType): Promise<string> {
    return currentUser.employeeId ?? currentUser.id;
  }

  /**
   * 发送通知（失败静默降级）
   */
  private async notifyOnEvent(
    ticket: TicketWithRelations,
    notificationType: ProjectTicketNotificationTypeValue,
    targetEmployeeId: string
  ): Promise<void> {
    try {
      const payload = buildTicketNotification(notificationType, {
        id: ticket.id,
        ticketNo: ticket.ticketNo,
        title: ticket.title,
        projectName: ticket.project?.name ?? null,
        dispatcherName: ticket.dispatcher?.name ?? null,
        assigneeName: ticket.assignee?.name ?? null,
      });

      await this.notificationsService.create({
        employeeId: targetEmployeeId,
        type: notificationType,
        title: payload.title,
        content: payload.content,
        link: payload.link,
      });
    } catch (error) {
      this.logger.warn(
        `[ProjectTickets] 发送通知失败 ticketId=${ticket.id} type=${notificationType}: ${(error as Error).message}`
      );
    }
  }

  /**
   * 根据状态流转决定通知类型
   */
  private transitionToNotificationType(
    toStatus: ProjectTicketStatusValue
  ): ProjectTicketNotificationTypeValue | null {
    switch (toStatus) {
      case PROJECT_TICKET_STATUS.IN_PROGRESS:
        return PROJECT_TICKET_NOTIFICATION_TYPE.STARTED;
      case PROJECT_TICKET_STATUS.COMPLETED:
        return PROJECT_TICKET_NOTIFICATION_TYPE.COMPLETED;
      case PROJECT_TICKET_STATUS.CLOSED:
        return PROJECT_TICKET_NOTIFICATION_TYPE.CLOSED;
      case PROJECT_TICKET_STATUS.CANCELLED:
        return PROJECT_TICKET_NOTIFICATION_TYPE.CANCELLED;
      default:
        return null;
    }
  }

  /**
   * 根据状态流转决定通知对手方 employeeId
   * - STARTED/COMPLETED：通知派单人
   * - CLOSED：通知接单人（派单人关闭时，告知接单人）
   * - CANCELLED：通知另一方（由谁取消则通知对手）
   */
  private pickNotifyTargetForTransition(
    ticket: TicketWithRelations,
    toStatus: ProjectTicketStatusValue
  ): string | null {
    switch (toStatus) {
      case PROJECT_TICKET_STATUS.IN_PROGRESS:
      case PROJECT_TICKET_STATUS.COMPLETED:
        return ticket.dispatcherId;
      case PROJECT_TICKET_STATUS.CLOSED:
        return ticket.assigneeId;
      case PROJECT_TICKET_STATUS.CANCELLED:
        return ticket.dispatcherId; // 默认通知派单人
      default:
        return null;
    }
  }
}
